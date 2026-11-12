import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatCanonicalJson } from "../../serialization/canonicalJson.js";
import { encodeCanonicalJson } from "../../serialization/canonicalJson.js";
import { sha256Hex } from "../../serialization/contentHash.js";
import { calculateContentHash, withoutContentHash } from "./contentHash.js";
import { encodePortableCanonicalJson, portableCanonicalJson } from "./portableCanonicalJson.js";

const bundle = {
  answer: "愛媛の地域課題",
  items: [{ b: true, a: null }, 2],
  meta: { z: 1, contentHash: "a".repeat(64), a: "first" },
};

describe("portableCanonicalJson", () => {
  it("sorts nested keys, uses two spaces and ends with one LF", () => {
    expect(portableCanonicalJson({ z: [2, { b: true, a: null }], a: "愛媛" })).toBe(
      ["{", "  \"a\": \"愛媛\",", "  \"z\": [", "    2,", "    {", "      \"a\": null,", "      \"b\": true", "    }", "  ]", "}", ""].join("\n"),
    );
  });

  it("matches the existing canonical JSON for whitespace, Japanese, nesting and changed key order", () => {
    const first = { z: ["あ", { b: false, a: 1 }], a: { y: null, x: true } };
    const second = { a: { x: true, y: null }, z: ["あ", { a: 1, b: false }] };
    expect(portableCanonicalJson(first)).toBe(formatCanonicalJson(first));
    expect(portableCanonicalJson(second)).toBe(formatCanonicalJson(first));
    expect(encodePortableCanonicalJson(first)).toEqual(encodeCanonicalJson(first));
  });

  it("rejects unsupported values, dangerous keys, sparse arrays and circular references", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const sparse = new Array(2);
    expect(() => portableCanonicalJson({ value: undefined })).toThrow(TypeError);
    expect(() => portableCanonicalJson({ value: Number.NaN })).toThrow(TypeError);
    expect(() => portableCanonicalJson(Object.assign(Object.create(null), { constructor: "x" }))).toThrow(TypeError);
    expect(() => portableCanonicalJson(sparse)).toThrow(TypeError);
    expect(() => portableCanonicalJson(circular)).toThrow(TypeError);
  });

  // Feature: regional-values-map, Property 38: canonical JSON equivalence
  // **Validates: Requirements 11.9, 11.10**
  it("matches the existing formatter for generated ordinary JSON values", () => {
    const value = fc.record({
      z: fc.array(fc.oneof(fc.boolean(), fc.integer(), fc.string({ maxLength: 16 }), fc.constant(null)), { maxLength: 5 }),
      a: fc.record({ b: fc.string({ maxLength: 12 }), c: fc.integer({ min: -200, max: 200 }) }),
    });
    fc.assert(
      fc.property(value, (input) => {
        expect(portableCanonicalJson(input)).toBe(formatCanonicalJson(input));
        expect(encodePortableCanonicalJson(input)).toEqual(encodeCanonicalJson(input));
      }),
      { seed: 350_038, numRuns: 120 },
    );
  });
});

describe("calculateContentHash", () => {
  it("removes only meta.contentHash without changing the input", async () => {
    const before = structuredClone(bundle);
    const without = withoutContentHash(bundle);
    expect(without).toEqual({ answer: "愛媛の地域課題", items: [{ b: true, a: null }, 2], meta: { z: 1, a: "first" } });
    expect(bundle).toEqual(before);
    expect(without).not.toBe(bundle);
    expect(without.meta).not.toBe(bundle.meta);
  });

  it("matches the existing SHA-256 of the canonical bytes", async () => {
    const expected = sha256Hex(encodeCanonicalJson(withoutContentHash(bundle)));
    await expect(calculateContentHash(bundle)).resolves.toBe(expected);
  });

  // Feature: regional-values-map, Property 38: contentHash recomputation
  // **Validates: Requirements 11.9, 11.10**
  it("does not depend on the prior hash field or object key order", async () => {
    const values = fc.array(fc.integer({ min: -2, max: 2 }), { maxLength: 5 });
    await fc.assert(
      fc.asyncProperty(values, async (items) => {
        const first = { meta: { contentHash: "a".repeat(64), z: 1 }, a: "あ", items };
        const second = { items, a: "あ", meta: { z: 1, contentHash: "b".repeat(64) } };
        const expected = sha256Hex(encodeCanonicalJson(withoutContentHash(first)));
        await expect(calculateContentHash(first)).resolves.toBe(expected);
        await expect(calculateContentHash(second)).resolves.toBe(expected);
      }),
      { seed: 350_039, numRuns: 120 },
    );
  });
});