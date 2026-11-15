import {
  CONVERSE_MAX_TOKENS,
  type BedrockConverseClient,
  type BedrockConverseResult,
  type ConverseRequest,
  type ConverseUsage,
} from "./bedrockConverse.js";

/**
 * Limits that one run holds for itself, on top of the limits of the Converse client (20,000 input
 * characters, 2,000 output tokens, 30 seconds, ten calls in a minute, one call at a time).
 *
 * The client cannot tell how many calls a whole run makes or what they may cost. This wrapper
 * counts them and stops at a ceiling that a person set before the run:
 *
 *  - `maxCalls`: the calls that may reach the service;
 *  - `maxCostMicroUsd`: the sum of the worst-case cost of the calls that were let through (a call
 *    is let through only if the sum stays at or below the ceiling);
 *  - `stopAfterFailure`: after one call fails, nothing more is let through (no retry, no next try).
 *
 * A call that is not let through never reaches the client, so nothing is sent. It answers
 * `RATE_LIMITED`, the code that the draft process already takes for "too many calls" (Req 8.16);
 * the reason is kept in `refusals()`. The wrapper keeps counts, codes and sizes of each call, and
 * never the request or the text of the answer.
 */

/** A price in US dollars for one million tokens. */
export type ModelPrice = Readonly<{ input: number; output: number }>;

/** When the table below was written down. The prices change: it is a ceiling for a cap, not a bill. */
export const PRICE_TABLE_AS_OF = "2026-11";

/**
 * Standard tier, Japan geographic inference profile (`jp.`): the price of the global profile plus the
 * ten percent that a regional profile costs. Anthropic models are billed through AWS Marketplace, so the
 * charge shows under the provider in Cost Explorer. A prompt of more than 100,000 tokens is billed at
 * a higher rate, which the limit of 20,000 input characters keeps out of reach.
 */
export const MODEL_PRICE_USD_PER_MILLION_TOKENS: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "jp.anthropic.claude-haiku-5-5": Object.freeze({ input: 0.11, output: 0.55 }),
  "jp.anthropic.claude-opus-5-5": Object.freeze({ input: 4.4, output: 22 }),
});

/**
 * Tokens that one UTF-16 code unit of the input may come to at most. Japanese text is well under this
 * (a character is about one token or a little more), so the bound makes the worst case a ceiling and
 * not an estimate.
 */
export const INPUT_TOKENS_PER_CODE_UNIT_CEILING = 2;

/** One US dollar in the unit of this file: whole millionths, so that sums of costs have no rounding noise. */
export const MICRO_USD_PER_USD = 1_000_000;

/** The price of a model, or `undefined` for any other name (a name such as `constructor` is not a model). */
export function priceOf(modelId: string): ModelPrice | undefined {
  return Object.hasOwn(MODEL_PRICE_USD_PER_MILLION_TOKENS, modelId) ? MODEL_PRICE_USD_PER_MILLION_TOKENS[modelId] : undefined;
}

/**
 * Millionths of a dollar for the tokens, rounded up. A token count times a price per million tokens is already
 * in millionths. The noise of floating point numbers (`220.00000000000003`) is rounded away before the ceiling,
 * so that a price of two decimals does not cost one millionth more than it says.
 */
