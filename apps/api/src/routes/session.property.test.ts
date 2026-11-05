import type * as NodeCrypto from "node:crypto";

import {
  REDACTED_VALUE,
  detectProtectedTextKind,
  redactProtectedValues,
  type ProtectedValueKind,
  type RedactedObject,
  type RedactedValue,
} from "@ehime-vote-navigator/domain";
import express, { type Express } from "express";
import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFastCheckParameters,
  type FastCheckParameters,
} from "../../../../tests/harness/fast-check.js";
import { createSupertestAppFactory } from "../../../../tests/harness/supertest-app.js";
import {
  SAFE_RESPONSE_PROJECTION_ERROR,
  projectApiResponse,
} from "../http/responseProjection.js";
import { createLocalBoundaryMiddleware } from "../middleware/localBoundary.js";
import {
  createLocalNonce,
  type LocalNonce,
} from "../middleware/localNonce.js";
import {
  SessionResponseSchema,
  type SessionResponse,
  registerSessionRoute,
} from "./session.js";

type RandomUuid = typeof NodeCrypto.randomUUID;

const cryptoMocks = vi.hoisted(() => ({
  randomUUID: vi.fn<RandomUuid>(
    () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return {
    ...actual,
    randomUUID: cryptoMocks.randomUUID,
  };
});

const ALLOWED_HOST = "127.0.0.1:8787";
const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const SAFE_CONTROL_NONCE = "A".repeat(43);
const SAFE_CONTROL_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_SAFE_REQUEST_ID = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const THIRD_SAFE_REQUEST_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const RECORDED_NONCE_COUNTEREXAMPLE =
  "_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ";
const RECORDED_REQUEST_ID_COUNTEREXAMPLE =
  "71f9383a-0201-4659-ba07-06d9d35b0302";
const EXPLORATION_SEEDS = Object.freeze([
  20_260_901, 20_260_902, 20_260_903, 20_260_904,
] as const);
const BROAD_RUNS_PER_SEED = 250_000;
const DIRECTED_RUNS_PER_SEED = 1_000;
const ISOLATION_RUNS_PER_SEED = 1_000;
const LIGHTWEIGHT_DIRECTED_RUNS = 100;
const BASE64URL_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TEST_POSTAL_ADDRESS_PATTERN = /\d{3}-\d{4}/u;
const TEST_AWS_ACCESS_KEY_PATTERN =
  /(?:^|[^A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])/u;
const TEST_AWS_SESSION_TOKEN_PATTERN =
  /^(?:IQoJb3JpZ2luX2Vj|FQoGZXIvYXdzE|AQoDYXdzE)[A-Za-z0-9]{16,}$/u;

beforeEach(() => {
  cryptoMocks.randomUUID.mockReset();
  cryptoMocks.randomUUID.mockReturnValue(SAFE_CONTROL_REQUEST_ID);
});

const SYNTHETIC_ADDRESS_COUNTEREXAMPLE = Object.freeze({
  generationIndex: 0,
  nonce: `${"A".repeat(10)}123-4567${"B".repeat(25)}`,
  patternName: "POSTAL_ADDRESS_PATTERN",
  protectedValueKind: "ADDRESS" as const,
  redactedFieldPath: "data.nonce",
  replayPath: "0",
  requestAllowed: true,
  requestId: SAFE_CONTROL_REQUEST_ID,
  seed: EXPLORATION_SEEDS[0],
});

type DirectedProtectedKind = Extract<
  ProtectedValueKind,
  "ADDRESS" | "AWS_ACCESS_KEY_ID" | "AWS_SESSION_TOKEN"
>;

type DirectedBugCase = Readonly<{
  nonce: string;
  patternName:
    | "AWS_ACCESS_KEY_ID_PATTERN"
    | "AWS_SESSION_TOKEN_PATTERN"
    | "POSTAL_ADDRESS_PATTERN";
  protectedValueKind: DirectedProtectedKind;
}>;

type SessionRequestCase = Readonly<{
  candidate: unknown;
  requestAllowed: boolean;
}>;

type PipelineObservation = Readonly<{
  candidate: SessionResponse;
  nonceKind: ProtectedValueKind | null;
  projectionOk: boolean;
  redactedNonce: RedactedValue | undefined;
  redactedRequestId: RedactedValue | undefined;
  requestIdKind: ProtectedValueKind | null;
}>;

type ExplorationFinding = Readonly<{
  fieldPath: "data.nonce" | "requestId";
  generationIndex: number;
  kind: ProtectedValueKind;
  patternName: string;
  replayPath: string;
  seed: number;
  value: string;
}>;

type HttpSessionResult = Readonly<{
  body: unknown;
  cacheControl: unknown;
  expires: unknown;
  headers: unknown;
  pragma: unknown;
  status: number;
}>;

const randomNonceArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("base64url"));

const randomUuidV4Arbitrary = fc
  .uint8Array({ minLength: 16, maxLength: 16 })
  .map((bytes) => bytesToUuidV4(bytes));

function fixedLengthStringArbitrary(
  alphabet: readonly [string, ...string[]],
  length: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...alphabet), {
      minLength: length,
      maxLength: length,
    })
    .map((characters) => characters.join(""));
}

