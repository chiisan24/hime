import express, { type Express, type RequestHandler } from "express";
import { z } from "zod";

import { sendProjectedJson } from "./http/responseProjection.js";
import {
  createLocalBoundaryMiddleware,
  createLocalMutationJsonParser,
  handleLocalBoundaryError,
} from "./middleware/localBoundary.js";
import { createLocalNonce } from "./middleware/localNonce.js";
import { registerSessionRoute } from "./routes/session.js";

export const HealthResponseSchema = z
  .object({
    service: z.literal("ehime-vote-navigator-api"),
    status: z.literal("ok"),
    readiness: z.literal("NOT_READY"),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type CreateAppOptions = Readonly<{
  allowOriginlessTestRequests?: boolean;
}>;

const sendHealth: RequestHandler = (_request, response) => {
  sendProjectedJson(response, 200, HealthResponseSchema, {
    service: "ehime-vote-navigator-api",
    status: "ok",
    readiness: "NOT_READY",
  });
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const nonce = createLocalNonce();

  app.disable("x-powered-by");
  app.disable("trust proxy");
  app.use(
    createLocalBoundaryMiddleware({
      nonce,
      ...(options.allowOriginlessTestRequests === undefined
        ? {}
        : {
            allowOriginlessTestRequests:
              options.allowOriginlessTestRequests,
          }),
    }),
  );
  app.use(createLocalMutationJsonParser());

  app.get("/health", sendHealth);
  app.get("/api/v1/health", sendHealth);
  registerSessionRoute(app, nonce);

  app.use(handleLocalBoundaryError);

  return app;
}
