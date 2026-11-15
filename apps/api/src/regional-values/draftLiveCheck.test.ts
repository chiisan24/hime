import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createClock } from "../../../../tests/harness/regional-values/draftSupport.js";
import { ISSUE_SPECS } from "../../../../tests/harness/regional-values/fixtureIssueRecords.js";
import type { BedrockConverseClient, BedrockConverseResult, ConverseFetch, ConverseRequest } from "../aws/bedrockConverse.js";
import { CONVERSE_MAX_TOKENS, MAX_CONVERSE_INPUT_CHARS } from "../aws/bedrockConverse.js";
import { MODEL_PRICE_USD_PER_MILLION_TOKENS, formatUsd, microUsdOf } from "../aws/bedrockLimits.js";
import {
  AUTH_PROBE_TOKEN,
  DEFAULT_LIVE_CHECK_CONFIG_DIR,
  DEFAULT_LIVE_CHECK_SETTINGS,
  DEFAULT_MAX_COST_MICRO_USD,
  LIVE_CHECK_APPROVAL_ENV,
  accountHintOfKey,
  createLiveClient,
  parseDraftLines,
  parseFlags,
  runDraftLiveCheck,
} from "./draftLiveCheck.js";
import type { LiveClientKind } from "./draftLiveCheck.js";

/**
 * The tests of the check against the real Bedrock. Nothing here reaches a network (the clients are fakes, and the guard of the tests
 * would stop a `fetch`), and nothing is written in the repository: the drafts of a run go to a temporary folder.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FICTIONAL_DRAFTS = join(REPOSITORY_ROOT, "packages", "fixtures", "src", "regional-values", "drafts", "ISSUE_CANDIDATE");

const HAIKU = "jp.anthropic.claude-haiku-5-5";
const OPUS = "jp.anthropic.claude-opus-5-5";
const ACCOUNT = "123456789012";
const SECRET_PART = "SECRET-PART-OF-THE-KEY-0123456789";

/** The shape of a long-term key: base64 of three bytes and `<name of the IAM user>-at-<account>:<secret>`. */
function longTermKey(account = ACCOUNT, secret = SECRET_PART, user = "BedrockAPIKey-ab12"): string {
  return Buffer.concat([Buffer.from([0x00, 0x14, 0x8a]), Buffer.from(`${user}-at-${account}:${secret}`, "latin1")]).toString("base64");
}

const KEY = longTermKey();

function readyEnvironment(over: Record<string, string> = {}): Record<string, string> {
  return {
    AWS_BEARER_TOKEN_BEDROCK: KEY,
    AWS_REGION: "ap-northeast-1",
    BEDROCK_CROSS_REGION: "false",
    BEDROCK_GENERATION_MODEL_ID: HAIKU,
    BEDROCK_VERIFICATION_MODEL_ID: OPUS,
    ...over,
  };
}

const temporaryFolders: string[] = [];

