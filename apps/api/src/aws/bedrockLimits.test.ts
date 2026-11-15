import { describe, expect, it } from "vitest";

import {
  ALLOWED_BEDROCK_MODEL_IDS,
  CONVERSE_MAX_TOKENS,
  type BedrockConverseClient,
  type BedrockConverseError,
  type BedrockConverseResult,
  type ConverseRequest,
} from "./bedrockConverse.js";
import {
  INPUT_TOKENS_PER_CODE_UNIT_CEILING,
  MODEL_PRICE_USD_PER_MILLION_TOKENS,
  createLimitedConverseClient,
  describeTextShape,
  formatUsd,
  microUsdOf,
  priceOf,
  worstCaseMicroUsd,
  type RunLimits,
} from "./bedrockLimits.js";

const HAIKU = "jp.anthropic.claude-haiku-5-5";
const OPUS = "jp.anthropic.claude-opus-5-5";

/** Text that must never reach a record, whatever the record keeps. */
const REQUEST_SENTINEL = "SENTINEL-REQUEST-TEXT";
const RESPONSE_SENTINEL = "SENTINEL-RESPONSE-TEXT";

function request(over: Partial<ConverseRequest> = {}): ConverseRequest {
  return { modelId: HAIKU, system: "system", text: `${REQUEST_SENTINEL} 資料`, ...over };
}

type Script = (index: number) => BedrockConverseResult;

const OK_WITH_USAGE: Script = () => ({
  ok: true,
  value: { text: `{"a":"${RESPONSE_SENTINEL}"}`, status: 200, elapsedMs: 120, usage: { inputTokens: 1000, outputTokens: 500 }, stopReason: "end_turn" },
});

function createInner(script: Script = OK_WITH_USAGE): { client: BedrockConverseClient; calls: ConverseRequest[] } {
  const calls: ConverseRequest[] = [];
  return {
    calls,
    client: {
      converse: (given) => {
        calls.push(given);
        return Promise.resolve(script(calls.length));
      },
    },
  };
}

const failure = (error: BedrockConverseError): BedrockConverseResult => ({ ok: false, error });

const LIMITS: RunLimits = { maxCalls: 3, maxCostMicroUsd: 1_000_000, stopAfterFailure: true };

describe("the table of prices", () => {
  it("has a price for each allowed model and for no other name", () => {
    expect(Object.keys(MODEL_PRICE_USD_PER_MILLION_TOKENS).sort()).toEqual([...ALLOWED_BEDROCK_MODEL_IDS].sort());
    for (const modelId of ALLOWED_BEDROCK_MODEL_IDS) {
      const price = priceOf(modelId);
      expect(price?.input).toBeGreaterThan(0);
      expect(price?.output).toBeGreaterThan(0);
    }
  });

  it("does not take a name of an object for a model", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", ""]) {
      expect(priceOf(name)).toBeUndefined();
      expect(worstCaseMicroUsd(name, 100)).toBeUndefined();
    }
  });
});