const safeNonceArbitrary = fixedLengthStringArbitrary(
  ["g", "h", "j", "k", "m", "n"],
  43,
);
const safeHexSegmentArbitrary = (length: number): fc.Arbitrary<string> =>
  fixedLengthStringArbitrary(["a", "b", "c", "d", "e", "f"], length);
const safeUuidV4Arbitrary = fc
  .tuple(
    safeHexSegmentArbitrary(8),
    safeHexSegmentArbitrary(4),
    safeHexSegmentArbitrary(3),
    safeHexSegmentArbitrary(3),
    safeHexSegmentArbitrary(12),
  )
  .map(
    ([first, second, versionTail, variantTail, fifth]) =>
      `${first}-${second}-4${versionTail}-a${variantTail}-${fifth}`,
  );

const postalAddressCaseArbitrary: fc.Arbitrary<DirectedBugCase> = fc
  .tuple(
    fc.integer({ min: 0, max: 35 }),
    fc.array(fc.integer({ min: 0, max: 9 }), {
      minLength: 7,
      maxLength: 7,
    }),
  )
  .map(([position, digits]) => {
    const postalCode = `${digits.slice(0, 3).join("")}-${digits
      .slice(3)
      .join("")}`;
    return Object.freeze({
      nonce: `${"A".repeat(position)}${postalCode}${"B".repeat(
        35 - position,
      )}`,
      patternName: "POSTAL_ADDRESS_PATTERN" as const,
      protectedValueKind: "ADDRESS" as const,
    });
  });

const awsAccessKeyCaseArbitrary: fc.Arbitrary<DirectedBugCase> = fc
  .tuple(
    fc.integer({ min: 0, max: 21 }),
    fc.array(fc.integer({ min: 0, max: 35 }), {
      minLength: 16,
      maxLength: 16,
    }),
  )
  .map(([position, symbols]) => {
    const tokenBody = symbols
      .map((symbol) =>
        symbol < 26
          ? String.fromCharCode("A".charCodeAt(0) + symbol)
          : String(symbol - 26),
      )
      .join("");
    const intersection = `aAKIA${tokenBody}a`;
    return Object.freeze({
      nonce: `${"b".repeat(position)}${intersection}${"c".repeat(
        21 - position,
      )}`,
      patternName: "AWS_ACCESS_KEY_ID_PATTERN" as const,
      protectedValueKind: "AWS_ACCESS_KEY_ID" as const,
    });
  });

const awsSessionTokenCaseArbitrary: fc.Arbitrary<DirectedBugCase> = fc
  .array(fc.integer({ min: 0, max: 61 }), {
    minLength: 27,
    maxLength: 27,
  })
  .map((symbols) => {
    const suffix = symbols.map(base64UrlAlphaNumericAt).join("");
    return Object.freeze({
      nonce: `IQoJb3JpZ2luX2Vj${suffix}`,
      patternName: "AWS_SESSION_TOKEN_PATTERN" as const,
      protectedValueKind: "AWS_SESSION_TOKEN" as const,
    });
  });

const directedBugCaseArbitraries = Object.freeze([
  postalAddressCaseArbitrary,
  awsAccessKeyCaseArbitrary,
  awsSessionTokenCaseArbitrary,
] as const);

function fixedParameters(seed: number, numRuns: number): FastCheckParameters {
  return createFastCheckParameters({
    FC_NUM_RUNS: String(numRuns),
    FC_SEED: String(seed),
  });
}

function base64UrlAlphaNumericAt(index: number): string {
  if (index < 26) {
    return String.fromCharCode("A".charCodeAt(0) + index);
  }
  if (index < 52) {
    return String.fromCharCode("a".charCodeAt(0) + index - 26);
  }
  return String(index - 52);
}

