import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ISOInstantSchema } from "@ehime-vote-navigator/contracts";
import type { DataKind, Sha256 } from "@ehime-vote-navigator/contracts";

import { loadBuildConfig, loadNeutralityConfig } from "./build/loadConfig.js";
import type { IssueSource } from "./build/runBuild.js";
import type { RegionalValuesCliIo } from "./cli.js";
import { defaultRecordRoot } from "./draft/types.js";
import type { RecordRoot } from "./draft/types.js";
import { DraftRunSettingsSchema, parseArgs } from "./draftCli.js";
import type { Parsed } from "./draftCli.js";
import { DEFAULT_EXPORT_OPERATIONS, runIssuesExport, sha256OfBytes, verifyOutput } from "./issues/exportIssues.js";
import type { ExportFileOperations, OutputPlace } from "./issues/exportIssues.js";
import { createFileIssueInputs } from "./issues/inputs.js";
import type { IssueInputs } from "./issues/inputs.js";
import { verifyIssuesText } from "./issues/issuesFile.js";
import { loadIssueSnapshot } from "./issues/loadIssueSnapshot.js";
import type { IssueSettings } from "./issues/loadIssueSnapshot.js";
import { checkAgainstReceipts, createReceipt, readReceipts, RECEIPT_DIRECTORY } from "./issues/receipt.js";

/**
 * The commands for the issues that a person approved: `issues export|list|verify|receipt`
 * (`npm run regional-values -- issues ...`). Like the build, it prints only fixed codes, IDs and
 * counts: never a text of an issue, a fact or a source (Req 13.1).
 *
 * `issues export` and `issues list` are not a check that the output may be used: the standard
 * output of the export is a code, and a code of success is not a statement that a file is current.
 * What decides whether a file may be used is `issues verify` (design D33).
 *
 * The commands read files and write the output and the receipts only. They call no AI, open no port
 * and do not fetch.
 */

export type IssuesCommandSeams = Readonly<{
  /** The directory of the records of a data kind. A test gives a temporary directory. */
  recordRoot?: (dataKind: DataKind) => RecordRoot;
  /** The fact items, the sources and the originals of a record root. A test gives its own. */
  inputs?: (root: RecordRoot) => IssueInputs;
  /** Reads a file of the settings. */
  readTextFile?: (path: string) => Promise<string>;
  /** Reads the bytes of a file that was received (`verify --file`). */
  readBytes?: (path: string) => Promise<Uint8Array>;
  /** The directory of the receipts (an absolute path). The default is the one of the repository. */
  receiptDirectory?: string;
  /** The file operations of the output. A test makes a delete or a write fail. */
  operations?: ExportFileOperations;
}>;

export type IssuesCommandOptions = Readonly<{
  io: RegionalValuesCliIo;
  workspaceRoot: string;
  now?: () => Date;
  issues?: IssuesCommandSeams;
}>;

export const ISSUES_USAGE_LINES: readonly string[] = [
  "Usage: npm run regional-values -- issues export --data-mode FIXTURE|REAL --draft-settings <settings.json> [--generated-at <ISO>] [--config-dir <path>]",
  "       npm run regional-values -- issues list --data-mode FIXTURE|REAL --draft-settings <settings.json> [--config-dir <path>]",
  "       npm run regional-values -- issues verify --output --data-mode FIXTURE|REAL [--current --draft-settings <settings.json> [--config-dir <path>]]",
  "       npm run regional-values -- issues verify --file <issues.json>",
  "       npm run regional-values -- issues receipt --data-mode REAL --draft-settings <settings.json> [--config-dir <path>]",
  "         --delivered-by <id> --received-by <id> --received-at <ISO> --received-sha256 <SHA-256>",
];

function usage(io: RegionalValuesCliIo): number {
  for (const line of ISSUES_USAGE_LINES) {
    io.write(line);
  }
  io.write("code=USAGE");
  return 1;
}

function argumentInvalid(io: RegionalValuesCliIo): number {
  io.write("code=ARGUMENT_INVALID");
  return 1;
}

/** The data kind of `--data-mode FIXTURE|REAL`. `REAL_PREFERRED` is not a mode of this command: switching is a feature of the build. */
function dataKindOf(parsed: Parsed): DataKind | null {
  const mode = parsed.values.get("--data-mode");
  return mode === "FIXTURE" ? "FIXTURE" : mode === "REAL" ? "REAL_AI" : null;
}

/** What reading the settings and the records needs of the options: the commands and the build both give it. */
export type IssueReadContext = Pick<IssuesCommandOptions, "workspaceRoot" | "issues">;

