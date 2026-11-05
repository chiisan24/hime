import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import {
  RunEventAppendSchema,
  RunEventSchema,
  type AnalysisRun,
  type RunEvent,
  type RunEventAppend,
  type Sha256,
} from "@ehime-vote-navigator/contracts";
import {
  createRunEvent,
  encodeCanonicalJson,
  foldRunEvents,
  redactProtectedValues,
  sha256Hex,
  type RunEventFoldIssueCode,
} from "@ehime-vote-navigator/domain";
import { z } from "zod";

import { AtomicFileError, atomicWriteImmutableFile } from "./atomicFiles.js";

const EVENT_DIRECTORY = "events";
const INDEX_DIRECTORY = "indexes";
const APPEND_LOCK_NAME = ".append.lock";
const INDEX_MANIFEST_NAME = "MANIFEST.json";
const INDEX_COMMIT_MARKER_NAME = "COMMITTED.json";
const EVENT_FILE_PATTERN = /^(\d{6})\.json$/u;
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_EVENT_SEQUENCE = 999_999;

export const RUN_EVENT_STORE_ERROR_CODES = [
  "CONCURRENT_APPEND_CONFLICT",
  "EVENT_SEQUENCE_EXHAUSTED",
  "EVENT_STORE_QUARANTINED",
  "FILESYSTEM_ERROR",
  "INDEX_ALREADY_EXISTS",
  "INDEX_COMMIT_FAILED",
  "INDEX_VALIDATION_FAILED",
  "INVALID_APPEND_EVENT",
  "INVALID_INDEX_ID",
  "INVALID_INDEX_INPUT",
  "INVALID_ROOT",
] as const;

export type RunEventStoreErrorCode =
  (typeof RUN_EVENT_STORE_ERROR_CODES)[number];

const STORE_ERROR_MESSAGES: Readonly<Record<RunEventStoreErrorCode, string>> =
  Object.freeze({
    CONCURRENT_APPEND_CONFLICT:
      "Another append is already in progress for this run.",
    EVENT_SEQUENCE_EXHAUSTED: "The run event sequence limit was reached.",
    EVENT_STORE_QUARANTINED:
      "The run event store has integrity issues and was not changed.",
    FILESYSTEM_ERROR: "The run event filesystem operation failed safely.",
    INDEX_ALREADY_EXISTS:
      "An immutable index with this identifier already exists.",
    INDEX_COMMIT_FAILED:
      "The index files exist but the final commit marker was not created.",
    INDEX_VALIDATION_FAILED:
      "The immutable index failed validation and was not committed.",
    INVALID_APPEND_EVENT: "The run event append input is invalid.",
    INVALID_INDEX_ID: "The index identifier is not a safe path segment.",
    INVALID_INDEX_INPUT: "The index file input is invalid.",
    INVALID_ROOT: "The run store root must be an existing safe directory.",
  });

/** A fixed-message failure that never includes local paths or file contents. */
export class RunEventStoreError extends Error {
  readonly code: RunEventStoreErrorCode;

