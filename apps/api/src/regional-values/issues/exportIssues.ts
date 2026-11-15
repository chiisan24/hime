import { createHash } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { ISSUES_SCHEMA_VERSION, IssuesExportReportSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { DataKind, IssuesExportReport, Sha256 } from "@ehime-vote-navigator/contracts";
import { encodePortableCanonicalJson } from "@ehime-vote-navigator/domain";

import { atomicReplaceFile } from "../../store/atomicReplaceFile.js";
import { buildIssuesFile, serializeIssuesFile, verifyIssuesText } from "./issuesFile.js";
import { loadIssueSnapshot } from "./loadIssueSnapshot.js";
import type { IssueSettings, IssueSnapshot, LoadIssueSnapshotError } from "./loadIssueSnapshot.js";
import type { IssueInputs } from "./inputs.js";

/**
 * The output of `issues export` and the state record that makes a stale or failed output
 * unusable (Req 13.1, 13.3, 13.4, design: 出力の手順、失敗時の扱い).
 *
 * The rule: `issues.json` is a valid output only when the state record next to it says SUCCESS for
 * the SHA-256 of that very file. The state record is written RUNNING first, the old file is
 * deleted, and SUCCESS is written last. So a run that fails, a run that stops, a file that could
 * not be deleted and a write of SUCCESS that did not happen all leave a state that is not SUCCESS,
 * and the old file is not taken for a valid output. It fails on the closed side.
 */

export const ISSUES_FILE_NAME = "issues.json";
export const ISSUES_STATE_FILE_NAME = "issues-export-report.json";

/** The directory of the output of a data kind, relative to the workspace root. It is not the directory of a build. */
export function issuesOutputDirectory(dataKind: DataKind): string {
  return `dist/regional-values/issues/${dataKind === "REAL_AI" ? "real" : "fixture"}`;
}

/** The file operations. A test replaces them to make a delete or a write fail. */
export type ExportFileOperations = Readonly<{
  /** The bytes of a file, or `null` when it is not there. */
  read: (absolutePath: string) => Promise<Uint8Array | null>;
  /** Writes a whole file in one step (the old bytes or the new bytes are seen, never half). */
  replace: (workspaceRoot: string, relativePath: string, bytes: Uint8Array) => Promise<void>;
  /** Removes a file. A file that is not there is not an error. */
  remove: (absolutePath: string) => Promise<void>;
}>;

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export const DEFAULT_EXPORT_OPERATIONS: ExportFileOperations = {
  async read(absolutePath) {
    try {
      return new Uint8Array(await readFile(absolutePath));
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  },
  async replace(workspaceRoot, relativePath, bytes) {
    await atomicReplaceFile({ allowedRoot: workspaceRoot, relativePath, bytes });
  },
  async remove(absolutePath) {
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile() && !stats.isSymbolicLink()) {
        throw new Error("Not a file");
      }
      await unlink(absolutePath);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
    }
  },
};

export function sha256OfBytes(bytes: Uint8Array): Sha256 {
  return Sha256Schema.parse(createHash("sha256").update(bytes).digest("hex"));
}

export type OutputPlace = Readonly<{ workspaceRoot: string; dataKind: DataKind }>;

function outputPaths(place: OutputPlace): Readonly<{ filePath: string; statePath: string; fileRelative: string; stateRelative: string }> {
  const directory = issuesOutputDirectory(place.dataKind);
  return {
    fileRelative: `${directory}/${ISSUES_FILE_NAME}`,
    stateRelative: `${directory}/${ISSUES_STATE_FILE_NAME}`,
    filePath: join(place.workspaceRoot, ...directory.split("/"), ISSUES_FILE_NAME),
    statePath: join(place.workspaceRoot, ...directory.split("/"), ISSUES_STATE_FILE_NAME),
  };
}

/** The state record, or `null` when it is not there, cannot be read, or is not a state record of this data kind. */
async function readState(place: OutputPlace, operations: ExportFileOperations): Promise<IssuesExportReport | null> {
  try {
    const bytes = await operations.read(outputPaths(place).statePath);
    if (bytes === null) {
      return null;
    }
    const parsed = IssuesExportReportSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success && parsed.data.dataKind === place.dataKind ? parsed.data : null;
  } catch {
    return null;
  }
}

type LastSuccess = NonNullable<IssuesExportReport["lastSuccess"]>;

function lastSuccessOf(state: IssuesExportReport | null): LastSuccess | null {
  if (state === null) {
    return null;
  }
  if (state.status === "SUCCESS" && state.output !== null) {
    const { fileSha256, contentHash, inputDigest, generatedAt } = state.output;
    return { fileSha256, contentHash, inputDigest, generatedAt };
  }
  return state.lastSuccess;
}

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

export type ExportFailureCode =
  | "EXPORT_STATE_NOT_RECORDED"
  | "EXPORT_STATE_NOT_FINALIZED"
  | NonNullable<IssuesExportReport["failureCode"]>;

