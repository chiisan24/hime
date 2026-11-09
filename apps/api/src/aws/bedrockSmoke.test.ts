import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  SMOKE_INPUT_TEXT,
  SMOKE_REPLY_PREVIEW_CHARS,
  runBedrockSmoke,
} from "./bedrockSmoke.js";

const TOKEN = "test-token";
const MODEL = "jp.anthropic.claude-haiku-5-5";

const READY_ENVIRONMENT = Object.freeze({
  RUN_BEDROCK_SMOKE: "1",
  AWS_BEARER_TOKEN_BEDROCK: TOKEN,
  BEDROCK_GENERATION_MODEL_ID: MODEL,
  BEDROCK_VERIFICATION_MODEL_ID: MODEL,
});

function replyResponse(text: string): Response {
  return new Response(
    JSON.stringify({ output: { message: { role: "assistant", content: [{ text }] } } }),
    { status: 200 },
  );
}

function createOutput() {
  const lines: string[] = [];

  return { lines, write: (line: string) => lines.push(line) };
}

describe("smoke command run", () => {
  it("refuses to send anything unless RUN_BEDROCK_SMOKE=1", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(replyResponse("x")));
    vi.stubGlobal("fetch", fetchSpy);
    const output = createOutput();

    for (const flag of [undefined, "", "0", "true", "yes"]) {
      const code = await runBedrockSmoke({
        environment: { ...READY_ENVIRONMENT, RUN_BEDROCK_SMOKE: flag },
        write: output.write,
      });

      expect(code).toBe(1);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.lines.join("\n")).toContain("RUN_BEDROCK_SMOKE=1");
  });

  it("prints only the names of missing settings and sends nothing", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(replyResponse("x")));
    vi.stubGlobal("fetch", fetchSpy);
    const output = createOutput();

    const code = await runBedrockSmoke({
      environment: {
        RUN_BEDROCK_SMOKE: "1",
        AWS_REGION: "us-east-1",
        BEDROCK_VERIFICATION_MODEL_ID: "global.anthropic.claude-haiku-5-5",
      },
      write: output.write,
    });

    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.lines).toEqual([
      "NOT_READY: the Bedrock settings are incomplete. No request was sent.",
      "missing: AWS_BEARER_TOKEN_BEDROCK",
      "missing: BEDROCK_GENERATION_MODEL_ID",
      "rejected: AWS_REGION (REGION_NOT_APPROVED)",
      "rejected: BEDROCK_VERIFICATION_MODEL_ID (MODEL_ID_INFERENCE_PROFILE)",
    ]);
    expect(output.lines.join("\n")).not.toContain("us-east-1");
    expect(output.lines.join("\n")).not.toContain("global.anthropic");
  });

  it("sends one greeting through the global fetch and prints a short summary", async () => {
    const reply = `${"長".repeat(SMOKE_REPLY_PREVIEW_CHARS + 50)}\n続き`;
    const fetchSpy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      () => Promise.resolve(replyResponse(reply)),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const output = createOutput();
    let clock = 10_000;

    const code = await runBedrockSmoke({
      environment: READY_ENVIRONMENT,
      write: output.write,
      now: () => (clock += 25),
    });

    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/jp.anthropic.claude-haiku-5-5/converse",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [{ role: "user", content: [{ text: SMOKE_INPUT_TEXT }] }],
      inferenceConfig: { maxTokens: 2000 },
    });
    expect(SMOKE_INPUT_TEXT).toBe("こんにちは");
    expect(output.lines).toHaveLength(2);
    expect(output.lines[0]).toMatch(
      /^ok=true status=200 model=jp\.anthropic\.claude-haiku-5-5 elapsedMs=\d+$/u,
    );
    expect(output.lines[1]).toBe(`reply: ${"長".repeat(SMOKE_REPLY_PREVIEW_CHARS)}`);
    expect(output.lines.join("\n")).not.toContain(TOKEN);
  });

  it("exits non-zero and prints only the status and model on an HTTP failure", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(`denied for Bearer ${TOKEN} こんにちは`, { status: 403 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const output = createOutput();

    const code = await runBedrockSmoke({
      environment: READY_ENVIRONMENT,
      write: output.write,
    });

    expect(code).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output.lines).toHaveLength(1);
    expect(output.lines[0]).toMatch(
      /^ok=false code=HTTP_ERROR status=403 model=jp\.anthropic\.claude-haiku-5-5 elapsedMs=\d+$/u,
    );
    expect(output.lines.join("\n")).not.toContain(TOKEN);
    expect(output.lines.join("\n")).not.toContain("denied");
  });
});

describe("smoke command wiring", () => {
  it("loads the repo-root .env.local through Node and is reachable from the root", async () => {
    const apiManifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const rootManifest = JSON.parse(
      await readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(apiManifest.scripts?.["bedrock:smoke"]).toBe(
      "tsc -p tsconfig.json && node --env-file-if-exists=../../.env.local dist/aws/smoke.js",
    );
    expect(rootManifest.scripts?.["bedrock:smoke"]).toBe(
      "npm run bedrock:smoke --workspace @ehime-vote-navigator/api",
    );
  });
});