function seamsOf(options: IssueReadContext): IssuesCommandSeams {
  return options.issues ?? {};
}

function recordRootOf(options: IssueReadContext, dataKind: DataKind): RecordRoot {
  return seamsOf(options).recordRoot?.(dataKind) ?? defaultRecordRoot(options.workspaceRoot, dataKind);
}

function inputsOf(options: IssueReadContext, root: RecordRoot): IssueInputs {
  return seamsOf(options).inputs?.(root) ?? createFileIssueInputs(root);
}

function placeOf(options: IssuesCommandOptions, dataKind: DataKind): OutputPlace {
  return { workspaceRoot: options.workspaceRoot, dataKind };
}

function receiptDirectoryOf(options: IssuesCommandOptions): string {
  return seamsOf(options).receiptDirectory ?? join(options.workspaceRoot, ...RECEIPT_DIRECTORY.split("/"));
}

async function readJson(options: IssueReadContext, path: string): Promise<unknown> {
  try {
    const read = seamsOf(options).readTextFile ?? ((file: string) => readFile(file, "utf8"));
    return JSON.parse(await read(resolve(options.workspaceRoot, path)));
  } catch {
    return undefined;
  }
}

/**
 * The settings of the judgment: the number of approvers (`build.json`), the checks (`neutrality.json`)
 * and the lists of words and the six themes (the settings file of the draft process, which a person
 * gives until 13.1 makes the real one). `null` when they cannot be used.
 */
export async function loadIssueSettings(
  options: IssueReadContext,
  settingsPath: string | undefined,
  configDirectory: string,
): Promise<IssueSettings | null> {
  if (settingsPath === undefined) {
    return null;
  }
  const settings = DraftRunSettingsSchema.safeParse(await readJson(options, settingsPath));
  const configDir = resolve(options.workspaceRoot, configDirectory);
  const neutrality = await loadNeutralityConfig(configDir);
  const build = await loadBuildConfig(configDir);
  if (!settings.success || !neutrality.ok || !build.ok) {
    return null;
  }
  return {
    requiredApprovers: build.value.requiredApprovers,
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
    themes: settings.data.themes,
  };
}

/** The settings that the arguments of a command name. */
function loadSettings(options: IssuesCommandOptions, parsed: Parsed): Promise<IssueSettings | null> {
  return loadIssueSettings(options, parsed.values.get("--draft-settings"), parsed.values.get("--config-dir") ?? join("config", "regional-values"));
}

/**
 * The source of the issues for the build: the judgment of `loadIssueSnapshot` on the records of the data
 * kind, with the settings that were read. The build does not read the file `issues.json`.
 */
export function createIssueSource(options: IssueReadContext, settings: IssueSettings): IssueSource {
  return async ({ dataKind }) => {
    const root = recordRootOf(options, dataKind);
    const loaded = await loadIssueSnapshot(inputsOf(options, root), settings);
    return loaded.ok ? loaded.value : null;
  };
}

const COMMON_VALUES = ["--data-mode", "--draft-settings", "--config-dir"] as const;

// ---------------------------------------------------------------------------
// issues export
// ---------------------------------------------------------------------------

async function issuesExport(args: readonly string[], options: IssuesCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, [...COMMON_VALUES, "--generated-at"], []);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  const now = options.now ?? ((): Date => new Date());
  const generatedAt = parsed?.values.get("--generated-at") ?? now().toISOString();
  if (
    parsed === null ||
    parsed.positionals.length > 0 ||
    dataKind === null ||
    !parsed.values.has("--draft-settings") ||
    !ISOInstantSchema.safeParse(generatedAt).success
  ) {
    return argumentInvalid(io);
  }
  const operations = seamsOf(options).operations;
  const outcome = await runIssuesExport(
    { workspaceRoot: options.workspaceRoot, dataKind, generatedAt },
    {
      now: () => now().toISOString(),
      inputs: inputsOf(options, recordRootOf(options, dataKind)),
      settings: () => loadSettings(options, parsed),
      ...(operations === undefined ? {} : { operations }),
    },
  );
  if (outcome.ok) {
    io.write(`code=EXPORT_OK issues=${outcome.issueCount} withdrawn=${outcome.withdrawnCount}`);
    return 0;
  }
  if (outcome.code === "EXPORT_STATE_NOT_RECORDED" || outcome.code === "EXPORT_STATE_NOT_FINALIZED") {
    io.write(`code=${outcome.code}`);
  } else {
    io.write(`code=EXPORT_FAILED reason=${outcome.code}`);
  }
  return 1;
}

