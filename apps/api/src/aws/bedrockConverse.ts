import {
  BEDROCK_BEARER_TOKEN_ENV_NAME,
  type AwsConfigNotReady,
  type ReadyAwsConfig,
} from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

import { withReadyAwsConfig, type AwsEnvironment } from "../config/aws.js";

/**
 * Server-side-only Bedrock Converse client.
 *
 * It calls the Converse REST API with `fetch` and an admin-issued Bedrock API
 * key sent as a Bearer token. It never logs, returns, or throws the key, the
 * request, or the response body: failures are fixed codes (plus an HTTP status
 * number). Hard limits are enforced here, not only in any UI.
 */

/** Model IDs the admin-issued key may call (Japan-domestic profiles). */
export const ALLOWED_BEDROCK_MODEL_IDS: readonly string[] = Object.freeze([
  "jp.anthropic.claude-haiku-5-5",
  "jp.anthropic.claude-opus-5-5",
]);

/** Cap on `system.length + text.length` (UTF-16 code units), checked before fetch. */
export const MAX_CONVERSE_INPUT_CHARS = 20_000;
export const CONVERSE_MAX_TOKENS = 2_000;
export const CONVERSE_TIMEOUT_MS = 30_000;
export const CONVERSE_MAX_CALLS_PER_WINDOW = 10;
export const CONVERSE_RATE_WINDOW_MS = 60_000;

const MAX_TOKEN_LENGTH = 4_096;
const VISIBLE_ASCII_TOKEN = /^[\u0021-\u007E]+$/u;

export type ConverseRequestInit = Readonly<{
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
  redirect: "error";
}>;

export type ConverseHttpResponse = Readonly<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  body?: Readonly<{ cancel: () => Promise<unknown> }> | null;
}>;

/** The subset of `fetch` the client uses; the global `fetch` satisfies it. */
export type ConverseFetch = (
  url: string,
  init: ConverseRequestInit,
) => Promise<ConverseHttpResponse>;

export type ConverseRequest = Readonly<{
  modelId: string;
  system: string;
  text: string;
}>;

export type BedrockConverseSuccess = Readonly<{
  /** First non-empty `output.message.content[].text`. */
  text: string;
  status: number;
  elapsedMs: number;
}>;

export type BedrockConverseError =
  | Readonly<{ code: "CONFIG_NOT_READY"; notReady: AwsConfigNotReady }>
  | Readonly<{ code: "HTTP_ERROR"; status: number }>
  | Readonly<{
      code:
        | "INPUT_INVALID"
        | "INPUT_TOO_LONG"
        | "MODEL_NOT_ALLOWED"
        | "TOKEN_INVALID"
        | "BUSY"
        | "RATE_LIMITED"
        | "TIMEOUT"
        | "NETWORK_ERROR"
        | "RESPONSE_INVALID";
    }>;

export type BedrockConverseResult = Result<
  BedrockConverseSuccess,
  BedrockConverseError
>;

export type BedrockConverseClient = Readonly<{
  converse: (request: ConverseRequest) => Promise<BedrockConverseResult>;
}>;

export type BedrockConverseOptions = Readonly<{
  /** Defaults to the global `fetch`. */
  fetch?: ConverseFetch;
  /** Reads the API key at call time. Defaults to the key in `environment`. */
  getToken?: () => string | undefined;
  now?: () => number;
  /** Settings checked by the readiness gate. Defaults to `process.env`. */
  environment?: AwsEnvironment;
  /** Can only shorten the 30 second timeout. */
  timeoutMs?: number;
}>;

type ValidInput = Readonly<{ modelId: string; system: string; text: string }>;

type BedrockConverseFailure = Extract<BedrockConverseResult, { ok: false }>;

