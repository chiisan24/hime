import { z } from "zod";

import {
  ApiErrorCodeSchema,
  NonEmptyStringSchema,
} from "../models/primitives.js";

export const ApiRetrySchema = z
  .object({
    allowed: z.boolean(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();

export const ApiErrorDetailSchema = z
  .object({
    code: ApiErrorCodeSchema,
    message: NonEmptyStringSchema,
    fields: z.array(NonEmptyStringSchema).readonly().optional(),
    retry: ApiRetrySchema,
  })
  .strict();

export const ApiErrorSchema = z
  .object({
    ok: z.literal(false),
    error: ApiErrorDetailSchema,
    requestId: NonEmptyStringSchema,
  })
  .strict();

export function createApiSuccessSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      requestId: NonEmptyStringSchema,
    })
    .strict();
}

export function createApiEnvelopeSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z.discriminatedUnion("ok", [
    createApiSuccessSchema(dataSchema),
    ApiErrorSchema,
  ]);
}

export type ApiRetry = z.infer<typeof ApiRetrySchema>;
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiSuccess<T> = Readonly<{
  ok: true;
  data: T;
  requestId: string;
}>;
export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;