function bytesToUuidV4(bytes: Uint8Array): string {
  const normalized = Uint8Array.from(bytes);
  const versionByte = normalized[6];
  const variantByte = normalized[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new TypeError("UUID generation requires exactly 16 bytes.");
  }

  normalized[6] = (versionByte & 0x0f) | 0x40;
  normalized[8] = (variantByte & 0x3f) | 0x80;
  const hex = Buffer.from(normalized).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertValidNonceShape(nonce: string): void {
  if (
    nonce.length !== 43 ||
    !BASE64URL_NONCE_PATTERN.test(nonce) ||
    Buffer.from(nonce, "base64url").byteLength !== 32
  ) {
    throw new Error("Generated nonce did not retain the 32-byte base64url shape.");
  }
}

function isRedactedObject(value: RedactedValue): value is RedactedObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asRedactedObject(value: RedactedValue): RedactedObject {
  if (!isRedactedObject(value)) {
    throw new TypeError("Expected a redacted object.");
  }
  return value;
}

function readRedactedPath(
  value: RedactedValue,
  path: readonly string[],
): RedactedValue | undefined {
  let current: RedactedValue | undefined = value;
  for (const segment of path) {
    if (current === undefined) {
      return undefined;
    }
    current = asRedactedObject(current)[segment];
  }
  return current;
}

function inspectPipeline(nonce: string, requestId: string): PipelineObservation {
  assertValidNonceShape(nonce);
  const candidate = SessionResponseSchema.parse({
    ok: true,
    data: { nonce },
    requestId,
  });
  const redacted = redactProtectedValues(candidate);
  const projection = projectApiResponse(SessionResponseSchema, candidate);

  return Object.freeze({
    candidate,
    nonceKind: detectProtectedTextKind(candidate.data.nonce),
    projectionOk: projection.ok,
    redactedNonce: readRedactedPath(redacted, ["data", "nonce"]),
    redactedRequestId: readRedactedPath(redacted, ["requestId"]),
    requestIdKind: detectProtectedTextKind(candidate.requestId),
  });
}

/** Mirrors the fixed bug-condition definition from design.md against generic F. */
function isBugCondition(input: SessionRequestCase): boolean {
  if (!input.requestAllowed) {
    return false;
  }

  const parsed = SessionResponseSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return false;
  }

  const nonceKind = detectProtectedTextKind(parsed.data.data.nonce);
  const requestIdKind = detectProtectedTextKind(parsed.data.requestId);
  const redacted = redactProtectedValues(parsed.data);
  const originalProjection = projectApiResponse(
    SessionResponseSchema,
    parsed.data,
  );
  const nonceCollision =
    nonceKind !== null &&
    readRedactedPath(redacted, ["data", "nonce"]) === REDACTED_VALUE;
  const requestIdCollision =
    requestIdKind !== null &&
    readRedactedPath(redacted, ["requestId"]) === REDACTED_VALUE;

  return !originalProjection.ok && (nonceCollision || requestIdCollision);
}

function matchesRecordedPattern(testCase: DirectedBugCase): boolean {
  switch (testCase.patternName) {
    case "POSTAL_ADDRESS_PATTERN":
      return TEST_POSTAL_ADDRESS_PATTERN.test(testCase.nonce);
    case "AWS_ACCESS_KEY_ID_PATTERN":
      return TEST_AWS_ACCESS_KEY_PATTERN.test(testCase.nonce);
    case "AWS_SESSION_TOKEN_PATTERN":
      return TEST_AWS_SESSION_TOKEN_PATTERN.test(testCase.nonce);
  }
}

function assertDirectedBugCase(testCase: DirectedBugCase): void {
  const observation = inspectPipeline(testCase.nonce, SAFE_CONTROL_REQUEST_ID);

  expect(matchesRecordedPattern(testCase)).toBe(true);
  expect(observation.nonceKind).toBe(testCase.protectedValueKind);
  expect(observation.requestIdKind).toBeNull();
  expect(observation.redactedNonce).toBe(REDACTED_VALUE);
  expect(observation.redactedRequestId).toBe(SAFE_CONTROL_REQUEST_ID);
  expect(observation.projectionOk).toBe(false);
  expect(
    isBugCondition({
      candidate: observation.candidate,
      requestAllowed: true,
    }),
  ).toBe(true);
}

