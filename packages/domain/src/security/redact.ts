import { types } from "node:util";

export const REDACTED_VALUE = "[REDACTED]" as const;
export const MAX_REDACTION_DEPTH = 100;

export const PROTECTED_VALUE_KINDS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "BEARER_TOKEN",
  "ADDRESS",
  "COORDINATES",
  "AI_QUESTION",
] as const;

export type ProtectedValueKind = (typeof PROTECTED_VALUE_KINDS)[number];

export const REDACTION_ERROR_CODES = [
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

export type RedactionErrorCode = (typeof REDACTION_ERROR_CODES)[number];

export type RedactedValue =
  | boolean
  | null
  | number
  | string
  | readonly RedactedValue[]
  | RedactedObject;

export interface RedactedObject {
  readonly [key: string]: RedactedValue;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const ERROR_MESSAGES: Readonly<Record<RedactionErrorCode, string>> =
  Object.freeze({
    ACCESSOR_PROPERTY: "Protected data input contains an accessor property.",
    CIRCULAR_REFERENCE: "Protected data input contains a circular reference.",
    DANGEROUS_KEY: "Protected data input contains an unsafe object key.",
    MAX_DEPTH_EXCEEDED: "Protected data input exceeds the safe nesting limit.",
    NON_ENUMERABLE_PROPERTY:
      "Protected data input contains a non-enumerable data property.",
    NON_FINITE_NUMBER: "Protected data input contains a non-finite number.",
    SPARSE_ARRAY: "Protected data input contains a sparse array.",
    SYMBOL_KEY: "Protected data input contains a symbol key.",
    UNSAFE_ARRAY_PROPERTY:
      "Protected data input contains a custom array property.",
    UNSAFE_PROTOTYPE:
      "Protected data input must contain only plain objects and arrays.",
    UNSAFE_PROXY: "Protected data input contains a proxy object.",
    UNSUPPORTED_VALUE: "Protected data input contains an unsupported value.",
  });

const AWS_ACCESS_KEY_ID_PATTERN =
  /(?:^|[^A-Z0-9])(?:(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|AGPA|ASCA)[A-Z0-9]{16}|A3T[A-Z0-9]{17})(?![A-Z0-9])/u;
const LABELED_AWS_ACCESS_KEY_PATTERN =
  /(?:aws[\s_.-]*)?access[\s_.-]*key(?:[\s_.-]*id)?\s*[:=]\s*["']?[^\s"'&#;,]+/iu;
const LABELED_AWS_SECRET_KEY_PATTERN =
  /(?:aws[\s_.-]*)?secret[\s_.-]*(?:access[\s_.-]*)?key\s*[:=]\s*["']?[^\s"'&#;,]+/iu;
const AWS_SECRET_ACCESS_KEY_PATTERN =
  /(?:^|[^A-Za-z0-9/+_-])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+_=-])/u;
const LABELED_AWS_SESSION_TOKEN_PATTERN =
  /(?:aws[\s_.-]*)?(?:session|security)[\s_.-]*token\s*[:=]\s*["']?[^\s"'&#;,]+/iu;
const AWS_SESSION_TOKEN_PATTERN =
  /(?:^|[^A-Za-z0-9/+_-])(?:IQoJb3JpZ2luX2Vj|FQoGZXIvYXdzE|AQoDYXdzE)[A-Za-z0-9/+=]{16,}(?![A-Za-z0-9/+_=-])/u;
const LONG_AWS_SESSION_TOKEN_PATTERN =
  /(?:^|[^A-Za-z0-9/+_-])[A-Za-z0-9/+]{80,}={0,2}(?![A-Za-z0-9/+_=-])/u;
const BEARER_TOKEN_PATTERN =
  /\bbearer\s+[A-Za-z0-9._~+/-]+={0,2}/iu;
const LABELED_BEARER_TOKEN_PATTERN =
  /(?:authorization|bearer[\s_.-]*token)\s*[:=]\s*(?:bearer(?:%20|\s+))?[^\s&#;,]+/iu;

const POSTAL_ADDRESS_PATTERN = /(?:〒\s*)?\d{3}[-‐‑‒–—ー]\d{4}/u;
const JAPANESE_ADDRESS_PATTERN =
  /(?:東京都|北海道|(?:京都|大阪)府|[^\s,，;；]{2,4}県)[^\r\n,，;；]{1,48}(?:市|区|町|村)[^\r\n,，;；]{0,48}/u;
const JAPANESE_LOCAL_ADDRESS_PATTERN =
  /(?:市|区|町|村)[^\r\n,，;；]{0,24}(?:\d+|[一二三四五六七八九十]+)(?:丁目|番地?|号)/u;
const WESTERN_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z .'-]{1,48}\s+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln)\b/iu;
const LABELED_ADDRESS_PATTERN =
  /(?:^|[?&#;\s])(?:address|street[\s_.-]*address|postal[\s_.-]*address|住所|所在地)\s*[:=]\s*[^\s&#;]+/iu;

const LABELED_COORDINATE_PATTERN =
  /(?:latitude|longitude|lat|lon|lng|coordinates?|緯度|経度|座標)\s*[:=]\s*[\[({]?\s*[+-]?\d{1,3}(?:\.\d+)?/iu;
const COORDINATE_PAIR_PATTERN =
  /^\s*(?:geo:\s*)?[\[({]?\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[,，]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*[\])}]?\s*$/iu;
const EMBEDDED_COORDINATE_PAIR_PATTERN =
  /(?:^|[^\d.])([+-]?\d{1,3}\.\d+)\s*[,，]\s*([+-]?\d{1,3}\.\d+)(?![\d.])/u;

const LABELED_QUESTION_PATTERN =
  /(?:^|[?&#;\s])(?:ai[\s_.-]*)?(?:question|question[\s_.-]*(?:text|body)|chat[\s_.-]*question|prompt|質問|質問本文)\s*[:=]\s*[^\s&#;]+/iu;
const JAPANESE_QUESTION_PATTERN =
  /(?:ですか|ますか|でしょうか|教えて(?:ください)?|知りたい|どうすれば|どのように|なぜ)[。.!！?？]*\s*$/u;
const ENGLISH_QUESTION_PATTERN =
  /\b(?:what|why|how|when|where|who|which|can|could|should|would|is|are|do|does)\b[^\r\n]{0,500}[?？]\s*$/iu;
const QUESTION_MARK_PATTERN = /[?？]\s*$/u;

const CREDENTIAL_KEY_NAMES = new Set([
  "accesskey",
  "accesskeyid",
  "accesstoken",
  "apikey",
  "authorization",
  "authorizationheader",
  "awsaccesskey",
  "awsaccesskeyid",
  "awscredentials",
  "awssecret",
  "awssecretaccesskey",
  "awssecretkey",
  "awssessiontoken",
  "bearer",
  "bearertoken",
  "clientsecret",
  "credentials",
  "idtoken",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretaccesskey",
  "securitytoken",
  "sessiontoken",
  "token",
]);

const COORDINATE_KEY_NAMES = new Set([
  "coordinate",
  "coordinates",
  "currentlocation",
  "currentposition",
  "geolocation",
  "geo",
  "lat",
  "latitude",
  "lng",
  "lon",
  "longitude",
  "location",
  "position",
  "currentcoordinates",
  "位置情報",
  "座標",
  "現在地",
  "経度",
  "緯度",
]);

const QUESTION_KEY_NAMES = new Set([
  "aiquestion",
  "ai質問",
  "chatquestion",
  "chatinput",
  "chatmessage",
  "prompt",
  "prompttext",
  "question",
  "questionbody",
  "questiontext",
  "query",
  "usermessage",
  "userquestion",
  "チャット質問",
  "質問",
  "質問本文",
]);

/** A fixed-message rejection that never reflects input values or paths. */
export class RedactionError extends TypeError {
  readonly code: RedactionErrorCode;

  constructor(code: RedactionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "RedactionError";
    this.code = code;
  }
}

function fail(code: RedactionErrorCode): never {
  throw new RedactionError(code);
}

function normalizedKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** Detects semantic field names that must not cross an application sink. */
export function isProtectedKeyName(key: string): boolean {
  const normalized = normalizedKey(key);

  return (
    CREDENTIAL_KEY_NAMES.has(normalized) ||
    /(?:accesskey(?:id)?|accesstoken|apikey|authorization|bearertoken|clientsecret|credentials?|idtoken|password|privatekey|refreshtoken|secret(?:access)?key|securitytoken|sessiontoken)$/u.test(
      normalized,
    ) ||
    COORDINATE_KEY_NAMES.has(normalized) ||
    /(?:coordinates?|currentlocation|currentposition|geolocation|latitude|longitude|位置情報|座標|現在地|経度|緯度)$/u.test(
      normalized,
    ) ||
    QUESTION_KEY_NAMES.has(normalized) ||
    /(?:chatinput|chatmessage|prompt(?:text)?|question(?:body|text)?|usermessage|userquestion|チャット質問|質問(?:本文)?)$/u.test(
      normalized,
    ) ||
    /(?:address(?:line)?\d*|postalcode|postcode|residence|streetaddress|zipcode|住所|所在地)$/u.test(
      normalized,
    )
  );
}

function detectAwsCredentialKind(value: string): ProtectedValueKind | null {
  if (
    AWS_ACCESS_KEY_ID_PATTERN.test(value) ||
    LABELED_AWS_ACCESS_KEY_PATTERN.test(value)
  ) {
    return "AWS_ACCESS_KEY_ID";
  }

  if (
    LABELED_AWS_SECRET_KEY_PATTERN.test(value) ||
    AWS_SECRET_ACCESS_KEY_PATTERN.test(value)
  ) {
    return "AWS_SECRET_ACCESS_KEY";
  }

  if (
    LABELED_AWS_SESSION_TOKEN_PATTERN.test(value) ||
    AWS_SESSION_TOKEN_PATTERN.test(value) ||
    LONG_AWS_SESSION_TOKEN_PATTERN.test(value)
  ) {
    return "AWS_SESSION_TOKEN";
  }

  return null;
}

/** Pure pre-send detector for AWS access key, secret key, and session token forms. */
export function containsAwsCredentialPattern(value: string): boolean {
  if (detectAwsCredentialKind(value) !== null) {
    return true;
  }

  const decoded = decodeUrlEncodedText(value);
  return (
    decoded !== null &&
    decoded !== value &&
    containsAwsCredentialPattern(decoded)
  );
}

/** Pure pre-send detector for AWS credential and bearer-token forms. */
export function containsCredentialPattern(value: string): boolean {
  if (
    containsAwsCredentialPattern(value) ||
    BEARER_TOKEN_PATTERN.test(value) ||
    LABELED_BEARER_TOKEN_PATTERN.test(value)
  ) {
    return true;
  }

  const decoded = decodeUrlEncodedText(value);
  return (
    decoded !== null && decoded !== value && containsCredentialPattern(decoded)
  );
}

function isCoordinatePairText(value: string): boolean {
  const match =
    COORDINATE_PAIR_PATTERN.exec(value) ??
    EMBEDDED_COORDINATE_PAIR_PATTERN.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return false;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return false;
  }

  return (
    (Math.abs(first) <= 90 && Math.abs(second) <= 180) ||
    (Math.abs(first) <= 180 && Math.abs(second) <= 90)
  );
}

function decodeUrlEncodedText(value: string): string | null {
  if (!/(?:%[0-9A-F]{2}|\+)/iu.test(value)) {
    return null;
  }

  try {
    return decodeURIComponent(value.replaceAll("+", "%20"));
  } catch {
    return null;
  }
}

/** Classifies protected text without returning any part of the detected value. */
export function detectProtectedTextKind(
  value: string,
): ProtectedValueKind | null {
  const credentialKind = detectAwsCredentialKind(value);
  if (credentialKind !== null) {
    return credentialKind;
  }

  if (
    BEARER_TOKEN_PATTERN.test(value) ||
    LABELED_BEARER_TOKEN_PATTERN.test(value)
  ) {
    return "BEARER_TOKEN";
  }

  if (
    POSTAL_ADDRESS_PATTERN.test(value) ||
    JAPANESE_ADDRESS_PATTERN.test(value) ||
    JAPANESE_LOCAL_ADDRESS_PATTERN.test(value) ||
    WESTERN_ADDRESS_PATTERN.test(value) ||
    LABELED_ADDRESS_PATTERN.test(value)
  ) {
    return "ADDRESS";
  }

  if (
    LABELED_COORDINATE_PATTERN.test(value) ||
    isCoordinatePairText(value)
  ) {
    return "COORDINATES";
  }

  if (
    LABELED_QUESTION_PATTERN.test(value) ||
    JAPANESE_QUESTION_PATTERN.test(value) ||
    ENGLISH_QUESTION_PATTERN.test(value) ||
    QUESTION_MARK_PATTERN.test(value)
  ) {
    return "AI_QUESTION";
  }

  const decoded = decodeUrlEncodedText(value);
  return decoded === null || decoded === value
    ? null
    : detectProtectedTextKind(decoded);
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

function isCoordinateNumberPair(values: readonly RedactedValue[]): boolean {
  if (
    values.length !== 2 ||
    typeof values[0] !== "number" ||
    typeof values[1] !== "number"
  ) {
    return false;
  }

  const first = values[0];
  const second = values[1];
  if (Number.isInteger(first) && Number.isInteger(second)) {
    return false;
  }

  return (
    (Math.abs(first) <= 90 && Math.abs(second) <= 180) ||
    (Math.abs(first) <= 180 && Math.abs(second) <= 90)
  );
}

function redactArray(
  value: readonly unknown[],
  depth: number,
  ancestors: WeakSet<object>,
): RedactedValue {
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
  const output: RedactedValue[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      fail("SPARSE_ARRAY");
    }

    assertDataDescriptor(descriptor);
    output.push(redactValue(descriptor.value, depth + 1, ancestors));
  }

  if (isCoordinateNumberPair(output)) {
    return REDACTED_VALUE;
  }

  return Object.freeze(output);
}

function redactObject(
  value: object,
  depth: number,
  ancestors: WeakSet<object>,
): RedactedValue {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("UNSAFE_PROTOTYPE");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    fail("SYMBOL_KEY");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, RedactedValue> = {};

  for (const key of (ownKeys as string[]).sort()) {
    if (DANGEROUS_KEYS.has(key)) {
      fail("DANGEROUS_KEY");
    }

    const descriptor = descriptors[key];
    assertDataDescriptor(descriptor);

    if (detectProtectedTextKind(key) !== null) {
      redactValue(descriptor.value, depth + 1, ancestors);
      continue;
    }

    const redacted = redactValue(descriptor.value, depth + 1, ancestors);
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: isProtectedKeyName(key) ? REDACTED_VALUE : redacted,
      writable: false,
    });
  }

  return Object.freeze(output);
}

function redactValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): RedactedValue {
  if (depth > MAX_REDACTION_DEPTH) {
    fail("MAX_DEPTH_EXCEEDED");
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("NON_FINITE_NUMBER");
    }
    return value;
  }

  if (typeof value === "string") {
    return detectProtectedTextKind(value) === null ? value : REDACTED_VALUE;
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
      ? redactArray(value, depth, ancestors)
      : redactObject(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Recursively clones JSON-shaped input, replacing protected values with one
 * fixed marker. Unsafe object graphs are rejected before any sink sees them.
 */
export function redactProtectedValues(value: unknown): RedactedValue {
  return redactValue(value, 0, new WeakSet());
}

/** Serializes only the redacted clone and never serializes the caller's input. */
export function serializeRedactedValue(value: unknown): string {
  const serialized = JSON.stringify(redactProtectedValues(value));
  if (serialized === undefined) {
    return fail("UNSUPPORTED_VALUE");
  }
  return serialized;
}
