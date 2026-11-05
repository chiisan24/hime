import {
  FixtureRunBoundaryInputSchema,
  FixtureScreenBoundaryInputSchema,
  FixtureStoragePathSchema,
  RealAiRunBoundaryInputSchema,
  RealAiScreenBoundaryInputSchema,
  RealAiStoragePathSchema,
  type FixtureDataRecord,
  type FixtureRunBoundaryInput,
  type FixtureScreenBoundaryInput,
  type RealAiDataRecord,
  type RealAiRunBoundaryInput,
  type RealAiScreenBoundaryInput,
  type RealAiStoragePath,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../result.js";

const VALIDATED_DATA_BOUNDARY = Symbol("validated-data-boundary");
const EMPTY_RECORDS = Object.freeze([]) as readonly never[];

export const DATA_BOUNDARY_ERROR_CODES = [
  "DATA_KIND_INVALID",
  "DATA_KIND_MIXED",
  "STORAGE_ROOT_MISMATCH",
  "BOUNDARY_INPUT_INVALID",
] as const;

export type DataBoundaryErrorCode =
  (typeof DATA_BOUNDARY_ERROR_CODES)[number];

export type SafeDataBoundaryFieldPath =
  | "$"
  | "dataKind"
  | "records"
  | `records[${number}]`
  | `records[${number}].dataKind`
  | `records[${number}].payload`
  | `records[${number}].recordId`
  | "scope"
  | "storagePath";

export type DataBoundaryOperationTargets<T> = Readonly<{
  analyze: readonly T[];
  display: readonly T[];
  index: readonly T[];
  save: readonly T[];
}>;

export type DataBoundaryError = Readonly<{
  code: DataBoundaryErrorCode;
  fieldPaths: readonly SafeDataBoundaryFieldPath[];
  outputs: DataBoundaryOperationTargets<never>;
}>;

export type DataBoundaryFailure = Readonly<{
  error: DataBoundaryError;
  ok: false;
}>;

type ValidatedBoundary<
  TKind extends "FIXTURE" | "REAL_AI",
  TScope extends "RUN" | "SCREEN",
  TRecord,
  TInput,
> = Readonly<{
  [VALIDATED_DATA_BOUNDARY]: true;
  dataKind: TKind;
  input: TInput;
  outputs: DataBoundaryOperationTargets<TRecord>;
  scope: TScope;
}>;

export type ValidatedRealAiScreenBoundary = ValidatedBoundary<
  "REAL_AI",
  "SCREEN",
  RealAiDataRecord,
  RealAiScreenBoundaryInput
>;

export type ValidatedRealAiRunBoundary = ValidatedBoundary<
  "REAL_AI",
  "RUN",
  RealAiDataRecord,
  RealAiRunBoundaryInput
>;

export type ValidatedFixtureScreenBoundary = ValidatedBoundary<
  "FIXTURE",
  "SCREEN",
  FixtureDataRecord,
  FixtureScreenBoundaryInput
>;

export type ValidatedFixtureRunBoundary = ValidatedBoundary<
  "FIXTURE",
  "RUN",
  FixtureDataRecord,
  FixtureRunBoundaryInput
>;

export type ValidatedDataBoundary =
  | ValidatedFixtureRunBoundary
  | ValidatedFixtureScreenBoundary
  | ValidatedRealAiRunBoundary
  | ValidatedRealAiScreenBoundary;

export type DataBoundaryValidationResult = Result<
  ValidatedDataBoundary,
  DataBoundaryError
>;

export type RealAiRunComposition = Readonly<{
  dataKind: "REAL_AI";
  outputs: DataBoundaryOperationTargets<RealAiDataRecord>;
  records: readonly RealAiDataRecord[];
  storagePath: RealAiStoragePath;
}>;

export type RealAiRunCompositionResult = Result<
  RealAiRunComposition,
  DataBoundaryError
>;

function isUnknownRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownDataKind(value: unknown): value is "FIXTURE" | "REAL_AI" {
  return value === "FIXTURE" || value === "REAL_AI";
}

function isKnownScope(value: unknown): value is "RUN" | "SCREEN" {
  return value === "RUN" || value === "SCREEN";
}

function createOperationTargets<T>(
  records: readonly T[],
): DataBoundaryOperationTargets<T> {
  return Object.freeze({
    analyze: records,
    display: records,
    index: records,
    save: records,
  });
}

function emptyOperationTargets(): DataBoundaryOperationTargets<never> {
  return Object.freeze({
    analyze: EMPTY_RECORDS,
    display: EMPTY_RECORDS,
    index: EMPTY_RECORDS,
    save: EMPTY_RECORDS,
  });
}

function createFailure(
  code: DataBoundaryErrorCode,
  fieldPaths: readonly SafeDataBoundaryFieldPath[],
): DataBoundaryFailure {
  const uniquePaths = Object.freeze(
    [...new Set(fieldPaths.length === 0 ? (["$"] as const) : fieldPaths)].sort(),
  );

  return Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code,
      fieldPaths: uniquePaths,
      outputs: emptyOperationTargets(),
    }),
  });
}

