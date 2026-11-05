import express, { type Express } from "express";
import { describe, expect, it, vi } from "vitest";

import { createSupertestAppFactory } from "../../../../tests/harness/supertest-app.js";
import {
  LOCAL_JSON_BODY_LIMIT_BYTES,
  LOCAL_NONCE_HEADER,
  createLocalBoundaryMiddleware,
  createLocalMutationJsonParser,
  handleLocalBoundaryError,
} from "./localBoundary.js";
import {
  createLocalNonce,
  type LocalNonce,
} from "./localNonce.js";
import { registerSessionRoute } from "../routes/session.js";

const ALLOWED_HOST = "127.0.0.1:8787";
const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const SAFE_CONTROL_NONCE = "A".repeat(43);

type SessionBoundaryHarness = Readonly<{
  app: Express;
  matches: LocalNonce["matches"];
  revealForSession: LocalNonce["revealForSession"];
}>;

type MutationHarness = Readonly<{
  app: Express;
  nonce: string;
  useCase: ReturnType<typeof vi.fn>;
}>;

function createSessionBoundaryHarness(): SessionBoundaryHarness {
  const matches = vi.fn<(candidate: string | undefined) => boolean>(() => false);
  const revealForSession = vi.fn<() => string>(() => SAFE_CONTROL_NONCE);
  const nonce: LocalNonce = Object.freeze({ matches, revealForSession });
  const app = express();

  app.use(
    createLocalBoundaryMiddleware({
      nonce,
      runtimeEnvironment: "test",
    }),
  );
  registerSessionRoute(app, nonce);

  return Object.freeze({ app, matches, revealForSession });
}

function createMutationHarness(): MutationHarness {
  const nonce = createLocalNonce();
  const useCase = vi.fn();
  const app = express();

  app.use(
    createLocalBoundaryMiddleware({
      nonce,
      runtimeEnvironment: "test",
    }),
  );
  app.use(createLocalMutationJsonParser());
  app.all("/mutation", (request, response) => {
    useCase(request.body);
    response.status(204).end();
  });
  app.get("/read", (_request, response) => {
    useCase();
    response.status(200).json({ ok: true });
  });
  app.use(handleLocalBoundaryError);

  return Object.freeze({
    app,
    nonce: nonce.revealForSession(),
    useCase,
  });
}

function requestHarness(harness: MutationHarness) {
  return createSupertestAppFactory(() => harness.app)();
}