describe("cost in millionths of a dollar", () => {
  it("counts tokens at the price per million tokens, without the noise of floating point numbers", () => {
    // 1000 input tokens at 0.11 and 500 output tokens at 0.55 dollars per million tokens: 110 + 275 millionths.
    expect(microUsdOf({ input: 0.11, output: 0.55 }, { inputTokens: 1000, outputTokens: 500 })).toBe(385);
    expect(microUsdOf({ input: 0.11, output: 0.55 }, { inputTokens: 2000, outputTokens: 2000 })).toBe(1320);
    expect(microUsdOf({ input: 4.4, output: 22 }, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(26_400_000);
  });

  it("rounds up, so that a fraction of a millionth is never dropped", () => {
    expect(microUsdOf({ input: 0.11, output: 0.55 }, { inputTokens: 1, outputTokens: 0 })).toBe(1);
    expect(microUsdOf({ input: 0.11, output: 0.55 }, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("makes the worst case from the largest input that the characters can be and the full output", () => {
    const price = MODEL_PRICE_USD_PER_MILLION_TOKENS[HAIKU];
    expect(price).toBeDefined();
    expect(worstCaseMicroUsd(HAIKU, 1000)).toBe(
      microUsdOf(price ?? { input: 0, output: 0 }, { inputTokens: 1000 * INPUT_TOKENS_PER_CODE_UNIT_CEILING, outputTokens: CONVERSE_MAX_TOKENS }),
    );
    // The larger model costs more for the same input.
    expect(worstCaseMicroUsd(OPUS, 1000)).toBeGreaterThan(worstCaseMicroUsd(HAIKU, 1000) ?? Number.POSITIVE_INFINITY);
    // More input never costs less.
    expect(worstCaseMicroUsd(HAIKU, 2000)).toBeGreaterThan(worstCaseMicroUsd(HAIKU, 1000) ?? Number.POSITIVE_INFINITY);
  });

  it("prints dollars with six decimals", () => {
    expect(formatUsd(0)).toBe("0.000000");
    expect(formatUsd(1320)).toBe("0.001320");
    expect(formatUsd(50_000)).toBe("0.050000");
  });
});

describe("the shape of a text", () => {
  it.each([
    ["an object as it stands", '{"a":1}', { starts: "OBJECT", ends: "OBJECT", hasFence: false }],
    ["an object in a fence", '```json\n{"a":1}\n```', { starts: "FENCE", ends: "OTHER", hasFence: true }],
    ["a sentence before the object", 'Here is the JSON: {"a":1}', { starts: "OTHER", ends: "OBJECT", hasFence: false }],
    ["an object with space around it", '  \n{"a":1}\n ', { starts: "OBJECT", ends: "OBJECT", hasFence: false }],
    ["an empty text", "", { starts: "OTHER", ends: "OTHER", hasFence: false }],
  ])("tells %s", (_label, text, shape) => {
    expect(describeTextShape(text)).toMatchObject(shape);
  });

  it("counts code points and keeps nothing of the text", () => {
    const shape = describeTextShape(`{"a":"${RESPONSE_SENTINEL}😀"}`);
    expect(shape.codePoints).toBe(Array.from(`{"a":"${RESPONSE_SENTINEL}😀"}`).length);
    expect(JSON.stringify(shape)).not.toContain(RESPONSE_SENTINEL);
  });
});

describe("a client with the limits of a run", () => {
  it("passes the answer through as it is and keeps the numbers of the call, never the text", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, LIMITS);

    const result = await limited.client.converse(request());

    expect(result).toEqual(OK_WITH_USAGE(1));
    expect(inner.calls).toHaveLength(1);
    const [record] = limited.records();
    expect(record).toMatchObject({
      index: 1,
      modelId: HAIKU,
      outcome: "OK",
      httpStatus: 200,
      elapsedMs: 120,
      usage: { inputTokens: 1000, outputTokens: 500 },
      stopReason: "end_turn",
      actualMicroUsd: 385,
      shape: { starts: "OBJECT", ends: "OBJECT", hasFence: false },
    });
    expect(record?.inputChars).toBe("system".length + `${REQUEST_SENTINEL} 資料`.length);
    expect(record?.worstCaseMicroUsd).toBe(worstCaseMicroUsd(HAIKU, record?.inputChars ?? 0));
    expect(JSON.stringify(limited.records())).not.toContain(REQUEST_SENTINEL);
    expect(JSON.stringify(limited.records())).not.toContain(RESPONSE_SENTINEL);
    expect(limited.refusals()).toEqual([]);
  });

  it("keeps no actual cost when the service gave no token counts", async () => {
    const limited = createLimitedConverseClient(
      createInner(() => ({ ok: true, value: { text: "{}", status: 200, elapsedMs: 5 } })).client,
      LIMITS,
    );

    await limited.client.converse(request());

    expect(limited.records()[0]).toMatchObject({ outcome: "OK", usage: null, stopReason: null, actualMicroUsd: null, outputHeadroom: null });
  });

  it.each([
    [0, CONVERSE_MAX_TOKENS],
    [500, CONVERSE_MAX_TOKENS - 500],
    [1969, 31],
    [CONVERSE_MAX_TOKENS, 0],
    // The limit is the limit of the client, so a count above it is not believed to leave room: it is zero, never negative.
    [CONVERSE_MAX_TOKENS + 50, 0],
  ])("records how far the output was from the limit: %i output tokens leave %i", async (outputTokens, headroom) => {
    const limited = createLimitedConverseClient(
      createInner(() => ({ ok: true, value: { text: "{}", status: 200, elapsedMs: 5, usage: { inputTokens: 100, outputTokens } } })).client,
      LIMITS,
    );

    await limited.client.converse(request());

    expect(limited.records()[0]?.outputHeadroom).toBe(headroom);
  });

  it("keeps no room under the limit for a call that failed", async () => {
    const limited = createLimitedConverseClient(createInner(() => failure({ code: "TIMEOUT" })).client, LIMITS);

    await limited.client.converse(request());

    expect(limited.records()[0]).toMatchObject({ outcome: "TIMEOUT", outputHeadroom: null });
  });

  it("passes the thinking setting of the request on to the client as it is, and does not change what a call costs at the most", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, LIMITS);

    await limited.client.converse(request({ thinking: { mode: "DISABLED" } }));
    await limited.client.converse(request());

    expect(inner.calls.map((call) => call.thinking)).toEqual([{ mode: "DISABLED" }, undefined]);
    // The worst case is the full output of the limit, with or without thinking: thinking tokens are output tokens.
    const [first, second] = limited.records();
    expect(first?.worstCaseMicroUsd).toBe(second?.worstCaseMicroUsd);
  });

  it("lets through no more calls than the limit and does not send the one that is over", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, { ...LIMITS, maxCalls: 2 });

    const first = await limited.client.converse(request());
    const second = await limited.client.converse(request());
    const third = await limited.client.converse(request());

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(third).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(inner.calls).toHaveLength(2);
    expect(limited.refusals()).toEqual(["CALL_LIMIT"]);
    expect(limited.state()).toMatchObject({ admitted: 2, failed: false });
  });

  it("holds the sum of the worst case at the ceiling: the call that reaches it goes, the one that passes it does not", async () => {
    const worst = worstCaseMicroUsd(HAIKU, request().system.length + request().text.length) ?? 0;
    const atCeiling = createInner();
    const exact = createLimitedConverseClient(atCeiling.client, { ...LIMITS, maxCostMicroUsd: worst * 2 });
    expect((await exact.client.converse(request())).ok).toBe(true);
    expect((await exact.client.converse(request())).ok).toBe(true);
    expect((await exact.client.converse(request())).ok).toBe(false);
    expect(atCeiling.calls).toHaveLength(2);
    expect(exact.refusals()).toEqual(["COST_LIMIT"]);
    expect(exact.state().committedMicroUsd).toBe(worst * 2);

    const over = createInner();
    const tight = createLimitedConverseClient(over.client, { ...LIMITS, maxCostMicroUsd: worst * 2 - 1 });
    expect((await tight.client.converse(request())).ok).toBe(true);
    expect((await tight.client.converse(request())).ok).toBe(false);
    expect(over.calls).toHaveLength(1);
    expect(tight.refusals()).toEqual(["COST_LIMIT"]);
  });

  it("sends nothing when the first call alone is over the ceiling", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, { ...LIMITS, maxCostMicroUsd: 1 });

    expect(await limited.client.converse(request())).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(inner.calls).toHaveLength(0);
    expect(limited.refusals()).toEqual(["COST_LIMIT"]);
  });

  it("does not send a model that has no price, whatever the name", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, LIMITS);

    for (const modelId of ["jp.anthropic.claude-sonnet-9", "constructor", ""]) {
      expect((await limited.client.converse(request({ modelId }))).ok).toBe(false);
    }
    expect(inner.calls).toHaveLength(0);
    expect(limited.refusals()).toEqual(["PRICE_UNKNOWN", "PRICE_UNKNOWN", "PRICE_UNKNOWN"]);
  });

  it("stops after the first failure, whatever it is, and does not try again", async () => {
    const failures: readonly BedrockConverseError[] = [
      { code: "HTTP_ERROR", status: 403 },
      { code: "TIMEOUT" },
      { code: "NETWORK_ERROR" },
      { code: "RESPONSE_INVALID" },
      { code: "TOKEN_INVALID" },
    ];
    for (const error of failures) {
      const inner = createInner(() => failure(error));
      const limited = createLimitedConverseClient(inner.client, LIMITS);

      expect(await limited.client.converse(request())).toEqual({ ok: false, error });
      expect(await limited.client.converse(request())).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });

      expect(inner.calls).toHaveLength(1);
      expect(limited.refusals()).toEqual(["STOPPED_AFTER_FAILURE"]);
      expect(limited.state()).toMatchObject({ admitted: 1, failed: true });
      expect(limited.records()[0]).toMatchObject({
        outcome: error.code,
        httpStatus: error.code === "HTTP_ERROR" ? error.status : null,
        usage: null,
        actualMicroUsd: null,
        shape: null,
      });
    }
  });

  it("goes on after a failure only when the run says so", async () => {
    const inner = createInner((index) => (index === 1 ? failure({ code: "TIMEOUT" }) : OK_WITH_USAGE(index)));
    const limited = createLimitedConverseClient(inner.client, { ...LIMITS, stopAfterFailure: false });

    expect((await limited.client.converse(request())).ok).toBe(false);
    expect((await limited.client.converse(request())).ok).toBe(true);
    expect(inner.calls).toHaveLength(2);
    expect(limited.refusals()).toEqual([]);
  });

  it("lets only one of two callers at once take the last place", async () => {
    const inner = createInner();
    const limited = createLimitedConverseClient(inner.client, { ...LIMITS, maxCalls: 1 });

    const results = await Promise.all([limited.client.converse(request()), limited.client.converse(request())]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(inner.calls).toHaveLength(1);
    expect(limited.refusals()).toEqual(["CALL_LIMIT"]);
  });

  it("counts a call that was let through even when it failed, and never counts a refused one", async () => {
    const inner = createInner(() => failure({ code: "HTTP_ERROR", status: 500 }));
    const limited = createLimitedConverseClient(inner.client, { ...LIMITS, stopAfterFailure: false, maxCalls: 2 });

    await limited.client.converse(request());
    await limited.client.converse(request());
    await limited.client.converse(request());

    expect(limited.records().map((record) => record.index)).toEqual([1, 2]);
    expect(limited.state().admitted).toBe(2);
    expect(limited.refusals()).toEqual(["CALL_LIMIT"]);
  });

  it("gives a copy of what it kept each time, so the kept list is not the one that a caller holds", async () => {
    const limited = createLimitedConverseClient(createInner().client, LIMITS);
    await limited.client.converse(request());

    const first = limited.records();
    await limited.client.converse(request());

    expect(first).toHaveLength(1);
    expect(limited.records()).toHaveLength(2);
    expect(limited.records()).not.toBe(limited.records());
    expect(limited.refusals()).not.toBe(limited.refusals());
  });
});
