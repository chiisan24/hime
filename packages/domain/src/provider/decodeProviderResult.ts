import {
  FIXTURE_DATA_LABEL,
  FixtureProviderResultSchema,
  REAL_AI_DATA_LABEL,
  RealAiProviderResultSchema,
  type FixtureProviderResult,
  type ProviderDataLabel,
  type ProviderFailureDetail,
  type ProviderOperation,
  type ProviderResult,
  type ProviderResultStatus,
  type ProviderRoute,
  type ProviderScalarValue,
  type RealAiProviderResult,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../result.js";

const EMPTY_OUTPUT = Object.freeze([]) as readonly never[];

export type ProviderContractFieldPath =
  | "$"
  | "dataKind"
  | "error"
  | "error.code"
  | "error.fields"
  | `error.fields[${number}]`
  | "error.message"
  | "error.retry"
  | "error.retry.allowed"
  | "error.retry.remaining"
  | "items"
  | `items[${number}]`
  | `items[${number}].dataKind`
  | `items[${number}].fields`
  | `items[${number}].fields[${number}]`
  | `items[${number}].fields[${number}].name`
  | `items[${number}].fields[${number}].value`
  | `items[${number}].itemId`
  | "message"
  | "operations"
  | `operations[${number}]`
  | `operations[${number}].label`
  | `operations[${number}].operationId`
  | `operations[${number}].route`
  | "requestId"
  | "route"
  | "status";

export type ScreenDataField = Readonly<{
  name: string;
  value: ProviderScalarValue;
}>;

export type ScreenDataItem = Readonly<{
  itemId: string;
  fields: readonly ScreenDataField[];
}>;

export type ScreenDataOperation = Readonly<{
  operationId: string;
  label: string;
  route: ProviderRoute;
}>;

export type ScreenDataFailure = Readonly<{
  code: ProviderFailureDetail["code"];
  message: string;
  fields: readonly string[];
  retry: Readonly<{
    allowed: boolean;
    remaining: number;
  }>;
}>;

/**
 * The UI-facing shape is identical for both providers. The data label is the
 * only field derived from which provider entrance schema accepted the input.
 */
export type ScreenDataModel = Readonly<{
  dataLabel: ProviderDataLabel;
  requestId: string;
  route: ProviderRoute;
  state: ProviderResultStatus;
  items: readonly ScreenDataItem[];
  operations: readonly ScreenDataOperation[];
  message: string | null;
  failure: ScreenDataFailure | null;
}>;

export type ProviderContractViolation = Readonly<{
  code: "PROVIDER_CONTRACT_VIOLATION";
  state: "no-data";
  fieldPaths: readonly ProviderContractFieldPath[];
  outputs: Readonly<{
    display: readonly never[];
    save: readonly never[];
  }>;
}>;

export type DecodeProviderResult = Result<
  ScreenDataModel,
  ProviderContractViolation
>;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemPath(
  path: readonly PropertyKey[],
): ProviderContractFieldPath {
  const itemIndex = path[1];
  if (typeof itemIndex !== "number" || !Number.isSafeInteger(itemIndex)) {
    return "items";
  }

  const base = `items[${itemIndex}]` as const;
  const itemKey = path[2];
  if (itemKey === "dataKind" || itemKey === "itemId") {
    return `${base}.${itemKey}`;
  }

  if (itemKey !== "fields") {
    return base;
  }

  const fieldIndex = path[3];
  if (typeof fieldIndex !== "number" || !Number.isSafeInteger(fieldIndex)) {
    return `${base}.fields`;
  }

  const fieldBase = `${base}.fields[${fieldIndex}]` as const;
  const fieldKey = path[4];
  if (fieldKey === "name" || fieldKey === "value") {
    return `${fieldBase}.${fieldKey}`;
  }

  return fieldBase;
}

function operationPath(
  path: readonly PropertyKey[],
): ProviderContractFieldPath {
  const operationIndex = path[1];
  if (
    typeof operationIndex !== "number" ||
    !Number.isSafeInteger(operationIndex)
  ) {
    return "operations";
  }

  const base = `operations[${operationIndex}]` as const;
  const operationKey = path[2];
  if (
    operationKey === "label" ||
    operationKey === "operationId" ||
    operationKey === "route"
  ) {
    return `${base}.${operationKey}`;
  }

  return base;
}

function errorPath(path: readonly PropertyKey[]): ProviderContractFieldPath {
  const errorKey = path[1];
  if (errorKey === "code" || errorKey === "message") {
    return `error.${errorKey}`;
  }

  if (errorKey === "fields") {
    const fieldIndex = path[2];
    return typeof fieldIndex === "number" && Number.isSafeInteger(fieldIndex)
      ? `error.fields[${fieldIndex}]`
      : "error.fields";
  }

  if (errorKey === "retry") {
    const retryKey = path[2];
    if (retryKey === "allowed" || retryKey === "remaining") {
      return `error.retry.${retryKey}`;
    }
    return "error.retry";
  }

  return "error";
}

function toSafeFieldPath(
  path: readonly PropertyKey[],
): ProviderContractFieldPath {
  const first = path[0];

  if (
    first === "dataKind" ||
    first === "message" ||
    first === "requestId" ||
    first === "route" ||
    first === "status"
  ) {
    return first;
  }

  if (first === "items") {
    return itemPath(path);
  }

  if (first === "operations") {
    return operationPath(path);
  }

  if (first === "error") {
    return errorPath(path);
  }

  return "$";
}

function createViolation(
  fieldPaths: readonly ProviderContractFieldPath[],
): DecodeProviderResult {
  const normalizedPaths = Object.freeze(
    [...new Set(fieldPaths.length === 0 ? (["$"] as const) : fieldPaths)].sort(),
  );

  return Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: "PROVIDER_CONTRACT_VIOLATION" as const,
      state: "no-data" as const,
      fieldPaths: normalizedPaths,
      outputs: Object.freeze({
        display: EMPTY_OUTPUT,
        save: EMPTY_OUTPUT,
      }),
    }),
  });
}

