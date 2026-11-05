import { z } from "zod";

import {
  ApiErrorCodeSchema,
  FixtureDataKindSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
} from "../models/primitives.js";

export const PROVIDER_RESULT_STATUSES = [
  "success",
  "no-data",
  "no-results",
  "failure",
] as const;

export const ProviderResultStatusSchema = z.enum(PROVIDER_RESULT_STATUSES);

export const REAL_AI_DATA_LABEL = "2022年実資料・AI解析";
export const FIXTURE_DATA_LABEL = "架空fixture・UIテスト専用";

export const ProviderDataLabelSchema = z.enum([
  REAL_AI_DATA_LABEL,
  FIXTURE_DATA_LABEL,
]);

function isLocalScreenRoute(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\?#\u0000-\u0020\u007f]/u.test(value)
  );
}

export const ProviderRouteSchema = z
  .string()
  .refine(isLocalScreenRoute, {
    message: "Expected a local screen route without query or fragment data.",
  })
  .brand<"ProviderRoute">();

export const ProviderScalarValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const ProviderNamedValueSchema = z
  .object({
    name: NonEmptyStringSchema,
    value: ProviderScalarValueSchema,
  })
  .strict()
  .readonly();

export const ProviderOperationSchema = z
  .object({
    operationId: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    route: ProviderRouteSchema,
  })
  .strict()
  .readonly();

export const ProviderRetrySchema = z
  .object({
    allowed: z.boolean(),
    remaining: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

export const ProviderFailureDetailSchema = z
  .object({
    code: ApiErrorCodeSchema,
    message: NonEmptyStringSchema,
    fields: z.array(NonEmptyStringSchema).readonly(),
    retry: ProviderRetrySchema,
  })
  .strict()
  .readonly();

const RequestShape = {
  requestId: NonEmptyStringSchema,
  route: ProviderRouteSchema,
  operation: NonEmptyStringSchema,
  parameters: z.array(ProviderNamedValueSchema).readonly(),
} as const;

export const RealAiProviderRequestSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    ...RequestShape,
  })
  .strict()
  .readonly();

export const FixtureProviderRequestSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    ...RequestShape,
  })
  .strict()
  .readonly();

export const ProviderRequestSchema = z.discriminatedUnion("dataKind", [
  RealAiProviderRequestSchema,
  FixtureProviderRequestSchema,
]);

export const RealAiProviderItemSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    itemId: NonEmptyStringSchema,
    fields: z.array(ProviderNamedValueSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export const FixtureProviderItemSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    itemId: NonEmptyStringSchema,
    fields: z.array(ProviderNamedValueSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

const ResultBaseShape = {
  requestId: NonEmptyStringSchema,
  route: ProviderRouteSchema,
  operations: z.array(ProviderOperationSchema).readonly(),
} as const;

const RealAiEmptyItemsSchema = z
  .array(RealAiProviderItemSchema)
  .length(0)
  .readonly();
const FixtureEmptyItemsSchema = z
  .array(FixtureProviderItemSchema)
  .length(0)
  .readonly();

export const RealAiProviderSuccessSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    status: z.literal("success"),
    ...ResultBaseShape,
    items: z.array(RealAiProviderItemSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export const RealAiProviderNoDataSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    status: z.literal("no-data"),
    ...ResultBaseShape,
    items: RealAiEmptyItemsSchema,
    message: NonEmptyStringSchema,
  })
  .strict()
  .readonly();

export const RealAiProviderNoResultsSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    status: z.literal("no-results"),
    ...ResultBaseShape,
    items: RealAiEmptyItemsSchema,
    message: NonEmptyStringSchema,
  })
  .strict()
  .readonly();

export const RealAiProviderFailureSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    status: z.literal("failure"),
    ...ResultBaseShape,
    items: RealAiEmptyItemsSchema,
    error: ProviderFailureDetailSchema,
  })
  .strict()
  .readonly();

export const RealAiProviderResultSchema = z.discriminatedUnion("status", [
  RealAiProviderSuccessSchema,
  RealAiProviderNoDataSchema,
  RealAiProviderNoResultsSchema,
  RealAiProviderFailureSchema,
]);

export const FixtureProviderSuccessSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    status: z.literal("success"),
    ...ResultBaseShape,
    items: z.array(FixtureProviderItemSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export const FixtureProviderNoDataSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    status: z.literal("no-data"),
    ...ResultBaseShape,
    items: FixtureEmptyItemsSchema,
    message: NonEmptyStringSchema,
  })
  .strict()
  .readonly();

export const FixtureProviderNoResultsSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    status: z.literal("no-results"),
    ...ResultBaseShape,
    items: FixtureEmptyItemsSchema,
    message: NonEmptyStringSchema,
  })
  .strict()
  .readonly();

export const FixtureProviderFailureSchema = z
  .object({
    dataKind: FixtureDataKindSchema,
    status: z.literal("failure"),
    ...ResultBaseShape,
    items: FixtureEmptyItemsSchema,
    error: ProviderFailureDetailSchema,
  })
  .strict()
  .readonly();

export const FixtureProviderResultSchema = z.discriminatedUnion("status", [
  FixtureProviderSuccessSchema,
  FixtureProviderNoDataSchema,
  FixtureProviderNoResultsSchema,
  FixtureProviderFailureSchema,
]);

export const ProviderResultSchema = z.union([
  RealAiProviderResultSchema,
  FixtureProviderResultSchema,
]);

export type ProviderResultStatus = z.infer<
  typeof ProviderResultStatusSchema
>;
export type ProviderDataLabel = z.infer<typeof ProviderDataLabelSchema>;
export type ProviderRoute = z.infer<typeof ProviderRouteSchema>;
export type ProviderScalarValue = z.infer<typeof ProviderScalarValueSchema>;
export type ProviderNamedValue = z.infer<typeof ProviderNamedValueSchema>;
export type ProviderOperation = z.infer<typeof ProviderOperationSchema>;
export type ProviderRetry = z.infer<typeof ProviderRetrySchema>;
export type ProviderFailureDetail = z.infer<
  typeof ProviderFailureDetailSchema
>;
export type RealAiProviderRequest = z.infer<
  typeof RealAiProviderRequestSchema
>;
export type FixtureProviderRequest = z.infer<
  typeof FixtureProviderRequestSchema
>;
export type ProviderRequest = z.infer<typeof ProviderRequestSchema>;
export type RealAiProviderItem = z.infer<typeof RealAiProviderItemSchema>;
export type FixtureProviderItem = z.infer<typeof FixtureProviderItemSchema>;
export type RealAiProviderSuccess = z.infer<
  typeof RealAiProviderSuccessSchema
>;
export type RealAiProviderNoData = z.infer<
  typeof RealAiProviderNoDataSchema
>;
export type RealAiProviderNoResults = z.infer<
  typeof RealAiProviderNoResultsSchema
>;
export type RealAiProviderFailure = z.infer<
  typeof RealAiProviderFailureSchema
>;
export type RealAiProviderResult = z.infer<
  typeof RealAiProviderResultSchema
>;
export type FixtureProviderSuccess = z.infer<
  typeof FixtureProviderSuccessSchema
>;
export type FixtureProviderNoData = z.infer<
  typeof FixtureProviderNoDataSchema
>;
export type FixtureProviderNoResults = z.infer<
  typeof FixtureProviderNoResultsSchema
>;
export type FixtureProviderFailure = z.infer<
  typeof FixtureProviderFailureSchema
>;
export type FixtureProviderResult = z.infer<
  typeof FixtureProviderResultSchema
>;
export type ProviderResult = z.infer<typeof ProviderResultSchema>;