afterEach(async () => {
  for (const folder of temporaryFolders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

async function outputRoot(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "rv-live-check-"));
  temporaryFolders.push(folder);
  return join(folder, "out");
}

// ---------------------------------------------------------------------------
// The fakes of the clients
// ---------------------------------------------------------------------------

type ScriptedClient = Readonly<{ client: BedrockConverseClient; calls: ConverseRequest[] }>;

function scripted(answer: (call: ConverseRequest, index: number) => BedrockConverseResult): ScriptedClient {
  const calls: ConverseRequest[] = [];
  return {
    calls,
    client: {
      converse: (request) => {
        calls.push(request);
        return Promise.resolve(answer(request, calls.length - 1));
      },
    },
  };
}

const USAGE = { inputTokens: 1500, outputTokens: 700 } as const;

function modelSays(text: string): BedrockConverseResult {
  return { ok: true, value: { text, status: 200, elapsedMs: 42, usage: USAGE, stopReason: "end_turn" } };
}

/** The candidate that passes the checks, for the facts of the request (the candidates of the fictional issues of the repository). */
function candidateFor(call: ConverseRequest, change: (candidate: Record<string, unknown>, index: number) => Record<string, unknown> = (candidate) => candidate): string {
  const index = ISSUE_SPECS.findIndex((spec) => call.text.includes(`factId: ${spec.factIds[0]}`));
  const spec = ISSUE_SPECS[index];
  if (spec === undefined) {
    throw new Error("The request was expected to hold the facts of one of the fictional issues");
  }
  return JSON.stringify(change(spec.candidate, index));
}

const REFUSED_BY_THE_KEY: BedrockConverseResult = { ok: false, error: { code: "HTTP_ERROR", status: 403, errorType: "AccessDeniedException" } };

type Clients = Readonly<{ main: ScriptedClient; probe: ScriptedClient; made: LiveClientKind[] }>;

function clientsOf(main: ScriptedClient, probe: ScriptedClient = scripted(() => REFUSED_BY_THE_KEY)): Clients {
  return { main, probe, made: [] };
}

// ---------------------------------------------------------------------------
// Running the check
// ---------------------------------------------------------------------------

type Outcome = Readonly<{ exitCode: number; lines: string[]; out: string }>;

type RunOptions = Readonly<{
  environment?: Record<string, string>;
  argv?: readonly string[];
  clients?: Clients;
  readTextFile?: (path: string) => Promise<string>;
}>;

async function run(options: RunOptions = {}): Promise<Outcome> {
  const out = await outputRoot();
  const lines: string[] = [];
  const clients = options.clients;
  const exitCode = await runDraftLiveCheck({
    environment: options.environment ?? readyEnvironment(),
    workspaceRoot: REPOSITORY_ROOT,
    argv: options.argv ?? [],
    write: (line) => lines.push(line),
    now: createClock("2026-11-20T00:00:00.000Z", 60_000),
    pacer: { wait: () => Promise.resolve() },
    outputRoot: out,
    ...(options.readTextFile === undefined ? {} : { readTextFile: options.readTextFile }),
    createClient: (kind) => {
      if (clients === undefined) {
        throw new Error("No client was expected to be made");
      }
      clients.made.push(kind);
      return kind === "MAIN" ? clients.main.client : clients.probe.client;
    },
  });
  return { exitCode, lines, out };
}

/** The digest of the plan that a person is shown. */
async function digestOf(environment: Record<string, string>, argv: readonly string[] = []): Promise<string> {
  const planned = await run({ environment, argv });
  const digest = /^plan version=2 digest=([0-9a-f]{64})$/u.exec(planned.lines[0] ?? "")?.[1];
  if (digest === undefined) {
    throw new Error("The plan was expected to start with its digest");
  }
  return digest;
}

async function approvedRun(options: Omit<RunOptions, "environment"> & { environment?: Record<string, string> }): Promise<Outcome> {
  const environment = options.environment ?? readyEnvironment();
  const digest = await digestOf(environment, options.argv ?? []);
  return run({ ...options, environment: { ...environment, [LIVE_CHECK_APPROVAL_ENV]: digest } });
}

function lineWith(outcome: Outcome, prefix: string): string {
  const found = outcome.lines.find((line) => line.startsWith(prefix));
  if (found === undefined) {
    throw new Error(`No line starts with ${prefix}`);
  }
  return found;
}

/** What a line must never hold: the key, the secret in it, a text of the prompt, a text of the answer. */
const FORBIDDEN_IN_OUTPUT = [KEY, SECRET_PART, ACCOUNT, "架空市あおば", "架空町みなと", "架空村ひなた", "地域の集まりへの参加の変化", "あなたは、地域の政策課題"];

function expectNoSecretOrText(outcome: Outcome): void {
  const whole = outcome.lines.join("\n");
  for (const forbidden of FORBIDDEN_IN_OUTPUT) {
    expect(whole).not.toContain(forbidden);
  }
}

// ---------------------------------------------------------------------------
// The plan, and no request without the approval of it
// ---------------------------------------------------------------------------

describe("the plan", () => {
  it("shows what would be sent, where, with what limits and at what cost, and sends nothing", async () => {
    const outcome = await run();

    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines[0]).toMatch(/^plan version=2 digest=[0-9a-f]{64}$/u);
    expect(outcome.lines).toContain(
      "plan aws region=ap-northeast-1 endpoint=bedrock-runtime.ap-northeast-1.amazonaws.com auth=BEDROCK_API_KEY keyAccount=********9012 crossRegion=false",
    );
    expect(outcome.lines).toContain(`plan models generation=${HAIKU} verification=${OPUS} used=generation`);
    expect(outcome.lines).toContain("plan data kind=FIXTURE source=packages/fixtures/src/regional-values/facts.json realData=none");
    expect(lineWith(outcome, "plan checks")).toContain(`status=TEST_ONLY_NOT_APPROVED configDir=${DEFAULT_LIVE_CHECK_CONFIG_DIR} settings=${DEFAULT_LIVE_CHECK_SETTINGS}`);
    expect(lineWith(outcome, "plan limits")).toBe(
      `plan limits maxCalls=4 maxWorstCaseUsd=${formatUsd(DEFAULT_MAX_COST_MICRO_USD)} timeoutMs=30000 maxOutputTokens=${String(CONVERSE_MAX_TOKENS)} ` +
        `maxInputChars=${String(MAX_CONVERSE_INPUT_CHARS)} minIntervalMs=6100 stopAfterFailure=true retries=0`,
    );
    expect(lineWith(outcome, "plan inference")).toBe("plan inference thinking=DEFAULT");
    expect(lineWith(outcome, "plan pricing")).toContain(`model=${HAIKU} inputUsdPerMillionTokens=0.11 outputUsdPerMillionTokens=0.55`);
    const steps = outcome.lines.filter((line) => line.startsWith("plan step "));
    expect(steps.map((line) => /id=(\S+) kind=(\S+)/u.exec(line)?.slice(1, 3).join(":"))).toEqual(["P0:AUTH_PROBE", "S1:ISSUE_CANDIDATE", "S2:ISSUE_CANDIDATE", "S3:ISSUE_CANDIDATE"]);
    for (const step of steps) {
      expect(step).toMatch(/inputChars=\d+ inputSha256=[0-9a-f]{64} worstCaseUsd=\d+\.\d{6}$/u);
    }
    expect(lineWith(outcome, "plan total")).toMatch(/^plan total calls=4 worstCaseUsd=0\.0\d{5}$/u);
    expect(outcome.lines.at(-1)).toBe(`code=LIVE_CHECK_NOT_APPROVED approve-with=${LIVE_CHECK_APPROVAL_ENV}=<digest> sent=none`);
    expectNoSecretOrText(outcome);
  });

  it("makes no client, writes nothing and does not make the folder of the run", async () => {
    const clients = clientsOf(scripted(() => modelSays("{}")));
    const outcome = await run({ clients });

    expect(outcome.exitCode).toBe(0);
    expect(clients.made).toEqual([]);
    expect(clients.main.calls).toHaveLength(0);
    expect(clients.probe.calls).toHaveLength(0);
    await expect(readdir(outcome.out)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is the same plan for the same settings and another plan for any change of what is sent, where, or with what limit", async () => {
    const base = await digestOf(readyEnvironment());

    expect(await digestOf(readyEnvironment())).toBe(base);
    // Another model, another key (and its account), another ceiling, no probe: each is another plan that needs its own approval.
    expect(await digestOf(readyEnvironment({ BEDROCK_GENERATION_MODEL_ID: OPUS }))).not.toBe(base);
    expect(await digestOf(readyEnvironment({ AWS_BEARER_TOKEN_BEDROCK: longTermKey("999999999999") }))).not.toBe(base);
    expect(await digestOf(readyEnvironment(), ["--max-cost-usd", "0.01"])).not.toBe(base);
    expect(await digestOf(readyEnvironment(), ["--no-auth-probe"])).not.toBe(base);
    // The approval itself is not a part of the plan.
    expect(await digestOf(readyEnvironment({ [LIVE_CHECK_APPROVAL_ENV]: "anything" }))).toBe(base);
  });

  it("states how the model is asked, and each way of asking is a plan of its own", async () => {
    const digests = [
      await digestOf(readyEnvironment()),
      await digestOf(readyEnvironment(), ["--thinking", "disabled"]),
      await digestOf(readyEnvironment(), ["--thinking", "low"]),
      await digestOf(readyEnvironment(), ["--thinking", "medium"]),
      await digestOf(readyEnvironment(), ["--thinking", "high"]),
    ];

    expect(new Set(digests).size).toBe(5);
    expect(lineWith(await run({ argv: ["--thinking", "disabled"] }), "plan inference")).toBe("plan inference thinking=DISABLED");
    expect(lineWith(await run({ argv: ["--thinking", "low"] }), "plan inference")).toBe("plan inference thinking=ADAPTIVE_LOW");
    // The limit of the output and the worst case of the cost are those of every plan: thinking less cannot cost more.
    const off = await run({ argv: ["--thinking", "disabled"] });
    expect(lineWith(off, "plan limits")).toContain(`maxOutputTokens=${String(CONVERSE_MAX_TOKENS)}`);
    expect(lineWith(off, "plan total")).toBe(lineWith(await run(), "plan total"));
  });

  it("is not made for thinking off on a model that cannot turn thinking off, and can for the same model with less thinking", async () => {
    const environment = readyEnvironment({ BEDROCK_GENERATION_MODEL_ID: OPUS });

    const off = await run({ environment, argv: ["--thinking", "disabled"] });
    const less = await run({ environment, argv: ["--thinking", "low"] });

    expect(off).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_THINKING_NOT_SUPPORTED"] });
    expect(lineWith(less, "plan inference")).toBe("plan inference thinking=ADAPTIVE_LOW");
    expect(less.lines).not.toContain("code=LIVE_CHECK_THINKING_NOT_SUPPORTED");
  });

  it("changes when the settings of the checks change, because they judge what the model wrote", async () => {
    const real = await readFile(join(REPOSITORY_ROOT, DEFAULT_LIVE_CHECK_SETTINGS), "utf8");
    const base = await digestOf(readyEnvironment());

    const planned = await run({
      readTextFile: (path) => (path.endsWith("draft-settings.json") ? Promise.resolve(real.replace("可能性があります", "可能性がございます")) : readFile(path, "utf8")),
    });

    expect(planned.lines[0]).not.toContain(base);
    expect(lineWith(planned, "plan checks")).toMatch(/settingsSha256=[0-9a-f]{64}/u);
  });

  it("states that the lists of the words of the checks are the test-only ones when the default settings are used, and not when they are given", async () => {
    const given = await run({ argv: ["--draft-settings", DEFAULT_LIVE_CHECK_SETTINGS, "--config-dir", `./${DEFAULT_LIVE_CHECK_CONFIG_DIR}`] });
    expect(lineWith(given, "plan checks")).toContain("status=GIVEN_BY_OPERATOR");
  });

  it("is not made when the settings of AWS are not ready, and names what is missing without a value", async () => {
    const outcome = await run({ environment: { AWS_BEARER_TOKEN_BEDROCK: "", AWS_REGION: "us-east-1", BEDROCK_CROSS_REGION: "true" } });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines).toEqual(
      expect.arrayContaining([
        "code=LIVE_CHECK_NOT_READY",
        "missing: AWS_BEARER_TOKEN_BEDROCK",
        "missing: BEDROCK_GENERATION_MODEL_ID",
        "missing: BEDROCK_VERIFICATION_MODEL_ID",
        "rejected: AWS_REGION (REGION_NOT_APPROVED)",
        "rejected: BEDROCK_CROSS_REGION (CROSS_REGION_NOT_DISABLED)",
      ]),
    );
    expect(outcome.lines.some((line) => line.startsWith("plan "))).toBe(false);
  });

  it("is not made for a model that has no price or is not allowed", async () => {
    const outcome = await run({ environment: readyEnvironment({ BEDROCK_GENERATION_MODEL_ID: "jp.anthropic.claude-sonnet-9" }) });

    expect(outcome).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_MODEL_NOT_ALLOWED"] });
  });

  it("is refused when the worst case of the plan is over the ceiling, even with its approval", async () => {
    const argv = ["--max-cost-usd", "0.000001"];
    const outcome = await approvedRun({ argv, clients: clientsOf(scripted(() => modelSays("{}"))) });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.at(-1)).toBe("code=LIVE_CHECK_PLAN_OVER_BUDGET");
  });

  it.each([
    ["a flag that is not listed", ["--force"]],
    ["a ceiling above one dollar", ["--max-cost-usd", "1.5"]],
    ["a ceiling that is not a number", ["--max-cost-usd", "cheap"]],
    ["a ceiling of zero", ["--max-cost-usd", "0"]],
    ["a flag without its value", ["--config-dir"]],
    ["a word that is not a flag", ["now"]],
    ["a thinking setting that is not listed", ["--thinking", "max"]],
    ["a thinking setting twice", ["--thinking", "low", "--thinking", "high"]],
  ])("refuses %s before anything is read", async (_label, argv) => {
    const clients = clientsOf(scripted(() => modelSays("{}")));
    const outcome = await run({ argv, clients });

    expect(outcome).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_ARGUMENT_INVALID"] });
    expect(clients.made).toEqual([]);
  });

  it("reads only the fictional registry: a fact that is not a fictional fact, a missing fact, a missing file and bad settings stop it", async () => {
    const realFact = {
      dataKind: "REAL_AI",
      factId: "real-1",
      sentence: "試験町の施設は12か所である。",
      value: { amount: 12, unit: "か所" },
      surveyDate: 2025,
      area: "試験町",
    };
    const facts = (text: string) => (path: string) => (path.endsWith("facts.json") ? Promise.resolve(text) : readFile(path, "utf8"));

    const real = await run({ readTextFile: facts(JSON.stringify([realFact])) });
    const empty = await run({ readTextFile: facts("[]") });
    const broken = await run({ readTextFile: facts("{") });
    const settings = await run({ readTextFile: (path) => (path.endsWith("draft-settings.json") ? Promise.resolve("{}") : readFile(path, "utf8")) });
    const missing = await run({
      readTextFile: (path) => (path.endsWith("facts.json") ? Promise.reject(new Error("no file")) : readFile(path, "utf8")),
    });

    expect(real).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_FIXTURE_UNREADABLE"] });
    expect(empty).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_FIXTURE_FACT_MISSING step=S1"] });
    expect(broken).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_FIXTURE_UNREADABLE"] });
    expect(missing).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_FIXTURE_UNREADABLE"] });
    expect(settings).toMatchObject({ exitCode: 1, lines: ["code=LIVE_CHECK_CONFIG_UNREADABLE"] });
  });
});