function createRouteHarnessForNonce(nonce: LocalNonce): Express {
  const app = express();
  app.use(
    createLocalBoundaryMiddleware({
      nonce,
      runtimeEnvironment: "test",
    }),
  );
  registerSessionRoute(app, nonce);
  return app;
}

function createRouteHarness(nonceValue: string): Express {
  const nonce: LocalNonce = Object.freeze({
    matches(candidate: string | undefined): boolean {
      return candidate === nonceValue;
    },
    revealForSession(): string {
      return nonceValue;
    },
  });
  return createRouteHarnessForNonce(nonce);
}

function valueOccursOnlyAtSessionField(
  result: HttpSessionResult,
  value: string,
  fieldPath: "body.data.nonce" | "body.requestId",
): boolean {
  const parsed = SessionResponseSchema.safeParse(result.body);
  if (!parsed.success) {
    return false;
  }

  const fieldValue =
    fieldPath === "body.data.nonce"
      ? parsed.data.data.nonce
      : parsed.data.requestId;
  if (fieldValue !== value) {
    return false;
  }

  const serializedBody = JSON.stringify(result.body);
  const bodyOccurrences = serializedBody.split(value).length - 1;
  return bodyOccurrences === 1 && !JSON.stringify(result.headers).includes(value);
}

function expectedBehavior(
  input: SessionRequestCase,
  result: HttpSessionResult,
): boolean {
  const parsedInput = SessionResponseSchema.safeParse(input.candidate);
  const parsedBody = SessionResponseSchema.safeParse(result.body);
  return (
    input.requestAllowed &&
    parsedInput.success &&
    result.status === 200 &&
    parsedBody.success &&
    parsedBody.data.data.nonce === parsedInput.data.data.nonce &&
    parsedBody.data.requestId === parsedInput.data.requestId &&
    typeof result.cacheControl === "string" &&
    result.cacheControl.includes("no-store") &&
    result.expires === "0" &&
    result.pragma === "no-cache" &&
    valueOccursOnlyAtSessionField(
      result,
      parsedInput.data.data.nonce,
      "body.data.nonce",
    ) &&
    valueOccursOnlyAtSessionField(
      result,
      parsedInput.data.requestId,
      "body.requestId",
    )
  );
}

async function requestAllowedSession(
  nonce: string,
  requestId: string,
): Promise<HttpSessionResult> {
  cryptoMocks.randomUUID.mockReturnValue(
    requestId as ReturnType<RandomUuid>,
  );
  const response = await createSupertestAppFactory(() =>
    createRouteHarness(nonce),
  )()
    .get("/api/v1/session")
    .set("Host", ALLOWED_HOST)
    .set("Origin", ALLOWED_ORIGIN);

  return Object.freeze({
    body: response.body as unknown,
    cacheControl: response.headers["cache-control"],
    expires: response.headers.expires,
    headers: response.headers,
    pragma: response.headers.pragma,
    status: response.status,
  });
}

async function assertFixedRouteExpectedBehavior(
  nonce: string,
  requestId: string,
  expectedNonceKind: ProtectedValueKind | null,
  expectedRequestIdKind: ProtectedValueKind | null,
): Promise<void> {
  const observation = inspectPipeline(nonce, requestId);
  expect(observation.nonceKind).toBe(expectedNonceKind);
  expect(observation.requestIdKind).toBe(expectedRequestIdKind);
  expect(observation.redactedNonce).toBe(
    expectedNonceKind === null ? nonce : REDACTED_VALUE,
  );
  expect(observation.redactedRequestId).toBe(
    expectedRequestIdKind === null ? requestId : REDACTED_VALUE,
  );
  expect(observation.projectionOk).toBe(false);

  const input = Object.freeze({
    candidate: observation.candidate,
    requestAllowed: true,
  });
  expect(isBugCondition(input)).toBe(true);

  const originalProjection = projectApiResponse(
    SessionResponseSchema,
    observation.candidate,
  );
  expect(originalProjection).toEqual({
    body: SAFE_RESPONSE_PROJECTION_ERROR,
    ok: false,
  });
  const serializedOriginalFailure = JSON.stringify(originalProjection);
  expect(serializedOriginalFailure).not.toContain(nonce);
  expect(serializedOriginalFailure).not.toContain(requestId);

  const result = await requestAllowedSession(nonce, requestId);
  expect(
    result.status,
    "expectedBehavior requires an allowed session response to use HTTP 200",
  ).toBe(200);
  expect(expectedBehavior(input, result)).toBe(true);

  const parsedBody = SessionResponseSchema.parse(result.body);
  expect(parsedBody).toEqual(observation.candidate);
  expect(Object.keys(parsedBody).sort()).toEqual([
    "data",
    "ok",
    "requestId",
  ]);
  expect(Object.keys(parsedBody.data)).toEqual(["nonce"]);
  expect(result.cacheControl).toBe("no-store, max-age=0");
  expect(result.expires).toBe("0");
  expect(result.pragma).toBe("no-cache");
  expect(JSON.stringify(result.headers)).not.toContain(nonce);
  expect(JSON.stringify(result.headers)).not.toContain(requestId);
}

