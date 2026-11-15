import { mkdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { BEDROCK_BEARER_TOKEN_ENV_NAME, FixtureFactSchema } from "@ehime-vote-navigator/contracts";
import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { MIN_REQUEST_INTERVAL_MS, createPacer } from "../analysis/pacer.js";
import type { Pacer } from "../analysis/pacer.js";
import {
  ALLOWED_BEDROCK_MODEL_IDS,
  CONVERSE_MAX_TOKENS,
  CONVERSE_TIMEOUT_MS,
  MAX_CONVERSE_INPUT_CHARS,
  THINKING_DISABLED_MODEL_IDS,
  createBedrockConverseClient,
  thinkingLabelOf,
} from "../aws/bedrockConverse.js";
import type { BedrockConverseClient, ConverseFetch, ConverseThinking } from "../aws/bedrockConverse.js";
import {
  INPUT_TOKENS_PER_CODE_UNIT_CEILING,
  MICRO_USD_PER_USD,
  PRICE_TABLE_AS_OF,
  createLimitedConverseClient,
  formatUsd,
  priceOf,
  worstCaseMicroUsd,
} from "../aws/bedrockLimits.js";
import type { CallRecord, LimitedConverseClient } from "../aws/bedrockLimits.js";
import { SMOKE_INPUT_TEXT, SMOKE_SYSTEM_TEXT } from "../aws/bedrockSmoke.js";
import { resolveAwsConfig } from "../config/aws.js";
import type { AwsEnvironment } from "../config/aws.js";
import { loadNeutralityConfig } from "./build/loadConfig.js";
import { readLedger } from "./draft/approvalLedger.js";
import { readAiContribution } from "./draft/contribution.js";
import { deriveDisposition } from "./draft/disposition.js";
import { createDraftStore } from "./draft/draftStore.js";
import { PROMPT_VERSION, buildPrompt, promptOptionsOf } from "./draft/prompts/index.js";
import { DraftRequestSchema } from "./draft/request.js";
import { mapClientError } from "./draft/runDraft.js";
import { FIXTURE_LOGICAL_ROOT } from "./draft/types.js";
import type { RecordRoot } from "./draft/types.js";
import { DraftRunSettingsSchema, checkWordsOf, parseArgs, runDraftCommand } from "./draftCli.js";

/**
 * The check of the AI draft process against the real Amazon Bedrock, with the fictional data of the repository
 * (`npm run bedrock:draft-check`). It is the one place that sends a request for the draft process to the real
 * service, and it is built so that nothing is sent without a person's approval of exactly what is sent:
 *
 *  1. It reads the settings and the fictional facts and builds a plan: the region, the model, the key's account (masked),
 *     each request (its size and its SHA-256), the limits, how the model is asked (`--thinking`; the limit of the output is
 *     the same in every plan), and the worst case of the cost. It prints the plan and a digest of it.
 *     No client is made at this point, so nothing can be sent.
 *  2. It sends only when `BEDROCK_LIVE_CHECK_APPROVAL` holds the digest of the plan as it is now. A plan that changed by
 *     one character (a model, a fact, the settings, the ceiling) has another digest and needs a new approval.
 *  3. It runs each request through `draft run` (`runDraftCommand`), the command that a person uses, with a client that has
 *     the limits of the run: a ceiling for the calls and for the cost, and no call after the first failure.
 *  4. It writes the drafts and the records only in a folder of its own under `dist/` (never in the fictional data of the
 *     repository), and it prints only codes, IDs, counts and sizes: no key, no prompt, no text of an answer.
 *
 * What it does not do: it sends no real data, no personal data and no secret (the facts are read from the fictional
 * registry and checked against the contract of a fictional fact), it approves nothing (a draft stays `PENDING` until a person
 * adopts and approves it), and it makes no AWS resource.
 */

export const LIVE_CHECK_APPROVAL_ENV = "BEDROCK_LIVE_CHECK_APPROVAL";
/** 2: the plan states how the model is asked (the thinking). */
export const LIVE_CHECK_PLAN_VERSION = 2;

/** The settings that the tests use before the lists of words are approved (13.1). They are not approved lists. */
export const DEFAULT_LIVE_CHECK_CONFIG_DIR = "tests/harness/regional-values/test-config";
export const DEFAULT_LIVE_CHECK_SETTINGS = "tests/harness/regional-values/test-config/draft-settings.json";

/** The ceiling of the worst-case cost of a run, in millionths of a dollar: five cents. A run is a few calls of a few thousand tokens. */
export const DEFAULT_MAX_COST_MICRO_USD = 50_000;
/** No ceiling above one dollar can be asked for: this check is not a place to spend. */
export const MAX_ALLOWED_COST_MICRO_USD = 1_000_000;

/**
 * Not a credential: a fixed text that the service cannot accept as a key. The probe of the refusal sends it in place of the key, to
 * see how the real service answers a key it does not accept. The real key is never sent by the probe.
 */
export const AUTH_PROBE_TOKEN = "invalid-token-for-the-auth-probe";

export type LiveCheckScenario = Readonly<{ id: string; theme: string; factIds: readonly string[] }>;

/**
 * One request of an issue candidate for each theme of the fictional data, on the same facts that the fictional issues of the
 * repository rest on (`packages/fixtures/src/regional-values/issues/`), so that what the real model writes can be read beside them.
 */
export const LIVE_CHECK_SCENARIOS: readonly LiveCheckScenario[] = [
  { id: "S1", theme: "population", factIds: ["fixture-fact-population-2023-v1", "fixture-fact-population-2024-v1", "fixture-fact-population-v1"] },
  { id: "S2", theme: "disaster", factIds: ["fixture-fact-disaster-v1", "fixture-fact-disaster-hills-v1"] },
  { id: "S3", theme: "education", factIds: ["fixture-fact-education-v1", "fixture-fact-education-users-v1"] },
];

const FACTS_RELATIVE_PATH = ["packages", "fixtures", "src", "regional-values", "facts.json"] as const;
const VIRTUAL_REQUEST_DIRECTORY = ".live-check-requests";

// ---------------------------------------------------------------------------
// The key's account, the flags
// ---------------------------------------------------------------------------

/**
 * The account that a long-term Bedrock API key names, masked to its last four digits (`********1234`), or `UNKNOWN`.
 * A long-term key is a base64 text of a few bytes and `<name of the IAM user>-at-<account>:<secret>` (the service-specific
 * credential of the user). Only the twelve digits of the account are taken from it; the name and the secret are not kept or
 * looked at. A short-term key (a signed URL) names no account. It is what the key says about itself: the service has not confirmed it.
 */
export function accountHintOfKey(token: string | undefined): string {
  if (token === undefined) {
    return "UNKNOWN";
  }
  const decoded = Buffer.from(token.trim(), "base64").toString("latin1");
  const account = /-at-(\d{12}):/u.exec(decoded)?.[1];
  return account === undefined ? "UNKNOWN" : `********${account.slice(-4)}`;
}

type Flags = Readonly<{
  configDir: string;
  draftSettings: string;
  maxCostMicroUsd: number;
  authProbe: boolean;
  /** Absent: the model is asked with the defaults of the service (the setting of the run of 2026-11-15). */
  thinking?: ConverseThinking;
}>;

const COST_PATTERN = /^\d{1,3}(?:\.\d{1,6})?$/u;

/**
 * The words of `--thinking`. The lower the effort, the less the model thinks; `disabled` is no thinking, which only Haiku takes.
 * The limit of the output is not a flag: it stays at `CONVERSE_MAX_TOKENS`.
 */
const THINKING_FLAG_VALUES: Readonly<Record<string, ConverseThinking>> = Object.freeze({
  disabled: { mode: "DISABLED" },
  low: { mode: "ADAPTIVE", effort: "low" },
  medium: { mode: "ADAPTIVE", effort: "medium" },
  high: { mode: "ADAPTIVE", effort: "high" },
});

/** `null` for a flag that is not listed, a repeated or a valueless flag, a path outside the repository, a ceiling that is not in (0, 1] dollars, or a thinking setting that is not listed. */
export function parseFlags(argv: readonly string[]): Flags | null {
  const parsed = parseArgs(argv, ["--config-dir", "--draft-settings", "--max-cost-usd", "--thinking"], ["--no-auth-probe"]);
  if (parsed === null || parsed.positionals.length > 0) {
    return null;
  }
  const thinkingText = parsed.values.get("--thinking");
  if (thinkingText !== undefined && !Object.hasOwn(THINKING_FLAG_VALUES, thinkingText)) {
    return null;
  }
  const thinking = thinkingText === undefined ? undefined : THINKING_FLAG_VALUES[thinkingText];
  const costText = parsed.values.get("--max-cost-usd");
  let maxCostMicroUsd = DEFAULT_MAX_COST_MICRO_USD;
  if (costText !== undefined) {
    if (!COST_PATTERN.test(costText)) {
      return null;
    }
    maxCostMicroUsd = Math.round(Number(costText) * MICRO_USD_PER_USD);
    if (maxCostMicroUsd < 1 || maxCostMicroUsd > MAX_ALLOWED_COST_MICRO_USD) {
      return null;
    }
  }
  return {
    configDir: parsed.values.get("--config-dir") ?? DEFAULT_LIVE_CHECK_CONFIG_DIR,
    draftSettings: parsed.values.get("--draft-settings") ?? DEFAULT_LIVE_CHECK_SETTINGS,
    maxCostMicroUsd,
    authProbe: !parsed.flags.has("--no-auth-probe"),
    ...(thinking === undefined ? {} : { thinking }),
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type PlanStep = Readonly<{
  id: string;
  kind: "AUTH_PROBE" | "ISSUE_CANDIDATE";
  theme: string | null;
  factIds: readonly string[];
  modelId: string;
  inputChars: number;
  inputSha256: string;
  worstCaseMicroUsd: number;
}>;

export type LiveCheckPlan = Readonly<{
  version: typeof LIVE_CHECK_PLAN_VERSION;
  region: string;
  endpoint: string;
  keyAccount: string;
  promptVersion: string;
  models: Readonly<{ generation: string; verification: string }>;
  /** `TEST_ONLY_NOT_APPROVED`: the lists of words are the ones that the tests use, not the lists that a person approved (13.1). */
  checks: Readonly<{
    configDir: string;
    draftSettings: string;
    draftSettingsSha256: string;
    status: "TEST_ONLY_NOT_APPROVED" | "GIVEN_BY_OPERATOR";
  }>;
  limits: Readonly<{
    maxCalls: number;
    maxCostMicroUsd: number;
    stopAfterFailure: true;
    timeoutMs: number;
    maxOutputTokens: number;
    maxInputChars: number;
    minIntervalMs: number;
  }>;
  /** How the model is asked, apart from the prompt: `DEFAULT` (the defaults of the service), `DISABLED`, or `ADAPTIVE_LOW`, `ADAPTIVE_MEDIUM`, `ADAPTIVE_HIGH`. */
  inference: Readonly<{ thinking: string }>;
  pricing: Readonly<{ asOf: string; modelId: string; inputUsdPerMillion: number; outputUsdPerMillion: number; inputTokensPerCodeUnitCeiling: number }>;
  steps: readonly PlanStep[];
  totalWorstCaseMicroUsd: number;
}>;

/** The digest that a person approves. The same plan has the same digest, and any change of the plan has another. */
export function planDigest(plan: LiveCheckPlan): string {
  return sha256Hex(encodeCanonicalJson(plan));
}

function inputOf(system: string, text: string): Readonly<{ inputChars: number; inputSha256: string }> {
  return { inputChars: system.length + text.length, inputSha256: sha256Hex(encodeCanonicalJson({ system, text })) };
}

// ---------------------------------------------------------------------------
// The answer of `draft run`
// ---------------------------------------------------------------------------

export type StepVerdict =
  | Readonly<{ kind: "DRAFT_OK"; draftId: string; cached: boolean }>
  /** `truncated` is set (to `true`) only when the model stopped at the limit of the output, so that the output is cut off. */
  | Readonly<{ kind: "CHECK_FAILED"; violations: readonly string[]; truncated?: true }>
  | Readonly<{ kind: "STOPPED"; reason: string }>;

/**
 * Reads the lines that `draft run` printed (`code=DRAFT_OK ...`, `code=DRAFT_FAILED reason=...`, `violation=...`). A refusal of the
 * checks on the output is a verdict of the check, and the run goes on; any other failure (the key, the service, the input, the
 * store, the settings) stops the run.
 */
export function parseDraftLines(lines: readonly string[]): StepVerdict {
  const firstMatch = (pattern: RegExp): RegExpExecArray | null => {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match !== null) {
        return match;
      }
    }
    return null;
  };

  const ok = firstMatch(/^code=DRAFT_OK draftId=([0-9a-f]{64}) task=\S+ cached=(true|false)$/u);
  if (ok?.[1] !== undefined) {
    return { kind: "DRAFT_OK", draftId: ok[1], cached: ok[2] === "true" };
  }
  const reason = firstMatch(/^code=DRAFT_FAILED reason=([A-Z_]+)$/u)?.[1];
  if (reason === "CHECK_FAILED") {
    const violations = lines.flatMap((line) => {
      const violation = /^violation=(DR_[A-Z_]+:[^\s,]+)$/u.exec(line)?.[1];
      return violation === undefined ? [] : [violation];
    });
    return { kind: "CHECK_FAILED", violations, ...(lines.includes("truncated=true") ? { truncated: true as const } : {}) };
  }
  if (reason !== undefined) {
    return { kind: "STOPPED", reason };
  }
  return { kind: "STOPPED", reason: firstMatch(/^code=([A-Z_]+)/u)?.[1] ?? "NO_RESULT" };
}

// ---------------------------------------------------------------------------
// The clients
// ---------------------------------------------------------------------------

export type LiveClientKind = "MAIN" | "AUTH_PROBE";

/**
 * The real client. `MAIN` sends the key of the environment. `AUTH_PROBE` has the same configuration but sends `AUTH_PROBE_TOKEN`
 * in place of the key, so the real key is never in a request of the probe. `fetchImplementation` is for a test.
 */
export function createLiveClient(kind: LiveClientKind, environment: AwsEnvironment, fetchImplementation?: ConverseFetch): BedrockConverseClient {
  return createBedrockConverseClient({
    environment,
    ...(fetchImplementation === undefined ? {} : { fetch: fetchImplementation }),
    ...(kind === "AUTH_PROBE" ? { getToken: () => AUTH_PROBE_TOKEN } : {}),
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type DraftLiveCheckOptions = Readonly<{
  environment: AwsEnvironment;
  /** The root of the repository. */
  workspaceRoot: string;
  argv?: readonly string[];
  write: (line: string) => void;
  now?: () => Date;
  pacer?: Pacer;
  /** The folder that holds one folder for each run. Default: `<root>/dist/bedrock-live-check`. */
  outputRoot?: string;
  /** Makes a client. It is called only after the approval was checked; a test gives a fake. */
  createClient?: (kind: LiveClientKind) => BedrockConverseClient;
  readTextFile?: (path: string) => Promise<string>;
}>;

function describeRecord(record: CallRecord | undefined): string {
  if (record === undefined) {
    return "";
  }
  const parts = [`elapsedMs=${record.elapsedMs === null ? "-" : String(record.elapsedMs)}`];
  if (record.httpStatus !== null && record.outcome !== "OK") {
    parts.push(`httpStatus=${String(record.httpStatus)}`);
  }
  if (record.errorType !== null) {
    parts.push(`errorType=${record.errorType}`);
  }
  if (record.usage !== null) {
    parts.push(`inputTokens=${String(record.usage.inputTokens)}`, `outputTokens=${String(record.usage.outputTokens)}`);
  }
  if (record.outputHeadroom !== null) {
    parts.push(`headroom=${String(record.outputHeadroom)}`);
  }
  if (record.stopReason !== null) {
    parts.push(`stopReason=${record.stopReason}`);
  }
  if (record.actualMicroUsd !== null) {
    parts.push(`usd=${formatUsd(record.actualMicroUsd)}`);
  }
  if (record.shape !== null) {
    parts.push(`shape=${record.shape.starts}/${record.shape.ends}`, `fence=${String(record.shape.hasFence)}`, `codePoints=${String(record.shape.codePoints)}`);
  }
  return ` ${parts.join(" ")}`;
}

function sumMicroUsd(records: readonly CallRecord[], field: "actualMicroUsd" | "worstCaseMicroUsd"): number {
  return records.reduce((sum, record) => sum + (record[field] ?? 0), 0);
}

/**
 * The tokens of the calls that reported them: their sum, the most that one call spent on its output (the thinking is in it), and the
 * least room that a call had under the limit of the output. `-` when no call reported any. A call that failed has no counts.
 */
function summaryOfTokens(records: readonly CallRecord[], thinking: string): string {
  const usages = records.flatMap((record) => (record.usage === null ? [] : [record.usage]));
  const headrooms = records.flatMap((record) => (record.outputHeadroom === null ? [] : [record.outputHeadroom]));
  const total = (pick: (usage: (typeof usages)[number]) => number): string => (usages.length === 0 ? "-" : String(usages.reduce((sum, usage) => sum + pick(usage), 0)));
  const largest = usages.length === 0 ? "-" : String(Math.max(...usages.map((usage) => usage.outputTokens)));
  const room = headrooms.length === 0 ? "-" : String(Math.min(...headrooms));
  return (
    `summary tokens input=${total((usage) => usage.inputTokens)} output=${total((usage) => usage.outputTokens)} ` +
    `maxOutputPerCall=${largest} minHeadroom=${room} limit=${String(CONVERSE_MAX_TOKENS)} thinking=${thinking}`
  );
}

/**
 * Plans, and sends only with the approval of the plan. Returns the exit code: 0 when the plan was printed (nothing sent) or when every request
 * of an approved run reached a verdict of the checks; 1 for anything else (a setting that is not ready, a plan that was not approved as it is, a run that stopped).
 */
export async function runDraftLiveCheck(options: DraftLiveCheckOptions): Promise<number> {
  const { environment, workspaceRoot, write } = options;
  const now = options.now ?? ((): Date => new Date());
  const read = options.readTextFile ?? ((path: string): Promise<string> => readFile(path, "utf8"));

  const flags = parseFlags(options.argv ?? []);
  if (flags === null) {
    write("code=LIVE_CHECK_ARGUMENT_INVALID");
    return 1;
  }

  // 1. The settings of AWS: the region, the key (by its presence), the models. No value of a secret is read out.
  const aws = resolveAwsConfig(environment);
  if (!aws.ok) {
    write("code=LIVE_CHECK_NOT_READY");
    for (const name of aws.error.missing) {
      write(`missing: ${name}`);
    }
    for (const violation of aws.error.violations) {
      write(`rejected: ${violation.name} (${violation.code})`);
    }
    return 1;
  }
  const { generation, verification } = aws.value.models;
  const price = priceOf(generation);
  if (!ALLOWED_BEDROCK_MODEL_IDS.includes(generation) || price === undefined) {
    write("code=LIVE_CHECK_MODEL_NOT_ALLOWED");
    return 1;
  }
  if (flags.thinking?.mode === "DISABLED" && !THINKING_DISABLED_MODEL_IDS.includes(generation)) {
    // The model cannot turn thinking off (the service would answer 400), so no plan is made for it.
    write("code=LIVE_CHECK_THINKING_NOT_SUPPORTED");
    return 1;
  }

  // 2. The fictional facts, the settings of the checks.
  const configDirectory = resolve(workspaceRoot, flags.configDir);
  const settingsPath = resolve(workspaceRoot, flags.draftSettings);
  let allFacts: readonly FixtureFact[];
  let settingsText: string;
  try {
    const parsedFacts = FixtureFactSchema.array().safeParse(JSON.parse(await read(join(workspaceRoot, ...FACTS_RELATIVE_PATH))));
    if (!parsedFacts.success) {
      write("code=LIVE_CHECK_FIXTURE_UNREADABLE");
      return 1;
    }
    allFacts = parsedFacts.data;
    settingsText = await read(settingsPath);
  } catch {
    write("code=LIVE_CHECK_FIXTURE_UNREADABLE");
    return 1;
  }
  const settings = (() => {
    try {
      return DraftRunSettingsSchema.safeParse(JSON.parse(settingsText));
    } catch {
      return null;
    }
  })();
  const neutrality = await loadNeutralityConfig(configDirectory);
  if (settings === null || !settings.success || !neutrality.ok) {
    write("code=LIVE_CHECK_CONFIG_UNREADABLE");
    return 1;
  }

  // 3. The requests: each is built from the fictional facts and checked against the contract of a draft request.
  // The prompt is built with the same options that `draft run` uses, so the size and the SHA-256 of a step are those of what is sent.
  const promptOptions = promptOptionsOf({ neutrality: neutrality.value, words: checkWordsOf(settings.data) });
  const requestTexts = new Map<string, string>();
  const steps: PlanStep[] = [];
  if (flags.authProbe) {
    const input = inputOf(SMOKE_SYSTEM_TEXT, SMOKE_INPUT_TEXT);
    steps.push({ id: "P0", kind: "AUTH_PROBE", theme: null, factIds: [], modelId: generation, ...input, worstCaseMicroUsd: worstCaseMicroUsd(generation, input.inputChars) ?? 0 });
  }
  for (const scenario of LIVE_CHECK_SCENARIOS) {
    const facts = scenario.factIds.map((factId) => allFacts.find((fact) => fact.factId === factId));
    if (facts.some((fact) => fact === undefined)) {
      write(`code=LIVE_CHECK_FIXTURE_FACT_MISSING step=${scenario.id}`);
      return 1;
    }
    const request = DraftRequestSchema.safeParse({ task: "ISSUE_CANDIDATE", dataKind: "FIXTURE", facts, evidence: [], sources: [] });
    if (!request.success) {
      write(`code=LIVE_CHECK_FIXTURE_UNREADABLE step=${scenario.id}`);
      return 1;
    }
    const prompt = buildPrompt(request.data, promptOptions);
    const input = inputOf(prompt.system, prompt.text);
    if (input.inputChars > MAX_CONVERSE_INPUT_CHARS) {
      write(`code=LIVE_CHECK_INPUT_TOO_LONG step=${scenario.id}`);
      return 1;
    }
    requestTexts.set(`${scenario.id}`, JSON.stringify({ dataKind: "FIXTURE", facts, evidence: [], sources: [] }));
    steps.push({
      id: scenario.id,
      kind: "ISSUE_CANDIDATE",
      theme: scenario.theme,
      factIds: scenario.factIds,
      modelId: generation,
      ...input,
      worstCaseMicroUsd: worstCaseMicroUsd(generation, input.inputChars) ?? 0,
    });
  }

  const totalWorstCaseMicroUsd = steps.reduce((sum, step) => sum + step.worstCaseMicroUsd, 0);
  const plan: LiveCheckPlan = {
    version: LIVE_CHECK_PLAN_VERSION,
    region: aws.value.region,
    endpoint: `bedrock-runtime.${aws.value.region}.amazonaws.com`,
    keyAccount: accountHintOfKey(environment[BEDROCK_BEARER_TOKEN_ENV_NAME]),
    promptVersion: PROMPT_VERSION,
    models: { generation, verification },
    checks: {
      configDir: flags.configDir,
      draftSettings: flags.draftSettings,
      draftSettingsSha256: sha256Hex(settingsText),
      status: flags.configDir === DEFAULT_LIVE_CHECK_CONFIG_DIR && flags.draftSettings === DEFAULT_LIVE_CHECK_SETTINGS ? "TEST_ONLY_NOT_APPROVED" : "GIVEN_BY_OPERATOR",
    },
    limits: {
      maxCalls: steps.length,
      maxCostMicroUsd: flags.maxCostMicroUsd,
      stopAfterFailure: true,
      timeoutMs: CONVERSE_TIMEOUT_MS,
      maxOutputTokens: CONVERSE_MAX_TOKENS,
      maxInputChars: MAX_CONVERSE_INPUT_CHARS,
      minIntervalMs: MIN_REQUEST_INTERVAL_MS,
    },
    inference: { thinking: thinkingLabelOf(flags.thinking) },
    pricing: {
      asOf: PRICE_TABLE_AS_OF,
      modelId: generation,
      inputUsdPerMillion: price.input,
      outputUsdPerMillion: price.output,
      inputTokensPerCodeUnitCeiling: INPUT_TOKENS_PER_CODE_UNIT_CEILING,
    },
    steps,
    totalWorstCaseMicroUsd,
  };
  const digest = planDigest(plan);

  write(`plan version=${String(plan.version)} digest=${digest}`);
  write(`plan aws region=${plan.region} endpoint=${plan.endpoint} auth=BEDROCK_API_KEY keyAccount=${plan.keyAccount} crossRegion=${String(aws.value.crossRegion)}`);
  write(`plan models generation=${generation} verification=${verification} used=generation`);
  write("plan data kind=FIXTURE source=packages/fixtures/src/regional-values/facts.json realData=none");
  write(`plan prompt version=${plan.promptVersion}`);
  write(`plan checks status=${plan.checks.status} configDir=${plan.checks.configDir} settings=${plan.checks.draftSettings} settingsSha256=${plan.checks.draftSettingsSha256}`);
  write(
    `plan limits maxCalls=${String(plan.limits.maxCalls)} maxWorstCaseUsd=${formatUsd(plan.limits.maxCostMicroUsd)} timeoutMs=${String(plan.limits.timeoutMs)} ` +
      `maxOutputTokens=${String(plan.limits.maxOutputTokens)} maxInputChars=${String(plan.limits.maxInputChars)} minIntervalMs=${String(plan.limits.minIntervalMs)} stopAfterFailure=true retries=0`,
  );
  write(`plan inference thinking=${plan.inference.thinking}`);
  write(
    `plan pricing asOf=${plan.pricing.asOf} model=${plan.pricing.modelId} inputUsdPerMillionTokens=${String(plan.pricing.inputUsdPerMillion)} ` +
      `outputUsdPerMillionTokens=${String(plan.pricing.outputUsdPerMillion)} inputTokensPerCodeUnitCeiling=${String(plan.pricing.inputTokensPerCodeUnitCeiling)}`,
  );
  for (const step of steps) {
    write(
      `plan step id=${step.id} kind=${step.kind} theme=${step.theme ?? "-"} facts=${step.factIds.join(",") || "-"} model=${step.modelId} ` +
        `inputChars=${String(step.inputChars)} inputSha256=${step.inputSha256} worstCaseUsd=${formatUsd(step.worstCaseMicroUsd)}`,
    );
  }
  write(`plan total calls=${String(steps.length)} worstCaseUsd=${formatUsd(totalWorstCaseMicroUsd)}`);

  if (totalWorstCaseMicroUsd > flags.maxCostMicroUsd) {
    write("code=LIVE_CHECK_PLAN_OVER_BUDGET");
    return 1;
  }

  // 4. The approval. Nothing below this line runs without it, and no client exists before it.
  const approval = environment[LIVE_CHECK_APPROVAL_ENV]?.trim();
  if (approval === undefined || approval === "") {
    write(`code=LIVE_CHECK_NOT_APPROVED approve-with=${LIVE_CHECK_APPROVAL_ENV}=<digest> sent=none`);
    return 0;
  }
  if (approval !== digest) {
    write("code=LIVE_CHECK_APPROVAL_MISMATCH sent=none");
    return 1;
  }

  // 5. The run.
  const startedAt = now();
  const runId = startedAt.toISOString().replaceAll(/[-:.]/gu, "");
  const outputDirectory = join(options.outputRoot ?? join(workspaceRoot, "dist", "bedrock-live-check"), runId);
  const root: RecordRoot = { dataKind: "FIXTURE", rootDir: outputDirectory, logicalRoot: FIXTURE_LOGICAL_ROOT };
  const store = createDraftStore(root);
  const makeClient = options.createClient ?? ((kind: LiveClientKind): BedrockConverseClient => createLiveClient(kind, environment));
  const pacer = options.pacer ?? createPacer();
  const limits = { maxCostMicroUsd: flags.maxCostMicroUsd, stopAfterFailure: true } as const;
  const requestPath = (id: string): string => join(VIRTUAL_REQUEST_DIRECTORY, `${id}.json`);
  const virtual = new Map([...requestTexts].map(([id, text]) => [resolve(workspaceRoot, requestPath(id)), text] as const));

  let stoppedBecause: string | null = null;
  let probe: LimitedConverseClient | undefined;
  let main: LimitedConverseClient | undefined;

  try {
    await mkdir(outputDirectory, { recursive: true });
    write(`run id=${runId} output=${relative(workspaceRoot, outputDirectory)}`);

    if (flags.authProbe) {
      probe = createLimitedConverseClient(makeClient("AUTH_PROBE"), { ...limits, maxCalls: 1 });
      const result = await probe.client.converse({ modelId: generation, system: SMOKE_SYSTEM_TEXT, text: SMOKE_INPUT_TEXT });
      const detail = describeRecord(probe.records()[0]);
      if (result.ok) {
        // The service took a key that it should not take. Nothing else is sent.
        write(`run step=P0 kind=AUTH_PROBE outcome=ACCEPTED expected=false${detail}`);
        stoppedBecause = "AUTH_PROBE_ACCEPTED";
      } else {
        const mapped = mapClientError(result.error).code;
        write(`run step=P0 kind=AUTH_PROBE outcome=${mapped} expected=${String(mapped === "AUTH")}${detail}`);
        if (mapped !== "AUTH") {
          stoppedBecause = `AUTH_PROBE_${mapped}`;
        }
      }
    }

    // The client that holds the real key is made only when the probe did not stop the run.
    if (stoppedBecause === null) {
      main = createLimitedConverseClient(makeClient("MAIN"), { ...limits, maxCalls: LIVE_CHECK_SCENARIOS.length });
    }
    const models = { generation, verification };
    for (const scenario of LIVE_CHECK_SCENARIOS) {
      if (stoppedBecause !== null || main === undefined) {
        write(`run step=${scenario.id} outcome=SKIPPED`);
        continue;
      }
      const before = main.records().length;
      const lines: string[] = [];
      await runDraftCommand(
        ["draft", "run", "--task", "ISSUE_CANDIDATE", "--input", requestPath(scenario.id), "--draft-settings", flags.draftSettings, "--config-dir", flags.configDir],
        {
          io: { write: (line) => lines.push(line) },
          workspaceRoot,
          now,
          logWriter: () => undefined,
          draft: {
            client: main.client,
            pacer,
            models,
            ...(flags.thinking === undefined ? {} : { inference: { thinking: flags.thinking } }),
            recordRoot: (dataKind) => {
              if (dataKind !== "FIXTURE") {
                throw new Error("LIVE_CHECK_FIXTURE_ONLY");
              }
              return root;
            },
            isElectionBulletin: () => Promise.resolve(false),
            readTextFile: (path) => {
              const text = virtual.get(resolve(path));
              return text === undefined ? read(path) : Promise.resolve(text);
            },
          },
        },
      );
      const verdict = parseDraftLines(lines);
      const recorded = main.records();
      const detail = describeRecord(recorded.length > before ? recorded[recorded.length - 1] : undefined);
      if (verdict.kind === "DRAFT_OK") {
        write(`run step=${scenario.id} outcome=DRAFT_OK draftId=${verdict.draftId} status=PENDING cached=${String(verdict.cached)}${detail}`);
      } else if (verdict.kind === "CHECK_FAILED") {
        const cut = verdict.truncated === true ? " truncated=true" : "";
        write(`run step=${scenario.id} outcome=CHECK_FAILED violations=${verdict.violations.join(",") || "-"}${cut}${detail}`);
      } else {
        write(`run step=${scenario.id} outcome=STOPPED reason=${verdict.reason}${detail}`);
        stoppedBecause = verdict.reason;
      }
    }

    // 6. What the run left, read back from the records: the drafts wait for a person.
    const drafts = await store.loadDrafts();
    const events = await store.loadEvents();
    const contribution = await readAiContribution(store);
    const ledger = await readLedger(root);
    const allRecords = [...(probe?.records() ?? []), ...(main?.records() ?? [])];
    const refusals = [...(probe?.refusals() ?? []), ...(main?.refusals() ?? [])];
    write(
      `summary calls=${String(allRecords.length)} refusals=${String(refusals.length)} actualUsd=${formatUsd(sumMicroUsd(allRecords, "actualMicroUsd"))} ` +
        `worstCaseUsd=${formatUsd(sumMicroUsd(allRecords, "worstCaseMicroUsd"))} ceilingUsd=${formatUsd(flags.maxCostMicroUsd)}`,
    );
    write(summaryOfTokens(allRecords, plan.inference.thinking));
    if (drafts.ok && events.ok) {
      const states = drafts.value.map((draft) => deriveDisposition(draft.draftId, events.value));
      const count = (state: string): number => states.filter((value) => value === state).length;
      write(
        `summary drafts saved=${String(drafts.value.length)} pending=${String(count("PENDING"))} adopted=${String(count("ADOPTED"))} rejected=${String(count("REJECTED"))} ` +
          `approvals=${ledger.ok ? String(ledger.value.length) : "UNKNOWN"} humanApprovalRequired=true`,
      );
    } else {
      write("summary drafts UNKNOWN");
    }
    if (contribution.ok) {
      const { drafted, rejectedByChecks, humanEdited, humanRejected } = contribution.value;
      write(`summary aiContribution drafted=${String(drafted)} rejectedByChecks=${String(rejectedByChecks)} humanEdited=${String(humanEdited)} humanRejected=${String(humanRejected)}`);
    }
  } catch {
    // Never print the error: it could carry a path or a request.
    write("code=LIVE_CHECK_FAILED");
    return 1;
  }

  if (stoppedBecause !== null) {
    write(`code=LIVE_CHECK_STOPPED reason=${stoppedBecause}`);
    return 1;
  }
  write("code=LIVE_CHECK_DONE");
  return 0;
}