// ---------------------------------------------------------------------------
// issues list
// ---------------------------------------------------------------------------

async function issuesList(args: readonly string[], options: IssuesCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, [...COMMON_VALUES], []);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  if (parsed === null || parsed.positionals.length > 0 || dataKind === null || !parsed.values.has("--draft-settings")) {
    return argumentInvalid(io);
  }
  const settings = await loadSettings(options, parsed);
  if (settings === null) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }
  const loaded = await loadIssueSnapshot(inputsOf(options, recordRootOf(options, dataKind)), settings);
  if (!loaded.ok) {
    io.write(`code=LIST_FAILED reason=${loaded.error.code}`);
    return 1;
  }
  const { issues, withdrawn, inputDigest, reasons } = loaded.value;
  const operations = seamsOf(options).operations ?? DEFAULT_EXPORT_OPERATIONS;

  // The state of the output comes first. The file `issues.json` is not read for the list below:
  // the list is what the input says now.
  const verification = await verifyOutput(placeOf(options, dataKind), { currentInputDigest: inputDigest, operations });
  const none = verification.state === null && verification.status === "INVALIDATED" && (await outputFileIsAbsent(options, dataKind, operations));
  io.write(`output=${none ? "NONE" : verification.status}`);
  const last = verification.state?.lastSuccess ?? null;
  if (last !== null) {
    io.write(`lastSuccess generatedAt=${last.generatedAt} inputDigest=${last.inputDigest}`);
  }
  for (const issue of issues) {
    io.write(`issue=${issue.issueId} version=${issue.version} theme=${issue.themeId} approvers=${issue.approval.approverCount}`);
  }
  for (const item of withdrawn) {
    io.write(`withdrawn=${item.issueId} version=${item.version} reasons=${(reasons.get(item.issueId) ?? [item.reason]).join(",")}`);
  }
  io.write(`code=LIST_OK issues=${issues.length} withdrawn=${withdrawn.length}`);
  return 0;
}