  constructor(code: RunEventStoreErrorCode, cause?: unknown) {
    super(STORE_ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = "RunEventStoreError";
    this.code = code;
  }
}

export const RUN_STORE_DIAGNOSTIC_CODES = [
  "EVENT_FILENAME_MISMATCH",
  "EVENT_JSON_INVALID",
  "EVENT_NON_CANONICAL",
  "FILESYSTEM_ENTRY_UNSAFE",
  "FILESYSTEM_READ_FAILED",
  "INDEX_COMMIT_MARKER_INVALID",
  "INDEX_COMMIT_MARKER_MISSING",
  "INDEX_FILE_HASH_MISMATCH",
  "INDEX_FILE_MISSING",
  "INDEX_MANIFEST_HASH_MISMATCH",
  "INDEX_MANIFEST_INVALID",
  "INDEX_UNEXPECTED_FILE",
  "STALE_APPEND_LOCK",
  "STALE_TEMPORARY",
  "UNEXPECTED_EVENT_ENTRY",
  ...(
    [
      "DUPLICATE_SEQUENCE",
      "EMPTY_EVENT_STREAM",
      "EVENT_HASH_MISMATCH",
      "FIRST_EVENT_NOT_RUN_CREATED",
      "FIRST_EVENT_PREVIOUS_HASH_PRESENT",
      "INVALID_EVENT_SCHEMA",
      "INVALID_RUN_STATE",
      "MULTIPLE_RUN_CREATED",
      "OUT_OF_ORDER_SEQUENCE",
      "PREVIOUS_EVENT_HASH_MISMATCH",
      "RUN_ID_MISMATCH",
      "SEQUENCE_GAP",
    ] as const satisfies readonly RunEventFoldIssueCode[]
  ),
] as const;

export type RunStoreDiagnosticCode =
  (typeof RUN_STORE_DIAGNOSTIC_CODES)[number];

const DIAGNOSTIC_MESSAGES: Readonly<Record<RunStoreDiagnosticCode, string>> =
  Object.freeze({
    DUPLICATE_SEQUENCE: "The run event sequence contains a duplicate number.",
    EMPTY_EVENT_STREAM: "The run event sequence is empty.",
    EVENT_FILENAME_MISMATCH:
      "A run event filename does not match its sequence number.",
    EVENT_HASH_MISMATCH: "A run event content hash is invalid.",
    EVENT_JSON_INVALID: "A run event is not valid UTF-8 JSON.",
    EVENT_NON_CANONICAL: "A run event is not canonical JSON.",
    FILESYSTEM_ENTRY_UNSAFE:
      "A symbolic link or unsupported filesystem entry was found.",
    FILESYSTEM_READ_FAILED: "A store entry could not be read safely.",
    FIRST_EVENT_NOT_RUN_CREATED:
      "The first run event is not a run creation event.",
    FIRST_EVENT_PREVIOUS_HASH_PRESENT:
      "The first run event unexpectedly references an earlier event.",
    INDEX_COMMIT_MARKER_INVALID: "The index commit marker is invalid.",
    INDEX_COMMIT_MARKER_MISSING:
      "The index has no commit marker and was ignored.",
    INDEX_FILE_HASH_MISMATCH: "An index file content hash is invalid.",
    INDEX_FILE_MISSING: "A file listed by the index manifest is missing.",
    INDEX_MANIFEST_HASH_MISMATCH: "The index manifest hash is invalid.",
    INDEX_MANIFEST_INVALID: "The index manifest is invalid.",
    INDEX_UNEXPECTED_FILE: "The index contains an unlisted file.",
    INVALID_EVENT_SCHEMA: "A run event does not match the strict event schema.",
    INVALID_RUN_STATE:
      "The run event sequence does not reconstruct a valid run state.",
    MULTIPLE_RUN_CREATED:
      "The run event sequence contains more than one creation event.",
    OUT_OF_ORDER_SEQUENCE: "The run events are not in sequence order.",
    PREVIOUS_EVENT_HASH_MISMATCH:
      "A run event does not reference the preceding event hash.",
    RUN_ID_MISMATCH: "The run event sequence contains different run IDs.",
    SEQUENCE_GAP: "The run event sequence contains a missing number.",
    STALE_APPEND_LOCK:
      "An unfinished append lock requires operator quarantine review.",
    STALE_TEMPORARY:
      "An unfinished temporary entry requires operator quarantine review.",
    UNEXPECTED_EVENT_ENTRY:
      "The event directory contains an unexpected entry.",
  });

export type RunStoreDiagnostic = Readonly<{
  code: RunStoreDiagnosticCode;
  relativePath: string;
  safeMessage: string;
  sequence: number | null;
}>;

export type QuarantineTarget = Readonly<{
  kind: "DIRECTORY" | "FILE";
  reasonCode: RunStoreDiagnosticCode;
  relativePath: string;
}>;

export type IndexFileInput = Readonly<{
  bytes: Uint8Array;
  expectedContentHash?: string;
  relativePath: string;
}>;

export type CommittedIndexFile = Readonly<{
  bytes: Uint8Array;
  contentHash: Sha256;
  relativePath: string;
}>;

export type IndexReadResult = Readonly<{
  diagnostics: readonly RunStoreDiagnostic[];
  files: readonly CommittedIndexFile[];
  indexId: string;
  manifestHash: Sha256 | null;
  quarantineTargets: readonly QuarantineTarget[];
  status: "COMMITTED" | "IGNORED_UNCOMMITTED" | "MISSING" | "QUARANTINED";
}>;

export type AppendRunEventResult = Readonly<{
  event: RunEvent;
  relativePath: string;
}>;

export type CommitIndexResult = Readonly<{
  indexId: string;
  manifestHash: Sha256;
  relativePath: string;
}>;

export type RunEventStoreInspection = Readonly<{
  diagnostics: readonly RunStoreDiagnostic[];
  events: readonly RunEvent[];
  indexes: readonly IndexReadResult[];
  lastEventHash: Sha256 | null;
  quarantineTargets: readonly QuarantineTarget[];
  run: AnalysisRun | null;
  status: "EMPTY" | "HEALTHY" | "QUARANTINED";
}>;

export type RunEventStore = Readonly<{
  append: (input: RunEventAppend) => Promise<AppendRunEventResult>;
  commitIndex: (
    indexId: string,
    files: readonly IndexFileInput[],
  ) => Promise<CommitIndexResult>;
  inspect: () => Promise<RunEventStoreInspection>;
  readIndex: (indexId: string) => Promise<IndexReadResult>;
}>;

export type CreateRunEventStoreOptions = Readonly<{
  allowedRoot: string;
}>;

type RootContext = Readonly<{
  absoluteRoot: string;
  realRoot: string;
}>;

type EventCandidate = Readonly<{
  parsed: unknown;
  relativePath: string;
}>;

type EventDirectoryInspection = Readonly<{
  diagnostics: readonly RunStoreDiagnostic[];
  events: readonly RunEvent[];
  lastEventHash: Sha256 | null;
  quarantineTargets: readonly QuarantineTarget[];
  run: AnalysisRun | null;
}>;

const IndexManifestFileSchema = z
  .object({
    relativePath: z.string().min(1),
    contentHash: z.string().regex(SHA_256_PATTERN),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

const IndexManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    indexId: z.string().min(1),
    files: z.array(IndexManifestFileSchema).readonly(),
  })
  .strict();

const IndexCommitMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    indexId: z.string().min(1),
    manifestHash: z.string().regex(SHA_256_PATTERN),
    fileCount: z.number().int().nonnegative(),
  })
  .strict();