describe("the approval", () => {
  async function expectNothingSent(approval: (digest: string) => string): Promise<void> {
    const environment = readyEnvironment();
    const digest = await digestOf(environment);
    const clients = clientsOf(scripted(() => modelSays("{}")));

    const outcome = await run({ environment: { ...environment, [LIVE_CHECK_APPROVAL_ENV]: approval(digest) }, clients });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.at(-1)).toBe("code=LIVE_CHECK_APPROVAL_MISMATCH sent=none");
    expect(clients.made).toEqual([]);
    expect(clients.main.calls).toHaveLength(0);
    expect(clients.probe.calls).toHaveLength(0);
    await expect(readdir(outcome.out)).rejects.toMatchObject({ code: "ENOENT" });
  }

  it("does not send with the digest of another plan", async () => {
    await expectNothingSent(() => "0".repeat(64));
  });

  it("does not send with a text that is not a digest", async () => {
    await expectNothingSent(() => "yes");
  });

  it("does not send with the digest of this plan with one character changed", async () => {
    await expectNothingSent((digest) => `${digest.slice(0, 63)}${digest.endsWith("0") ? "1" : "0"}`);
  });

  it("does not send with the digest with a character added", async () => {
    await expectNothingSent((digest) => `${digest}0`);
  });

  it("treats a blank approval as none", async () => {
    const clients = clientsOf(scripted(() => modelSays("{}")));
    const outcome = await run({ environment: readyEnvironment({ [LIVE_CHECK_APPROVAL_ENV]: "   " }), clients });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines.at(-1)).toContain("code=LIVE_CHECK_NOT_APPROVED");
    expect(clients.made).toEqual([]);
  });

  it("does not take the approval of a plan with the probe for a plan without it", async () => {
    const withProbe = await digestOf(readyEnvironment());
    const clients = clientsOf(scripted(() => modelSays("{}")));

    const outcome = await run({ environment: readyEnvironment({ [LIVE_CHECK_APPROVAL_ENV]: withProbe }), argv: ["--no-auth-probe"], clients });

    expect(outcome.lines.at(-1)).toBe("code=LIVE_CHECK_APPROVAL_MISMATCH sent=none");
    expect(clients.made).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// An approved run
// ---------------------------------------------------------------------------

describe("a run that was approved", () => {
  it("sends the refusal probe and one request for each fictional theme, keeps each draft as PENDING and approves nothing", async () => {
    const fictionalBefore = await readdir(FICTIONAL_DRAFTS);
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    const outcome = await approvedRun({ clients });

    expect(outcome.exitCode).toBe(0);
    expect(clients.made).toEqual(["AUTH_PROBE", "MAIN"]);
    expect(lineWith(outcome, "run step=P0")).toBe("run step=P0 kind=AUTH_PROBE outcome=AUTH expected=true elapsedMs=- httpStatus=403 errorType=AccessDeniedException");
    for (const id of ["S1", "S2", "S3"]) {
      expect(lineWith(outcome, `run step=${id} `)).toMatch(
        new RegExp(
          `^run step=${id} outcome=DRAFT_OK draftId=[0-9a-f]{64} status=PENDING cached=false elapsedMs=42 inputTokens=1500 outputTokens=700 headroom=1300 stopReason=end_turn usd=0\\.000550 shape=OBJECT/OBJECT fence=false codePoints=\\d+$`,
          "u",
        ),
      );
    }
    expect(lineWith(outcome, "summary calls")).toMatch(/^summary calls=4 refusals=0 actualUsd=0\.001650 worstCaseUsd=0\.\d{6} ceilingUsd=0\.050000$/u);
    expect(lineWith(outcome, "summary tokens")).toBe("summary tokens input=4500 output=2100 maxOutputPerCall=700 minHeadroom=1300 limit=2000 thinking=DEFAULT");
    expect(lineWith(outcome, "summary drafts")).toBe("summary drafts saved=3 pending=3 adopted=0 rejected=0 approvals=0 humanApprovalRequired=true");
    expect(lineWith(outcome, "summary aiContribution")).toBe("summary aiContribution drafted=3 rejectedByChecks=0 humanEdited=0 humanRejected=0");
    expect(outcome.lines.at(-1)).toBe("code=LIVE_CHECK_DONE");
    expectNoSecretOrText(outcome);

    // The model got the model of the plan, a request of a size that the client allows, and the instruction of the draft process.
    expect(clients.main.calls).toHaveLength(3);
    for (const call of clients.main.calls) {
      expect(call.modelId).toBe(HAIKU);
      expect(call.system.length + call.text.length).toBeLessThanOrEqual(MAX_CONVERSE_INPUT_CHARS);
      expect(call.text.startsWith("<<<DATA>>>")).toBe(true);
    }
    expect(clients.probe.calls).toHaveLength(1);
    expect(clients.probe.calls[0]?.text).not.toContain("<<<DATA>>>");

    // The records are in the folder of the run and nowhere in the repository. Nobody has approved anything.
    const runFolders = await readdir(outcome.out);
    expect(runFolders).toHaveLength(1);
    const runFolder = join(outcome.out, runFolders[0] ?? "");
    expect(await readdir(join(runFolder, "drafts", "ISSUE_CANDIDATE"))).toHaveLength(3);
    expect(await readdir(join(runFolder, "events"))).toHaveLength(3);
    await expect(readdir(join(runFolder, "approvals"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(runFolder, "issues"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(FICTIONAL_DRAFTS)).toEqual(fictionalBefore);
  });

  it("keeps each draft as the draft of the model of the plan, marked as an AI draft, with no approval and no decision of a person", async () => {
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    const outcome = await approvedRun({ clients });

    const runFolder = join(outcome.out, (await readdir(outcome.out))[0] ?? "");
    const files = await readdir(join(runFolder, "drafts", "ISSUE_CANDIDATE"));
    for (const file of files) {
      const draft = JSON.parse(await readFile(join(runFolder, "drafts", "ISSUE_CANDIDATE", file), "utf8")) as Record<string, unknown>;
      expect(draft).toMatchObject({ dataKind: "FIXTURE", aiClass: "AI_DRAFT", modelId: HAIKU, key: { task: "ISSUE_CANDIDATE", modelId: HAIKU } });
      // A draft has no field of its fate: what became of it is told by the events and the ledger, which have no decision.
      expect(Object.keys(draft)).not.toEqual(expect.arrayContaining(["disposition", "approval", "approvedAt", "status"]));
    }
    for (const file of await readdir(join(runFolder, "events"))) {
      const event = JSON.parse(await readFile(join(runFolder, "events", file), "utf8")) as { kind: string };
      expect(event.kind).toBe("DRAFTED");
    }
  });

  it("measures the cost from the tokens that the service reports, and never above the worst case of the plan", async () => {
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    const outcome = await approvedRun({ clients });

    const price = MODEL_PRICE_USD_PER_MILLION_TOKENS[HAIKU];
    expect(price).toBeDefined();
    const perCall = microUsdOf(price ?? { input: 0, output: 0 }, USAGE);
    const summary = lineWith(outcome, "summary calls");
    expect(summary).toContain(`actualUsd=${formatUsd(perCall * 3)}`);
    const worst = Number(/worstCaseUsd=(\d+\.\d+)/u.exec(summary)?.[1]);
    const actual = Number(/actualUsd=(\d+\.\d+)/u.exec(summary)?.[1]);
    expect(actual).toBeLessThanOrEqual(worst);
  });

  it("sends exactly what the plan showed: for each request the same size and the same SHA-256 as the step of the plan", async () => {
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    const outcome = await approvedRun({ clients });

    const planned = outcome.lines.filter((line) => /^plan step id=S\d /u.test(line));
    expect(planned).toHaveLength(3);
    expect(clients.main.calls).toHaveLength(3);
    clients.main.calls.forEach((call, index) => {
      const step = planned[index] ?? "";
      expect(step).toContain(` inputChars=${String(call.system.length + call.text.length)} `);
      expect(step).toContain(` inputSha256=${sha256Hex(encodeCanonicalJson({ system: call.system, text: call.text }))} `);
    });
  });

  it("asks the model as the plan says: with no setting by default, and with the thinking that was approved otherwise", async () => {
    const byDefault = clientsOf(scripted((call) => modelSays(candidateFor(call))));
    const off = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    await approvedRun({ clients: byDefault });
    const outcome = await approvedRun({ clients: off, argv: ["--thinking", "disabled"] });

    expect(byDefault.main.calls).toHaveLength(3);
    for (const call of byDefault.main.calls) {
      expect(call).not.toHaveProperty("thinking");
    }
    expect(off.main.calls.map((call) => call.thinking)).toEqual([{ mode: "DISABLED" }, { mode: "DISABLED" }, { mode: "DISABLED" }]);
    // The probe of the refusal is the same request in every plan.
    expect(off.probe.calls[0]).not.toHaveProperty("thinking");
    expect(lineWith(outcome, "summary tokens")).toContain(" thinking=DISABLED");
    expect(outcome.exitCode).toBe(0);
  });

  it("says that an output was cut off when the model stopped at the limit, and how much room each call had", async () => {
    const cut = (call: ConverseRequest): BedrockConverseResult => ({
      ok: true,
      value: {
        text: candidateFor(call).slice(0, 400),
        status: 200,
        elapsedMs: 42,
        usage: { inputTokens: 1500, outputTokens: CONVERSE_MAX_TOKENS },
        stopReason: "max_tokens",
      },
    });
    const clients = clientsOf(scripted((call, index) => (index === 0 ? cut(call) : modelSays(candidateFor(call)))));

    const outcome = await approvedRun({ clients });

    expect(outcome.exitCode).toBe(0);
    expect(lineWith(outcome, "run step=S1 ")).toMatch(
      /^run step=S1 outcome=CHECK_FAILED violations=DR_JSON:output truncated=true elapsedMs=42 inputTokens=1500 outputTokens=2000 headroom=0 stopReason=max_tokens /u,
    );
    expect(lineWith(outcome, "run step=S2 ")).not.toContain("truncated");
    expect(lineWith(outcome, "summary tokens")).toBe("summary tokens input=4500 output=3400 maxOutputPerCall=2000 minHeadroom=0 limit=2000 thinking=DEFAULT");
    expectNoSecretOrText(outcome);
  });

  it("does not call an output cut off when the model ended its turn: a wrong output is a wrong output", async () => {
    const clients = clientsOf(scripted((call, index) => (index === 0 ? modelSays(candidateFor(call).slice(0, 400)) : modelSays(candidateFor(call)))));

    const outcome = await approvedRun({ clients });

    expect(lineWith(outcome, "run step=S1 ")).toMatch(/^run step=S1 outcome=CHECK_FAILED violations=DR_JSON:output elapsedMs=42 /u);
    expect(lineWith(outcome, "run step=S1 ")).not.toContain("truncated");
  });

  it("goes on after an output that the checks refuse, counts it, and does not save it", async () => {
    const clients = clientsOf(
      scripted((call, index) => {
        if (index === 0) {
          return modelSays(candidateFor(call, (candidate) => ({ ...candidate, statement: "架空市あおばの参加者の減少は、高齢化が原因かもしれません。" })));
        }
        if (index === 1) {
          return modelSays("```json\n" + candidateFor(call) + "\n```");
        }
        return modelSays(candidateFor(call));
      }),
    );

    const outcome = await approvedRun({ clients });

    expect(outcome.exitCode).toBe(0);
    expect(lineWith(outcome, "run step=S1 ")).toMatch(/^run step=S1 outcome=CHECK_FAILED violations=DR_CAUSAL_CLAIMS:statement /u);
    expect(lineWith(outcome, "run step=S2 ")).toMatch(/^run step=S2 outcome=CHECK_FAILED violations=DR_JSON:output .* shape=FENCE\/OTHER fence=true /u);
    expect(lineWith(outcome, "run step=S3 ")).toContain("outcome=DRAFT_OK");
    expect(lineWith(outcome, "summary drafts")).toBe("summary drafts saved=1 pending=1 adopted=0 rejected=0 approvals=0 humanApprovalRequired=true");
    expect(lineWith(outcome, "summary aiContribution")).toBe("summary aiContribution drafted=3 rejectedByChecks=2 humanEdited=0 humanRejected=0");
    expect(outcome.lines.at(-1)).toBe("code=LIVE_CHECK_DONE");
    expect(clients.main.calls).toHaveLength(3);
    expectNoSecretOrText(outcome);
  });

  it("refuses a number that is not in the facts and a sentence that is not a hypothesis, from the answer of the model", async () => {
    const clients = clientsOf(
      scripted((call, index) =>
        index === 0
          ? modelSays(
              candidateFor(call, (candidate) => ({
                ...candidate,
                factSummary: [{ text: "架空市あおばの参加者は、2024年度までに60人減りました。", groundFactIds: ["fixture-fact-population-2024-v1"] }],
              })),
            )
          : index === 1
            ? modelSays(candidateFor(call, (candidate) => ({ ...candidate, statement: "架空町みなとの避難場所は十分です。" })))
            : modelSays(candidateFor(call)),
      ),
    );

    const outcome = await approvedRun({ clients });

    expect(lineWith(outcome, "run step=S1 ")).toMatch(/^run step=S1 outcome=CHECK_FAILED violations=DR_[A-Z_]+:factSummary\[0\]/u);
    // Other checks may refuse the same sentence too; the one that a sentence that is not a hypothesis must meet is among them.
    expect(lineWith(outcome, "run step=S2 ")).toMatch(/^run step=S2 outcome=CHECK_FAILED violations=(?:[A-Z_]+:[^ ,]+,)*DR_HEDGE_REQUIRED:statement(?:,[A-Z_]+:[^ ,]+)* /u);
    expect(lineWith(outcome, "summary drafts")).toContain("saved=1 pending=1");
    expectNoSecretOrText(outcome);
  });

  it.each([
    ["the key is refused", { ok: false, error: { code: "HTTP_ERROR", status: 403, errorType: "AccessDeniedException" } } as BedrockConverseResult, "AUTH", " httpStatus=403 errorType=AccessDeniedException"],
    ["the service is busy", { ok: false, error: { code: "HTTP_ERROR", status: 429, errorType: "ThrottlingException" } } as BedrockConverseResult, "SERVICE_ERROR", " httpStatus=429 errorType=ThrottlingException"],
    ["the answer is late", { ok: false, error: { code: "TIMEOUT" } } as BedrockConverseResult, "TIMEOUT", ""],
    ["the network fails", { ok: false, error: { code: "NETWORK_ERROR" } } as BedrockConverseResult, "SERVICE_ERROR", ""],
    ["the answer cannot be read", { ok: false, error: { code: "RESPONSE_INVALID" } } as BedrockConverseResult, "SERVICE_ERROR", ""],
  ])("stops at the first failure when %s, does not try again and does not send the rest", async (_label, failure, reason, detail) => {
    const clients = clientsOf(scripted(() => failure));

    const outcome = await approvedRun({ clients });

    expect(outcome.exitCode).toBe(1);
    expect(clients.main.calls).toHaveLength(1);
    expect(lineWith(outcome, "run step=S1 ")).toBe(`run step=S1 outcome=STOPPED reason=${reason} elapsedMs=-${detail}`);
    expect(lineWith(outcome, "run step=S2 ")).toBe("run step=S2 outcome=SKIPPED");
    expect(lineWith(outcome, "run step=S3 ")).toBe("run step=S3 outcome=SKIPPED");
    expect(lineWith(outcome, "summary drafts")).toBe("summary drafts saved=0 pending=0 adopted=0 rejected=0 approvals=0 humanApprovalRequired=true");
    expect(outcome.lines.at(-1)).toBe(`code=LIVE_CHECK_STOPPED reason=${reason}`);
    expectNoSecretOrText(outcome);
  });

  it("sends nothing after the probe when the service does not answer it as a refusal of the key", async () => {
    const accepted = clientsOf(
      scripted(() => modelSays("{}")),
      scripted(() => modelSays("こんにちは")),
    );
    const failed = clientsOf(
      scripted(() => modelSays("{}")),
      scripted(() => ({ ok: false, error: { code: "HTTP_ERROR", status: 500 } })),
    );

    const first = await approvedRun({ clients: accepted });
    const second = await approvedRun({ clients: failed });

    expect(lineWith(first, "run step=P0")).toContain("outcome=ACCEPTED expected=false");
    expect(first.lines.at(-1)).toBe("code=LIVE_CHECK_STOPPED reason=AUTH_PROBE_ACCEPTED");
    expect(lineWith(second, "run step=P0")).toContain("outcome=SERVICE_ERROR expected=false");
    expect(second.lines.at(-1)).toBe("code=LIVE_CHECK_STOPPED reason=AUTH_PROBE_SERVICE_ERROR");
    for (const outcome of [first, second]) {
      expect(outcome.exitCode).toBe(1);
      expect(lineWith(outcome, "run step=S1 ")).toBe("run step=S1 outcome=SKIPPED");
    }
    // The client that holds the real key is not even made.
    expect(accepted.made).toEqual(["AUTH_PROBE"]);
    expect(failed.made).toEqual(["AUTH_PROBE"]);
    expect(accepted.main.calls).toHaveLength(0);
    expect(failed.main.calls).toHaveLength(0);
  });

  it("can leave the probe out: then no client for it is made and the plan has no step for it", async () => {
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));

    const outcome = await approvedRun({ clients, argv: ["--no-auth-probe"] });

    expect(outcome.exitCode).toBe(0);
    expect(clients.made).toEqual(["MAIN"]);
    expect(clients.probe.calls).toHaveLength(0);
    expect(outcome.lines.some((line) => line.startsWith("run step=P0"))).toBe(false);
    expect(lineWith(outcome, "plan limits")).toContain("maxCalls=3 ");
    expect(lineWith(outcome, "summary calls")).toContain("summary calls=3 ");
  });

  it("ends with a fixed code and sends nothing when the folder of the run cannot be made, and prints no error of its own", async () => {
    const root = await outputRoot();
    // The output root is a file, so the folder of the run cannot be made below it.
    await writeFile(root, "not a folder", "utf8");
    const clients = clientsOf(scripted((call) => modelSays(candidateFor(call))));
    const environment = readyEnvironment();
    const digest = await digestOf(environment);
    const lines: string[] = [];

    const exitCode = await runDraftLiveCheck({
      environment: { ...environment, [LIVE_CHECK_APPROVAL_ENV]: digest },
      workspaceRoot: REPOSITORY_ROOT,
      write: (line) => lines.push(line),
      now: createClock("2026-11-20T00:00:00.000Z", 60_000),
      pacer: { wait: () => Promise.resolve() },
      outputRoot: root,
      createClient: (kind) => (kind === "MAIN" ? clients.main.client : clients.probe.client),
    });

    expect(exitCode).toBe(1);
    expect(lines.at(-1)).toBe("code=LIVE_CHECK_FAILED");
    expect(clients.main.calls).toHaveLength(0);
    expect(clients.probe.calls).toHaveLength(0);
    expect(lines.join("\n")).not.toContain(root);
  });
});

// ---------------------------------------------------------------------------
// The real clients, with a fake of the network
// ---------------------------------------------------------------------------

type SentRequest = Readonly<{ url: string; authorization: string | undefined }>;

function recordingFetch(sent: SentRequest[]): ConverseFetch {
  return (url, init) => {
    sent.push({ url, authorization: init.headers["Authorization"] });
    return Promise.resolve(new Response("{}", { status: 403, headers: { "x-amzn-errortype": "AccessDeniedException" } }));
  };
}

describe("the real clients", () => {
  it("send the key of the environment for the main client and a fixed text that is not a key for the probe, never the key", async () => {
    const sent: SentRequest[] = [];
    const environment = readyEnvironment();
    const request = { modelId: HAIKU, system: "短く答えてください。", text: "こんにちは" };

    const main = await createLiveClient("MAIN", environment, recordingFetch(sent)).converse(request);
    const probe = await createLiveClient("AUTH_PROBE", environment, recordingFetch(sent)).converse(request);

    expect(main).toEqual({ ok: false, error: { code: "HTTP_ERROR", status: 403, errorType: "AccessDeniedException" } });
    expect(probe).toEqual({ ok: false, error: { code: "HTTP_ERROR", status: 403, errorType: "AccessDeniedException" } });
    expect(sent.map((item) => item.url)).toEqual(Array(2).fill("https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/jp.anthropic.claude-haiku-5-5/converse"));
    expect(sent[0]?.authorization).toBe(`Bearer ${KEY}`);
    expect(sent[1]?.authorization).toBe(`Bearer ${AUTH_PROBE_TOKEN}`);
    expect(JSON.stringify(sent[1])).not.toContain(SECRET_PART);
    expect(AUTH_PROBE_TOKEN).not.toBe(KEY);
  });
});

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

describe("the account of a key", () => {
  it("shows the last four digits of the account that a long-term key names, and nothing else of the key", () => {
    expect(accountHintOfKey(KEY)).toBe("********9012");
    expect(accountHintOfKey(`  ${KEY}\n`)).toBe("********9012");
    expect(accountHintOfKey(longTermKey("000000000001"))).toBe("********0001");
  });

  it("does not need the name of the IAM user to be the one that the console makes", () => {
    for (const user of ["my.bedrock_user+dev", "a", "team-bedrock@project"]) {
      expect(accountHintOfKey(longTermKey(ACCOUNT, SECRET_PART, user))).toBe("********9012");
    }
  });

  it.each([
    ["no key", undefined],
    ["an empty key", ""],
    ["a text that is not base64", "not a key at all !!!"],
    ["a short-term key (a signed URL)", "bedrock-api-key-" + Buffer.from("bedrock.amazonaws.com/?Action=CallWithBearerToken&X-Amz-Credential=AKIAEXAMPLE").toString("base64")],
    ["an account that is not 12 digits", longTermKey("12345")],
    ["an account of 13 digits", longTermKey("1234567890123")],
    ["a key without the separator", Buffer.from(`BedrockAPIKey-ab12-at-${ACCOUNT}`).toString("base64")],
  ])("does not tell an account for %s", (_label, token) => {
    expect(accountHintOfKey(token)).toBe("UNKNOWN");
  });
});

describe("the flags", () => {
  it("have the defaults of the test-only settings, the five cent ceiling and the probe", () => {
    expect(parseFlags([])).toEqual({
      configDir: DEFAULT_LIVE_CHECK_CONFIG_DIR,
      draftSettings: DEFAULT_LIVE_CHECK_SETTINGS,
      maxCostMicroUsd: DEFAULT_MAX_COST_MICRO_USD,
      authProbe: true,
    });
  });

  it("take the ceiling in dollars, up to one dollar, and the other settings as they are given", () => {
    expect(parseFlags(["--max-cost-usd", "0.01", "--no-auth-probe", "--config-dir", "a", "--draft-settings", "b.json"])).toEqual({
      configDir: "a",
      draftSettings: "b.json",
      maxCostMicroUsd: 10_000,
      authProbe: false,
    });
    expect(parseFlags(["--max-cost-usd", "1"])?.maxCostMicroUsd).toBe(1_000_000);
    expect(parseFlags(["--max-cost-usd", "0.000001"])?.maxCostMicroUsd).toBe(1);
  });

  it("take the thinking setting by its word, leave it out without the flag, and refuse any other word", () => {
    expect(parseFlags(["--thinking", "disabled"])?.thinking).toEqual({ mode: "DISABLED" });
    expect(parseFlags(["--thinking", "low"])?.thinking).toEqual({ mode: "ADAPTIVE", effort: "low" });
    expect(parseFlags(["--thinking", "medium"])?.thinking).toEqual({ mode: "ADAPTIVE", effort: "medium" });
    expect(parseFlags(["--thinking", "high"])?.thinking).toEqual({ mode: "ADAPTIVE", effort: "high" });
    expect(parseFlags([])).not.toHaveProperty("thinking");
    // Only the words of the list: not a level that only costs more, not another case, not a name of the object.
    for (const word of ["xhigh", "max", "off", "none", "DISABLED", "Low", "", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(parseFlags(["--thinking", word])).toBeNull();
    }
    expect(parseFlags(["--thinking", "low", "--thinking", "high"])).toBeNull();
  });

  it.each([["--max-cost-usd", "1.000001"], ["--max-cost-usd", "-1"], ["--max-cost-usd", "1e-2"], ["--max-cost-usd", ""], ["--no-auth-probe", "--no-auth-probe"], ["--max-cost-usd", "1", "--max-cost-usd", "2"]])(
    "refuse %s",
    (...argv) => {
      expect(parseFlags(argv)).toBeNull();
    },
  );
});

describe("the lines that `draft run` prints", () => {
  const ID = "a".repeat(64);

  it("tell a saved draft, the refusal of the checks, and any other stop", () => {
    expect(parseDraftLines([`code=DRAFT_OK draftId=${ID} task=ISSUE_CANDIDATE cached=false`])).toEqual({ kind: "DRAFT_OK", draftId: ID, cached: false });
    expect(parseDraftLines([`code=DRAFT_OK draftId=${ID} task=ISSUE_CANDIDATE cached=true`])).toEqual({ kind: "DRAFT_OK", draftId: ID, cached: true });
    expect(parseDraftLines(["code=DRAFT_FAILED reason=CHECK_FAILED", "violation=DR_JSON:output", "violation=DR_GROUND_MATCH:factSummary[0]"])).toEqual({
      kind: "CHECK_FAILED",
      violations: ["DR_JSON:output", "DR_GROUND_MATCH:factSummary[0]"],
    });
    expect(parseDraftLines(["code=DRAFT_FAILED reason=AUTH"])).toEqual({ kind: "STOPPED", reason: "AUTH" });
    expect(parseDraftLines(["code=DRAFT_FAILED reason=INPUT_REFUSED", "reasons=FACT_NOT_VERIFIED"])).toEqual({ kind: "STOPPED", reason: "INPUT_REFUSED" });
    expect(parseDraftLines(["code=CONFIG_UNREADABLE"])).toEqual({ kind: "STOPPED", reason: "CONFIG_UNREADABLE" });
    expect(parseDraftLines([])).toEqual({ kind: "STOPPED", reason: "NO_RESULT" });
  });

  it("tell that the output was cut off only from the line that says so, and only for a refusal of the checks", () => {
    const refused = ["code=DRAFT_FAILED reason=CHECK_FAILED", "violation=DR_JSON:output"];

    expect(parseDraftLines([...refused, "truncated=true"])).toEqual({ kind: "CHECK_FAILED", violations: ["DR_JSON:output"], truncated: true });
    expect(parseDraftLines([...refused, "truncated=false"])).toEqual({ kind: "CHECK_FAILED", violations: ["DR_JSON:output"] });
    expect(parseDraftLines([...refused, "x truncated=true"])).toEqual({ kind: "CHECK_FAILED", violations: ["DR_JSON:output"] });
    expect(parseDraftLines(["code=DRAFT_FAILED reason=AUTH", "truncated=true"])).toEqual({ kind: "STOPPED", reason: "AUTH" });
  });

  it("do not take a line that only looks like a violation", () => {
    expect(parseDraftLines(["code=DRAFT_FAILED reason=CHECK_FAILED", "violation=not a check", "violation=DR_JSON:output extra", "x violation=DR_JSON:output"])).toEqual({
      kind: "CHECK_FAILED",
      violations: [],
    });
  });
});
