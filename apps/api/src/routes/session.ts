import { randomUUID } from "node:crypto";

import { type Express } from "express";
import { z } from "zod";

import {
  SAFE_RESPONSE_PROJECTION_ERROR,
  SAFE_RESPONSE_PROJECTION_ERROR_STATUS,
} from "../http/responseProjection.js";
import { type LocalNonce } from "../middleware/localNonce.js";

export const SessionResponseSchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      })
      .strict(),
    requestId: z.string().uuid(),
  })
  .strict();

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

type SessionProjectionResult =
  | Readonly<{ body: SessionResponse; ok: true }>
  | Readonly<{
      body: typeof SAFE_RESPONSE_PROJECTION_ERROR;
      ok: false;
    }>;

const SESSION_PROJECTION_FAILURE = Object.freeze({
  body: SAFE_RESPONSE_PROJECTION_ERROR,
  ok: false as const,
});

function projectSessionResponse(
  nonceValue: string,
  requestIdValue: string,
): SessionProjectionResult {
  try {
    const candidate = {
      ok: true,
      data: { nonce: nonceValue },
      requestId: requestIdValue,
    };
    const initialValidation = SessionResponseSchema.safeParse(candidate);
    if (!initialValidation.success) {
      return SESSION_PROJECTION_FAILURE;
    }

    const validated = initialValidation.data;
    const assembled = {
      ok: validated.ok,
      data: { nonce: validated.data.nonce },
      requestId: validated.requestId,
    };
    const finalValidation = SessionResponseSchema.safeParse(assembled);
    if (!finalValidation.success) {
      return SESSION_PROJECTION_FAILURE;
    }

    return Object.freeze({
      body: finalValidation.data,
      ok: true as const,
    });
  } catch {
    return SESSION_PROJECTION_FAILURE;
  }
}

/** Registers the only route that reveals the in-memory mutation nonce. */
export function registerSessionRoute(app: Express, nonce: LocalNonce): void {
  app.get("/api/v1/session", (_request, response) => {
    const nonceValue = nonce.revealForSession();
    const requestIdValue = randomUUID();
    const projection = projectSessionResponse(nonceValue, requestIdValue);

    response.set({
      "Cache-Control": "no-store, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    });
    response
      .status(projection.ok ? 200 : SAFE_RESPONSE_PROJECTION_ERROR_STATUS)
      .json(projection.body);
  });
}