type IndexManifest = z.infer<typeof IndexManifestSchema>;

function fail(code: RunEventStoreErrorCode, cause?: unknown): never {
  throw new RunEventStoreError(code, cause);
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function safeSegment(value: string): boolean {
  return (
    SAFE_SEGMENT_PATTERN.test(value) &&
    !WINDOWS_RESERVED_NAMES.test(value) &&
    !value.endsWith(".") &&
    !value.endsWith(" ")
  );
}

function parseSafeRelativePath(path: string): readonly string[] {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    path.includes("\0") ||
    isAbsolute(path) ||
    win32.isAbsolute(path)
  ) {
    return fail("INVALID_INDEX_INPUT");
  }

  const segments = path.replaceAll("\\", "/").split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !safeSegment(segment),
    )
  ) {
    return fail("INVALID_INDEX_INPUT");
  }
  return segments;
}

function normalizeIndexFilePath(path: string): string {
  const normalized = parseSafeRelativePath(path).join("/");
  if (
    normalized === INDEX_MANIFEST_NAME ||
    normalized === INDEX_COMMIT_MARKER_NAME
  ) {
    fail("INVALID_INDEX_INPUT");
  }
  return normalized;
}

function validateIndexId(indexId: string): string {
  if (!safeSegment(indexId)) {
    fail("INVALID_INDEX_ID");
  }
  return indexId;
}

async function establishRoot(allowedRoot: string): Promise<RootContext> {
  if (
    allowedRoot.length === 0 ||
    allowedRoot !== allowedRoot.trim() ||
    allowedRoot.includes("\0") ||
    !isAbsolute(allowedRoot) ||
    allowedRoot.replaceAll("\\", "/").split("/").includes("..")
  ) {
    return fail("INVALID_ROOT");
  }

  const absoluteRoot = resolve(allowedRoot);
  try {
    const stats = await lstat(absoluteRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return fail("INVALID_ROOT");
    }
    const realRoot = await realpath(absoluteRoot);
    return Object.freeze({ absoluteRoot, realRoot });
  } catch (error) {
    return fail("INVALID_ROOT", error);
  }
}

async function ensureDirectory(
  root: RootContext,
  segment: string,
): Promise<string> {
  const path = join(root.absoluteRoot, segment);
  try {
    await mkdir(path);
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) {
      return fail("FILESYSTEM_ERROR", error);
    }
  }

  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return fail("FILESYSTEM_ERROR");
    }
    const resolved = await realpath(path);
    if (!isInsideOrEqual(root.realRoot, resolved)) {
      return fail("FILESYSTEM_ERROR");
    }
    return path;
  } catch (error) {
    if (error instanceof RunEventStoreError) {
      throw error;
    }
    return fail("FILESYSTEM_ERROR", error);
  }
}

async function existingDirectory(
  root: RootContext,
  segment: string,
): Promise<string | null> {
  const path = join(root.absoluteRoot, segment);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return null;
    }
    const resolved = await realpath(path);
    return isInsideOrEqual(root.realRoot, resolved) ? path : null;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return null;
    }
    return null;
  }
}

function diagnostic(
  code: RunStoreDiagnosticCode,
  relativePath: string,
  sequence: number | null = null,
): RunStoreDiagnostic {
  return Object.freeze({
    code,
    relativePath,
    safeMessage: DIAGNOSTIC_MESSAGES[code],
    sequence,
  });
}

function quarantineTarget(
  kind: QuarantineTarget["kind"],
  reasonCode: RunStoreDiagnosticCode,
  relativePath: string,
): QuarantineTarget {
  return Object.freeze({ kind, reasonCode, relativePath });
}