function toSafeFieldPath(
  path: readonly PropertyKey[],
): SafeDataBoundaryFieldPath {
  const [first, second, third] = path;

  if (
    first === "dataKind" ||
    first === "scope" ||
    first === "storagePath"
  ) {
    return first;
  }

  if (first !== "records") {
    return "$";
  }

  if (typeof second !== "number" || !Number.isSafeInteger(second)) {
    return "records";
  }

  const recordPath = `records[${second}]` as const;
  if (
    third === "dataKind" ||
    third === "payload" ||
    third === "recordId"
  ) {
    return `${recordPath}.${third}`;
  }

  return recordPath;
}

function pathsFromIssues(
  issues: readonly Readonly<{ path: readonly PropertyKey[] }>[],
): readonly SafeDataBoundaryFieldPath[] {
  return issues.map(({ path }) => toSafeFieldPath(path));
}

function createValidatedBoundary<
  const TKind extends "FIXTURE" | "REAL_AI",
  const TScope extends "RUN" | "SCREEN",
  TRecord,
  TInput extends Readonly<{
    dataKind: TKind;
    records: readonly TRecord[];
    scope: TScope;
  }>,
>(input: TInput): ValidatedBoundary<TKind, TScope, TRecord, TInput> {
  return Object.freeze({
    [VALIDATED_DATA_BOUNDARY]: true as const,
    dataKind: input.dataKind,
    input,
    outputs: createOperationTargets(input.records),
    scope: input.scope,
  });
}

/**
 * Decodes an untrusted screen/run boundary without inferring a missing kind.
 * The returned operation targets are the only records authorized for the
 * caller's already-selected, same-kind pipeline.
 */
