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
  /** Only the name of the error is read from the headers (`x-amzn-errortype`); the body of a failure is never read. */
  headers?: Readonly<{ get: (name: string) => string | null }>;
}>;

/** The subset of `fetch` the client uses; the global `fetch` satisfies it. */
export type ConverseFetch = (
  url: string,
  init: ConverseRequestInit,
) => Promise<ConverseHttpResponse>;

export const CONVERSE_EFFORTS = ["low", "medium", "high"] as const;
export type ConverseEffort = (typeof CONVERSE_EFFORTS)[number];

/**
 * How much the model thinks before it answers. The Claude 5 models think by default (adaptive thinking), and the thinking
 * tokens are output tokens: they count against `CONVERSE_MAX_TOKENS` and against the cost, and the text of the thinking is never
 * read by this client (it takes the first block of plain text and nothing else).
 *
 *  - `DISABLED`: no thinking. Claude Haiku 5.5 accepts it; Claude Opus 5.5 does not (the service answers 400), so the client
 *    refuses it for any model that is not in `THINKING_DISABLED_MODEL_IDS` before anything is sent.
 *  - `ADAPTIVE`: the model decides whether and how much to think, and thinks less at a lower `effort`. `xhigh` and `max` are not
 *    offered: they only raise the cost, and they are refused by the service together with `DISABLED`.
 */
export type ConverseThinking =
  | Readonly<{ mode: "DISABLED" }>
  | Readonly<{ mode: "ADAPTIVE"; effort: ConverseEffort }>;

/** The models that take `thinking: disabled` (Claude Opus 5.5 cannot turn thinking off; it can only think less). */
export const THINKING_DISABLED_MODEL_IDS: readonly string[] = Object.freeze(["jp.anthropic.claude-haiku-5-5"]);

/** A short fixed label of the thinking setting, for a plan and a record (`DEFAULT` is the request without the option). */
export function thinkingLabelOf(thinking: ConverseThinking | undefined): string {
  if (thinking === undefined) {
    return "DEFAULT";
  }
  if (thinking.mode === "DISABLED") {
    return "DISABLED";
  }
  // A setting that the types would not let through is named as such, never echoed.
  return CONVERSE_EFFORTS.includes(thinking.effort) ? `ADAPTIVE_${thinking.effort.toUpperCase()}` : "INVALID";
}

export type ConverseRequest = Readonly<{
  modelId: string;
  system: string;
  text: string;
  /**
   * Without it the request is the one that was always sent, and the service uses its own default (adaptive thinking at the
   * default effort of the model). `maxTokens` is the same with or without it: `CONVERSE_MAX_TOKENS`.
   */
  thinking?: ConverseThinking;
}>;

/** Token counts that the service reports for one call (whole numbers only; they carry no content). */
export type ConverseUsage = Readonly<{ inputTokens: number; outputTokens: number }>;

export type BedrockConverseSuccess = Readonly<{
  /** First non-empty `output.message.content[].text`. */
  text: string;
  status: number;
  elapsedMs: number;
  /** Absent when the response has no token counts that are whole numbers. */
  usage?: ConverseUsage;
  /** Why the model stopped (`end_turn`, `max_tokens`, ...): a short lower-case word, or absent. */
  stopReason?: string;
}>;

export type BedrockConverseError =
  | Readonly<{ code: "CONFIG_NOT_READY"; notReady: AwsConfigNotReady }>
  /**
   * `errorType` is the name that the service gives to the error (`AccessDeniedException`, `ThrottlingException`, ...):
   * a plain identifier of at most 64 characters, so that it cannot carry a message, the request or the key.
   */
  | Readonly<{ code: "HTTP_ERROR"; status: number; errorType?: string }>
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

type ValidInput = Readonly<{ modelId: string; system: string; text: string; thinking?: ConverseThinking }>;

type BedrockConverseFailure = Extract<BedrockConverseResult, { ok: false }>;

