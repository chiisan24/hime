import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  MAX_CANONICAL_JSON_DEPTH,
  encodeCanonicalJson,
  formatCanonicalJson,
} from "./canonicalJson.js";
import {
  createCanonicalJsonArtifact,
  hashCanonicalJson,
  sha256Hex,
} from "./contentHash.js";

function expectCanonicalError(
  run: () => unknown,
  code: CanonicalJsonError["code"],
): void {
  try {
    run();
    throw new Error("Expected canonical JSON formatting to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalJsonError);
    expect((error as CanonicalJsonError).code).toBe(code);
  }
}

describe("canonical JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value = {
      z: 3,
      nested: { z: false, a: null },
      array: [{ y: 2, x: 1 }, "last"],
      a: "first",
    };

    expect(formatCanonicalJson(value)).toBe(
      [
        "{",
        '  "a": "first",',
        '  "array": [',
        "    {",
        '      "x": 1,',
        '      "y": 2',
        "    },",
        '    "last"',
        "  ],",
        '  "nested": {',
        '    "a": null,',
        '    "z": false',
        "  },",
        '  "z": 3',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("uses UTF-8 and LF without normalizing Unicode input", () => {
    const value = {
      decomposed: "e\u0301",
      emoji: "🍊",
      japanese: "愛媛",
      lineBreaks: "first\r\nsecond\nthird",
    };

    const text = formatCanonicalJson(value);
    const bytes = encodeCanonicalJson(value);

    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(text);
    expect(text).toContain("愛媛");
    expect(text).toContain("🍊");
    expect(text).toContain("e\u0301");
    expect(text).toContain("first\\r\\nsecond\\nthird");
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is independent of insertion order and does not mutate the input", () => {
    const first = { c: 3, a: { y: 2, x: 1 }, b: [2, 1] };
    const second = { b: [2, 1], a: { x: 1, y: 2 }, c: 3 };
    const firstKeys = Object.keys(first);
    const nestedKeys = Object.keys(first.a);

    const firstText = formatCanonicalJson(first);
    const secondText = formatCanonicalJson(second);

    expect(firstText).toBe(secondText);
    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second));
    expect(Object.keys(first)).toEqual(firstKeys);
    expect(Object.keys(first.a)).toEqual(nestedKeys);
    expect(first).toEqual({ c: 3, a: { y: 2, x: 1 }, b: [2, 1] });
  });

  it("allows repeated non-cyclic references and null-prototype records", () => {
    const shared = { value: "same" };
    const record = Object.create(null) as Record<string, unknown>;
    record.right = shared;
    record.left = shared;

    expect(formatCanonicalJson(record)).toBe(
      [
        "{",
        '  "left": {',
        '    "value": "same"',
        "  },",
        '  "right": {',
        '    "value": "same"',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it.each([
    [undefined, "UNSUPPORTED_VALUE"],
    [1n, "UNSUPPORTED_VALUE"],
    [Symbol("value"), "UNSUPPORTED_VALUE"],
    [() => undefined, "UNSUPPORTED_VALUE"],
    [Number.NaN, "NON_FINITE_NUMBER"],
    [Number.POSITIVE_INFINITY, "NON_FINITE_NUMBER"],
    [new Date(0), "UNSAFE_PROTOTYPE"],
    [new Map(), "UNSAFE_PROTOTYPE"],
  ] as const)("rejects a non-JSON or unsafe value", (value, code) => {
    expectCanonicalError(() => formatCanonicalJson(value), code);
  });

  it("rejects unsupported values inside objects and arrays instead of dropping or coercing them", () => {
    expectCanonicalError(
      () => formatCanonicalJson({ accepted: true, omitted: undefined }),
      "UNSUPPORTED_VALUE",
    );
    expectCanonicalError(
      () => formatCanonicalJson(["accepted", undefined]),
      "UNSUPPORTED_VALUE",
    );
  });

  it("rejects circular references", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expectCanonicalError(
      () => formatCanonicalJson(value),
      "CIRCULAR_REFERENCE",
    );
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the dangerous key %s",
    (key) => {
      const value = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        value: "unsafe",
        writable: true,
      });

      expectCanonicalError(() => formatCanonicalJson(value), "DANGEROUS_KEY");
    },
  );

  it("rejects a polluted prototype without reading inherited data", () => {
    const inherited = { inherited: "unsafe" };
    const value = Object.create(inherited) as Record<string, unknown>;
    value.own = "value";

    expectCanonicalError(
      () => formatCanonicalJson(value),
      "UNSAFE_PROTOTYPE",
    );
  });

  it("rejects getters without invoking them", () => {
    let getterCalls = 0;
    const value = {};
    Object.defineProperty(value, "secret", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "value";
      },
    });

    expectCanonicalError(() => formatCanonicalJson(value), "ACCESSOR_PROPERTY");
    expect(getterCalls).toBe(0);
  });

  it("rejects symbols, proxies, sparse arrays, and custom array properties", () => {
    const symbolRecord = { safe: true } as Record<PropertyKey, unknown>;
    symbolRecord[Symbol("hidden")] = "value";
    expectCanonicalError(
      () => formatCanonicalJson(symbolRecord),
      "SYMBOL_KEY",
    );

    expectCanonicalError(
      () => formatCanonicalJson(new Proxy({ safe: true }, {})),
      "UNSAFE_PROXY",
    );

    expectCanonicalError(
      () => formatCanonicalJson(new Array(1)),
      "SPARSE_ARRAY",
    );

    const customArray = [1] as number[] & { extra?: string };
    customArray.extra = "value";
    expectCanonicalError(
      () => formatCanonicalJson(customArray),
      "UNSAFE_ARRAY_PROPERTY",
    );
  });

  it("rejects nesting beyond the documented safety limit", () => {
    let value: unknown = null;
    for (let depth = 0; depth <= MAX_CANONICAL_JSON_DEPTH; depth += 1) {
      value = [value];
    }

    expectCanonicalError(
      () => formatCanonicalJson(value),
      "MAX_DEPTH_EXCEEDED",
    );
  });
});

describe("content hashes", () => {
  it("matches the standard SHA-256 test vector using lowercase hex", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the exact canonical UTF-8 bytes reproducibly", () => {
    const value = { z: "🍊", a: "愛媛" };
    const artifact = createCanonicalJsonArtifact(value);
    const nodeReference = createHash("sha256")
      .update(artifact.bytes)
      .digest("hex");

    expect(artifact.contentHash).toBe(nodeReference);
    expect(hashCanonicalJson(value)).toBe(nodeReference);
    expect(artifact.bytes).toEqual(encodeCanonicalJson(value));
    expect(artifact.text).toBe(formatCanonicalJson(value));
    expect(artifact.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("changes the digest when canonical content changes", () => {
    expect(hashCanonicalJson({ value: "one" })).not.toBe(
      hashCanonicalJson({ value: "two" }),
    );
  });
});