export function validateDataBoundary(
  input: unknown,
): DataBoundaryValidationResult {
  if (!isUnknownRecord(input)) {
    return createFailure("BOUNDARY_INPUT_INVALID", ["$"]);
  }

  const dataKind = input.dataKind;
  if (!isKnownDataKind(dataKind)) {
    return createFailure("DATA_KIND_INVALID", ["dataKind"]);
  }

  const scope = input.scope;
  if (!isKnownScope(scope)) {
    return createFailure("BOUNDARY_INPUT_INVALID", ["scope"]);
  }

  const records = input.records;
  if (!Array.isArray(records)) {
    return createFailure("BOUNDARY_INPUT_INVALID", ["records"]);
  }

  const invalidKindPaths: SafeDataBoundaryFieldPath[] = [];
  const mixedKindPaths: SafeDataBoundaryFieldPath[] = [];

  records.forEach((record, index) => {
    const recordKind = isUnknownRecord(record) ? record.dataKind : undefined;
    const fieldPath = `records[${index}].dataKind` as const;

    if (!isKnownDataKind(recordKind)) {
      invalidKindPaths.push(fieldPath);
    } else if (recordKind !== dataKind) {
      mixedKindPaths.push(fieldPath);
    }
  });

  if (invalidKindPaths.length > 0) {
    return createFailure("DATA_KIND_INVALID", invalidKindPaths);
  }

  if (mixedKindPaths.length > 0) {
    return createFailure("DATA_KIND_MIXED", mixedKindPaths);
  }

  const storagePathResult =
    dataKind === "REAL_AI"
      ? RealAiStoragePathSchema.safeParse(input.storagePath)
      : FixtureStoragePathSchema.safeParse(input.storagePath);
  if (!storagePathResult.success) {
    return createFailure("STORAGE_ROOT_MISMATCH", ["storagePath"]);
  }

  if (dataKind === "REAL_AI" && scope === "RUN") {
    const result = RealAiRunBoundaryInputSchema.safeParse(input);
    return result.success
      ? Object.freeze({
          ok: true as const,
          value: createValidatedBoundary<
            "REAL_AI",
            "RUN",
            RealAiDataRecord,
            RealAiRunBoundaryInput
          >(result.data),
        })
      : createFailure(
          "BOUNDARY_INPUT_INVALID",
          pathsFromIssues(result.error.issues),
        );
  }

  if (dataKind === "REAL_AI" && scope === "SCREEN") {
    const result = RealAiScreenBoundaryInputSchema.safeParse(input);
    return result.success
      ? Object.freeze({
          ok: true as const,
          value: createValidatedBoundary<
            "REAL_AI",
            "SCREEN",
            RealAiDataRecord,
            RealAiScreenBoundaryInput
          >(result.data),
        })
      : createFailure(
          "BOUNDARY_INPUT_INVALID",
          pathsFromIssues(result.error.issues),
        );
  }

  if (dataKind === "FIXTURE" && scope === "RUN") {
    const result = FixtureRunBoundaryInputSchema.safeParse(input);
    return result.success
      ? Object.freeze({
          ok: true as const,
          value: createValidatedBoundary<
            "FIXTURE",
            "RUN",
            FixtureDataRecord,
            FixtureRunBoundaryInput
          >(result.data),
        })
      : createFailure(
          "BOUNDARY_INPUT_INVALID",
          pathsFromIssues(result.error.issues),
        );
  }

  const result = FixtureScreenBoundaryInputSchema.safeParse(input);
  return result.success
    ? Object.freeze({
        ok: true as const,
        value: createValidatedBoundary<
          "FIXTURE",
          "SCREEN",
          FixtureDataRecord,
          FixtureScreenBoundaryInput
        >(result.data),
      })
    : createFailure(
        "BOUNDARY_INPUT_INVALID",
        pathsFromIssues(result.error.issues),
      );
}

/** Accepts only the opaque success token produced for a REAL_AI run. */
export function composeRealAiRun(
  boundary: ValidatedRealAiRunBoundary,
): RealAiRunCompositionResult {
  if (
    !isUnknownRecord(boundary) ||
    boundary[VALIDATED_DATA_BOUNDARY] !== true ||
    !isUnknownRecord(boundary.input)
  ) {
    const failure = createFailure("BOUNDARY_INPUT_INVALID", ["$"]);
    return failure;
  }

  const revalidated = validateDataBoundary(boundary.input);
  if (!revalidated.ok) {
    return revalidated;
  }

  if (
    revalidated.value.dataKind !== "REAL_AI" ||
    revalidated.value.scope !== "RUN"
  ) {
    const failure = createFailure("DATA_KIND_MIXED", ["dataKind"]);
    return failure;
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      dataKind: "REAL_AI" as const,
      outputs: revalidated.value.outputs,
      records: revalidated.value.input.records,
      storagePath: revalidated.value.input.storagePath,
    }),
  });
}
