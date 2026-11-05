import { ApiErrorSchema } from "@ehime-vote-navigator/contracts";
import {
  REDACTED_VALUE,
  RedactionError,
  redactProtectedValues,
  serializeRedactedValue,
} from "@ehime-vote-navigator/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { projectApiResponse } from "../http/responseProjection.js";
import { serializeSafeLogEvent } from "./safeLogger.js";

const FICTIONAL_ACCESS_KEY_ID = `AKIA${"FAKE".repeat(4)}`;
const FICTIONAL_SECRET_ACCESS_KEY = "FAKE".repeat(10);
const FICTIONAL_SESSION_TOKEN = `IQoJb3JpZ2luX2Vj${"FAKE".repeat(8)}`;
const RECORDED_NONCE_COUNTEREXAMPLE =
  "_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ";
const RECORDED_REQUEST_ID_COUNTEREXAMPLE =
  "71f9383a-0201-4659-ba07-06d9d35b0302";

const LOGGER_COUNTEREXAMPLE_CASES = Object.freeze([
  Object.freeze({
    name: "nonce only",
    event: Object.freeze({ nonceReplica: RECORDED_NONCE_COUNTEREXAMPLE }),
    expected: Object.freeze({ nonceReplica: REDACTED_VALUE }),
  }),
  Object.freeze({
    name: "request ID only",
    event: Object.freeze({
      requestIdReplica: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
    }),
    expected: Object.freeze({ requestIdReplica: REDACTED_VALUE }),
  }),
  Object.freeze({
    name: "nonce and request ID together",
    event: Object.freeze({
      nonceReplica: RECORDED_NONCE_COUNTEREXAMPLE,
      requestIdReplica: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
    }),
    expected: Object.freeze({
      nonceReplica: REDACTED_VALUE,
      requestIdReplica: REDACTED_VALUE,
    }),
  }),
]);

const SinkResponseSchema = z
  .object({
    payload: z.unknown(),
  })
  .strict();

type ForbiddenCase = Readonly<{
  key: string;
  needle: string;
  value: unknown;
}>;

const FORBIDDEN_CASES: readonly ForbiddenCase[] = Object.freeze([
  {
    key: "detail",
    needle: FICTIONAL_ACCESS_KEY_ID,
    value: FICTIONAL_ACCESS_KEY_ID,
  },
  {
    key: "detail",
    needle: FICTIONAL_SECRET_ACCESS_KEY,
    value: FICTIONAL_SECRET_ACCESS_KEY,
  },
  {
    key: "detail",
    needle: FICTIONAL_SESSION_TOKEN,
    value: FICTIONAL_SESSION_TOKEN,
  },
  {
    key: "detail",
    needle: "fictional.header.signature",
    value: "Bearer fictional.header.signature",
  },
  {
    key: "detail",
    needle: "架空県架空市架空町1丁目2番3号",
    value: "架空県架空市架空町1丁目2番3号",
  },
  {
    key: "detail",
    needle: "33.000001",
    value: "33.000001, 132.000001",
  },
  {
    key: "detail",
    needle: "架空の政策について教えてください",
    value: "架空の政策について教えてください？",
  },
  {
    key: "awsAccessKeyId",
    needle: "fictional-access-field-value",
    value: "fictional-access-field-value",
  },
  {
    key: "secretAccessKey",
    needle: "fictional-secret-field-value",
    value: "fictional-secret-field-value",
  },
  {
    key: "sessionToken",
    needle: "fictional-session-field-value",
    value: "fictional-session-field-value",
  },
  {
    key: "bearerToken",
    needle: "fictional-bearer-field-value",
    value: "fictional-bearer-field-value",
  },
  {
    key: "address",
    needle: "fictional-address-field-value",
    value: "fictional-address-field-value",
  },
  {
    key: "latitude",
    needle: "33.123456",
    value: 33.123456,
  },
  {
    key: "questionBody",
    needle: "fictional-question-field-value",
    value: "fictional-question-field-value",
  },
]);

const forbiddenCaseArbitrary = fc.constantFrom(...FORBIDDEN_CASES);
const wrappersArbitrary = fc.array(fc.constantFrom("ARRAY", "OBJECT" as const), {
  maxLength: 12,
});

