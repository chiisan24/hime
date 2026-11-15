import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DataKindSchema, DraftTaskSchema, IssueCandidateOutputSchema, ThemeDefSchema, ThemeIdSchema } from "@ehime-vote-navigator/contracts";
import type { ApprovalTargetKind, DataKind, DraftRecord, DraftTask, IssueConfirmation } from "@ehime-vote-navigator/contracts";
import { z } from "zod";

import { createPacer } from "../analysis/pacer.js";
import type { Pacer } from "../analysis/pacer.js";
import { createBedrockConverseClient } from "../aws/bedrockConverse.js";
import type { BedrockConverseClient } from "../aws/bedrockConverse.js";
import { resolveAwsConfig } from "../config/aws.js";
import { createFileIngestStore } from "../ingest/ingestStore.js";
import { createSafeLogger } from "../logging/safeLogger.js";
import { loadBuildConfig, loadNeutralityConfig } from "./build/loadConfig.js";
import type { RegionalValuesCliIo } from "./cli.js";
import { factNumeralsOf } from "./draft/checks.js";
import type { DraftCheckConfig, DraftCheckContext } from "./draft/checks.js";
import { readAiContribution } from "./draft/contribution.js";
import { deriveDisposition } from "./draft/disposition.js";
import type { Disposition } from "./draft/disposition.js";
import { createDraftStore } from "./draft/draftStore.js";
import type { DraftStore } from "./draft/draftStore.js";
import { DraftRequestSchema } from "./draft/request.js";
import { adoptDraft, approveTarget, rejectDraft, revokeApproval } from "./draft/review.js";
import { runDraft } from "./draft/runDraft.js";
import type { DraftModels } from "./draft/runDraft.js";
import { defaultRecordRoot } from "./draft/types.js";
import type { RecordRoot } from "./draft/types.js";

/**
 * The commands of the AI draft process: `draft run|list|review|counts` and `approve`
 * (`npm run regional-values -- draft ...`). Like the build, it prints only fixed codes, IDs and
 * counts: never a text of a draft, a prompt or a response (Req 8.17).
 *
 * `draft run` builds the real client and the real pace, and that is all the wiring does: the real
 * model is called only when a person runs the command, and no test does (a test gives a fake).
 */

export type DraftCommandSeams = Readonly<{
  /** The directory of the records of a data kind. A test gives a temporary directory. */
  recordRoot?: (dataKind: DataKind) => RecordRoot;
  /** The client of the model. A test gives a fake; without one the real client is made. */
  client?: BedrockConverseClient;
  pacer?: Pacer;
  /** The models of the two roles. Without them they are read from the settings of the environment. */
  models?: DraftModels;
  /** Whether an original is a registered election bulletin. Without it the intake records are asked. */
  isElectionBulletin?: (sha256: string) => Promise<boolean>;
  /** Reads a file of a request or of the settings. */
  readTextFile?: (path: string) => Promise<string>;
}>;

export type DraftCommandOptions = Readonly<{
  io: RegionalValuesCliIo;
  workspaceRoot: string;
  now?: () => Date;
  logWriter?: (line: string) => void;
  draft?: DraftCommandSeams;
}>;

/**
 * The settings of one run of `draft run`, from a file that a person gives (`--draft-settings`). The
 * real file of the repository is made at 13.1 after a person approves the values and the lists of
 * words, so until then nothing is built in: the lists are what the file says.
 */
export const DraftRunSettingsSchema = z
  .object({
    maxEvidenceUnits: z.number().int().min(1),
    evidenceMaxChars: z.number().int().min(1),
    sentenceMaxChars: z.number().int().min(1).max(60),
    causalWords: z.array(z.string().min(1)).min(1),
    hedgeEndings: z.array(z.string().min(1)).min(1),
    comparisonWords: z.array(z.string().min(1)).min(1),
    themes: z.array(ThemeDefSchema).length(6),
  })
  .strict();

export type DraftRunSettings = z.infer<typeof DraftRunSettingsSchema>;

