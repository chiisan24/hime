import { ApiErrorSchema } from "@ehime-vote-navigator/contracts";
import { REDACTED_VALUE } from "@ehime-vote-navigator/domain";
import express from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSupertestAppFactory } from "../../../../tests/harness/supertest-app.js";
import {
  SAFE_RESPONSE_PROJECTION_ERROR,
  projectApiResponse,
  sendProjectedJson,
} from "./responseProjection.js";

const FICTIONAL_ACCESS_KEY_ID = `AKIA${"FAKE".repeat(4)}`;
const FICTIONAL_BEARER_TOKEN = "Bearer fictional.header.signature";
const RECORDED_NONCE_COUNTEREXAMPLE =
  "_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ";
const RECORDED_REQUEST_ID_COUNTEREXAMPLE =
  "71f9383a-0201-4659-ba07-06d9d35b0302";

const SafeDtoSchema = z
  .object({
    detail: z.string(),
    status: z.literal("ok"),
  })
  .strict();

const GenericCounterexampleDtoSchema = z
  .object({
    primary: z.string(),
    secondary: z.string().optional(),
    status: z.literal("ok"),
  })
  .strict();

const ExactCounterexampleDtoSchema = z
  .object({
    primary: z.union([
      z.literal(RECORDED_NONCE_COUNTEREXAMPLE),
      z.literal(RECORDED_REQUEST_ID_COUNTEREXAMPLE),
    ]),
    secondary: z.literal(RECORDED_REQUEST_ID_COUNTEREXAMPLE).optional(),
    status: z.literal("ok"),
  })
  .strict();

const GENERIC_COUNTEREXAMPLE_CASES = Object.freeze([
  Object.freeze({
    name: "nonce only",
    candidate: Object.freeze({
      primary: RECORDED_NONCE_COUNTEREXAMPLE,
      status: "ok" as const,
    }),
  }),
  Object.freeze({
    name: "request ID only",
    candidate: Object.freeze({
      primary: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      status: "ok" as const,
    }),
  }),
  Object.freeze({
    name: "nonce and request ID together",
    candidate: Object.freeze({
      primary: RECORDED_NONCE_COUNTEREXAMPLE,
      secondary: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      status: "ok" as const,
    }),
  }),
]);

describe("API response projection", () => {
  it("redacts first and returns only a value that the strict schema re-decodes", () => {
    const candidate = {
      status: "ok",
      detail: FICTIONAL_BEARER_TOKEN,
    };

    const projection = projectApiResponse(SafeDtoSchema, candidate);

    expect(projection).toEqual({
      body: { detail: REDACTED_VALUE, status: "ok" },
      ok: true,
    });
    expect(JSON.stringify(projection)).not.toContain(
      "fictional.header.signature",
    );
    expect(candidate.detail).toBe(FICTIONAL_BEARER_TOKEN);
  });

  it("uses the fixed safe error when redaction makes the DTO invalid", () => {
    const constrainedSchema = z
      .object({
        detail: z.literal("public-detail"),
        status: z.literal("ok"),
      })
      .strict();

    const projection = projectApiResponse(constrainedSchema, {
      status: "ok",
      detail: FICTIONAL_ACCESS_KEY_ID,
    });

    expect(projection).toEqual({
      body: SAFE_RESPONSE_PROJECTION_ERROR,
      ok: false,
    });
    expect(ApiErrorSchema.parse(projection.body)).toEqual(
      SAFE_RESPONSE_PROJECTION_ERROR,
    );
    expect(JSON.stringify(projection)).not.toContain(FICTIONAL_ACCESS_KEY_ID);
  });

  it("fails closed for unknown keys and unsafe object graphs", () => {
    const extraKeyProjection = projectApiResponse(SafeDtoSchema, {
      detail: "public detail",
      extra: "must-not-be-projected",
      status: "ok",
    });
    expect(extraKeyProjection.ok).toBe(false);
    expect(JSON.stringify(extraKeyProjection)).not.toContain(
      "must-not-be-projected",
    );

    let getterCalls = 0;
    const unsafe = { status: "ok" } as Record<string, unknown>;
    Object.defineProperty(unsafe, "detail", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return FICTIONAL_ACCESS_KEY_ID;
      },
    });

    const unsafeProjection = projectApiResponse(SafeDtoSchema, unsafe);
    expect(unsafeProjection.ok).toBe(false);
    expect(JSON.stringify(unsafeProjection)).not.toContain(
      FICTIONAL_ACCESS_KEY_ID,
    );
    expect(getterCalls).toBe(0);
  });

  it("audits schema transform output before allowing serialization", () => {
    const unsafeTransformSchema = z
      .object({ status: z.literal("ok") })
      .strict()
      .transform(({ status }) => ({
        detail: FICTIONAL_ACCESS_KEY_ID,
        status,
      }));

    const projection = projectApiResponse(unsafeTransformSchema, {
      status: "ok",
    });

    expect(projection.ok).toBe(false);
    expect(JSON.stringify(projection)).not.toContain(FICTIONAL_ACCESS_KEY_ID);
  });

  it("sends the fixed safe body with status 500 after projection failure", async () => {
    const app = express();
    app.get("/projected", (_request, response) => {
      sendProjectedJson(response, 200, SafeDtoSchema, {
        detail: "public detail",
        extra: FICTIONAL_ACCESS_KEY_ID,
        status: "ok",
      });
    });

    const response = await createSupertestAppFactory(() => app)()
      .get("/projected")
      .expect(500);

    expect(response.body).toEqual(SAFE_RESPONSE_PROJECTION_ERROR);
    expect(JSON.stringify(response.body)).not.toContain(
      FICTIONAL_ACCESS_KEY_ID,
    );
  });
});

describe("Property 2: Preservation - generic response projection", () => {
  // Feature: session-api-redaction-regression, Property 2: Preservation
  // **Validates: Requirements 3.5, 3.6**
  it.each(GENERIC_COUNTEREXAMPLE_CASES)(
    "continues to redact $name outside the session schema",
    ({ candidate }) => {
      const before = JSON.stringify(candidate);
      const projection = projectApiResponse(
        GenericCounterexampleDtoSchema,
        candidate,
      );
      const expectedBody =
        "secondary" in candidate
          ? {
              primary: REDACTED_VALUE,
              secondary: REDACTED_VALUE,
              status: "ok",
            }
          : { primary: REDACTED_VALUE, status: "ok" };

      expect(projection).toEqual({ body: expectedBody, ok: true });
      expect(JSON.stringify(projection)).not.toContain(
        RECORDED_NONCE_COUNTEREXAMPLE,
      );
      expect(JSON.stringify(projection)).not.toContain(
        RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      );
      expect(JSON.stringify(candidate)).toBe(before);
    },
  );

  it.each(GENERIC_COUNTEREXAMPLE_CASES)(
    "continues to fail closed when strict $name fields cannot accept the marker",
    ({ candidate }) => {
      const before = JSON.stringify(candidate);
      const projection = projectApiResponse(
        ExactCounterexampleDtoSchema,
        candidate,
      );

      expect(projection).toEqual({
        body: SAFE_RESPONSE_PROJECTION_ERROR,
        ok: false,
      });
      expect(JSON.stringify(projection)).not.toContain(
        RECORDED_NONCE_COUNTEREXAMPLE,
      );
      expect(JSON.stringify(projection)).not.toContain(
        RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      );
      expect(JSON.stringify(candidate)).toBe(before);
    },
  );
});