function nestAtArbitraryDepth(
  forbidden: ForbiddenCase,
  wrappers: readonly ("ARRAY" | "OBJECT")[],
  marker: number,
): unknown {
  let nested: unknown = {
    [forbidden.key]: forbidden.value,
    safeSibling: `safe-${marker}`,
  };

  wrappers.forEach((wrapper, index) => {
    nested =
      wrapper === "ARRAY"
        ? [`safe-array-${marker}-${index}`, nested]
        : {
            [`layer${index}`]: nested,
            safeSibling: `safe-object-${marker}-${index}`,
          };
  });

  return nested;
}

function responseSerialization(input: unknown): string {
  const projection = projectApiResponse(SinkResponseSchema, {
    payload: input,
  });

  expect(projection.ok).toBe(true);
  return JSON.stringify(projection.body);
}

function fixedErrorSerialization(input: unknown): string {
  const projection = projectApiResponse(ApiErrorSchema, input);
  return JSON.stringify(projection.body);
}

describe("Property 34: protected input non-disclosure", () => {
  // Feature: ehime-vote-navigator, Property 34: 秘密情報と保護対象入力の非流出
  // **Validates: Requirements 14.11, 15.14, 19.9, 20.8, 20.12, 20.13**
  it("removes every inserted fictional forbidden value from every serialized sink", () => {
    fc.assert(
      fc.property(
        forbiddenCaseArbitrary,
        wrappersArbitrary,
        fc.integer({ min: 0, max: 1_000_000 }),
        (forbidden, wrappers, marker) => {
          const nested = nestAtArbitraryDepth(forbidden, wrappers, marker);
          const before = JSON.stringify(nested);
          const encodedUrl = `http://localhost/sink?${forbidden.key}=${encodeURIComponent(
            String(forbidden.value),
          )}`;

          const serializedSinks = [
            serializeRedactedValue({ diagnostic: nested }),
            serializeRedactedValue({ runHistory: nested }),
            serializeRedactedValue({ persistentStore: nested }),
            serializeRedactedValue({ url: encodedUrl }),
            serializeRedactedValue({ apiDto: nested }),
            responseSerialization(nested),
            serializeSafeLogEvent("INFO", nested),
          ];

          for (const serialized of serializedSinks) {
            expect(serialized).not.toContain(forbidden.needle);
          }
          expect(serializedSinks[3]).toContain(REDACTED_VALUE);
          expect(JSON.stringify(nested)).toBe(before);

          let getterCalls = 0;
          const unsafe = {};
          Object.defineProperty(unsafe, "payload", {
            enumerable: true,
            get: () => {
              getterCalls += 1;
              return forbidden.value;
            },
          });

          try {
            redactProtectedValues(unsafe);
            throw new Error("Expected unsafe property rejection.");
          } catch (error) {
            expect(error).toBeInstanceOf(RedactionError);
            expect(String(error)).not.toContain(forbidden.needle);
            expect(JSON.stringify(error)).not.toContain(forbidden.needle);
          }
          expect(getterCalls).toBe(0);

          const fixedError = fixedErrorSerialization(unsafe);
          expect(fixedError).not.toContain(forbidden.needle);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 2: Preservation - safe logger", () => {
  // Feature: session-api-redaction-regression, Property 2: Preservation
  // **Validates: Requirements 3.6, 3.7**
  it.each(LOGGER_COUNTEREXAMPLE_CASES)(
    "keeps $name redacted in a non-session event without mutating input",
    ({ event, expected }) => {
      const before = JSON.stringify(event);
      const line = serializeSafeLogEvent("INFO", event);

      expect(JSON.parse(line)).toEqual({
        event: expected,
        level: "INFO",
      });
      expect(line).toContain(REDACTED_VALUE);
      expect(line).not.toContain(RECORDED_NONCE_COUNTEREXAMPLE);
      expect(line).not.toContain(RECORDED_REQUEST_ID_COUNTEREXAMPLE);
      expect(JSON.stringify(event)).toBe(before);
    },
  );
});