function deduplicateTargets(
  targets: readonly QuarantineTarget[],
): readonly QuarantineTarget[] {
  const seen = new Set<string>();
  return Object.freeze(
    targets.filter((target) => {
      const key = `${target.kind}\0${target.reasonCode}\0${target.relativePath}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

function eventFilename(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_EVENT_SEQUENCE) {
    return fail("EVENT_SEQUENCE_EXHAUSTED");
  }
  return `${sequence.toString().padStart(6, "0")}.json`;
}

async function readJson(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

async function inspectEventDirectory(
  root: RootContext,
  ignoreOwnedAppendLock: boolean,
): Promise<EventDirectoryInspection> {
  const eventDirectory = await existingDirectory(root, EVENT_DIRECTORY);
  if (eventDirectory === null) {
    return Object.freeze({
      diagnostics: Object.freeze([]),
      events: Object.freeze([]),
      lastEventHash: null,
      quarantineTargets: Object.freeze([]),
      run: null,
    });
  }

  let entries: Dirent[];
  try {
    entries = await readdir(eventDirectory, { withFileTypes: true });
  } catch {
    const issue = diagnostic("FILESYSTEM_READ_FAILED", EVENT_DIRECTORY);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      events: Object.freeze([]),
      lastEventHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, EVENT_DIRECTORY),
      ]),
      run: null,
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const diagnostics: RunStoreDiagnostic[] = [];
  const targets: QuarantineTarget[] = [];
  const candidates: EventCandidate[] = [];

  for (const entry of entries) {
    const relativePath = `${EVENT_DIRECTORY}/${entry.name}`;
    if (entry.name === APPEND_LOCK_NAME) {
      if (!ignoreOwnedAppendLock) {
        diagnostics.push(diagnostic("STALE_APPEND_LOCK", relativePath));
        targets.push(quarantineTarget("FILE", "STALE_APPEND_LOCK", relativePath));
      }
      continue;
    }

    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
      diagnostics.push(diagnostic("STALE_TEMPORARY", relativePath));
      targets.push(
        quarantineTarget(
          entry.isDirectory() ? "DIRECTORY" : "FILE",
          "STALE_TEMPORARY",
          relativePath,
        ),
      );
      continue;
    }

    if (entry.isSymbolicLink() || !entry.isFile()) {
      diagnostics.push(diagnostic("FILESYSTEM_ENTRY_UNSAFE", relativePath));
      targets.push(
        quarantineTarget(
          entry.isDirectory() ? "DIRECTORY" : "FILE",
          "FILESYSTEM_ENTRY_UNSAFE",
          relativePath,
        ),
      );
      continue;
    }

    if (!entry.name.endsWith(".json")) {
      diagnostics.push(diagnostic("UNEXPECTED_EVENT_ENTRY", relativePath));
      targets.push(
        quarantineTarget("FILE", "UNEXPECTED_EVENT_ENTRY", relativePath),
      );
      continue;
    }

    const absolutePath = join(eventDirectory, entry.name);
    try {
      const bytes = await readFile(absolutePath);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = JSON.parse(text) as unknown;
      candidates.push(Object.freeze({ parsed, relativePath }));

      const strictEvent = RunEventSchema.safeParse(parsed);
      if (
        strictEvent.success &&
        !bytesEqual(bytes, encodeCanonicalJson(strictEvent.data))
      ) {
        diagnostics.push(
          diagnostic(
            "EVENT_NON_CANONICAL",
            relativePath,
            strictEvent.data.sequence,
          ),
        );
        targets.push(
          quarantineTarget("FILE", "EVENT_NON_CANONICAL", relativePath),
        );
      }
    } catch {
      diagnostics.push(diagnostic("EVENT_JSON_INVALID", relativePath));
      targets.push(quarantineTarget("FILE", "EVENT_JSON_INVALID", relativePath));
      candidates.push(Object.freeze({ parsed: null, relativePath }));
    }
  }

  candidates.forEach(({ parsed, relativePath }) => {
    const parsedEvent = RunEventSchema.safeParse(parsed);
    if (!parsedEvent.success) {
      return;
    }
    const filenameMatch = EVENT_FILE_PATTERN.exec(
      relativePath.slice(EVENT_DIRECTORY.length + 1),
    );
    const filenameSequence =
      filenameMatch?.[1] === undefined ? null : Number(filenameMatch[1]);
    if (filenameSequence !== parsedEvent.data.sequence) {
      diagnostics.push(
        diagnostic(
          "EVENT_FILENAME_MISMATCH",
          relativePath,
          parsedEvent.data.sequence,
        ),
      );
      targets.push(
        quarantineTarget("FILE", "EVENT_FILENAME_MISMATCH", relativePath),
      );
    }
  });

  if (candidates.length === 0) {
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      events: Object.freeze([]),
      lastEventHash: null,
      quarantineTargets: deduplicateTargets(targets),
      run: null,
    });
  }

  const folded = foldRunEvents(candidates.map(({ parsed }) => parsed));
  if (!folded.ok) {
    for (const issue of folded.error.issues) {
      const relativePath =
        issue.eventIndex === null
          ? EVENT_DIRECTORY
          : (candidates[issue.eventIndex]?.relativePath ?? EVENT_DIRECTORY);
      diagnostics.push(diagnostic(issue.code, relativePath, issue.sequence));
      targets.push(
        quarantineTarget(
          relativePath === EVENT_DIRECTORY ? "DIRECTORY" : "FILE",
          issue.code,
          relativePath,
        ),
      );
    }

    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      events: Object.freeze([]),
      lastEventHash: null,
      quarantineTargets: deduplicateTargets(targets),
      run: null,
    });
  }

  const strictEvents = candidates.map(({ parsed }) => RunEventSchema.parse(parsed));
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    events: Object.freeze(strictEvents),
    lastEventHash: folded.value.lastEventHash,
    quarantineTargets: deduplicateTargets(targets),
    run: folded.value.run,
  });
}

async function acquireAppendLock(
  eventDirectory: string,
): Promise<Readonly<{ handle: FileHandle; path: string }>> {
  const lockPath = join(eventDirectory, APPEND_LOCK_NAME);
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      return fail("CONCURRENT_APPEND_CONFLICT");
    }
    return fail("FILESYSTEM_ERROR", error);
  }

  try {
    await handle.writeFile(`${randomUUID()}\n`, "utf8");
    await handle.sync();
    return Object.freeze({ handle, path: lockPath });
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // The owned lock is still never interpreted as a committed event.
    }
    try {
      await unlink(lockPath);
    } catch {
      // Startup inspection reports any lock that remains after interruption.
    }
    return fail("FILESYSTEM_ERROR", error);
  }
}

async function releaseAppendLock(lock: {
  handle: FileHandle;
  path: string;
}): Promise<void> {
  try {
    await lock.handle.close();
  } catch {
    // A committed event remains valid; inspection will report a stale lock.
  }
  try {
    await unlink(lock.path);
  } catch {
    // Never remove any other entry while attempting lock cleanup.
  }
}

function prepareIndexFiles(
  files: readonly IndexFileInput[],
): readonly CommittedIndexFile[] {
  const paths = new Set<string>();
  const prepared = files.map((file) => {
    if (!(file.bytes instanceof Uint8Array)) {
      return fail("INVALID_INDEX_INPUT");
    }
    const relativePath = normalizeIndexFilePath(file.relativePath);
    if (paths.has(relativePath)) {
      return fail("INVALID_INDEX_INPUT");
    }
    paths.add(relativePath);

    const bytes = Uint8Array.from(file.bytes);
    const contentHash = sha256Hex(bytes);
    if (
      file.expectedContentHash !== undefined &&
      (!SHA_256_PATTERN.test(file.expectedContentHash) ||
        file.expectedContentHash !== contentHash)
    ) {
      return fail("INVALID_INDEX_INPUT");
    }

    return Object.freeze({ bytes, contentHash, relativePath });
  });

  return Object.freeze(
    prepared.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, "en"),
    ),
  );
}

function createIndexManifest(
  indexId: string,
  files: readonly CommittedIndexFile[],
): IndexManifest {
  return IndexManifestSchema.parse({
    schemaVersion: 1,
    indexId,
    files: files.map((file) => ({
      relativePath: file.relativePath,
      contentHash: file.contentHash,
      byteLength: file.bytes.byteLength,
    })),
  });
}

async function assertPathIsRegularFile(
  root: RootContext,
  path: string,
): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return false;
    }
    const resolved = await realpath(path);
    return isInsideOrEqual(root.realRoot, resolved);
  } catch {
    return false;
  }
}

async function walkIndexFiles(
  root: RootContext,
  directory: string,
  prefix = "",
): Promise<readonly string[] | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const paths: string[] = [];
  for (const entry of entries) {
    const childRelativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      return null;
    }
    if (entry.isDirectory()) {
      const nested = await walkIndexFiles(root, absolutePath, childRelativePath);
      if (nested === null) {
        return null;
      }
      paths.push(...nested);
      continue;
    }
    if (!entry.isFile() || !(await assertPathIsRegularFile(root, absolutePath))) {
      return null;
    }
    paths.push(childRelativePath);
  }
  return Object.freeze(paths);
}

async function readCommittedIndexFromRoot(
  root: RootContext,
  indexIdInput: string,
): Promise<IndexReadResult> {
  const indexId = validateIndexId(indexIdInput);
  const indexesPath = await existingDirectory(root, INDEX_DIRECTORY);
  if (indexesPath === null) {
    return Object.freeze({
      diagnostics: Object.freeze([]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([]),
      status: "MISSING",
    });
  }

  const indexPath = join(indexesPath, indexId);
  try {
    const stats = await lstat(indexPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      const issue = diagnostic(
        "FILESYSTEM_ENTRY_UNSAFE",
        `${INDEX_DIRECTORY}/${indexId}`,
      );
      return Object.freeze({
        diagnostics: Object.freeze([issue]),
        files: Object.freeze([]),
        indexId,
        manifestHash: null,
        quarantineTargets: Object.freeze([
          quarantineTarget("DIRECTORY", issue.code, issue.relativePath),
        ]),
        status: "QUARANTINED",
      });
    }
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return Object.freeze({
        diagnostics: Object.freeze([]),
        files: Object.freeze([]),
        indexId,
        manifestHash: null,
        quarantineTargets: Object.freeze([]),
        status: "MISSING",
      });
    }
    const issue = diagnostic(
      "FILESYSTEM_READ_FAILED",
      `${INDEX_DIRECTORY}/${indexId}`,
    );
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, issue.relativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const indexRelativePath = `${INDEX_DIRECTORY}/${indexId}`;
  const markerPath = join(indexPath, INDEX_COMMIT_MARKER_NAME);
  if (!(await assertPathIsRegularFile(root, markerPath))) {
    const issue = diagnostic("INDEX_COMMIT_MARKER_MISSING", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "IGNORED_UNCOMMITTED",
    });
  }

  let marker: z.infer<typeof IndexCommitMarkerSchema>;
  try {
    const markerBytes = await readFile(markerPath);
    const parsed = IndexCommitMarkerSchema.parse(await readJson(markerPath));
    if (!bytesEqual(markerBytes, encodeCanonicalJson(parsed))) {
      throw new Error("non-canonical marker");
    }
    marker = parsed;
  } catch {
    const issue = diagnostic("INDEX_COMMIT_MARKER_INVALID", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  if (marker.indexId !== indexId) {
    const issue = diagnostic("INDEX_COMMIT_MARKER_INVALID", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const manifestPath = join(indexPath, INDEX_MANIFEST_NAME);
  let manifest: IndexManifest;
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readFile(manifestPath);
    manifest = IndexManifestSchema.parse(await readJson(manifestPath));
    if (!bytesEqual(manifestBytes, encodeCanonicalJson(manifest))) {
      throw new Error("non-canonical manifest");
    }
  } catch {
    const issue = diagnostic("INDEX_MANIFEST_INVALID", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash: null,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const manifestHash = sha256Hex(manifestBytes);
  if (manifest.indexId !== indexId || marker.manifestHash !== manifestHash) {
    const issue = diagnostic("INDEX_MANIFEST_HASH_MISMATCH", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const manifestPaths = manifest.files.map(({ relativePath }) => relativePath);
  const normalizedPaths = new Set<string>();
  try {
    for (const relativePath of manifestPaths) {
      const normalized = normalizeIndexFilePath(relativePath);
      if (normalized !== relativePath || normalizedPaths.has(normalized)) {
        return fail("INDEX_VALIDATION_FAILED");
      }
      normalizedPaths.add(normalized);
    }
  } catch {
    const issue = diagnostic("INDEX_MANIFEST_INVALID", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  if (
    marker.fileCount !== manifest.files.length ||
    manifestPaths.some(
      (path, index) => index > 0 && path.localeCompare(manifestPaths[index - 1]!, "en") <= 0,
    )
  ) {
    const issue = diagnostic("INDEX_MANIFEST_INVALID", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const actualPaths = await walkIndexFiles(root, indexPath);
  if (actualPaths === null) {
    const issue = diagnostic("FILESYSTEM_ENTRY_UNSAFE", indexRelativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash,
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, indexRelativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const expectedPaths = new Set([
    ...manifestPaths,
    INDEX_MANIFEST_NAME,
    INDEX_COMMIT_MARKER_NAME,
  ]);
  const unexpected = actualPaths.find((path) => !expectedPaths.has(path));
  if (unexpected !== undefined) {
    const relativePath = `${indexRelativePath}/${unexpected}`;
    const issue = diagnostic("INDEX_UNEXPECTED_FILE", relativePath);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      files: Object.freeze([]),
      indexId,
      manifestHash,
      quarantineTargets: Object.freeze([
        quarantineTarget("FILE", issue.code, relativePath),
      ]),
      status: "QUARANTINED",
    });
  }

  const committedFiles: CommittedIndexFile[] = [];
  for (const manifestFile of manifest.files) {
    if (!actualPaths.includes(manifestFile.relativePath)) {
      const relativePath = `${indexRelativePath}/${manifestFile.relativePath}`;
      const issue = diagnostic("INDEX_FILE_MISSING", relativePath);
      return Object.freeze({
        diagnostics: Object.freeze([issue]),
        files: Object.freeze([]),
        indexId,
        manifestHash,
        quarantineTargets: Object.freeze([
          quarantineTarget("FILE", issue.code, relativePath),
        ]),
        status: "QUARANTINED",
      });
    }

    const bytes = await readFile(
      join(indexPath, ...manifestFile.relativePath.split("/")),
    );
    if (
      bytes.byteLength !== manifestFile.byteLength ||
      sha256Hex(bytes) !== manifestFile.contentHash
    ) {
      const relativePath = `${indexRelativePath}/${manifestFile.relativePath}`;
      const issue = diagnostic("INDEX_FILE_HASH_MISMATCH", relativePath);
      return Object.freeze({
        diagnostics: Object.freeze([issue]),
        files: Object.freeze([]),
        indexId,
        manifestHash,
        quarantineTargets: Object.freeze([
          quarantineTarget("FILE", issue.code, relativePath),
        ]),
        status: "QUARANTINED",
      });
    }

    committedFiles.push(
      Object.freeze({
        bytes: Uint8Array.from(bytes),
        contentHash: sha256Hex(bytes),
        relativePath: manifestFile.relativePath,
      }),
    );
  }

  return Object.freeze({
    diagnostics: Object.freeze([]),
    files: Object.freeze(committedFiles),
    indexId,
    manifestHash,
    quarantineTargets: Object.freeze([]),
    status: "COMMITTED",
  });
}

async function inspectIndexes(root: RootContext): Promise<Readonly<{
  diagnostics: readonly RunStoreDiagnostic[];
  indexes: readonly IndexReadResult[];
  quarantineTargets: readonly QuarantineTarget[];
}>> {
  const indexesPath = await existingDirectory(root, INDEX_DIRECTORY);
  if (indexesPath === null) {
    return Object.freeze({
      diagnostics: Object.freeze([]),
      indexes: Object.freeze([]),
      quarantineTargets: Object.freeze([]),
    });
  }

  let entries: Dirent[];
  try {
    entries = await readdir(indexesPath, { withFileTypes: true });
  } catch {
    const issue = diagnostic("FILESYSTEM_READ_FAILED", INDEX_DIRECTORY);
    return Object.freeze({
      diagnostics: Object.freeze([issue]),
      indexes: Object.freeze([]),
      quarantineTargets: Object.freeze([
        quarantineTarget("DIRECTORY", issue.code, INDEX_DIRECTORY),
      ]),
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const diagnostics: RunStoreDiagnostic[] = [];
  const targets: QuarantineTarget[] = [];
  const indexes: IndexReadResult[] = [];

  for (const entry of entries) {
    const relativePath = `${INDEX_DIRECTORY}/${entry.name}`;
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) {
      diagnostics.push(diagnostic("STALE_TEMPORARY", relativePath));
      targets.push(
        quarantineTarget(
          entry.isDirectory() ? "DIRECTORY" : "FILE",
          "STALE_TEMPORARY",
          relativePath,
        ),
      );
      continue;
    }

    if (entry.isSymbolicLink() || !entry.isDirectory() || !safeSegment(entry.name)) {
      diagnostics.push(diagnostic("FILESYSTEM_ENTRY_UNSAFE", relativePath));
      targets.push(
        quarantineTarget(
          entry.isDirectory() ? "DIRECTORY" : "FILE",
          "FILESYSTEM_ENTRY_UNSAFE",
          relativePath,
        ),
      );
      continue;
    }

    const index = await readCommittedIndexFromRoot(root, entry.name);
    indexes.push(index);
    diagnostics.push(...index.diagnostics);
    targets.push(...index.quarantineTargets);
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    indexes: Object.freeze(indexes),
    quarantineTargets: deduplicateTargets(targets),
  });
}

async function appendRunEvent(
  root: RootContext,
  inputValue: RunEventAppend,
): Promise<AppendRunEventResult> {
  let redactedInput: unknown;
  try {
    redactedInput = redactProtectedValues(inputValue);
  } catch {
    return fail("INVALID_APPEND_EVENT");
  }

  const parsedInput = RunEventAppendSchema.safeParse(redactedInput);
  if (!parsedInput.success) {
    return fail("INVALID_APPEND_EVENT");
  }

  const eventDirectory = await ensureDirectory(root, EVENT_DIRECTORY);
  const lock = await acquireAppendLock(eventDirectory);
  try {
    const current = await inspectEventDirectory(root, true);
    if (current.diagnostics.length > 0) {
      return fail("EVENT_STORE_QUARANTINED");
    }

    const sequence = current.events.length + 1;
    if (sequence > MAX_EVENT_SEQUENCE) {
      return fail("EVENT_SEQUENCE_EXHAUSTED");
    }

    const event = createRunEvent({
      ...parsedInput.data,
      previousEventHash: current.lastEventHash,
      sequence,
    });
    const prospectiveFold = foldRunEvents([...current.events, event]);
    if (!prospectiveFold.ok) {
      return fail("INVALID_APPEND_EVENT");
    }

    const relativePath = `${EVENT_DIRECTORY}/${eventFilename(sequence)}`;
    try {
      const writeResult = await atomicWriteImmutableFile({
        allowedRoot: root.absoluteRoot,
        bytes: encodeCanonicalJson(event),
        relativePath,
      });
      if (writeResult.state !== "created") {
        return fail("CONCURRENT_APPEND_CONFLICT");
      }
    } catch (error) {
      if (
        error instanceof AtomicFileError &&
        (error.code === "IMMUTABLE_CONFLICT" ||
          error.code === "ATOMIC_RENAME_FAILED")
      ) {
        return fail("CONCURRENT_APPEND_CONFLICT", error);
      }
      return fail("FILESYSTEM_ERROR", error);
    }

    return Object.freeze({ event, relativePath });
  } finally {
    await releaseAppendLock(lock);
  }
}

async function commitImmutableIndex(
  root: RootContext,
  indexIdInput: string,
  inputFiles: readonly IndexFileInput[],
): Promise<CommitIndexResult> {
  const indexId = validateIndexId(indexIdInput);
  const files = prepareIndexFiles(inputFiles);
  const indexesPath = await ensureDirectory(root, INDEX_DIRECTORY);
  const finalPath = join(indexesPath, indexId);

  try {
    await lstat(finalPath);
    return fail("INDEX_ALREADY_EXISTS");
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      if (error instanceof RunEventStoreError) {
        throw error;
      }
      return fail("FILESYSTEM_ERROR", error);
    }
  }

  const temporaryName = `.${indexId}.${randomUUID()}.tmp`;
  const temporaryPath = join(indexesPath, temporaryName);
  try {
    await mkdir(temporaryPath);
  } catch (error) {
    return fail("FILESYSTEM_ERROR", error);
  }

  const manifest = createIndexManifest(indexId, files);
  const manifestBytes = encodeCanonicalJson(manifest);
  const manifestHash = sha256Hex(manifestBytes);

  try {
    for (const file of files) {
      await atomicWriteImmutableFile({
        allowedRoot: temporaryPath,
        bytes: file.bytes,
        expectedContentHash: file.contentHash,
        relativePath: file.relativePath,
      });
      const writtenBytes = await readFile(
        join(temporaryPath, ...file.relativePath.split("/")),
      );
      if (!bytesEqual(writtenBytes, file.bytes)) {
        return fail("INDEX_VALIDATION_FAILED");
      }
    }

    await atomicWriteImmutableFile({
      allowedRoot: temporaryPath,
      bytes: manifestBytes,
      expectedContentHash: manifestHash,
      relativePath: INDEX_MANIFEST_NAME,
    });

    for (const file of files) {
      const verifiedBytes = await readFile(
        join(temporaryPath, ...file.relativePath.split("/")),
      );
      if (
        verifiedBytes.byteLength !== file.bytes.byteLength ||
        sha256Hex(verifiedBytes) !== file.contentHash
      ) {
        return fail("INDEX_VALIDATION_FAILED");
      }
    }
    const verifiedManifest = await readFile(
      join(temporaryPath, INDEX_MANIFEST_NAME),
    );
    if (sha256Hex(verifiedManifest) !== manifestHash) {
      return fail("INDEX_VALIDATION_FAILED");
    }

    await rename(temporaryPath, finalPath);
  } catch (error) {
    if (error instanceof RunEventStoreError) {
      throw error;
    }
    if (isErrorCode(error, "EEXIST") || isErrorCode(error, "ENOTEMPTY")) {
      return fail("INDEX_ALREADY_EXISTS", error);
    }
    return fail("INDEX_VALIDATION_FAILED", error);
  }

  const marker = IndexCommitMarkerSchema.parse({
    schemaVersion: 1,
    indexId,
    manifestHash,
    fileCount: files.length,
  });
  try {
    await atomicWriteImmutableFile({
      allowedRoot: root.absoluteRoot,
      bytes: encodeCanonicalJson(marker),
      relativePath: `${INDEX_DIRECTORY}/${indexId}/${INDEX_COMMIT_MARKER_NAME}`,
    });
  } catch (error) {
    return fail("INDEX_COMMIT_FAILED", error);
  }

  const committed = await readCommittedIndexFromRoot(root, indexId);
  if (committed.status !== "COMMITTED") {
    return fail("INDEX_COMMIT_FAILED");
  }

  return Object.freeze({
    indexId,
    manifestHash,
    relativePath: `${INDEX_DIRECTORY}/${indexId}`,
  });
}

/** Creates a run-scoped immutable store. The API intentionally has no update or delete operation. */
export function createRunEventStore(
  options: CreateRunEventStoreOptions,
): RunEventStore {
  let appendInProgress = false;

  return Object.freeze({
    append: async (input) => {
      if (appendInProgress) {
        return fail("CONCURRENT_APPEND_CONFLICT");
      }
      appendInProgress = true;
      try {
        const root = await establishRoot(options.allowedRoot);
        return await appendRunEvent(root, input);
      } finally {
        appendInProgress = false;
      }
    },
    commitIndex: async (indexId, files) => {
      const root = await establishRoot(options.allowedRoot);
      return commitImmutableIndex(root, indexId, files);
    },
    inspect: async () => {
      const root = await establishRoot(options.allowedRoot);
      const [events, indexInspection] = await Promise.all([
        inspectEventDirectory(root, false),
        inspectIndexes(root),
      ]);
      const diagnostics = Object.freeze([
        ...events.diagnostics,
        ...indexInspection.diagnostics,
      ]);
      const quarantineTargets = deduplicateTargets([
        ...events.quarantineTargets,
        ...indexInspection.quarantineTargets,
      ]);
      const hasStoreContent =
        events.events.length > 0 || indexInspection.indexes.length > 0;

      return Object.freeze({
        diagnostics,
        events: events.events,
        indexes: indexInspection.indexes,
        lastEventHash: events.lastEventHash,
        quarantineTargets,
        run: events.run,
        status:
          diagnostics.length > 0
            ? "QUARANTINED"
            : hasStoreContent
              ? "HEALTHY"
              : "EMPTY",
      });
    },
    readIndex: async (indexId) => {
      const root = await establishRoot(options.allowedRoot);
      return readCommittedIndexFromRoot(root, indexId);
    },
  });
}