/** The six confirmations of a person who approves an issue (Req 8.27), each as a question that "yes" confirms. */
export const ISSUE_CONFIRMATION_QUESTIONS: ReadonlyArray<readonly [keyof IssueConfirmation, string]> = [
  ["factsMatch", "文の数値と日付が、根拠の事実項目と一致することを確認しましたか? [y/N] "],
  ["factAndHypothesisSeparated", "事実の要約と仮説が、区別して書かれていることを確認しましたか? [y/N] "],
  ["noCausalClaim", "因果関係を断定する書き方が含まれていないことを確認しましたか? [y/N] "],
  ["noRecommendation", "推奨、優劣、順位を示す書き方が含まれていないことを確認しましたか? [y/N] "],
  ["unknownsStated", "判断できないことと、追加で確認すべきことが書かれていることを確認しましたか? [y/N] "],
  ["sourcesShown", "根拠の出典が、示される形で記録されていることを確認しましたか? [y/N] "],
];

export type Parsed = Readonly<{ positionals: readonly string[]; values: ReadonlyMap<string, string>; flags: ReadonlySet<string> }>;

/** Splits the arguments. A name that is not listed, a repeated name and a name without a value are invalid. */
export function parseArgs(args: readonly string[], valueNames: readonly string[], flagNames: readonly string[]): Parsed | null {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      return null;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
    } else if (flagNames.includes(token)) {
      if (flags.has(token)) {
        return null;
      }
      flags.add(token);
    } else if (valueNames.includes(token)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--") || values.has(token)) {
        return null;
      }
      values.set(token, value);
      index += 1;
    } else {
      return null;
    }
  }
  return { positionals, values, flags };
}

const APPROVAL_KINDS: readonly ApprovalTargetKind[] = ["QUESTION", "CARD", "RESULT_TEXT", "FIXED_TEXT", "ISSUE"];

export const DRAFT_USAGE_LINES: readonly string[] = [
  "Usage: npm run regional-values -- draft run --task <task> --input <request.json> --draft-settings <settings.json> [--config-dir <path>]",
  "       npm run regional-values -- draft list --data-kind REAL_AI|FIXTURE [--status PENDING|ADOPTED|REJECTED]",
  "       npm run regional-values -- draft review <draftId> --task <task> --data-kind <kind> --reviewer <id> --adopt --target-kind <kind> --target-id <id>",
  "         [--edited <file> --input <request.json> --draft-settings <settings.json> [--config-dir <path>]] [--theme <themeId>]",
  "       npm run regional-values -- draft review <draftId> --task <task> --data-kind <kind> --reviewer <id> --reject",
  "       npm run regional-values -- draft counts --data-kind REAL_AI|FIXTURE",
  "       npm run regional-values -- approve <targetKind> <targetId> --data-kind <kind> --approver <id> [--version <n>] [--target-hash <sha256>] [--revoke]",
];

function usage(io: RegionalValuesCliIo): number {
  for (const line of DRAFT_USAGE_LINES) {
    io.write(line);
  }
  io.write("code=USAGE");
  return 1;
}

function argumentInvalid(io: RegionalValuesCliIo): number {
  io.write("code=ARGUMENT_INVALID");
  return 1;
}

function reader(options: DraftCommandOptions): (path: string) => Promise<string> {
  return options.draft?.readTextFile ?? ((path: string) => readFile(path, "utf8"));
}

/** The content of a JSON file, or `undefined` when it cannot be read or parsed (the reason is not told). */
async function readJson(options: DraftCommandOptions, path: string): Promise<unknown> {
  try {
    return JSON.parse(await reader(options)(resolve(options.workspaceRoot, path)));
  } catch {
    return undefined;
  }
}

function dataKindOf(parsed: Parsed): DataKind | null {
  const result = DataKindSchema.safeParse(parsed.values.get("--data-kind"));
  return result.success ? result.data : null;
}

function taskOf(text: string | undefined): DraftTask | null {
  const result = DraftTaskSchema.safeParse(text);
  return result.success ? result.data : null;
}