export type ExportRequest = Readonly<{
  workspaceRoot: string;
  dataKind: DataKind;
  /** `meta.generatedAt` of the file. A test and the option `--generated-at` fix it. */
  generatedAt: string;
}>;

export type ExportDependencies = Readonly<{
  /** The clock for the start and the end of a run in the state record. */
  now: () => string;
  inputs: IssueInputs;
  /**
   * The settings of the judgment, read when the run needs them (step 4), so that settings that cannot
   * be read fail the run after the old output was made invalid, like any other failure. `null`: they
   * cannot be used.
   */
  settings: () => Promise<IssueSettings | null>;
  operations?: ExportFileOperations;
}>;

export type ExportOutcome =
  | Readonly<{ ok: true; report: IssuesExportReport; issueCount: number; withdrawnCount: number }>
  | Readonly<{ ok: false; code: ExportFailureCode }>;

function failureCodeOfLoad(error: LoadIssueSnapshotError): NonNullable<IssuesExportReport["failureCode"]> {
  if (error.code === "DATA_KIND_MIXED") {
    return "DATA_KIND_MIXED";
  }
  return error.code === "CONTRACT_INVALID" ? "CONTRACT_INVALID" : "INPUT_UNREADABLE";
}

/** What an old `issues.json` is, for the record of what this run made invalid. */
function describeOldFile(bytes: Uint8Array): NonNullable<IssuesExportReport["invalidated"]> {
  const fileSha256 = sha256OfBytes(bytes);
  let contentHash: Sha256 = fileSha256;
  try {
    const hash = (JSON.parse(new TextDecoder().decode(bytes)) as { meta?: { contentHash?: unknown } }).meta?.contentHash;
    const parsed = Sha256Schema.safeParse(hash);
    if (parsed.success) {
      contentHash = parsed.data;
    }
  } catch {
    // A file that is not JSON has no content hash of its own: the hash of the file stands for it.
  }
  return { fileSha256, contentHash, deleted: false };
}

/**
 * Writes `issues.json` of the issues that are valid now, with the procedure of the state record.
 *
 *  1. Read the state record, and keep the last output that succeeded (`lastSuccess`).
 *  2. Write the state record RUNNING. If that cannot be written, nothing is changed and the run
 *     stops with `EXPORT_STATE_NOT_RECORDED`.
 *  3. Delete the old `issues.json`. If that fails, the state record becomes FAILED (`DELETE_FAILED`).
 *  4. Compute the issues and check the file with the contract. A failure is FAILED, and the input
 *     digest is kept if it could be computed.
 *  5. Write `issues.json` only when it is valid. A failure is FAILED (`WRITE_FAILED`).
 *  6. Write the state record SUCCESS. If that cannot be written, the state record stays RUNNING, so
 *     the file that was just written is not taken for a valid output either (`EXPORT_STATE_NOT_FINALIZED`).
 *
 * It does not call the build, and the build does not call it. It prints nothing: the caller prints
 * a fixed code.
 */