export function microUsdOf(price: ModelPrice, usage: ConverseUsage): number {
  const raw = usage.inputTokens * price.input + usage.outputTokens * price.output;
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

/** The most that a call can cost: the largest input that the characters can make, and the full output. `undefined` for a model without a price. */
export function worstCaseMicroUsd(modelId: string, inputChars: number): number | undefined {
  const price = priceOf(modelId);
  if (price === undefined) {
    return undefined;
  }
  return microUsdOf(price, {
    inputTokens: Math.ceil(inputChars * INPUT_TOKENS_PER_CODE_UNIT_CEILING),
    outputTokens: CONVERSE_MAX_TOKENS,
  });
}

/** Dollars with six decimals, for output (`0.001234`). */
export function formatUsd(microUsd: number): string {
  return (microUsd / MICRO_USD_PER_USD).toFixed(6);
}

export type RunLimits = Readonly<{
  maxCalls: number;
  maxCostMicroUsd: number;
  stopAfterFailure: boolean;
}>;

export type RefusalReason = "CALL_LIMIT" | "COST_LIMIT" | "PRICE_UNKNOWN" | "STOPPED_AFTER_FAILURE";

/** The shape of the text that came back, never the text: what a failed JSON check needs to be understood. */
export type TextShape = Readonly<{
  codePoints: number;
  starts: "OBJECT" | "FENCE" | "OTHER";
  ends: "OBJECT" | "OTHER";
  hasFence: boolean;
}>;

export function describeTextShape(text: string): TextShape {
  const trimmed = text.trim();
  return {
    codePoints: Array.from(text).length,
    starts: trimmed.startsWith("{") ? "OBJECT" : trimmed.startsWith("```") ? "FENCE" : "OTHER",
    ends: trimmed.endsWith("}") ? "OBJECT" : "OTHER",
    hasFence: text.includes("```"),
  };
}

export type CallRecord = Readonly<{
  /** 1 for the first call that was let through. */
  index: number;
  modelId: string;
  /** `system.length + text.length`, as the client counts it. */
  inputChars: number;
  worstCaseMicroUsd: number;
  /** `OK`, or the code of the failure of the client. */
  outcome: string;
  httpStatus: number | null;
  /** The name that the service gave to the error (`AccessDeniedException`), when it is a plain identifier. */
  errorType: string | null;
  elapsedMs: number | null;
  usage: ConverseUsage | null;
  stopReason: string | null;
  /** From the token counts that the service gave; `null` when it gave none. */
  actualMicroUsd: number | null;
  /**
   * How far the output was from the limit: `CONVERSE_MAX_TOKENS` less the output tokens, never below zero. The thinking is in the
   * output tokens, so a small number says that the limit is close, and 0 with `stopReason` `max_tokens` says that the output was cut.
   * `null` when the service gave no token counts.
   */
  outputHeadroom: number | null;
  shape: TextShape | null;
}>;

export type LimitedConverseClient = Readonly<{
  client: BedrockConverseClient;
  /** The calls that were let through, in order. */
  records: () => readonly CallRecord[];
  /** The calls that were not let through, in order. */
  refusals: () => readonly RefusalReason[];
  /** What is left to be let through. */
  state: () => Readonly<{ admitted: number; committedMicroUsd: number; failed: boolean }>;
}>;

export function createLimitedConverseClient(inner: BedrockConverseClient, limits: RunLimits): LimitedConverseClient {
  const records: CallRecord[] = [];
  const refusals: RefusalReason[] = [];
  let admitted = 0;
  let committedMicroUsd = 0;
  let failed = false;

  const refuse = (reason: RefusalReason): BedrockConverseResult => {
    refusals.push(reason);
    return { ok: false, error: Object.freeze({ code: "RATE_LIMITED" as const }) };
  };

  async function converse(request: ConverseRequest): Promise<BedrockConverseResult> {
    // Everything up to the call is synchronous, so two callers at once cannot both take the last place.
    if (limits.stopAfterFailure && failed) {
      return refuse("STOPPED_AFTER_FAILURE");
    }
    if (admitted >= limits.maxCalls) {
      return refuse("CALL_LIMIT");
    }
    const inputChars = request.system.length + request.text.length;
    const worst = worstCaseMicroUsd(request.modelId, inputChars);
    if (worst === undefined) {
      return refuse("PRICE_UNKNOWN");
    }
    if (committedMicroUsd + worst > limits.maxCostMicroUsd) {
      return refuse("COST_LIMIT");
    }
    admitted += 1;
    committedMicroUsd += worst;
    const index = admitted;

    const result = await inner.converse(request);

    if (result.ok) {
      const price = priceOf(request.modelId);
      const { usage, stopReason } = result.value;
      records.push({
        index,
        modelId: request.modelId,
        inputChars,
        worstCaseMicroUsd: worst,
        outcome: "OK",
        httpStatus: result.value.status,
        errorType: null,
        elapsedMs: result.value.elapsedMs,
        usage: usage ?? null,
        stopReason: stopReason ?? null,
        actualMicroUsd: usage === undefined || price === undefined ? null : microUsdOf(price, usage),
        outputHeadroom: usage === undefined ? null : Math.max(0, CONVERSE_MAX_TOKENS - usage.outputTokens),
        shape: describeTextShape(result.value.text),
      });
    } else {
      failed = true;
      records.push({
        index,
        modelId: request.modelId,
        inputChars,
        worstCaseMicroUsd: worst,
        outcome: result.error.code,
        httpStatus: result.error.code === "HTTP_ERROR" ? result.error.status : null,
        errorType: result.error.code === "HTTP_ERROR" ? (result.error.errorType ?? null) : null,
        elapsedMs: null,
        usage: null,
        stopReason: null,
        actualMicroUsd: null,
        outputHeadroom: null,
        shape: null,
      });
    }
    return result;
  }

  return Object.freeze({
    client: Object.freeze({ converse }),
    records: () => [...records],
    refusals: () => [...refusals],
    state: () => ({ admitted, committedMicroUsd, failed }),
  });
}