function fail(error: BedrockConverseError): BedrockConverseFailure {
  return { ok: false, error: Object.freeze(error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A copy of the thinking setting that the client knows, `undefined` when there is none, `null` when it is not usable: another
 * shape, a name of a mode or of an effort that is not listed, a key that is not listed, or `DISABLED` for a model that cannot
 * turn thinking off.
 */
function validateThinking(raw: unknown, modelId: string): ConverseThinking | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw) || Array.isArray(raw)) {
    return null;
  }

  const keyCount = Object.keys(raw).length;
  if (raw["mode"] === "DISABLED") {
    return keyCount === 1 && THINKING_DISABLED_MODEL_IDS.includes(modelId)
      ? { mode: "DISABLED" }
      : null;
  }
  if (raw["mode"] === "ADAPTIVE") {
    const effort = CONVERSE_EFFORTS.find((value) => value === raw["effort"]);
    return keyCount === 2 && effort !== undefined
      ? { mode: "ADAPTIVE", effort }
      : null;
  }

  return null;
}

function validateInput(
  request: ConverseRequest,
): BedrockConverseFailure | ValidInput {
  const { modelId, system, text, thinking } = request as Partial<
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

  const checkedThinking = validateThinking(thinking, modelId);
  if (checkedThinking === null) {
    return fail({ code: "INPUT_INVALID" });
  }

  return {
    modelId,
    system,
    text,
    ...(checkedThinking === undefined ? {} : { thinking: checkedThinking }),
  };
}

/**
 * The fields that the model takes and the Converse API does not know (`additionalModelRequestFields`). The effort is in
 * `output_config`, not in `thinking`: the service answers 400 for an effort inside `thinking`.
 */
function additionalFieldsOf(
  thinking: ConverseThinking | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (thinking === undefined) {
    return undefined;
  }

  return thinking.mode === "DISABLED"
    ? { thinking: { type: "disabled" } }
    : {
        thinking: { type: "adaptive" },
        output_config: { effort: thinking.effort },
      };
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

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Only the two counts that the cost is made of, and only when both are whole numbers. */
function extractUsage(payload: unknown): ConverseUsage | undefined {
  const usage = isRecord(payload) ? payload["usage"] : undefined;
  if (!isRecord(usage)) {
    return undefined;
  }

  const inputTokens = wholeNumber(usage["inputTokens"]);
  const outputTokens = wholeNumber(usage["outputTokens"]);

  return inputTokens === undefined || outputTokens === undefined
    ? undefined
    : { inputTokens, outputTokens };
}

const ERROR_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;

/**
 * The name of the error from the header `x-amzn-errortype` (the service writes `AccessDeniedException:http://...`; only the
 * part before the colon is taken). Anything that is not a plain identifier is dropped, never echoed.
 */
function extractErrorType(response: ConverseHttpResponse): string | undefined {
  let raw: string | null | undefined;
  try {
    raw = response.headers?.get("x-amzn-errortype");
  } catch {
    return undefined;
  }

  const name = typeof raw === "string" ? raw.split(":", 1)[0]?.trim() : undefined;

  return name !== undefined && ERROR_TYPE_PATTERN.test(name) ? name : undefined;
}

const STOP_REASON_PATTERN = /^[a-z][a-z_]{0,31}$/u;

/** A stop reason is a short word of the service; anything else is dropped, never echoed. */
function extractStopReason(payload: unknown): string | undefined {
  const reason = isRecord(payload) ? payload["stopReason"] : undefined;

  return typeof reason === "string" && STOP_REASON_PATTERN.test(reason)
    ? reason
    : undefined;
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
    const additionalModelRequestFields = additionalFieldsOf(input.thinking);
    const body = JSON.stringify({
      system: [{ text: input.system }],
      messages: [{ role: "user", content: [{ text: input.text }] }],
      inferenceConfig: { maxTokens: CONVERSE_MAX_TOKENS },
      ...(additionalModelRequestFields === undefined
        ? {}
        : { additionalModelRequestFields }),
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
        const errorType = extractErrorType(response);
        await discardBody(response);
        return fail({
          code: "HTTP_ERROR",
          status: Number.isInteger(response.status) ? response.status : 0,
          ...(errorType === undefined ? {} : { errorType }),
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

      const usage = extractUsage(payload);
      const stopReason = extractStopReason(payload);

      return {
        ok: true,
        value: Object.freeze({
          text,
          status: response.status,
          elapsedMs: now() - startedAt,
          ...(usage === undefined ? {} : { usage }),
          ...(stopReason === undefined ? {} : { stopReason }),
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