function createViolationFromIssues(
  issues: readonly Readonly<{ path: readonly PropertyKey[] }>[],
): DecodeProviderResult {
  return createViolation(issues.map(({ path }) => toSafeFieldPath(path)));
}

function projectFields(
  fields: readonly Readonly<{ name: string; value: ProviderScalarValue }>[],
): readonly ScreenDataField[] {
  return Object.freeze(
    fields.map((field) =>
      Object.freeze({
        name: field.name,
        value: field.value,
      }),
    ),
  );
}

function projectItems(
  items: ProviderResult["items"],
): readonly ScreenDataItem[] {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        itemId: item.itemId,
        fields: projectFields(item.fields),
      }),
    ),
  );
}

function projectOperations(
  operations: readonly ProviderOperation[],
): readonly ScreenDataOperation[] {
  return Object.freeze(
    operations.map((operation) =>
      Object.freeze({
        operationId: operation.operationId,
        label: operation.label,
        route: operation.route,
      }),
    ),
  );
}

function projectFailure(
  failure: ProviderFailureDetail,
): ScreenDataFailure {
  return Object.freeze({
    code: failure.code,
    message: failure.message,
    fields: Object.freeze([...failure.fields]),
    retry: Object.freeze({
      allowed: failure.retry.allowed,
      remaining: failure.retry.remaining,
    }),
  });
}

/** Projects an already-decoded provider result without mutating it. */
export function projectProviderResult(
  result: ProviderResult,
): ScreenDataModel {
  const dataLabel =
    result.dataKind === "REAL_AI" ? REAL_AI_DATA_LABEL : FIXTURE_DATA_LABEL;
  const failure =
    result.status === "failure" ? projectFailure(result.error) : null;
  const message =
    result.status === "success"
      ? null
      : result.status === "failure"
        ? result.error.message
        : result.message;

  return Object.freeze({
    dataLabel,
    requestId: result.requestId,
    route: result.route,
    state: result.status,
    items: projectItems(result.items),
    operations: projectOperations(result.operations),
    message,
    failure,
  });
}

export function decodeRealAiProviderResult(
  input: unknown,
): DecodeProviderResult {
  const decoded = RealAiProviderResultSchema.safeParse(input);
  return decoded.success
    ? Object.freeze({
        ok: true as const,
        value: projectProviderResult(decoded.data),
      })
    : createViolationFromIssues(decoded.error.issues);
}

export function decodeFixtureProviderResult(
  input: unknown,
): DecodeProviderResult {
  const decoded = FixtureProviderResultSchema.safeParse(input);
  return decoded.success
    ? Object.freeze({
        ok: true as const,
        value: projectProviderResult(decoded.data),
      })
    : createViolationFromIssues(decoded.error.issues);
}

/**
 * Selects a separate REAL_AI or FIXTURE entrance schema from the explicit tag.
 * Missing, unknown, or multiple tags are never inferred from the payload.
 */
export function decodeProviderResult(input: unknown): DecodeProviderResult {
  if (!isUnknownRecord(input)) {
    return createViolation(["$"]);
  }

  if (input.dataKind === "REAL_AI") {
    return decodeRealAiProviderResult(input);
  }

  if (input.dataKind === "FIXTURE") {
    return decodeFixtureProviderResult(input);
  }

  return createViolation(["dataKind"]);
}

export type DecodedRealAiProviderResult = RealAiProviderResult;
export type DecodedFixtureProviderResult = FixtureProviderResult;
