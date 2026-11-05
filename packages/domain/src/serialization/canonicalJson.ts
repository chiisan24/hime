import { types } from "node:util";

export const MAX_CANONICAL_JSON_DEPTH = 100;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const INDENT = "  ";

export const CANONICAL_JSON_ERROR_CODES = [
  "ACCESSOR_PROPERTY",
  "CIRCULAR_REFERENCE",
  "DANGEROUS_KEY",
  "MAX_DEPTH_EXCEEDED",
  "NON_ENUMERABLE_PROPERTY",
  "NON_FINITE_NUMBER",
  "SPARSE_ARRAY",
  "SYMBOL_KEY",
  "UNSAFE_ARRAY_PROPERTY",
  "UNSAFE_PROTOTYPE",
  "UNSAFE_PROXY",
  "UNSUPPORTED_VALUE",
] as const;

export type CanonicalJsonErrorCode =
  (typeof CANONICAL_JSON_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<CanonicalJsonErrorCode, string>> =
  Object.freeze({
    ACCESSOR_PROPERTY: "Canonical JSON does not accept accessor properties.",
    CIRCULAR_REFERENCE: "Canonical JSON does not accept circular references.",
    DANGEROUS_KEY: "Canonical JSON does not accept unsafe object keys.",
    MAX_DEPTH_EXCEEDED: "Canonical JSON exceeds the safe nesting limit.",
    NON_ENUMERABLE_PROPERTY:
      "Canonical JSON does not accept non-enumerable data properties.",
    NON_FINITE_NUMBER: "Canonical JSON accepts only finite numbers.",
    SPARSE_ARRAY: "Canonical JSON does not accept sparse arrays.",
    SYMBOL_KEY: "Canonical JSON does not accept symbol keys.",
    UNSAFE_ARRAY_PROPERTY:
      "Canonical JSON arrays cannot contain custom properties.",
    UNSAFE_PROTOTYPE:
      "Canonical JSON accepts only plain objects and ordinary arrays.",
    UNSAFE_PROXY: "Canonical JSON does not accept proxy objects.",
    UNSUPPORTED_VALUE: "The value cannot be represented as JSON.",
  });

/** A value was rejected without including its content in the error message. */
export class CanonicalJsonError extends TypeError {
  readonly code: CanonicalJsonErrorCode;

  constructor(code: CanonicalJsonErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CanonicalJsonError";
    this.code = code;
  }
}

function fail(code: CanonicalJsonErrorCode): never {
  throw new CanonicalJsonError(code);
}

function indentation(depth: number): string {
  return INDENT.repeat(depth);
}

function serializePrimitive(value: null | boolean | number | string): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return fail("NON_FINITE_NUMBER");
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return fail("UNSUPPORTED_VALUE");
  }

  return serialized;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) {
    return false;
  }

  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function assertDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
    fail("ACCESSOR_PROPERTY");
  }

  if (descriptor.enumerable !== true) {
    fail("NON_ENUMERABLE_PROPERTY");
  }
}

function serializeArray(
  value: readonly unknown[],
  depth: number,
  ancestors: WeakSet<object>,
): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail("UNSAFE_PROTOTYPE");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    fail("SYMBOL_KEY");
  }

  const stringKeys = ownKeys as string[];
  if (
    stringKeys.some(
      (key) => key !== "length" && !isArrayIndex(key, value.length),
    )
  ) {
    fail("UNSAFE_ARRAY_PROPERTY");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const items: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      fail("SPARSE_ARRAY");
    }

    assertDataDescriptor(descriptor);
    items.push(
      `${indentation(depth + 1)}${serializeValue(
        descriptor.value,
        depth + 1,
        ancestors,
      )}`,
    );
  }

  if (items.length === 0) {
    return "[]";
  }

  return `[\n${items.join(",\n")}\n${indentation(depth)}]`;
}

function serializeObject(
  value: object,
  depth: number,
  ancestors: WeakSet<object>,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("UNSAFE_PROTOTYPE");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    fail("SYMBOL_KEY");
  }

  const keys = (ownKeys as string[]).sort();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const properties: string[] = [];

  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) {
      fail("DANGEROUS_KEY");
    }

    const descriptor = descriptors[key];
    assertDataDescriptor(descriptor);
    properties.push(
      `${indentation(depth + 1)}${JSON.stringify(key)}: ${serializeValue(
        descriptor.value,
        depth + 1,
        ancestors,
      )}`,
    );
  }

  if (properties.length === 0) {
    return "{}";
  }

  return `{\n${properties.join(",\n")}\n${indentation(depth)}}`;
}

function serializeValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): string {
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    fail("MAX_DEPTH_EXCEEDED");
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return serializePrimitive(value);
  }

  if (typeof value !== "object") {
    fail("UNSUPPORTED_VALUE");
  }

  if (types.isProxy(value)) {
    fail("UNSAFE_PROXY");
  }

  if (ancestors.has(value)) {
    fail("CIRCULAR_REFERENCE");
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? serializeArray(value, depth, ancestors)
      : serializeObject(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Formats a strict JSON value with recursively sorted keys, two-space
 * indentation, and one trailing LF. The input graph is never modified.
 */
export function formatCanonicalJson(value: unknown): string {
  return `${serializeValue(value, 0, new WeakSet())}\n`;
}

/** Encodes canonical JSON as UTF-8 bytes. */
export function encodeCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(formatCanonicalJson(value));
}