function fail(error: BedrockConverseError): BedrockConverseFailure {
  return { ok: false, error: Object.freeze(error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateInput(
  request: ConverseRequest,
): BedrockConverseFailure | ValidInput {
  const { modelId, system, text } = request as Partial<
    Record<keyof ConverseRequest, unknown>
  >;

  if (
    typeof modelId !== "string" ||
    typeof system !== "string" ||
    typeof text !== "string" ||
    system.trim() === "" ||
    text.trim() === ""
  ) {
    return fail({ code: "INPUT_INVALID" });
  }

  if (system.length + text.length > MAX_CONVERSE_INPUT_CHARS) {
    return fail({ code: "INPUT_TOO_LONG" });
  }

  if (!ALLOWED_BEDROCK_MODEL_IDS.includes(modelId)) {
    return fail({ code: "MODEL_NOT_ALLOWED" });
  }

  return { modelId, system, text };
}

function isFailure(
  value: BedrockConverseFailure | ValidInput,
): value is BedrockConverseFailure {
  return "ok" in value;
}

function normalizeToken(raw: string | undefined): string | undefined {
  const token = typeof raw === "string" ? raw.trim() : "";

  return token.length > 0 &&
    token.length <= MAX_TOKEN_LENGTH &&
    VISIBLE_ASCII_TOKEN.test(token)
    ? token
    : undefined;
}

function extractFirstText(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const output = payload["output"];
  const message = isRecord(output) ? output["message"] : undefined;
  const content = isRecord(message) ? message["content"] : undefined;

  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content as readonly unknown[]) {
    const text = isRecord(block) ? block["text"] : undefined;

    if (typeof text === "string" && text !== "") {
      return text;
    }
  }

  return undefined;
}

async function discardBody(response: ConverseHttpResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is never read; failing to release it changes nothing else.
  }
}

function clampTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? Math.min(timeoutMs, CONVERSE_TIMEOUT_MS)
    : CONVERSE_TIMEOUT_MS;
}

export function createBedrockConverseClient(
  options: BedrockConverseOptions = {},
): BedrockConverseClient {
  const environment = options.environment ?? process.env;
  const fetchImplementation: ConverseFetch =
    options.fetch ?? ((url, init) => fetch(url, init));
  const getToken =
    options.getToken ?? (() => environment[BEDROCK_BEARER_TOKEN_ENV_NAME]);
  const now = options.now ?? Date.now;
  const timeoutMs = clampTimeout(options.timeoutMs);

  let inFlight = false;
  let admittedAt: number[] = [];

  /**
   * Runs only for a ready configuration and valid input. Everything up to the
   * `fetch` call is synchronous, so a concurrent caller sees `inFlight` at once.
   */
  async function send(
    config: ReadyAwsConfig,
    input: ValidInput,
  ): Promise<BedrockConverseResult> {
    const token = normalizeToken(getToken());
    if (token === undefined) {
      return fail({ code: "TOKEN_INVALID" });
    }

    if (inFlight) {
      return fail({ code: "BUSY" });
    }

    const startedAt = now();
    admittedAt = admittedAt.filter(
      (admitted) => startedAt - admitted < CONVERSE_RATE_WINDOW_MS,
    );
    if (admittedAt.length >= CONVERSE_MAX_CALLS_PER_WINDOW) {
      return fail({ code: "RATE_LIMITED" });
    }

    admittedAt.push(startedAt);
    inFlight = true;

    const signal = AbortSignal.timeout(timeoutMs);
    const url = `https://bedrock-runtime.${config.region}.amazonaws.com/model/${encodeURIComponent(
      input.modelId,
    )}/converse`;
    const body = JSON.stringify({
      system: [{ text: input.system }],
      messages: [{ role: "user", content: [{ text: input.text }] }],
      inferenceConfig: { maxTokens: CONVERSE_MAX_TOKENS },
    });

    try {
      let response: ConverseHttpResponse;
      try {
        response = await fetchImplementation(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body,
          signal,
          redirect: "error",
        });
      } catch {
        return fail({ code: signal.aborted ? "TIMEOUT" : "NETWORK_ERROR" });
      }

      if (!response.ok) {
        await discardBody(response);
        return fail({
          code: "HTTP_ERROR",
          status: Number.isInteger(response.status) ? response.status : 0,
        });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return fail({ code: signal.aborted ? "TIMEOUT" : "RESPONSE_INVALID" });
      }

      const text = extractFirstText(payload);
      if (text === undefined) {
        return fail({ code: "RESPONSE_INVALID" });
      }

      return {
        ok: true,
        value: Object.freeze({
          text,
          status: response.status,
          elapsedMs: now() - startedAt,
        }),
      };
    } finally {
      inFlight = false;
    }
  }

  async function converse(
    request: ConverseRequest,
  ): Promise<BedrockConverseResult> {
    const input = validateInput(request);
    if (isFailure(input)) {
      return input;
    }

    const gated = withReadyAwsConfig(environment, (config) =>
      send(config, input),
    );
    if (!gated.ok) {
      return fail({ code: "CONFIG_NOT_READY", notReady: gated.error });
    }

    return gated.value;
  }

  return Object.freeze({ converse });
}