function patternNameForKind(kind: ProtectedValueKind): string {
  switch (kind) {
    case "ADDRESS":
      return "POSTAL_ADDRESS_PATTERN or another ADDRESS predicate";
    case "AWS_ACCESS_KEY_ID":
      return "AWS_ACCESS_KEY_ID_PATTERN or labeled access-key predicate";
    case "AWS_SESSION_TOKEN":
      return "AWS_SESSION_TOKEN_PATTERN or another session-token predicate";
    default:
      return `${kind} predicate`;
  }
}

function runBroadNonceSweep(seed: number): Readonly<{
  firstFindings: readonly ExplorationFinding[];
  hitCounts: Readonly<Partial<Record<ProtectedValueKind, number>>>;
  seed: number;
}> {
  const firstByKind: Partial<Record<ProtectedValueKind, ExplorationFinding>> =
    {};
  const hitCounts: Partial<Record<ProtectedValueKind, number>> = {};
  let generationIndex = 0;

  fc.assert(
    fc.property(randomNonceArbitrary, (nonce) => {
      const currentIndex = generationIndex;
      generationIndex += 1;
      const observation = inspectPipeline(nonce, SAFE_CONTROL_REQUEST_ID);

      if (observation.nonceKind === null) {
        if (
          observation.redactedNonce !== nonce ||
          observation.redactedRequestId !== SAFE_CONTROL_REQUEST_ID ||
          !observation.projectionOk
        ) {
          throw new Error(
            `Unknown broad-sweep projection failure at seed=${seed}, index=${currentIndex}.`,
          );
        }
        return;
      }

      if (
        observation.redactedNonce !== REDACTED_VALUE ||
        observation.redactedRequestId !== SAFE_CONTROL_REQUEST_ID ||
        observation.projectionOk
      ) {
        throw new Error(
          `Protected nonce did not follow generic fail-closed projection at seed=${seed}, index=${currentIndex}.`,
        );
      }

      const kind = observation.nonceKind;
      hitCounts[kind] = (hitCounts[kind] ?? 0) + 1;
      firstByKind[kind] ??= Object.freeze({
        fieldPath: "data.nonce",
        generationIndex: currentIndex,
        kind,
        patternName: patternNameForKind(kind),
        replayPath: String(currentIndex),
        seed,
        value: nonce,
      });
    }),
    fixedParameters(seed, BROAD_RUNS_PER_SEED),
  );

  return Object.freeze({
    firstFindings: Object.freeze(Object.values(firstByKind)),
    hitCounts: Object.freeze(hitCounts),
    seed,
  });
}

function runRequestIdIsolation(
  seed: number,
): Readonly<{
  firstFinding?: ExplorationFinding;
  protectedCount: number;
  seed: number;
}> {
  let firstFinding: ExplorationFinding | undefined;
  let generationIndex = 0;
  let protectedCount = 0;

  fc.assert(
    fc.property(randomUuidV4Arbitrary, (requestId) => {
      const currentIndex = generationIndex;
      generationIndex += 1;
      const observation = inspectPipeline(SAFE_CONTROL_NONCE, requestId);

      if (observation.nonceKind !== null) {
        throw new Error("The safe nonce control was unexpectedly protected.");
      }

      if (observation.requestIdKind === null) {
        if (
          observation.redactedNonce !== SAFE_CONTROL_NONCE ||
          observation.redactedRequestId !== requestId ||
          !observation.projectionOk
        ) {
          throw new Error(
            `Unknown requestId isolation failure at seed=${seed}, index=${currentIndex}.`,
          );
        }
        return;
      }

      if (
        observation.redactedNonce !== SAFE_CONTROL_NONCE ||
        observation.redactedRequestId !== REDACTED_VALUE ||
        observation.projectionOk
      ) {
        throw new Error(
          `Protected requestId did not follow generic fail-closed projection at seed=${seed}, index=${currentIndex}.`,
        );
      }

      protectedCount += 1;
      firstFinding ??= Object.freeze({
        fieldPath: "requestId",
        generationIndex: currentIndex,
        kind: observation.requestIdKind,
        patternName: patternNameForKind(observation.requestIdKind),
        replayPath: String(currentIndex),
        seed,
        value: requestId,
      });
    }),
    fixedParameters(seed, ISOLATION_RUNS_PER_SEED),
  );

  return Object.freeze({
    ...(firstFinding === undefined ? {} : { firstFinding }),
    protectedCount,
    seed,
  });
}

