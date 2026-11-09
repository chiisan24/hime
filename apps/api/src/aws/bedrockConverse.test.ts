import { describe, expect, it, vi } from "vitest";

import {
  ALLOWED_BEDROCK_MODEL_IDS,
  CONVERSE_MAX_CALLS_PER_WINDOW,
  CONVERSE_MAX_TOKENS,
  CONVERSE_RATE_WINDOW_MS,
  CONVERSE_TIMEOUT_MS,
  MAX_CONVERSE_INPUT_CHARS,
  createBedrockConverseClient,
  type BedrockConverseOptions,
  type ConverseFetch,
  type ConverseHttpResponse,
  type ConverseRequestInit,
} from "./bedrockConverse.js";

const TOKEN = "test-token";
const HAIKU = "jp.anthropic.claude-haiku-5-5";
const OPUS = "jp.anthropic.claude-opus-5-5";
const SYSTEM = "短く答えてください。";

const READY_ENVIRONMENT = Object.freeze({
  AWS_BEARER_TOKEN_BEDROCK: TOKEN,
  BEDROCK_GENERATION_MODEL_ID: HAIKU,
  BEDROCK_VERIFICATION_MODEL_ID: OPUS,
});

type FetchCall = Readonly<{ url: string; init: ConverseRequestInit }>;

function replyBody(text: string): string {
  return JSON.stringify({
    output: { message: { role: "assistant", content: [{ text }] } },
    stopReason: "end_turn",
  });
}

/** A fake `fetch` that records each call and answers with `respond`. */
function createFakeFetch(
  respond: (call: FetchCall) => Promise<ConverseHttpResponse> | ConverseHttpResponse = () =>
    new Response(replyBody("こんにちは。"), { status: 200 }),
) {
  const calls: FetchCall[] = [];
  const fakeFetch: ConverseFetch = (url, init) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  };

  return { calls, fakeFetch };
}

function createClient(
  fakeFetch: ConverseFetch,
  overrides: BedrockConverseOptions = {},
) {
  return createBedrockConverseClient({
    environment: READY_ENVIRONMENT,
    fetch: fakeFetch,
    getToken: () => TOKEN,
    now: () => 1_000_000,
    ...overrides,
  });
}

const request = { modelId: HAIKU, system: SYSTEM, text: "こんにちは" } as const;

describe("request shape", () => {
  it("posts the exact Converse request with the Bearer key", async () => {
    const { calls, fakeFetch } = createFakeFetch();

    const result = await createClient(fakeFetch).converse(request);

    expect(result).toEqual({
      ok: true,
      value: { text: "こんにちは。", status: 200, elapsedMs: 0 },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(
      "https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/jp.anthropic.claude-haiku-5-5/converse",
    );
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(call?.init.body ?? "null")).toEqual({
      system: [{ text: SYSTEM }],
      messages: [{ role: "user", content: [{ text: "こんにちは" }] }],
      inferenceConfig: { maxTokens: 2000 },
    });
    expect(CONVERSE_MAX_TOKENS).toBe(2000);
  });

  it("returns the first content element that has text", async () => {
    const { fakeFetch } = createFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            output: {
              message: { content: [{ toolUse: {} }, { text: "" }, { text: "二番目" }, { text: "三番目" }] },
            },
          }),
          { status: 200 },
        ),
    );

    const result = await createClient(fakeFetch).converse(request);

    expect(result.ok && result.value.text).toBe("二番目");
  });

  it.each([
    ["not JSON", "<html>"],
    ["no output", "{}"],
    ["no text element", JSON.stringify({ output: { message: { content: [{ image: {} }] } } })],
  ])("reports a response with %s without echoing it", async (_label, body) => {
    const { fakeFetch } = createFakeFetch(() => new Response(body, { status: 200 }));

    const result = await createClient(fakeFetch).converse(request);

    expect(result).toEqual({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });

  it("sets the 30 second timeout and can only shorten it", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await createClient(createFakeFetch().fakeFetch).converse(request);
    await createClient(createFakeFetch().fakeFetch, { timeoutMs: 60_000 }).converse(request);
    await createClient(createFakeFetch().fakeFetch, { timeoutMs: 5_000 }).converse(request);

    expect(CONVERSE_TIMEOUT_MS).toBe(30_000);
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30_000, 30_000, 5_000]);
  });
});

