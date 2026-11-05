import { z } from "zod";

import {
  FixtureDataKindSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
} from "./models/primitives.js";

export const REAL_AI_STORAGE_ROOT = "data/real";
export const FIXTURE_STORAGE_ROOT = "packages/fixtures";

export const DATA_BOUNDARY_SCOPES = ["SCREEN", "RUN"] as const;
export const DataBoundaryScopeSchema = z.enum(DATA_BOUNDARY_SCOPES);

export type DataBoundaryJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly DataBoundaryJsonValue[]
  | { readonly [key: string]: DataBoundaryJsonValue };

export const DataBoundaryJsonValueSchema: z.ZodType<DataBoundaryJsonValue> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(DataBoundaryJsonValueSchema),
      z.record(z.string(), DataBoundaryJsonValueSchema),
    ]),
  );

export const DataBoundaryPayloadSchema = z
  .record(z.string(), DataBoundaryJsonValueSchema)
  .readonly();

function isStrictStorageDescendant(value: string, root: string): boolean {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\0") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }

  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.endsWith("/")) {
    return false;
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":"),
    )
  ) {
    return false;
  }

  const rootSegments = root.split("/");
  return (
    segments.length > rootSegments.length &&
    rootSegments.every((segment, index) => segments[index] === segment)
  );
}

export const RealAiStoragePathSchema = z
  .string()
  .refine((value) => isStrictStorageDescendant(value, REAL_AI_STORAGE_ROOT), {
    message: `Expected a repository-relative path below ${REAL_AI_STORAGE_ROOT}.`,
  })
  .brand<"RealAiStoragePath">();

export const FixtureStoragePathSchema = z
  .string()
  .refine((value) => isStrictStorageDescendant(value, FIXTURE_STORAGE_ROOT), {
    message: `Expected a repository-relative path below ${FIXTURE_STORAGE_ROOT}.`,
  })
  .brand<"FixtureStoragePath">();

export const RealAiDataRecordSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    recordId: NonEmptyStringSchema,
    payload: DataBoundaryPayloadSchema,
  })
  .strict()
  .readonly()
  .brand<"RealAiDataRecord">();

export const FixtureDataRecordSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    recordId: NonEmptyStringSchema,
    payload: DataBoundaryPayloadSchema,
  })
  .strict()
  .readonly()
  .brand<"FixtureDataRecord">();

const RealAiBoundaryShape = {
  dataKind: RealAiDataKindSchema,
  storagePath: RealAiStoragePathSchema,
  records: z.array(RealAiDataRecordSchema).readonly(),
} as const;

const FixtureBoundaryShape = {
  dataKind: FixtureDataKindSchema,
  storagePath: FixtureStoragePathSchema,
  records: z.array(FixtureDataRecordSchema).readonly(),
} as const;

export const RealAiScreenBoundaryInputSchema = z
  .object({
    ...RealAiBoundaryShape,
    scope: z.literal("SCREEN"),
  })
  .strict()
  .readonly()
  .brand<"RealAiScreenBoundaryInput">();

export const RealAiRunBoundaryInputSchema = z
  .object({
    ...RealAiBoundaryShape,
    scope: z.literal("RUN"),
  })
  .strict()
  .readonly()
  .brand<"RealAiRunBoundaryInput">();

export const FixtureScreenBoundaryInputSchema = z
  .object({
    ...FixtureBoundaryShape,
    scope: z.literal("SCREEN"),
  })
  .strict()
  .readonly()
  .brand<"FixtureScreenBoundaryInput">();

export const FixtureRunBoundaryInputSchema = z
  .object({
    ...FixtureBoundaryShape,
    scope: z.literal("RUN"),
  })
  .strict()
  .readonly()
  .brand<"FixtureRunBoundaryInput">();

export const RealAiDataBoundaryInputSchema = z.union([
  RealAiScreenBoundaryInputSchema,
  RealAiRunBoundaryInputSchema,
]);

export const FixtureDataBoundaryInputSchema = z.union([
  FixtureScreenBoundaryInputSchema,
  FixtureRunBoundaryInputSchema,
]);

export type DataBoundaryScope = z.infer<typeof DataBoundaryScopeSchema>;
export type DataBoundaryPayload = z.infer<typeof DataBoundaryPayloadSchema>;
export type RealAiStoragePath = z.infer<typeof RealAiStoragePathSchema>;
export type FixtureStoragePath = z.infer<typeof FixtureStoragePathSchema>;
export type RealAiDataRecord = z.infer<typeof RealAiDataRecordSchema>;
export type FixtureDataRecord = z.infer<typeof FixtureDataRecordSchema>;
export type RealAiScreenBoundaryInput = z.infer<
  typeof RealAiScreenBoundaryInputSchema
>;
export type RealAiRunBoundaryInput = z.infer<
  typeof RealAiRunBoundaryInputSchema
>;
export type FixtureScreenBoundaryInput = z.infer<
  typeof FixtureScreenBoundaryInputSchema
>;
export type FixtureRunBoundaryInput = z.infer<
  typeof FixtureRunBoundaryInputSchema
>;
export type RealAiDataBoundaryInput = z.infer<
  typeof RealAiDataBoundaryInputSchema
>;
export type FixtureDataBoundaryInput = z.infer<
  typeof FixtureDataBoundaryInputSchema
>;