describe("local API request boundary", () => {
  it("allows a JSON POST only after every boundary condition passes", async () => {
    const harness = createMutationHarness();

    await requestHarness(harness)
      .post("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "application/json; charset=utf-8")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send({ action: "test" })
      .expect(204);

    expect(harness.useCase).toHaveBeenCalledOnce();
    expect(harness.useCase).toHaveBeenCalledWith({ action: "test" });
  });

  it("rejects a Host outside the loopback host/port allowlist before the use case", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .post("/mutation")
      .set("Host", "evil.example:8787")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "application/json")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send({ action: "test" })
      .expect(403);

    expect(response.body.error.fields).toEqual(["host"]);
    expect(JSON.stringify(response.body)).not.toContain("evil.example");
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("rejects a missing Origin before the use case", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .post("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Content-Type", "application/json")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send({ action: "test" })
      .expect(403);

    expect(response.body.error.fields).toEqual(["origin"]);
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("rejects a method outside the allowlist before the use case", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .put("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "application/json")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send({ action: "test" })
      .expect(405);

    expect(response.body.error.fields).toEqual(["method"]);
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON Content-Type before the use case", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .post("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "text/plain")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send("{}")
      .expect(415);

    expect(response.body.error.fields).toEqual(["content-type"]);
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("rejects a JSON body larger than 1 MiB before the use case", async () => {
    const harness = createMutationHarness();
    const oversizedJson = JSON.stringify({
      value: "x".repeat(LOCAL_JSON_BODY_LIMIT_BYTES),
    });

    const response = await requestHarness(harness)
      .post("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "application/json")
      .set(LOCAL_NONCE_HEADER, harness.nonce)
      .send(oversizedJson)
      .expect(413);

    expect(response.body.error.fields).toEqual(["body"]);
    expect(response.body.error.message).not.toContain(oversizedJson);
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("rejects a missing mutation nonce before the use case", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .post("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Content-Type", "application/json")
      .send({ action: "test" })
      .expect(403);

    expect(response.body.error.fields).toEqual([LOCAL_NONCE_HEADER]);
    expect(JSON.stringify(response.body)).not.toContain(harness.nonce);
    expect(harness.useCase).not.toHaveBeenCalled();
  });

  it("does not require a nonce for a read-only route", async () => {
    const harness = createMutationHarness();

    await requestHarness(harness)
      .get("/read")
      .set("Host", "localhost:8787")
      .set("Origin", "http://localhost:4173")
      .expect(200, { ok: true });

    expect(harness.useCase).toHaveBeenCalledOnce();
  });

  it("allows originless requests only when the in-process test mode is explicit", async () => {
    const nonce = createLocalNonce();
    const useCase = vi.fn();
    const app = express();
    app.use(
      createLocalBoundaryMiddleware({
        allowOriginlessTestRequests: true,
        nonce,
        runtimeEnvironment: "test",
      }),
    );
    app.get("/read", (_request, response) => {
      useCase();
      response.status(204).end();
    });

    await createSupertestAppFactory(() => app)()
      .get("/read")
      .set("Host", ALLOWED_HOST)
      .expect(204);

    expect(useCase).toHaveBeenCalledOnce();
    expect(() =>
      createLocalBoundaryMiddleware({
        allowOriginlessTestRequests: true,
        nonce,
        runtimeEnvironment: "production",
      }),
    ).toThrow(/in-process test harness/u);
  });

  it("returns a bounded CORS preflight only for the local mutation contract", async () => {
    const harness = createMutationHarness();

    const response = await requestHarness(harness)
      .options("/mutation")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        `content-type,${LOCAL_NONCE_HEADER}`,
      )
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe(
      ALLOWED_ORIGIN,
    );
    expect(harness.useCase).not.toHaveBeenCalled();
  });
});

describe("local mutation nonce", () => {
  it("uses a fresh 256-bit value that is not serialized with its capability", () => {
    const first = createLocalNonce();
    const second = createLocalNonce();
    const firstValue = first.revealForSession();

    expect(Buffer.from(firstValue, "base64url")).toHaveLength(32);
    expect(firstValue).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second.revealForSession()).not.toBe(firstValue);
    expect(first.matches(firstValue)).toBe(true);
    expect(first.matches(`${firstValue}x`)).toBe(false);
    expect(first.matches(undefined)).toBe(false);
    expect(JSON.stringify(first)).not.toContain(firstValue);
  });
});

describe("Property 2: Preservation - session local boundary", () => {
  // Feature: session-api-redaction-regression, Property 2: Preservation
  // **Validates: Requirements 3.8**
  it.each([
    {
      boundary: "Host",
      expectedField: "host",
      host: "evil.example:8787",
      origin: ALLOWED_ORIGIN,
    },
    {
      boundary: "Origin",
      expectedField: "origin",
      host: ALLOWED_HOST,
      origin: "https://evil.example",
    },
  ])(
    "rejects a disallowed $boundary before revealing the session nonce",
    async ({ expectedField, host, origin }) => {
      const harness = createSessionBoundaryHarness();

      const response = await createSupertestAppFactory(() => harness.app)()
        .get("/api/v1/session")
        .set("Host", host)
        .set("Origin", origin)
        .expect(403);

      expect(response.body.error.fields).toEqual([expectedField]);
      expect(harness.revealForSession).not.toHaveBeenCalled();
      expect(harness.matches).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain(SAFE_CONTROL_NONCE);
      expect(JSON.stringify(response.headers)).not.toContain(
        SAFE_CONTROL_NONCE,
      );
    },
  );
});