export async function runIssuesExport(request: ExportRequest, dependencies: ExportDependencies): Promise<ExportOutcome> {
  const operations = dependencies.operations ?? DEFAULT_EXPORT_OPERATIONS;
  const { workspaceRoot, dataKind } = request;
  const paths = outputPaths(request);
  const startedAt = dependencies.now();

  const previous = await readState(request, operations);
  const lastSuccess = lastSuccessOf(previous);

  let oldBytes: Uint8Array | null;
  try {
    oldBytes = await operations.read(paths.filePath);
  } catch {
    oldBytes = null;
  }
  let invalidated = oldBytes === null ? null : describeOldFile(oldBytes);

  const base = { schemaVersion: 1 as const, kind: "ISSUES_EXPORT_REPORT" as const, dataKind, startedAt };
  // The clock gives a string; the contract checks that it is a time (an invalid one fails the write).
  const record = async (report: Readonly<Record<string, unknown>>): Promise<boolean> => {
    try {
      const checked = IssuesExportReportSchema.parse({ ...base, ...report });
      await operations.replace(workspaceRoot, paths.stateRelative, encodePortableCanonicalJson(checked));
      return true;
    } catch {
      return false;
    }
  };
  const failed = async (
    code: NonNullable<IssuesExportReport["failureCode"]>,
    inputDigest: Sha256 | null,
  ): Promise<ExportOutcome> => {
    // If this cannot be written either, the state record stays RUNNING: it is still not SUCCESS.
    await record({
      status: "FAILED",
      finishedAt: dependencies.now(),
      exitCode: 1,
      failureCode: code,
      inputDigest,
      invalidated,
      output: null,
      lastSuccess,
    });
    return { ok: false, code };
  };

  // Step 2.
  const recorded = await record({
    status: "RUNNING",
    finishedAt: null,
    exitCode: null,
    failureCode: null,
    inputDigest: null,
    invalidated,
    output: null,
    lastSuccess,
  });
  if (!recorded) {
    return { ok: false, code: "EXPORT_STATE_NOT_RECORDED" };
  }

  // Step 3.
  try {
    await operations.remove(paths.filePath);
    if (invalidated !== null) {
      invalidated = { ...invalidated, deleted: true };
    }
  } catch {
    return failed("DELETE_FAILED", null);
  }

  // Step 4.
  const settings = await dependencies.settings();
  if (settings === null) {
    return failed("INPUT_UNREADABLE", null);
  }
  const loaded = await loadIssueSnapshot(dependencies.inputs, settings);
  if (!loaded.ok) {
    return failed(failureCodeOfLoad(loaded.error), null);
  }
  const snapshot: IssueSnapshot = loaded.value;
  if (snapshot.issues.some((issue) => issue.dataKind !== dataKind)) {
    return failed("DATA_KIND_MIXED", snapshot.inputDigest);
  }
  const file = await buildIssuesFile({ snapshot, dataKind, generatedAt: request.generatedAt });
  if (!file.ok) {
    return failed("CONTRACT_INVALID", snapshot.inputDigest);
  }

  // Step 5.
  const bytes = serializeIssuesFile(file.value);
  try {
    await operations.replace(workspaceRoot, paths.fileRelative, bytes);
  } catch {
    return failed("WRITE_FAILED", snapshot.inputDigest);
  }

  // Step 6.
  const output = {
    fileSha256: sha256OfBytes(bytes),
    contentHash: file.value.meta.contentHash,
    inputDigest: file.value.meta.inputDigest,
    generatedAt: file.value.meta.generatedAt,
    issuesSchemaVersion: ISSUES_SCHEMA_VERSION,
    issueCount: file.value.issues.length,
    withdrawnCount: file.value.withdrawn.length,
  };
  const finishedAt = dependencies.now();
  const report = {
    ...base,
    status: "SUCCESS" as const,
    finishedAt,
    exitCode: 0 as const,
    failureCode: null,
    inputDigest: snapshot.inputDigest,
    invalidated,
    output,
    lastSuccess: {
      fileSha256: output.fileSha256,
      contentHash: output.contentHash,
      inputDigest: output.inputDigest,
      generatedAt: output.generatedAt,
    },
  };
  try {
    const checked = IssuesExportReportSchema.parse(report);
    await operations.replace(workspaceRoot, paths.stateRelative, encodePortableCanonicalJson(checked));
    return { ok: true, report: checked, issueCount: output.issueCount, withdrawnCount: output.withdrawnCount };
  } catch {
    return { ok: false, code: "EXPORT_STATE_NOT_FINALIZED" };
  }
}

// ---------------------------------------------------------------------------
// Whether an output may be used
// ---------------------------------------------------------------------------

export const OUTPUT_STATUSES = ["OK", "STALE", "INVALIDATED", "CONTRACT_INVALID"] as const;

export type OutputStatus = (typeof OUTPUT_STATUSES)[number];

export type OutputVerification = Readonly<{
  status: OutputStatus;
  /** The state record, if it could be read. */
  state: IssuesExportReport | null;
}>;

/**
 * Whether the output of a data kind may be used (design: 読む側の判定). `issues.json` is not valid
 * because it exists: the state record must say SUCCESS for its SHA-256. In this order: the state
 * record, the SHA-256 of the file, the contract and its version and the content hash, the `meta`
 * against the state record, and, when the digest of the input as it is now is given, the input.
 * The first check that is not met is the result. It reads only the two files.
 */
export async function verifyOutput(
  place: OutputPlace,
  options: Readonly<{ currentInputDigest?: Sha256; operations?: ExportFileOperations }> = {},
): Promise<OutputVerification> {
  const operations = options.operations ?? DEFAULT_EXPORT_OPERATIONS;
  const paths = outputPaths(place);
  const state = await readState(place, operations);
  const invalid = (status: OutputStatus): OutputVerification => ({ status, state });
  if (state === null || state.status !== "SUCCESS" || state.output === null) {
    return invalid("INVALIDATED");
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await operations.read(paths.filePath);
  } catch {
    bytes = null;
  }
  if (bytes === null || sha256OfBytes(bytes) !== state.output.fileSha256) {
    return invalid("INVALIDATED");
  }
  const verified = await verifyIssuesText(new TextDecoder().decode(bytes));
  if (!verified.ok) {
    return invalid("CONTRACT_INVALID");
  }
  const { meta } = verified.file;
  if (
    meta.contentHash !== state.output.contentHash ||
    meta.inputDigest !== state.output.inputDigest ||
    meta.schemaVersion !== state.output.issuesSchemaVersion ||
    meta.dataKind !== place.dataKind
  ) {
    return invalid("INVALIDATED");
  }
  if (options.currentInputDigest !== undefined && options.currentInputDigest !== meta.inputDigest) {
    return invalid("STALE");
  }
  return { status: "OK", state };
}
