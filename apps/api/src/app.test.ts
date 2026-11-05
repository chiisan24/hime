import { describe, expect, it } from "vitest";

import { createSupertestAppFactory } from "../../../tests/harness/supertest-app.js";
import { HealthResponseSchema, createApp } from "./app.js";
import { SessionResponseSchema } from "./routes/session.js";

const ALLOWED_HOST = "127.0.0.1:8787";
const ALLOWED_ORIGIN = "http://127.0.0.1:5173";

function requestApp() {
  return createSupertestAppFactory(createApp)();
}

describe("local API application", () => {
  it.each(["/health", "/api/v1/health"])(
    "returns schema-valid NOT_READY health at %s without a nonce",
    async (path) => {
      const response = await requestApp()
        .get(path)
        .set("Host", ALLOWED_HOST)
        .set("Origin", ALLOWED_ORIGIN)
        .expect(200);

      expect(HealthResponseSchema.parse(response.body)).toEqual({
        service: "ehime-vote-navigator-api",
        status: "ok",
        readiness: "NOT_READY",
      });
    },
  );

  it.each([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
  ])("allows the configured Vite Origin %s", async (origin) => {
    const response = await requestApp()
      .get("/health")
      .set("Host", "localhost:8787")
      .set("Origin", origin)
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("returns one memory-only nonce from the guarded localhost session route", async () => {
    const app = createApp();
    const requestSession = createSupertestAppFactory(() => app);

    const firstResponse = await requestSession()
      .get("/api/v1/session")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);
    const secondResponse = await requestSession()
      .get("/api/v1/session")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);

    const first = SessionResponseSchema.parse(firstResponse.body);
    const second = SessionResponseSchema.parse(secondResponse.body);
    expect(second.data.nonce).toBe(first.data.nonce);
    expect(second.requestId).not.toBe(first.requestId);

    for (const [response, session] of [
      [firstResponse, first],
      [secondResponse, second],
    ] as const) {
      expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(response.headers.expires).toBe("0");
      expect(response.headers.pragma).toBe("no-cache");

      const serializedHeaders = JSON.stringify(response.headers);
      expect(serializedHeaders).not.toContain(session.data.nonce);
      expect(serializedHeaders).not.toContain(session.requestId);
    }
  });

  it("rotates the session nonce when a new application process composition is created", async () => {
    const firstResponse = await createSupertestAppFactory(createApp)()
      .get("/api/v1/session")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);
    const secondResponse = await createSupertestAppFactory(createApp)()
      .get("/api/v1/session")
      .set("Host", ALLOWED_HOST)
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);

    const first = SessionResponseSchema.parse(firstResponse.body);
    const second = SessionResponseSchema.parse(secondResponse.body);
    expect(second.data.nonce).not.toBe(first.data.nonce);
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("permits an originless in-process health request only in explicit test mode", async () => {
    const response = await createSupertestAppFactory(() =>
      createApp({ allowOriginlessTestRequests: true }),
    )()
      .get("/health")
      .set("Host", ALLOWED_HOST)
      .expect(200);

    expect(HealthResponseSchema.parse(response.body).status).toBe("ok");
  });
});
