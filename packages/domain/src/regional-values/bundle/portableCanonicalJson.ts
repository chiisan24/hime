/**
 * Browser-safe canonical JSON. It sorts every object key, uses two-space indentation
 * and one final LF. It deliberately imports neither node:util nor any Node module.
 */

export const PORTABLE_CANONICAL_JSON_MAX_DEPTH = 100;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function fail(): never {
  // Deliberately content-free: callers can show a fixed message without exposing data.
  throw new TypeError("The value is not safe canonical JSON");
}

function normalized(value: unknown, depth: number, ancestors: WeakSet<object>): JsonValue {
  if (depth > PORTABLE_CANONICAL_JSON_MAX_DEPTH) {
    return fail();
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fail();
  }
  if (typeof value !== "object") {
    return fail();
  }
  if (ancestors.has(value)) {
    return fail();
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        return fail();
      }
      return value.map((item) => normalized(item, depth + 1, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail();
    }
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return fail();
      }
      out[key] = normalized(item, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/** Formats an ordinary JSON value with recursive key sorting and one trailing LF. */
export function portableCanonicalJson(value: unknown): string {
  return `${JSON.stringify(normalized(value, 0, new WeakSet()), null, 2)}\n`;
}

/** UTF-8 bytes of the portable canonical representation. */
export function encodePortableCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(portableCanonicalJson(value));
}