import { randomUUID } from "node:crypto";

import { ApiErrorSchema } from "@ehime-vote-navigator/contracts";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Response,
} from "express";

import { LOCAL_API_PORT } from "../server/localServerConfig.js";
import { sendProjectedJson } from "../http/responseProjection.js";
import { type LocalNonce } from "./localNonce.js";

export const LOCAL_NONCE_HEADER = "x-ehime-local-nonce";
export const LOCAL_JSON_BODY_LIMIT_BYTES = 1024 * 1024;

export const ALLOWED_API_HOST_HEADERS = Object.freeze([
  `127.0.0.1:${LOCAL_API_PORT}`,
  `localhost:${LOCAL_API_PORT}`,
] as const);

export const ALLOWED_BROWSER_ORIGINS = Object.freeze([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
] as const);

const ALLOWED_METHODS = Object.freeze(["GET", "HEAD", "OPTIONS", "POST"] as const);
const MUTATION_METHOD = "POST";
const ALLOWED_PREFLIGHT_HEADERS = new Set([
  "content-type",
  LOCAL_NONCE_HEADER,
]);

export type LocalBoundaryOptions = Readonly<{
  allowOriginlessTestRequests?: boolean;
  nonce: LocalNonce;
  runtimeEnvironment?: string | undefined;
}>;

type BoundaryFailure = Readonly<{
  field: string;
  message: string;
  status: number;
}>;

const FAILURES = Object.freeze({
  bodyInvalid: {
    field: "body",
    message: "The JSON request body was rejected.",
    status: 400,
  },
  bodyTooLarge: {
    field: "body",
    message: "The JSON request body exceeds the local limit.",
    status: 413,
  },
  contentEncoding: {
    field: "content-encoding",
    message: "The request content encoding is not supported.",
    status: 415,
  },
  contentType: {
    field: "content-type",
    message: "Mutation requests must use application/json.",
    status: 415,
  },
  host: {
    field: "host",
    message: "The request Host is not allowed for this local API.",
    status: 403,
  },
  method: {
    field: "method",
    message: "The request method is not allowed by this local API.",
    status: 405,
  },
  nonce: {
    field: LOCAL_NONCE_HEADER,
    message: "The local mutation nonce is missing or invalid.",
    status: 403,
  },
  origin: {
    field: "origin",
    message: "The request Origin is not allowed for this local API.",
    status: 403,
  },
  preflightHeaders: {
    field: "access-control-request-headers",
    message: "The requested browser headers are not allowed.",
    status: 403,
  },
} satisfies Record<string, BoundaryFailure>);

function reject(response: Response, failure: BoundaryFailure): void {
  response.set("Cache-Control", "no-store");
  sendProjectedJson(response, failure.status, ApiErrorSchema, {
    ok: false,
    error: {
      code: "LOCAL_REQUEST_REJECTED",
      message: failure.message,
      fields: [failure.field],
      retry: { allowed: false, remaining: 0 },
    },
    requestId: randomUUID(),
  });
}

function isAllowedHost(host: string | undefined): boolean {
  return (
    host !== undefined &&
    (ALLOWED_API_HOST_HEADERS as readonly string[]).includes(host.toLowerCase())
  );
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return (
    origin !== undefined &&
    (ALLOWED_BROWSER_ORIGINS as readonly string[]).includes(origin)
  );
}

function isApplicationJson(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }

  const [mediaType] = contentType.split(";", 1);
  return mediaType?.trim().toLowerCase() === "application/json";
}

function hasAllowedPreflightHeaders(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") {
    return true;
  }

  return value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .every((header) => ALLOWED_PREFLIGHT_HEADERS.has(header));
}

function isBodyParserError(
  error: unknown,
): error is Readonly<{ status?: unknown; type?: unknown }> {
  return typeof error === "object" && error !== null;
}

/** Enforces Host, Origin, method, JSON, and nonce checks before route code. */
export function createLocalBoundaryMiddleware(
  options: LocalBoundaryOptions,
): RequestHandler {
  const runtimeEnvironment =
    options.runtimeEnvironment ?? process.env.NODE_ENV;
  const allowOriginless = options.allowOriginlessTestRequests === true;

  if (allowOriginless && runtimeEnvironment !== "test") {
    throw new Error(
      "Originless requests can only be enabled by the in-process test harness.",
    );
  }

  return (request, response, next): void => {
    if (!isAllowedHost(request.headers.host)) {
      reject(response, FAILURES.host);
      return;
    }

    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      if (!(origin === undefined && allowOriginless)) {
        reject(response, FAILURES.origin);
        return;
      }
    } else {
      response.set("Access-Control-Allow-Origin", origin);
      response.vary("Origin");
    }

    if (!(ALLOWED_METHODS as readonly string[]).includes(request.method)) {
      response.set("Allow", ALLOWED_METHODS.join(", "));
      reject(response, FAILURES.method);
      return;
    }

    if (request.method === "OPTIONS") {
      const requestedMethod = request.get("access-control-request-method");
      if (
        requestedMethod === undefined ||
        !(ALLOWED_METHODS as readonly string[]).includes(
          requestedMethod.toUpperCase(),
        ) ||
        requestedMethod.toUpperCase() === "OPTIONS"
      ) {
        reject(response, FAILURES.method);
        return;
      }
      if (
        !hasAllowedPreflightHeaders(
          request.get("access-control-request-headers"),
        )
      ) {
        reject(response, FAILURES.preflightHeaders);
        return;
      }

      response.set({
        "Access-Control-Allow-Headers": `Content-Type, ${LOCAL_NONCE_HEADER}`,
        "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
        "Access-Control-Max-Age": "600",
      });
      response.status(204).end();
      return;
    }

    if (request.method === MUTATION_METHOD) {
      if (!isApplicationJson(request.headers["content-type"])) {
        reject(response, FAILURES.contentType);
        return;
      }
      if (!options.nonce.matches(request.get(LOCAL_NONCE_HEADER))) {
        reject(response, FAILURES.nonce);
        return;
      }
    }

    next();
  };
}

/** Parses only guarded JSON mutation bodies and caps decoded input at 1 MiB. */
export function createLocalMutationJsonParser(): RequestHandler {
  const parser = express.json({
    inflate: false,
    limit: LOCAL_JSON_BODY_LIMIT_BYTES,
    strict: true,
    type: "application/json",
  });

  return (request, response, next): void => {
    if (request.method !== MUTATION_METHOD) {
      next();
      return;
    }
    parser(request, response, next);
  };
}

/** Converts body-parser failures to fixed, non-reflective JSON responses. */
export const handleLocalBoundaryError: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
): void => {
  if (!isBodyParserError(error)) {
    next(error);
    return;
  }

  if (error.type === "entity.too.large" || error.status === 413) {
    reject(response, FAILURES.bodyTooLarge);
    return;
  }
  if (error.type === "encoding.unsupported" || error.status === 415) {
    reject(response, FAILURES.contentEncoding);
    return;
  }
  if (error.type === "entity.parse.failed" || error.status === 400) {
    reject(response, FAILURES.bodyInvalid);
    return;
  }

  next(error);
};