function runCombinedIsolation(
  nonceSeed: number,
  requestIdSeed: number,
): Readonly<{
  nonceProtectedCount: number;
  projectionFailureCount: number;
  requestIdProtectedCount: number;
}> {
  const nonces = fc.sample(randomNonceArbitrary, {
    numRuns: ISOLATION_RUNS_PER_SEED,
    seed: nonceSeed,
  });
  const requestIds = fc.sample(randomUuidV4Arbitrary, {
    numRuns: ISOLATION_RUNS_PER_SEED,
    seed: requestIdSeed,
  });
  let nonceProtectedCount = 0;
  let projectionFailureCount = 0;
  let requestIdProtectedCount = 0;

  for (let index = 0; index < ISOLATION_RUNS_PER_SEED; index += 1) {
    const nonce = nonces[index];
    const requestId = requestIds[index];
    if (nonce === undefined || requestId === undefined) {
      throw new Error("Combined isolation did not generate the requested samples.");
    }

    const observation = inspectPipeline(nonce, requestId);
    nonceProtectedCount += observation.nonceKind === null ? 0 : 1;
    requestIdProtectedCount += observation.requestIdKind === null ? 0 : 1;
    projectionFailureCount += observation.projectionOk ? 0 : 1;

    if (
      !observation.projectionOk &&
      observation.nonceKind === null &&
      observation.requestIdKind === null
    ) {
      throw new Error(
        `Run C found a projection failure outside either classified field at nonceSeed=${nonceSeed}, requestIdSeed=${requestIdSeed}, index=${index}.`,
      );
    }
  }

  return Object.freeze({
    nonceProtectedCount,
    projectionFailureCount,
    requestIdProtectedCount,
  });
}