describe("input and model limits", () => {
  it("rejects over-length input before any fetch", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    const client = createClient(fakeFetch);

    const longText = await client.converse({
      ...request,
      text: "あ".repeat(MAX_CONVERSE_INPUT_CHARS + 1),
    });
    const longSystem = await client.converse({
      ...request,
      system: "い".repeat(MAX_CONVERSE_INPUT_CHARS),
    });

    expect(longText).toEqual({ ok: false, error: { code: "INPUT_TOO_LONG" } });
    expect(longSystem).toEqual({ ok: false, error: { code: "INPUT_TOO_LONG" } });
    expect(calls).toHaveLength(0);
  });

  it("accepts input of exactly 20000 characters in total", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    const text = "あ".repeat(MAX_CONVERSE_INPUT_CHARS - SYSTEM.length);

    const result = await createClient(fakeFetch).converse({ ...request, text });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it.each([
    { ...request, text: "" },
    { ...request, text: "  \n" },
    { ...request, system: " " },
    { ...request, text: 42 },
    { modelId: HAIKU },
  ])("rejects invalid input before any fetch (%j)", async (invalid) => {
    const { calls, fakeFetch } = createFakeFetch();

    const result = await createClient(fakeFetch).converse(
      invalid as unknown as typeof request,
    );

    expect(result).toEqual({ ok: false, error: { code: "INPUT_INVALID" } });
    expect(calls).toHaveLength(0);
  });

  it("allows only the two admin-issued jp. models", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    const client = createClient(fakeFetch);

    for (const modelId of [
      "global.anthropic.claude-haiku-5-5",
      "us.anthropic.claude-haiku-5-5",
      "anthropic.claude-haiku-5-5",
      "jp.anthropic.claude-haiku-5-5/../x",
    ]) {
      const result = await client.converse({ ...request, modelId });

      expect(result).toEqual({ ok: false, error: { code: "MODEL_NOT_ALLOWED" } });
    }
    expect(calls).toHaveLength(0);

    const opus = await client.converse({ ...request, modelId: OPUS });
    expect(opus.ok).toBe(true);
    expect(calls[0]?.url).toContain("/model/jp.anthropic.claude-opus-5-5/converse");
    expect([...ALLOWED_BEDROCK_MODEL_IDS]).toEqual([HAIKU, OPUS]);
  });
});

describe("readiness gate and key", () => {
  it("makes zero fetch calls when the configuration is not ready", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    const client = createClient(fakeFetch, {
      environment: {
        AWS_BEARER_TOKEN_BEDROCK: TOKEN,
        BEDROCK_VERIFICATION_MODEL_ID: OPUS,
        AWS_REGION: "us-east-1",
      },
    });

    const result = await client.converse(request);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFIG_NOT_READY",
        notReady: {
          missing: ["BEDROCK_GENERATION_MODEL_ID"],
          violations: [{ code: "REGION_NOT_APPROVED", name: "AWS_REGION" }],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(calls).toHaveLength(0);
  });

  it("names only the key setting when the key is absent from the environment", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    const client = createClient(fakeFetch, {
      environment: {
        BEDROCK_GENERATION_MODEL_ID: HAIKU,
        BEDROCK_VERIFICATION_MODEL_ID: OPUS,
      },
    });

    const result = await client.converse(request);

    expect(!result.ok && result.error).toEqual({
      code: "CONFIG_NOT_READY",
      notReady: { missing: ["AWS_BEARER_TOKEN_BEDROCK"], violations: [] },
    });
    expect(calls).toHaveLength(0);
  });

  it("reads the key at call time and rejects an unusable key before fetch", async () => {
    const { calls, fakeFetch } = createFakeFetch();
    let token: string | undefined = "first-token";
    const getToken = vi.fn(() => token);
    const client = createClient(fakeFetch, { getToken });

    await client.converse(request);
    token = "second-token";
    await client.converse(request);

    expect(calls.map((call) => call.init.headers["Authorization"])).toEqual([
      "Bearer first-token",
      "Bearer second-token",
    ]);

    for (const unusable of [undefined, "", "   ", "has space", "line\nbreak", "日本語", "x".repeat(5000)]) {
      token = unusable;
      const result = await client.converse(request);

      expect(result).toEqual({ ok: false, error: { code: "TOKEN_INVALID" } });
    }
    expect(calls).toHaveLength(2);
  });
});

