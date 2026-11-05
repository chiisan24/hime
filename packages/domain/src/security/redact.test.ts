import { describe, expect, it } from "vitest";

import {
  MAX_REDACTION_DEPTH,
  REDACTED_VALUE,
  RedactionError,
  containsAwsCredentialPattern,
  containsCredentialPattern,
  detectProtectedTextKind,
  isProtectedKeyName,
  redactProtectedValues,
  serializeRedactedValue,
} from "./redact.js";

const FICTIONAL_ACCESS_KEY_ID = `AKIA${"FAKE".repeat(4)}`;
const FICTIONAL_SECRET_ACCESS_KEY = "FAKE".repeat(10);
const FICTIONAL_SESSION_TOKEN = `IQoJb3JpZ2luX2Vj${"FAKE".repeat(8)}`;
const FICTIONAL_BEARER_TOKEN = "Bearer fictional.header.signature";
const FICTIONAL_ADDRESS = "架空県架空市架空町1丁目2番3号";
const FICTIONAL_COORDINATES = "33.000001, 132.000001";
const FICTIONAL_QUESTION = "架空の政策について教えてください？";

function expectRedactionError(
  operation: () => unknown,
  code: RedactionError["code"],
  forbiddenValue?: string,
): void {
  try {
    operation();
    throw new Error("Expected redaction to reject the input.");
  } catch (error) {
    expect(error).toBeInstanceOf(RedactionError);
    expect((error as RedactionError).code).toBe(code);
    if (forbiddenValue !== undefined) {
      expect(String(error)).not.toContain(forbiddenValue);
      expect(JSON.stringify(error)).not.toContain(forbiddenValue);
    }
  }
}

describe("protected-data detection", () => {
  it.each([
    [FICTIONAL_ACCESS_KEY_ID, "AWS_ACCESS_KEY_ID"],
    [FICTIONAL_SECRET_ACCESS_KEY, "AWS_SECRET_ACCESS_KEY"],
    [FICTIONAL_SESSION_TOKEN, "AWS_SESSION_TOKEN"],
    [FICTIONAL_BEARER_TOKEN, "BEARER_TOKEN"],
    [FICTIONAL_ADDRESS, "ADDRESS"],
    [FICTIONAL_COORDINATES, "COORDINATES"],
    [FICTIONAL_QUESTION, "AI_QUESTION"],
  ] as const)("classifies an explicit fictional %s pattern", (value, kind) => {
    expect(detectProtectedTextKind(value)).toBe(kind);
  });

  it("detects labeled credentials without returning their value", () => {
    expect(
      containsAwsCredentialPattern("aws_secret_access_key=fictional-only"),
    ).toBe(true);
    expect(
      containsAwsCredentialPattern("AWS_SESSION_TOKEN=fictional-only"),
    ).toBe(true);
    expect(containsCredentialPattern(FICTIONAL_BEARER_TOKEN)).toBe(true);
    expect(containsAwsCredentialPattern(FICTIONAL_BEARER_TOKEN)).toBe(false);
  });

  it("provides a pure pre-send AWS credential check for AI questions", () => {
    const question = `この架空文字列を送れますか: ${FICTIONAL_ACCESS_KEY_ID}`;

    expect(containsAwsCredentialPattern(question)).toBe(true);
    expect(containsAwsCredentialPattern("架空の通常質問ですか？")).toBe(false);
    expect(question).toContain(FICTIONAL_ACCESS_KEY_ID);
  });

  it("does not mistake a SHA-256 value or local nonce shape for an AWS secret", () => {
    expect(containsAwsCredentialPattern("a".repeat(64))).toBe(false);
    expect(containsAwsCredentialPattern("A".repeat(43))).toBe(false);
  });

  it.each([
    "aws_access_key_id",
    "secretAccessKey",
    "session-token",
    "authorization",
    "homeAddress",
    "latitude",
    "current_location",
    "questionBody",
    "質問本文",
  ])("recognizes protected key name %s", (key) => {
    expect(isProtectedKeyName(key)).toBe(true);
  });
});