describe("Property 1: Expected Behavior - Explicit Session Nonce and Request ID Projection", () => {
  // Feature: session-api-redaction-regression, Property 1: Expected Behavior
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
  it("confirms the synthetic POSTAL_ADDRESS_PATTERN nonce reaches generic fail-closed projection", () => {
    expect(SYNTHETIC_ADDRESS_COUNTEREXAMPLE.nonce).toHaveLength(43);
    expect(SYNTHETIC_ADDRESS_COUNTEREXAMPLE.nonce).toMatch(
      BASE64URL_NONCE_PATTERN,
    );
    expect(
      Buffer.from(
        SYNTHETIC_ADDRESS_COUNTEREXAMPLE.nonce,
        "base64url",
      ),
    ).toHaveLength(32);
    expect(detectProtectedTextKind(SAFE_CONTROL_NONCE)).toBeNull();
    expect(detectProtectedTextKind(SAFE_CONTROL_REQUEST_ID)).toBeNull();

    assertDirectedBugCase({
      nonce: SYNTHETIC_ADDRESS_COUNTEREXAMPLE.nonce,
      patternName: SYNTHETIC_ADDRESS_COUNTEREXAMPLE.patternName,
      protectedValueKind:
        SYNTHETIC_ADDRESS_COUNTEREXAMPLE.protectedValueKind,
    });
  });

  it("expects the allowed route to return the original directed nonce as HTTP 200", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(SYNTHETIC_ADDRESS_COUNTEREXAMPLE),
        async (counterexample) => {
          expect(counterexample.requestAllowed).toBe(true);
          await assertFixedRouteExpectedBehavior(
            counterexample.nonce,
            counterexample.requestId,
            counterexample.protectedValueKind,
            null,
          );
        },
      ),
      fixedParameters(
        SYNTHETIC_ADDRESS_COUNTEREXAMPLE.seed,
        LIGHTWEIGHT_DIRECTED_RUNS,
      ),
    );
  });

  it("replays recorded nonce-only, requestId-only, and combined collisions", async () => {
    await assertFixedRouteExpectedBehavior(
      RECORDED_NONCE_COUNTEREXAMPLE,
      SAFE_CONTROL_REQUEST_ID,
      "ADDRESS",
      null,
    );
    await assertFixedRouteExpectedBehavior(
      SAFE_CONTROL_NONCE,
      RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      null,
      "ADDRESS",
    );
    await assertFixedRouteExpectedBehavior(
      RECORDED_NONCE_COUNTEREXAMPLE,
      RECORDED_REQUEST_ID_COUNTEREXAMPLE,
      "ADDRESS",
      "ADDRESS",
    );
  });

  it("runs fixed-seed directed, broad, and field-isolation exploration", async () => {
    const explorationEnabled = process.env.SESSION_NONCE_EXPLORATION === "1";
    const directedRuns = explorationEnabled
      ? DIRECTED_RUNS_PER_SEED
      : LIGHTWEIGHT_DIRECTED_RUNS;

    for (const seed of EXPLORATION_SEEDS) {
      for (const arbitrary of directedBugCaseArbitraries) {
        await fc.assert(
          fc.asyncProperty(arbitrary, async (testCase) => {
            assertDirectedBugCase(testCase);
            await assertFixedRouteExpectedBehavior(
              testCase.nonce,
              SAFE_CONTROL_REQUEST_ID,
              testCase.protectedValueKind,
              null,
            );
          }),
          fixedParameters(seed, directedRuns),
        );
      }
    }

    const requestIdIsolation = EXPLORATION_SEEDS.map((seed) =>
      runRequestIdIsolation(seed),
    );
    const combinedIsolation = EXPLORATION_SEEDS.map((nonceSeed, index) =>
      runCombinedIsolation(
        nonceSeed,
        EXPLORATION_SEEDS[(index + 1) % EXPLORATION_SEEDS.length] ??
          EXPLORATION_SEEDS[0],
      ),
    );

    console.info(
      `[session-nonce-field-isolation] ${JSON.stringify({
        combinedIsolation,
        requestIdIsolation,
      })}`,
    );

    const broadSweep = explorationEnabled
      ? EXPLORATION_SEEDS.map((seed) => {
          const result = runBroadNonceSweep(seed);
          console.info(
            `[session-nonce-broad-sweep] ${JSON.stringify(result)}`,
          );
          return result;
        })
      : [];

    const requestIdProtectedCount = requestIdIsolation.reduce(
      (total, result) => total + result.protectedCount,
      0,
    );
    expect(
      requestIdProtectedCount,
      `recorded requestId-only ADDRESS collisions changed: ${JSON.stringify({
        broadSweep,
        requestIdIsolation,
      })}`,
    ).toBe(899);
  }, 120_000);
});