async function outputFileIsAbsent(options: IssuesCommandOptions, dataKind: DataKind, operations: ExportFileOperations): Promise<boolean> {
  const directory = dataKind === "REAL_AI" ? "real" : "fixture";
  try {
    return (await operations.read(join(options.workspaceRoot, "dist", "regional-values", "issues", directory, "issues.json"))) === null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// issues verify
// ---------------------------------------------------------------------------

async function verifyOutputCommand(parsed: Parsed, options: IssuesCommandOptions): Promise<number> {
  const { io } = options;
  const dataKind = dataKindOf(parsed);
  if (dataKind === null || parsed.positionals.length > 0 || parsed.values.has("--file")) {
    return argumentInvalid(io);
  }
  const operations = seamsOf(options).operations ?? DEFAULT_EXPORT_OPERATIONS;
  let currentInputDigest: Sha256 | undefined;
  if (parsed.flags.has("--current")) {
    const settings = await loadSettings(options, parsed);
    if (settings === null) {
      io.write("code=CONFIG_UNREADABLE");
      return 1;
    }
    const loaded = await loadIssueSnapshot(inputsOf(options, recordRootOf(options, dataKind)), settings);
    if (!loaded.ok) {
      io.write(`code=VERIFY_FAILED status=INPUT_UNREADABLE reason=${loaded.error.code}`);
      return 1;
    }
    currentInputDigest = loaded.value.inputDigest;
  }
  const result = await verifyOutput(placeOf(options, dataKind), { ...(currentInputDigest === undefined ? {} : { currentInputDigest }), operations });
  if (result.status === "OK") {
    io.write(`code=VERIFY_OK current=${String(currentInputDigest !== undefined)}`);
    return 0;
  }
  io.write(`code=VERIFY_FAILED status=${result.status}`);
  return 1;
}

async function verifyFileCommand(parsed: Parsed, options: IssuesCommandOptions): Promise<number> {
  const { io } = options;
  const path = parsed.values.get("--file");
  if (path === undefined || parsed.positionals.length > 0 || parsed.values.has("--data-mode")) {
    return argumentInvalid(io);
  }
  let bytes: Uint8Array;
  try {
    const read = seamsOf(options).readBytes ?? ((file: string) => readFile(file).then((buffer) => new Uint8Array(buffer)));
    bytes = await read(resolve(options.workspaceRoot, path));
  } catch {
    io.write("code=VERIFY_FAILED status=FILE_UNREADABLE");
    return 1;
  }
  // The SHA-256 of the whole file is shown first: the person who has the file tells it to the person who writes the receipt.
  const fileSha256 = sha256OfBytes(bytes);
  io.write(`fileSha256=${fileSha256}`);
  const verified = await verifyIssuesText(new TextDecoder().decode(bytes));
  if (!verified.ok) {
    io.write(`code=VERIFY_FAILED status=${verified.code} detail=${verified.detail}`);
    return 1;
  }
  const { meta } = verified.file;
  if (meta.dataKind === "FIXTURE") {
    // The sample of fictional data is passed in Git, so it needs no receipt.
    io.write("code=VERIFY_OK dataKind=FIXTURE");
    return 0;
  }
  const checked = checkAgainstReceipts(
    {
      fileSha256,
      contentHash: meta.contentHash,
      inputDigest: meta.inputDigest,
      generatedAt: meta.generatedAt,
      issuesSchemaVersion: meta.schemaVersion,
    },
    await readReceipts(receiptDirectoryOf(options)),
  );
  if (checked.status !== "OK") {
    io.write(`code=VERIFY_FAILED status=${checked.status}`);
    return 1;
  }
  io.write("code=VERIFY_OK dataKind=REAL_AI");
  return 0;
}

async function issuesVerify(args: readonly string[], options: IssuesCommandOptions): Promise<number> {
  const parsed = parseArgs(args, [...COMMON_VALUES, "--file"], ["--output", "--current"]);
  if (parsed === null) {
    return argumentInvalid(options.io);
  }
  const output = parsed.flags.has("--output");
  const file = parsed.values.has("--file");
  if (output === file || (parsed.flags.has("--current") && !output)) {
    return argumentInvalid(options.io);
  }
  return output ? verifyOutputCommand(parsed, options) : verifyFileCommand(parsed, options);
}

// ---------------------------------------------------------------------------
// issues receipt
// ---------------------------------------------------------------------------

async function issuesReceipt(args: readonly string[], options: IssuesCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, [...COMMON_VALUES, "--delivered-by", "--received-by", "--received-at", "--received-sha256"], []);
  const dataKind = parsed === null ? null : dataKindOf(parsed);
  const deliveredBy = parsed?.values.get("--delivered-by");
  const receivedBy = parsed?.values.get("--received-by");
  const receivedAt = parsed?.values.get("--received-at");
  const receivedSha256 = parsed?.values.get("--received-sha256");
  if (
    parsed === null ||
    parsed.positionals.length > 0 ||
    dataKind === null ||
    deliveredBy === undefined ||
    receivedBy === undefined ||
    receivedAt === undefined ||
    receivedSha256 === undefined ||
    !parsed.values.has("--draft-settings")
  ) {
    return argumentInvalid(io);
  }
  if (dataKind !== "REAL_AI") {
    // The sample of fictional data is in Git, and has no receipt.
    io.write("code=RECEIPT_REFUSED reason=DATA_KIND_NOT_ALLOWED");
    return 1;
  }
  const settings = await loadSettings(options, parsed);
  if (settings === null) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }
  const loaded = await loadIssueSnapshot(inputsOf(options, recordRootOf(options, dataKind)), settings);
  if (!loaded.ok) {
    io.write(`code=RECEIPT_REFUSED reason=INPUT_UNREADABLE`);
    return 1;
  }
  const operations = seamsOf(options).operations;
  const outcome = await createReceipt(
    placeOf(options, dataKind),
    { deliveredBy, receivedBy, receivedAt, receivedSha256 },
    { currentInputDigest: loaded.value.inputDigest, receiptDirectory: receiptDirectoryOf(options), ...(operations === undefined ? {} : { operations }) },
  );
  if (!outcome.ok) {
    io.write(`code=RECEIPT_REFUSED reason=${outcome.error.code}${outcome.error.outputStatus === undefined ? "" : ` status=${outcome.error.outputStatus}`}`);
    return 1;
  }
  io.write(`code=RECEIPT_OK state=${outcome.value.state}`);
  return 0;
}

/** Runs `issues ...`. Returns the exit code: 0 on success, 1 for anything else. */
export async function runIssuesCommand(argv: readonly string[], options: IssuesCommandOptions): Promise<number> {
  const [, subcommand, ...args] = argv;
  switch (subcommand) {
    case "export":
      return issuesExport(args, options);
    case "list":
      return issuesList(args, options);
    case "verify":
      return issuesVerify(args, options);
    case "receipt":
      return issuesReceipt(args, options);
    default:
      return usage(options.io);
  }
}