describe("recursive protected-data redaction", () => {
  it("redacts nested object and array values while preserving safe data", () => {
    const input = {
      safe: "keep-this",
      nested: [
        { awsAccessKeyId: FICTIONAL_ACCESS_KEY_ID },
        { detail: `upstream returned ${FICTIONAL_BEARER_TOKEN}` },
        { location: FICTIONAL_ADDRESS },
        { point: [33.123456, 132.654321] },
        { questionText: "key-name-only fictional value" },
      ],
    };
    const before = JSON.stringify(input);

    const output = redactProtectedValues(input);
    const serialized = JSON.stringify(output);

    expect(serialized).toContain("keep-this");
    expect(serialized).toContain(REDACTED_VALUE);
    for (const forbidden of [
      FICTIONAL_ACCESS_KEY_ID,
      FICTIONAL_BEARER_TOKEN,
      FICTIONAL_ADDRESS,
      "33.123456",
      "132.654321",
      "key-name-only fictional value",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("redacts all requested key-name categories even for pattern-free values", () => {
    const input = {
      accessKeyId: "fictional-short-id",
      secretAccessKey: "fictional-short-secret",
      sessionToken: "fictional-short-session",
      bearerToken: "fictional-short-bearer",
      address: "fictional-short-address",
      longitude: 132,
      aiQuestion: "fictional-short-question",
    };

    expect(redactProtectedValues(input)).toEqual({
      accessKeyId: REDACTED_VALUE,
      address: REDACTED_VALUE,
      aiQuestion: REDACTED_VALUE,
      bearerToken: REDACTED_VALUE,
      longitude: REDACTED_VALUE,
      secretAccessKey: REDACTED_VALUE,
      sessionToken: REDACTED_VALUE,
    });
  });

  it("omits a property when the property name itself contains a protected value", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.safe = "visible";
    input[FICTIONAL_ACCESS_KEY_ID] = "fictional property value";

    const serialized = serializeRedactedValue(input);

    expect(serialized).toContain("visible");
    expect(serialized).not.toContain(FICTIONAL_ACCESS_KEY_ID);
    expect(serialized).not.toContain("fictional property value");
  });

  it("allows repeated non-cyclic references and never mutates them", () => {
    const shared = { value: FICTIONAL_SECRET_ACCESS_KEY };
    const input = { first: shared, second: shared };

    expect(redactProtectedValues(input)).toEqual({
      first: { value: REDACTED_VALUE },
      second: { value: REDACTED_VALUE },
    });
    expect(shared.value).toBe(FICTIONAL_SECRET_ACCESS_KEY);
  });

  it("rejects a circular graph with a fixed value-free error", () => {
    const input: { secret: string; self?: unknown } = {
      secret: FICTIONAL_ACCESS_KEY_ID,
    };
    input.self = input;

    expectRedactionError(
      () => redactProtectedValues(input),
      "CIRCULAR_REFERENCE",
      FICTIONAL_ACCESS_KEY_ID,
    );
  });

  it("rejects a getter without invoking it or exposing its closed-over value", () => {
    let getterCalls = 0;
    const input = {};
    Object.defineProperty(input, "detail", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return FICTIONAL_SESSION_TOKEN;
      },
    });

    expectRedactionError(
      () => redactProtectedValues(input),
      "ACCESSOR_PROPERTY",
      FICTIONAL_SESSION_TOKEN,
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects proxies before invoking their traps", () => {
    let trapCalls = 0;
    const input = new Proxy(
      { detail: FICTIONAL_BEARER_TOKEN },
      {
        ownKeys: () => {
          trapCalls += 1;
          return ["detail"];
        },
      },
    );

    expectRedactionError(
      () => redactProtectedValues(input),
      "UNSAFE_PROXY",
      FICTIONAL_BEARER_TOKEN,
    );
    expect(trapCalls).toBe(0);
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects dangerous key %s",
    (key) => {
      const input = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(input, key, {
        configurable: true,
        enumerable: true,
        value: FICTIONAL_SECRET_ACCESS_KEY,
        writable: true,
      });

      expectRedactionError(
        () => redactProtectedValues(input),
        "DANGEROUS_KEY",
        FICTIONAL_SECRET_ACCESS_KEY,
      );
    },
  );

  it("rejects unsafe array shapes and unsupported JSON values", () => {
    expectRedactionError(
      () => redactProtectedValues(new Array(1)),
      "SPARSE_ARRAY",
    );

    const custom = [1] as number[] & { detail?: string };
    custom.detail = FICTIONAL_ACCESS_KEY_ID;
    expectRedactionError(
      () => redactProtectedValues(custom),
      "UNSAFE_ARRAY_PROPERTY",
      FICTIONAL_ACCESS_KEY_ID,
    );

    expectRedactionError(
      () => redactProtectedValues({ value: undefined }),
      "UNSUPPORTED_VALUE",
    );
    expectRedactionError(
      () => redactProtectedValues({ value: Number.NaN }),
      "NON_FINITE_NUMBER",
    );
    expectRedactionError(
      () => redactProtectedValues(new Date()),
      "UNSAFE_PROTOTYPE",
    );
  });

  it("rejects nesting beyond the documented limit", () => {
    let input: unknown = "safe";
    for (let depth = 0; depth <= MAX_REDACTION_DEPTH; depth += 1) {
      input = [input];
    }

    expectRedactionError(
      () => redactProtectedValues(input),
      "MAX_DEPTH_EXCEEDED",
    );
  });
});