describe("Property 2: Preservation - Non-Bug Session Inputs and Non-Session Sinks", () => {
  // Feature: session-api-redaction-regression, Property 2: Preservation
  // **Validates: Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.9**
  it("preserves generic F as a strict HTTP 200 response for non-collision candidates", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeNonceArbitrary,
        safeUuidV4Arbitrary,
        async (nonce, requestId) => {
          const candidate = SessionResponseSchema.parse({
            ok: true,
            data: { nonce },
            requestId,
          });
          const input = Object.freeze({
            candidate,
            requestAllowed: true,
          });

          expect(detectProtectedTextKind(nonce)).toBeNull();
          expect(detectProtectedTextKind(requestId)).toBeNull();
          expect(isBugCondition(input)).toBe(false);

          const originalProjection = projectApiResponse(
            SessionResponseSchema,
            candidate,
          );
          expect(originalProjection.ok).toBe(true);
          if (!originalProjection.ok) {
            throw new Error("A non-collision candidate did not pass generic F.");
          }

          cryptoMocks.randomUUID.mockReturnValue(
            requestId as ReturnType<RandomUuid>,
          );
          const response = await createSupertestAppFactory(() =>
            createRouteHarness(nonce),
          )()
            .get("/api/v1/session")
            .set("Host", ALLOWED_HOST)
            .set("Origin", ALLOWED_ORIGIN)
            .expect(200);
          const parsedBody = SessionResponseSchema.parse(response.body);

          expect(parsedBody).toEqual(originalProjection.body);
          expect(Object.keys(parsedBody).sort()).toEqual([
            "data",
            "ok",
            "requestId",
          ]);
          expect(Object.keys(parsedBody.data)).toEqual(["nonce"]);
          expect(response.headers["cache-control"]).toBe(
            "no-store, max-age=0",
          );
          expect(response.headers.expires).toBe("0");
          expect(response.headers.pragma).toBe("no-cache");
          expect(JSON.stringify(response.headers)).not.toContain(nonce);
          expect(JSON.stringify(response.headers)).not.toContain(requestId);
        },
      ),
      fixedParameters(EXPLORATION_SEEDS[0], LIGHTWEIGHT_DIRECTED_RUNS),
    );
  });

  it("preserves one nonce per route instance, fresh request IDs, and nonce rotation", async () => {
    cryptoMocks.randomUUID
      .mockReturnValueOnce(SECOND_SAFE_REQUEST_ID)
      .mockReturnValueOnce(THIRD_SAFE_REQUEST_ID);
    const app = createRouteHarness(SAFE_CONTROL_NONCE);
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

    expect(first.data.nonce).toBe(SAFE_CONTROL_NONCE);
    expect(second.data.nonce).toBe(first.data.nonce);
    expect(first.requestId).toBe(SECOND_SAFE_REQUEST_ID);
    expect(second.requestId).toBe(THIRD_SAFE_REQUEST_ID);
    expect(second.requestId).not.toBe(first.requestId);
    for (const response of [firstResponse, secondResponse]) {
      expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(response.headers.expires).toBe("0");
      expect(response.headers.pragma).toBe("no-cache");
      expect(JSON.stringify(response.headers)).not.toContain(
        SAFE_CONTROL_NONCE,
      );
    }

    const firstNonce = createLocalNonce();
    const secondNonce = createLocalNonce();
    const firstNonceValue = firstNonce.revealForSession();
    const secondNonceValue = secondNonce.revealForSession();

    for (const value of [firstNonceValue, secondNonceValue]) {
      expect(value).toHaveLength(43);
      expect(value).toMatch(BASE64URL_NONCE_PATTERN);
      expect(Buffer.from(value, "base64url")).toHaveLength(32);
    }
    expect(firstNonce.revealForSession()).toBe(firstNonceValue);
    expect(secondNonce.revealForSession()).toBe(secondNonceValue);
    expect(secondNonceValue).not.toBe(firstNonceValue);
  });

  it("strictly rejects unknown fields and invalid values with the fixed safe failure", () => {
    const invalidNonce = "x".repeat(42);
    const invalidRequestId = "not-a-valid-uuid";
    const cases: readonly Readonly<{
      candidate: unknown;
      leakedValues: readonly string[];
      name: string;
    }>[] = [
      {
        name: "unknown root fields",
        candidate: {
          ok: true,
          data: { nonce: SAFE_CONTROL_NONCE },
          requestId: SAFE_CONTROL_REQUEST_ID,
          nonceReplica: RECORDED_NONCE_COUNTEREXAMPLE,
          requestIdReplica: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
        },
        leakedValues: [
          RECORDED_NONCE_COUNTEREXAMPLE,
          RECORDED_REQUEST_ID_COUNTEREXAMPLE,
        ],
      },
      {
        name: "unknown nested fields",
        candidate: {
          ok: true,
          data: {
            nonce: SAFE_CONTROL_NONCE,
            nonceReplica: RECORDED_NONCE_COUNTEREXAMPLE,
            requestIdReplica: RECORDED_REQUEST_ID_COUNTEREXAMPLE,
          },
          requestId: SAFE_CONTROL_REQUEST_ID,
        },
        leakedValues: [
          RECORDED_NONCE_COUNTEREXAMPLE,
          RECORDED_REQUEST_ID_COUNTEREXAMPLE,
        ],
      },
      {
        name: "invalid nonce",
        candidate: {
          ok: true,
          data: { nonce: invalidNonce },
          requestId: SAFE_CONTROL_REQUEST_ID,
        },
        leakedValues: [invalidNonce],
      },
      {
        name: "invalid request ID",
        candidate: {
          ok: true,
          data: { nonce: SAFE_CONTROL_NONCE },
          requestId: invalidRequestId,
        },
        leakedValues: [invalidRequestId],
      },
    ];

    for (const testCase of cases) {
      expect(
        SessionResponseSchema.safeParse(testCase.candidate).success,
        testCase.name,
      ).toBe(false);
      const projection = projectApiResponse(
        SessionResponseSchema,
        testCase.candidate,
      );
      expect(projection, testCase.name).toEqual({
        body: SAFE_RESPONSE_PROJECTION_ERROR,
        ok: false,
      });
      for (const leakedValue of testCase.leakedValues) {
        expect(JSON.stringify(projection)).not.toContain(leakedValue);
      }
    }
  });
});