import { isDeepStrictEqual } from "node:util";

import {
  ApiErrorSchema,
  type ApiError,
} from "@ehime-vote-navigator/contracts";
import { redactProtectedValues } from "@ehime-vote-navigator/domain";
import type { Response } from "express";
import type { output, ZodType } from "zod";

export const SAFE_RESPONSE_PROJECTION_ERROR_STATUS = 500;

const projectionFailure = ApiErrorSchema.parse({
  ok: false,
  error: {
    code: "INTERNAL_FAILURE",
    message: "The response could not be produced safely.",
    retry: { allowed: false, remaining: 0 },
  },
  requestId: "safe-response-projection-failed",
});

Object.freeze(projectionFailure.error.retry);
Object.freeze(projectionFailure.error);

/** Fixed fallback that contains no candidate data, parse issue, or exception. */
export const SAFE_RESPONSE_PROJECTION_ERROR: ApiError =
  Object.freeze(projectionFailure);

export type ApiResponseProjection<T> =
  | Readonly<{ body: T; ok: true }>
  | Readonly<{
      body: ApiError;
      ok: false;
    }>;

function failedProjection<T>(): ApiResponseProjection<T> {
  return Object.freeze({
    body: SAFE_RESPONSE_PROJECTION_ERROR,
    ok: false as const,
  });
}

/**
 * Redacts a response candidate, decodes the redacted value with its strict
 * response schema, and audits schema output once more before serialization.
 */
export function projectApiResponse<TSchema extends ZodType>(
  schema: TSchema,
  candidate: unknown,
): ApiResponseProjection<output<TSchema>> {
  try {
    const redactedCandidate = redactProtectedValues(candidate);
    const decoded = schema.safeParse(redactedCandidate);
    if (!decoded.success) {
      return failedProjection();
    }

    const redactedDecoded = redactProtectedValues(decoded.data);
    const redecoded = schema.safeParse(redactedDecoded);
    if (!redecoded.success) {
      return failedProjection();
    }

    const finalAudit = redactProtectedValues(redecoded.data);
    if (!isDeepStrictEqual(finalAudit, redecoded.data)) {
      return failedProjection();
    }

    return Object.freeze({ body: redecoded.data, ok: true as const });
  } catch {
    return failedProjection();
  }
}

/** Sends only a successfully projected body or the fixed safe 500 response. */
export function sendProjectedJson<TSchema extends ZodType>(
  response: Response,
  successStatus: number,
  schema: TSchema,
  candidate: unknown,
): ApiResponseProjection<output<TSchema>> {
  const projection = projectApiResponse(schema, candidate);
  response
    .status(
      projection.ok ? successStatus : SAFE_RESPONSE_PROJECTION_ERROR_STATUS,
    )
    .json(projection.body);
  return projection;
}