function storeOf(options: DraftCommandOptions, dataKind: DataKind): DraftStore {
  return createDraftStore(options.draft?.recordRoot?.(dataKind) ?? defaultRecordRoot(options.workspaceRoot, dataKind));
}

type RunConfig = Readonly<{ settings: DraftRunSettings; checks: DraftCheckConfig }>;

/** The settings file, the neutrality settings and the build settings. `null` when any cannot be used. */
async function loadRunConfig(options: DraftCommandOptions, parsed: Parsed): Promise<RunConfig | null> {
  const settingsPath = parsed.values.get("--draft-settings");
  if (settingsPath === undefined) {
    return null;
  }
  const settings = DraftRunSettingsSchema.safeParse(await readJson(options, settingsPath));
  const configDir = resolve(options.workspaceRoot, parsed.values.get("--config-dir") ?? join("config", "regional-values"));
  const neutrality = await loadNeutralityConfig(configDir);
  const build = await loadBuildConfig(configDir);
  if (!settings.success || !neutrality.ok || !build.ok) {
    return null;
  }
  return {
    settings: settings.data,
    checks: {
      neutrality: neutrality.value,
      properNouns: build.value.properNouns,
      sentenceMaxChars: settings.data.sentenceMaxChars,
      words: {
        causalWords: settings.data.causalWords,
        hedgeEndings: settings.data.hedgeEndings,
        comparisonWords: settings.data.comparisonWords,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// draft run
// ---------------------------------------------------------------------------

async function draftRun(args: readonly string[], options: DraftCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--task", "--input", "--draft-settings", "--config-dir"], []);
  const task = taskOf(parsed?.values.get("--task"));
  const inputPath = parsed?.values.get("--input");
  if (parsed === null || parsed.positionals.length > 0 || task === null || inputPath === undefined || !parsed.values.has("--draft-settings")) {
    return argumentInvalid(io);
  }
  const spec = await readJson(options, inputPath);
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return argumentInvalid(io);
  }
  const specTask = (spec as { task?: unknown }).task;
  const dataKind = DataKindSchema.safeParse((spec as { dataKind?: unknown }).dataKind);
  if ((specTask !== undefined && specTask !== task) || !dataKind.success) {
    return argumentInvalid(io);
  }

  const config = await loadRunConfig(options, parsed);
  if (config === null) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }
  const seams = options.draft ?? {};
  let models = seams.models;
  if (models === undefined) {
    const aws = resolveAwsConfig(process.env);
    if (!aws.ok) {
      io.write("code=AWS_CONFIG_NOT_READY");
      return 1;
    }
    models = { generation: aws.value.models.generation, verification: aws.value.models.verification };
  }

  const ingest = createFileIngestStore({ realDataRoot: join(options.workspaceRoot, "data", "real") });
  const outcome = await runDraft(
    {
      client: seams.client ?? createBedrockConverseClient(),
      store: storeOf(options, dataKind.data),
      pacer: seams.pacer ?? createPacer(),
      now: options.now ?? ((): Date => new Date()),
      models,
      gate: { limits: { maxEvidenceUnits: config.settings.maxEvidenceUnits, evidenceMaxChars: config.settings.evidenceMaxChars } },
      isElectionBulletin:
        seams.isElectionBulletin ??
        (async (sha256: string): Promise<boolean> => {
          const holders = await ingest.findSourceIdsBySha256(sha256);
          if (!holders.ok) {
            throw new Error("INGEST_READ_FAILED");
          }
          return holders.value.length > 0;
        }),
      checks: config.checks,
      themes: config.settings.themes,
      logger: createSafeLogger(options.logWriter ?? ((line) => console.error(line))),
    },
    { ...spec, task },
  );

  if (outcome.ok) {
    io.write(`code=DRAFT_OK draftId=${outcome.value.draftId} task=${outcome.value.task} cached=${String(outcome.value.cached)}`);
    return 0;
  }
  const { error } = outcome;
  io.write(`code=DRAFT_FAILED reason=${error.code}`);
  if (error.code === "INPUT_REFUSED") {
    io.write(`reasons=${error.reasons.join(",")}`);
  } else if (error.code === "CHECK_FAILED") {
    for (const violation of error.violations) {
      io.write(`violation=${violation.check}:${violation.target}`);
    }
  } else if (error.code === "STORE_READ_FAILED" || error.code === "STORE_WRITE_FAILED") {
    io.write(`cause=${error.cause}`);
  }
  return 1;
}

// ---------------------------------------------------------------------------
// draft list
// ---------------------------------------------------------------------------

type ListedDraft = Readonly<{ draft: DraftRecord; status: Disposition }>;

/** The candidates of one theme that rest on the same set of facts: a possible duplicate (D34). Nothing is merged or deleted. */
function duplicateGroups(candidates: readonly ListedDraft[]): ReadonlyMap<string, number> {
  const byKey = new Map<string, string[]>();
  for (const { draft } of candidates) {
    const parsed = IssueCandidateOutputSchema.safeParse(draft.output);
    if (!parsed.success) {
      continue;
    }
    const key = `${parsed.data.themeId}|${[...parsed.data.basisFactIds].sort().join(",")}`;
    byKey.set(key, [...(byKey.get(key) ?? []), draft.draftId]);
  }
  const groups = new Map<string, number>();
  let number = 0;
  for (const key of [...byKey.keys()].sort()) {
    const members = byKey.get(key) ?? [];
    if (members.length > 1) {
      number += 1;
      for (const draftId of members) {
        groups.set(draftId, number);
      }
    }
  }
  return groups;
}

async function draftList(args: readonly string[], options: DraftCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--data-kind", "--status"], []);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  const statusText = parsed?.values.get("--status");
  const status = statusText === undefined ? undefined : (["PENDING", "ADOPTED", "REJECTED"] as const).find((value) => value === statusText);
  if (parsed === null || parsed.positionals.length > 0 || dataKind === null || (statusText !== undefined && status === undefined)) {
    return argumentInvalid(io);
  }
  const store = storeOf(options, dataKind);
  const drafts = await store.loadDrafts();
  if (!drafts.ok) {
    io.write(`code=LIST_FAILED reason=${drafts.error.code}`);
    return 1;
  }
  const events = await store.loadEvents();
  if (!events.ok) {
    io.write(`code=LIST_FAILED reason=${events.error.code}`);
    return 1;
  }
  const listed: ListedDraft[] = drafts.value
    .map((draft) => ({ draft, status: deriveDisposition(draft.draftId, events.value) }))
    .filter((item) => status === undefined || item.status === status);
  const candidates = listed.filter((item) => item.draft.key.task === "ISSUE_CANDIDATE");
  const groups = duplicateGroups(candidates);

  // The candidates are proposals, not facts: they are listed apart from the other drafts.
  io.write("section=drafts");
  for (const { draft, status: state } of listed.filter((item) => item.draft.key.task !== "ISSUE_CANDIDATE")) {
    io.write(`draft=${draft.draftId} task=${draft.key.task} status=${state} model=${draft.modelId}`);
  }
  io.write("section=issue-candidates (proposals, not facts)");
  for (const { draft, status: state } of candidates) {
    const group = groups.get(draft.draftId);
    io.write(`candidate=${draft.draftId} status=${state} model=${draft.modelId} possible-duplicate=${group === undefined ? "none" : `group-${group}`}`);
  }
  io.write(`code=LIST_OK count=${listed.length}`);
  return 0;
}

// ---------------------------------------------------------------------------
// draft review
// ---------------------------------------------------------------------------

/** What the checks of an edited output need: the input of the draft and the settings. `null` when they were not given or cannot be used. */
async function loadRecheck(options: DraftCommandOptions, parsed: Parsed, task: DraftTask, dataKind: DataKind): Promise<DraftCheckContext | null> {
  const inputPath = parsed.values.get("--input");
  const config = await loadRunConfig(options, parsed);
  if (inputPath === undefined || config === null) {
    return null;
  }
  const spec = await readJson(options, inputPath);
  const request = DraftRequestSchema.safeParse(typeof spec === "object" && spec !== null ? { ...spec, task } : undefined);
  if (!request.success || request.data.dataKind !== dataKind) {
    return null;
  }
  const now = options.now ?? ((): Date => new Date());
  return {
    task,
    dataKind,
    config: config.checks,
    evidence: request.data.evidence,
    facts: request.data.facts,
    themes: config.settings.themes,
    factNumerals: factNumeralsOf([...request.data.facts, ...(request.data.factRegistry ?? [])]),
    today: now().toISOString().slice(0, 10),
  };
}

async function draftReview(args: readonly string[], options: DraftCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(
    args,
    ["--task", "--data-kind", "--reviewer", "--target-kind", "--target-id", "--edited", "--theme", "--input", "--draft-settings", "--config-dir"],
    ["--adopt", "--reject"],
  );
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  const draftId = parsed?.positionals[0];
  const task = taskOf(parsed?.values.get("--task"));
  const reviewerId = parsed?.values.get("--reviewer");
  if (
    parsed === null ||
    parsed.positionals.length !== 1 ||
    draftId === undefined ||
    dataKind === null ||
    task === null ||
    reviewerId === undefined ||
    parsed.flags.has("--adopt") === parsed.flags.has("--reject")
  ) {
    return argumentInvalid(io);
  }
  const store = storeOf(options, dataKind);
  const now = options.now ?? ((): Date => new Date());

  if (parsed.flags.has("--reject")) {
    const rejected = await rejectDraft({ store, now }, { task, draftId, reviewerId });
    if (!rejected.ok) {
      io.write(`code=REVIEW_FAILED reason=${rejected.error.code}`);
      return 1;
    }
    io.write(`code=REVIEW_OK event=${rejected.value.kind}`);
    return 0;
  }

  const targetKind = APPROVAL_KINDS.find((kind) => kind === parsed.values.get("--target-kind"));
  const targetId = parsed.values.get("--target-id");
  const themeText = parsed.values.get("--theme");
  const theme = themeText === undefined ? undefined : ThemeIdSchema.safeParse(themeText);
  if (targetKind === undefined || targetId === undefined || (theme !== undefined && !theme.success)) {
    return argumentInvalid(io);
  }
  const editedPath = parsed.values.get("--edited");
  let edited: unknown;
  if (editedPath !== undefined) {
    edited = await readJson(options, editedPath);
    if (edited === undefined) {
      return argumentInvalid(io);
    }
  }
  // What a person changed goes through the checks again (Req 8.8), so the input of the draft is needed to adopt it.
  const recheck = await loadRecheck(options, parsed, task, dataKind);
  const adopted = await adoptDraft(
    { store, now },
    {
      task,
      draftId,
      reviewerId,
      target: { targetKind, targetId },
      ...(edited === undefined ? {} : { edited }),
      ...(theme?.success === true ? { themeId: theme.data } : {}),
      ...(recheck === null ? {} : { recheck }),
    },
  );
  if (!adopted.ok) {
    io.write(`code=REVIEW_FAILED reason=${adopted.error.code}`);
    if (adopted.error.code === "RECHECK_FAILED") {
      for (const violation of adopted.error.violations) {
        io.write(`violation=${violation.check}:${violation.target}`);
      }
    }
    return 1;
  }
  io.write(`code=REVIEW_OK event=${adopted.value.event.kind}`);
  return 0;
}

// ---------------------------------------------------------------------------
// draft counts
// ---------------------------------------------------------------------------

async function draftCounts(args: readonly string[], options: DraftCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--data-kind"], []);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  if (parsed === null || parsed.positionals.length > 0 || dataKind === null) {
    return argumentInvalid(io);
  }
  const counted = await readAiContribution(storeOf(options, dataKind));
  if (!counted.ok) {
    io.write(`code=COUNTS_FAILED reason=${counted.error.code}`);
    return 1;
  }
  const { drafted, rejectedByChecks, humanEdited, humanRejected } = counted.value;
  io.write(`aiContribution drafted=${drafted} rejectedByChecks=${rejectedByChecks} humanEdited=${humanEdited} humanRejected=${humanRejected}`);
  io.write("code=COUNTS_OK");
  return 0;
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

/** Asks the six confirmations. Anything but an explicit yes stops the approval, and nothing is written. */
async function confirmIssue(io: RegionalValuesCliIo): Promise<IssueConfirmation | null> {
  if (io.confirm === undefined) {
    return null;
  }
  for (const [, question] of ISSUE_CONFIRMATION_QUESTIONS) {
    if (!(await io.confirm(question))) {
      return null;
    }
  }
  // Every one was a yes. The contract takes only `true` for each, so a weaker record cannot be made.
  return {
    factsMatch: true,
    factAndHypothesisSeparated: true,
    noCausalClaim: true,
    noRecommendation: true,
    unknownsStated: true,
    sourcesShown: true,
  };
}

async function approve(args: readonly string[], options: DraftCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--data-kind", "--approver", "--version", "--target-hash"], ["--revoke"]);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  const targetKind = APPROVAL_KINDS.find((kind) => kind === parsed?.positionals[0]);
  const targetId = parsed?.positionals[1];
  const approverId = parsed?.values.get("--approver");
  const versionText = parsed?.values.get("--version");
  const version = versionText === undefined ? undefined : Number(versionText);
  const targetHash = parsed?.values.get("--target-hash");
  if (
    parsed === null ||
    parsed.positionals.length !== 2 ||
    dataKind === null ||
    targetKind === undefined ||
    targetId === undefined ||
    approverId === undefined ||
    (version !== undefined && (!Number.isInteger(version) || version < 1)) ||
    // An issue is named by its version, and any other target by the hash of its content.
    (targetKind === "ISSUE" ? version === undefined : version !== undefined || targetHash === undefined)
  ) {
    return argumentInvalid(io);
  }
  const store = storeOf(options, dataKind);
  const now = options.now ?? ((): Date => new Date());
  const target = {
    targetKind,
    targetId,
    ...(version === undefined ? {} : { version }),
    ...(targetHash === undefined ? {} : { targetHash }),
  };

  if (parsed.flags.has("--revoke")) {
    const revoked = await revokeApproval({ store, now }, { ...target, revokerId: approverId });
    if (!revoked.ok) {
      io.write(`code=APPROVE_FAILED reason=${revoked.error.code}`);
      return 1;
    }
    io.write("code=REVOKE_OK");
    return 0;
  }

  let issueChecks: IssueConfirmation | undefined;
  if (targetKind === "ISSUE") {
    issueChecks = (await confirmIssue(io)) ?? undefined;
    if (issueChecks === undefined) {
      // Not every confirmation was a yes (or there is no one to ask): nothing is written.
      io.write("code=APPROVE_CANCELLED");
      return 1;
    }
  }
  const approved = await approveTarget({ store, now }, { ...target, approverId, ...(issueChecks === undefined ? {} : { issueChecks }) });
  if (!approved.ok) {
    io.write(`code=APPROVE_FAILED reason=${approved.error.code}`);
    return 1;
  }
  io.write("code=APPROVE_OK");
  return 0;
}

/** Runs `draft ...` or `approve ...`. Returns the exit code: 0 on success, 1 for anything else. */
export async function runDraftCommand(argv: readonly string[], options: DraftCommandOptions): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "approve") {
    return approve(rest, options);
  }
  const [subcommand, ...args] = rest;
  switch (subcommand) {
    case "run":
      return draftRun(args, options);
    case "list":
      return draftList(args, options);
    case "review":
      return draftReview(args, options);
    case "counts":
      return draftCounts(args, options);
    default:
      return usage(options.io);
  }
}