describe("single attempt, concurrency, and rate cap", () => {
  it.each([
    ["an HTTP 500", () => new Response("upstream failure", { status: 500 })],
    ["an HTTP 429", () => new Response("slow down", { status: 429 })],
  ])("calls fetch exactly once after %s", async (_label, respond) => {
    const { calls, fakeFetch } = createFakeFetch(respond);

    const result = await createClient(fakeFetch).converse(request);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("calls fetch exactly once after a network failure", async () => {
    const calls: string[] = [];
    const failingFetch: ConverseFetch = (url) => {
      calls.push(url);
      return Promise.reject(new Error(`connect failed with Bearer ${TOKEN}`));
    };

    const result = await createClient(failingFetch).converse(request);

    expect(result).toEqual({ ok: false, error: { code: "NETWORK_ERROR" } });
    expect(calls).toHaveLength(1);
  });

  it("rejects a second concurrent call instead of queueing it", async () => {
    let release: (response: ConverseHttpResponse) => void = () => undefined;
    // Only the first call stays pending; later calls answer at once.
    let invocations = 0;
    const { calls, fakeFetch } = createFakeFetch(() =>
      (invocations += 1) === 1
        ? new Promise<ConverseHttpResponse>((resolve) => {
            release = resolve;
          })
        : new Response(replyBody("done"), { status: 200 }),
    );
    const client = createClient(fakeFetch);

    const first = client.converse(request);
    const second = await client.converse(request);

    expect(second).toEqual({ ok: false, error: { code: "BUSY" } });
    expect(calls).toHaveLength(1);

    release(new Response(replyBody("done"), { status: 200 }));
    expect((await first).ok).toBe(true);

    const third = await client.converse(request);
    expect(third.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("rejects the 11th call within a minute before fetch and recovers after the window", async () => {
    let clock = 5_000_000;
    const { calls, fakeFetch } = createFakeFetch();
    const client = createClient(fakeFetch, { now: () => clock });

    for (let index = 0; index < CONVERSE_MAX_CALLS_PER_WINDOW; index += 1) {
      clock += 1_000;
      expect((await client.converse(request)).ok).toBe(true);
    }
    clock += 1_000;
    const eleventh = await client.converse(request);

    expect(eleventh).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(calls).toHaveLength(CONVERSE_MAX_CALLS_PER_WINDOW);

    // The oldest admitted call leaves the rolling window after 60 seconds.
    clock += CONVERSE_RATE_WINDOW_MS - 10_000;
    expect((await client.converse(request)).ok).toBe(true);
    expect(calls).toHaveLength(CONVERSE_MAX_CALLS_PER_WINDOW + 1);
  });

  it("reports a timeout once, without retrying, and then accepts a new call", async () => {
    const calls: number[] = [];
    const hangingFetch: ConverseFetch = (_url, init) => {
      calls.push(1);
      return new Promise<ConverseHttpResponse>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(init.signal.reason as Error);
        });
      });
    };
    const client = createClient(hangingFetch, { timeoutMs: 20 });

    const result = await client.converse(request);

    expect(result).toEqual({ ok: false, error: { code: "TIMEOUT" } });
    expect(calls).toHaveLength(1);

    const next = await createClient(createFakeFetch().fakeFetch).converse(request);
    expect(next.ok).toBe(true);
  });
});

describe("secret-free failures", () => {
  it("returns only the status for a non-2xx response", async () => {
    const { calls, fakeFetch } = createFakeFetch(
      () =>
        new Response(`{"message":"denied for Bearer ${TOKEN}","detail":"echoed prompt こんにちは"}`, {
          status: 403,
        }),
    );

    const result = await createClient(fakeFetch).converse(request);

    expect(result).toEqual({ ok: false, error: { code: "HTTP_ERROR", status: 403 } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("echoed");
    expect(calls).toHaveLength(1);
  });

  it("never returns or prints the key, prompt, or reply across every outcome", async () => {
    const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const leakyBody = `Bearer ${TOKEN} こんにちは reply-text`;
    const outcomes: ConverseFetch[] = [
      () => Promise.resolve(new Response(leakyBody, { status: 400 })),
      () => Promise.resolve(new Response(leakyBody, { status: 200 })),
      () => Promise.reject(new TypeError(`bad header Bearer ${TOKEN}`)),
      () => {
        throw new Error(`sync failure Bearer ${TOKEN}`);
      },
    ];
    const serialized: string[] = [];

    for (const outcome of outcomes) {
      const result = await createClient(outcome).converse(request);
      expect(result.ok).toBe(false);
      serialized.push(JSON.stringify(result));
    }
    serialized.push(
      JSON.stringify(
        await createClient(createFakeFetch().fakeFetch, {
          getToken: () => "bad token",
        }).converse(request),
      ),
    );

    for (const text of serialized) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("reply-text");
      expect(text).not.toContain("こんにちは");
    }
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
