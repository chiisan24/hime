import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import {
  encodeCanonicalJson,
  sha256Hex,
  type ContentHash,
} from "@ehime-vote-navigator/domain";

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,16}$/u;
const SAFE_UNIQUE_ID = /^[a-zA-Z0-9-]{1,80}$/u;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export const ATOMIC_FILE_ERROR_CODES = [
  "COMMIT_MARKER_FAILED",
  "CONTENT_HASH_MISMATCH",
  "FILESYSTEM_ERROR",
  "IMMUTABLE_CONFLICT",
  "INVALID_CONTENT_HASH",
  "INVALID_RELATIVE_PATH",
  "INVALID_ROOT",
  "ORPHANED_COMMIT_MARKER",
  "PATH_COMPONENT_NOT_DIRECTORY",
  "PATH_OUTSIDE_ROOT",
  "POST_COMMIT_VERIFICATION_FAILED",
  "SYMLINK_NOT_ALLOWED",
  "TEMPORARY_CLOSE_FAILED",
  "TEMPORARY_OPEN_FAILED",
  "TEMPORARY_SYNC_FAILED",
  "TEMPORARY_WRITE_FAILED",
  "ATOMIC_RENAME_FAILED",
] as const;

export type AtomicFileErrorCode = (typeof ATOMIC_FILE_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<AtomicFileErrorCode, string>> =
  Object.freeze({
    ATOMIC_RENAME_FAILED: "The immutable file could not be committed atomically.",
    COMMIT_MARKER_FAILED: "The commit marker could not be created safely.",
    CONTENT_HASH_MISMATCH: "The supplied content hash does not match the bytes.",
    FILESYSTEM_ERROR: "The filesystem operation failed safely.",
    IMMUTABLE_CONFLICT:
      "An immutable file already exists with different bytes.",
    INVALID_CONTENT_HASH: "The content hash must be lowercase SHA-256 hex.",
    INVALID_RELATIVE_PATH: "The storage path must be a safe relative path.",
    INVALID_ROOT: "The allowed storage root must be an existing directory.",
    ORPHANED_COMMIT_MARKER:
      "A commit marker exists without its immutable target.",
    PATH_COMPONENT_NOT_DIRECTORY:
      "A storage path component is not a directory.",
    PATH_OUTSIDE_ROOT: "The storage path resolves outside the allowed root.",
    POST_COMMIT_VERIFICATION_FAILED:
      "The committed file failed byte verification.",
    SYMLINK_NOT_ALLOWED: "Symbolic links are not allowed in storage paths.",
    TEMPORARY_CLOSE_FAILED: "The temporary file could not be closed safely.",
    TEMPORARY_OPEN_FAILED: "A unique temporary file could not be opened.",
    TEMPORARY_SYNC_FAILED: "The temporary file could not be synchronized.",
    TEMPORARY_WRITE_FAILED: "The temporary file could not be written.",
  });

/** A fixed-message storage failure that does not expose filesystem paths. */
export class AtomicFileError extends Error {
  readonly code: AtomicFileErrorCode;

  constructor(code: AtomicFileErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = "AtomicFileError";
    this.code = code;
  }
}

export type AtomicFileEntryStats = Readonly<{
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}>;

export type AtomicWritableFileHandle = Readonly<{
  close: () => Promise<void>;
  sync: () => Promise<void>;
  writeFile: (bytes: Uint8Array) => Promise<void>;
}>;

/** Injectable filesystem boundary used by integration fault tests. */
export type AtomicFileOperations = Readonly<{
  createUniqueId: () => string;
  lstat: (path: string) => Promise<AtomicFileEntryStats>;
  mkdir: (path: string) => Promise<unknown>;
  openExclusive: (path: string) => Promise<AtomicWritableFileHandle>;
  readFile: (path: string) => Promise<Uint8Array>;
  realpath: (path: string) => Promise<string>;
  rename: (temporaryPath: string, finalPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}>;

export type AtomicFileOperationOverrides = Partial<AtomicFileOperations>;

export type AtomicWriteOptions = Readonly<{
  allowedRoot: string;
  bytes: Uint8Array;
  commitMarkerRelativePath?: string;
  expectedContentHash?: string;
  operations?: AtomicFileOperationOverrides;
  relativePath: string;
}>;

export type AtomicWriteState = "already-present" | "created";

export type AtomicWriteResult = Readonly<{
  absolutePath: string;
  commitMarkerState?: AtomicWriteState;
  contentHash: ContentHash;
  relativePath: string;
  state: AtomicWriteState;
}>;

export type ContentAddressedPathOptions = Readonly<{
  directory?: string;
  extension?: string;
}>;

export type ContentAddressedWriteOptions = Readonly<{
  allowedRoot: string;
  bytes: Uint8Array;
  commitMarkerRelativePath?: string;
  directory?: string;
  extension?: string;
  operations?: AtomicFileOperationOverrides;
}>;

const NODE_OPERATIONS: AtomicFileOperations = Object.freeze({
  createUniqueId: randomUUID,
  lstat: async (path) => lstat(path),
  mkdir: async (path) => mkdir(path),
  openExclusive: async (path) => open(path, "wx"),
  readFile: async (path) => readFile(path),
  realpath: async (path) => realpath(path),
  rename: async (temporaryPath, finalPath) => rename(temporaryPath, finalPath),
  unlink: async (path) => unlink(path),
});

type RootContext = Readonly<{
  absoluteRoot: string;
  realRoot: string;
}>;

type PreparedTarget = Readonly<{
  absolutePath: string;
  normalizedRelativePath: string;
}>;

type ExistingState = "missing" | "same";

function fail(code: AtomicFileErrorCode, cause?: unknown): never {
  throw new AtomicFileError(code, cause);
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function operationsWith(
  overrides: AtomicFileOperationOverrides | undefined,
): AtomicFileOperations {
  return Object.freeze({ ...NODE_OPERATIONS, ...overrides });
}

function parseRelativePath(path: string): readonly string[] {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    path.includes("\0") ||
    isAbsolute(path) ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path)
  ) {
    fail("INVALID_RELATIVE_PATH");
  }

  const segments = path.replaceAll("\\", "/").split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SAFE_PATH_SEGMENT.test(segment) ||
        WINDOWS_RESERVED_NAMES.test(segment) ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    fail("INVALID_RELATIVE_PATH");
  }

  return segments;
}

function normalizeRelativePath(path: string): string {
  return parseRelativePath(path).join("/");
}

function validateRoot(root: string): string {
  if (
    root.length === 0 ||
    root !== root.trim() ||
    root.includes("\0") ||
    !isAbsolute(root) ||
    root.replaceAll("\\", "/").split("/").includes("..")
  ) {
    fail("INVALID_ROOT");
  }

  return resolve(root);
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

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

async function establishRoot(
  allowedRoot: string,
  operations: AtomicFileOperations,
): Promise<RootContext> {
  const absoluteRoot = validateRoot(allowedRoot);

  try {
    const rootStats = await operations.lstat(absoluteRoot);
    if (rootStats.isSymbolicLink()) {
      fail("SYMLINK_NOT_ALLOWED");
    }
    if (!rootStats.isDirectory()) {
      fail("INVALID_ROOT");
    }

    const realRoot = await operations.realpath(absoluteRoot);
    return Object.freeze({ absoluteRoot, realRoot });
  } catch (error) {
    if (error instanceof AtomicFileError) {
      throw error;
    }
    return fail("INVALID_ROOT", error);
  }
}

async function ensureSecureDirectory(
  root: RootContext,
  directorySegments: readonly string[],
  operations: AtomicFileOperations,
): Promise<void> {
  let currentPath = root.absoluteRoot;

  for (const segment of directorySegments) {
    currentPath = join(currentPath, segment);

    try {
      await operations.mkdir(currentPath);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        fail("FILESYSTEM_ERROR", error);
      }
    }

    let stats: AtomicFileEntryStats;
    let resolvedPath: string;
    try {
      stats = await operations.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        fail("SYMLINK_NOT_ALLOWED");
      }
      if (!stats.isDirectory()) {
        fail("PATH_COMPONENT_NOT_DIRECTORY");
      }
      resolvedPath = await operations.realpath(currentPath);
    } catch (error) {
      if (error instanceof AtomicFileError) {
        throw error;
      }
      return fail("FILESYSTEM_ERROR", error);
    }

    if (!isInsideOrEqual(root.realRoot, resolvedPath)) {
      fail("PATH_OUTSIDE_ROOT");
    }
  }
}

async function prepareTarget(
  root: RootContext,
  relativePathInput: string,
  operations: AtomicFileOperations,
): Promise<PreparedTarget> {
  const segments = parseRelativePath(relativePathInput);
  await ensureSecureDirectory(root, segments.slice(0, -1), operations);

  const absolutePath = resolve(root.absoluteRoot, ...segments);
  if (!isInsideOrEqual(root.absoluteRoot, absolutePath)) {
    fail("PATH_OUTSIDE_ROOT");
  }

  return Object.freeze({
    absolutePath,
    normalizedRelativePath: segments.join("/"),
  });
}

async function inspectExistingFile(
  root: RootContext,
  absolutePath: string,
  expectedBytes: Uint8Array,
  expectedHash: ContentHash,
  operations: AtomicFileOperations,
): Promise<ExistingState> {
  let stats: AtomicFileEntryStats;
  try {
    stats = await operations.lstat(absolutePath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return "missing";
    }
    return fail("FILESYSTEM_ERROR", error);
  }

  if (stats.isSymbolicLink()) {
    fail("SYMLINK_NOT_ALLOWED");
  }
  if (!stats.isFile()) {
    fail("IMMUTABLE_CONFLICT");
  }

  let resolvedPath: string;
  let existingBytes: Uint8Array;
  try {
    resolvedPath = await operations.realpath(absolutePath);
    existingBytes = await operations.readFile(absolutePath);
  } catch (error) {
    return fail("FILESYSTEM_ERROR", error);
  }

  if (!isInsideOrEqual(root.realRoot, resolvedPath)) {
    fail("PATH_OUTSIDE_ROOT");
  }

  if (
    sha256Hex(existingBytes) !== expectedHash ||
    !bytesEqual(existingBytes, expectedBytes)
  ) {
    fail("IMMUTABLE_CONFLICT");
  }

  return "same";
}

async function bestEffortUnlink(
  path: string,
  operations: AtomicFileOperations,
): Promise<void> {
  try {
    await operations.unlink(path);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      // A stale uncommitted file remains outside the reader contract. Task 3.3
      // owns startup quarantine; this primitive never removes unrelated files.
    }
  }
}

async function writeAndSync(
  handle: AtomicWritableFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  let failure: AtomicFileError | undefined;

  try {
    await handle.writeFile(bytes);
  } catch (error) {
    failure = new AtomicFileError("TEMPORARY_WRITE_FAILED", error);
  }

  if (failure === undefined) {
    try {
      await handle.sync();
    } catch (error) {
      failure = new AtomicFileError("TEMPORARY_SYNC_FAILED", error);
    }
  }

  try {
    await handle.close();
  } catch (error) {
    if (failure === undefined) {
      failure = new AtomicFileError("TEMPORARY_CLOSE_FAILED", error);
    }

    try {
      await handle.close();
    } catch {
      // Cleanup below is still attempted. No final path has been committed yet.
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
}

async function openUniqueTemporaryFile(
  finalPath: string,
  operations: AtomicFileOperations,
): Promise<Readonly<{ handle: AtomicWritableFileHandle; path: string }>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const uniqueId = operations.createUniqueId();
    if (!SAFE_UNIQUE_ID.test(uniqueId)) {
      fail("TEMPORARY_OPEN_FAILED");
    }

    const temporaryPath = join(
      dirname(finalPath),
      `.${basename(finalPath)}.${uniqueId}.tmp`,
    );

    try {
      const handle = await operations.openExclusive(temporaryPath);
      return Object.freeze({ handle, path: temporaryPath });
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        return fail("TEMPORARY_OPEN_FAILED", error);
      }
    }
  }

  return fail("TEMPORARY_OPEN_FAILED");
}

async function writeViaTemporaryRename(
  root: RootContext,
  target: PreparedTarget,
  bytes: Uint8Array,
  contentHash: ContentHash,
  operations: AtomicFileOperations,
): Promise<AtomicWriteState> {
  const existing = await inspectExistingFile(
    root,
    target.absolutePath,
    bytes,
    contentHash,
    operations,
  );
  if (existing === "same") {
    return "already-present";
  }

  const temporary = await openUniqueTemporaryFile(target.absolutePath, operations);
  try {
    await writeAndSync(temporary.handle, bytes);

    const stateBeforeRename = await inspectExistingFile(
      root,
      target.absolutePath,
      bytes,
      contentHash,
      operations,
    );
    if (stateBeforeRename === "same") {
      await bestEffortUnlink(temporary.path, operations);
      return "already-present";
    }

    try {
      await operations.rename(temporary.path, target.absolutePath);
    } catch (error) {
      const stateAfterFailure = await inspectExistingFile(
        root,
        target.absolutePath,
        bytes,
        contentHash,
        operations,
      );
      if (stateAfterFailure === "same") {
        await bestEffortUnlink(temporary.path, operations);
        return "already-present";
      }
      return fail("ATOMIC_RENAME_FAILED", error);
    }

    try {
      const committed = await inspectExistingFile(
        root,
        target.absolutePath,
        bytes,
        contentHash,
        operations,
      );
      if (committed !== "same") {
        fail("POST_COMMIT_VERIFICATION_FAILED");
      }
    } catch (error) {
      await bestEffortUnlink(target.absolutePath, operations);
      if (
        error instanceof AtomicFileError &&
        error.code === "POST_COMMIT_VERIFICATION_FAILED"
      ) {
        throw error;
      }
      return fail("POST_COMMIT_VERIFICATION_FAILED", error);
    }

    return "created";
  } finally {
    await bestEffortUnlink(temporary.path, operations);
  }
}

async function writeExclusiveFile(
  root: RootContext,
  target: PreparedTarget,
  bytes: Uint8Array,
  contentHash: ContentHash,
  operations: AtomicFileOperations,
): Promise<AtomicWriteState> {
  const existing = await inspectExistingFile(
    root,
    target.absolutePath,
    bytes,
    contentHash,
    operations,
  );
  if (existing === "same") {
    return "already-present";
  }

  let handle: AtomicWritableFileHandle;
  try {
    handle = await operations.openExclusive(target.absolutePath);
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      const racedState = await inspectExistingFile(
        root,
        target.absolutePath,
        bytes,
        contentHash,
        operations,
      );
      if (racedState === "same") {
        return "already-present";
      }
    }
    return fail("TEMPORARY_OPEN_FAILED", error);
  }

  try {
    await writeAndSync(handle, bytes);
    const committed = await inspectExistingFile(
      root,
      target.absolutePath,
      bytes,
      contentHash,
      operations,
    );
    if (committed !== "same") {
      fail("POST_COMMIT_VERIFICATION_FAILED");
    }
    return "created";
  } catch (error) {
    await bestEffortUnlink(target.absolutePath, operations);
    throw error;
  }
}

function validateExpectedHash(
  bytes: Uint8Array,
  expectedHash: string | undefined,
): ContentHash {
  const actualHash = sha256Hex(bytes);
  if (expectedHash === undefined) {
    return actualHash;
  }
  if (!SHA_256_PATTERN.test(expectedHash)) {
    fail("INVALID_CONTENT_HASH");
  }
  if (actualHash !== expectedHash) {
    fail("CONTENT_HASH_MISMATCH");
  }
  return actualHash;
}

/**
 * Writes immutable bytes through a synchronized sibling temporary file. An
 * optional marker is created last with exclusive-create semantics.
 */
export async function atomicWriteImmutableFile(
  options: AtomicWriteOptions,
): Promise<AtomicWriteResult> {
  if (!(options.bytes instanceof Uint8Array)) {
    fail("TEMPORARY_WRITE_FAILED");
  }

  const stableBytes = Uint8Array.from(options.bytes);
  const contentHash = validateExpectedHash(
    stableBytes,
    options.expectedContentHash,
  );
  const normalizedRelativePath = normalizeRelativePath(options.relativePath);
  const normalizedMarkerPath =
    options.commitMarkerRelativePath === undefined
      ? undefined
      : normalizeRelativePath(options.commitMarkerRelativePath);

  if (normalizedMarkerPath === normalizedRelativePath) {
    fail("INVALID_RELATIVE_PATH");
  }

  const operations = operationsWith(options.operations);
  const root = await establishRoot(options.allowedRoot, operations);
  const target = await prepareTarget(
    root,
    normalizedRelativePath,
    operations,
  );
  const markerTarget =
    normalizedMarkerPath === undefined
      ? undefined
      : await prepareTarget(root, normalizedMarkerPath, operations);
  const markerBytes =
    markerTarget === undefined
      ? undefined
      : encodeCanonicalJson({
          contentHash,
          target: normalizedRelativePath,
        });
  const markerHash =
    markerBytes === undefined ? undefined : sha256Hex(markerBytes);

  const targetBeforeWrite = await inspectExistingFile(
    root,
    target.absolutePath,
    stableBytes,
    contentHash,
    operations,
  );
  const markerBeforeWrite =
    markerTarget === undefined || markerBytes === undefined || markerHash === undefined
      ? undefined
      : await inspectExistingFile(
          root,
          markerTarget.absolutePath,
          markerBytes,
          markerHash,
          operations,
        );

  if (targetBeforeWrite === "missing" && markerBeforeWrite === "same") {
    fail("ORPHANED_COMMIT_MARKER");
  }

  let targetState: AtomicWriteState = "already-present";
  if (targetBeforeWrite === "missing") {
    targetState = await writeViaTemporaryRename(
      root,
      target,
      stableBytes,
      contentHash,
      operations,
    );
  }

  let commitMarkerState: AtomicWriteState | undefined;
  if (
    markerTarget !== undefined &&
    markerBytes !== undefined &&
    markerHash !== undefined
  ) {
    if (markerBeforeWrite === "same") {
      commitMarkerState = "already-present";
    } else {
      try {
        commitMarkerState = await writeExclusiveFile(
          root,
          markerTarget,
          markerBytes,
          markerHash,
          operations,
        );
      } catch (error) {
        if (targetState === "created") {
          await bestEffortUnlink(target.absolutePath, operations);
        }
        return fail("COMMIT_MARKER_FAILED", error);
      }
    }
  }

  return Object.freeze({
    absolutePath: target.absolutePath,
    ...(commitMarkerState === undefined ? {} : { commitMarkerState }),
    contentHash,
    relativePath: normalizedRelativePath,
    state: targetState,
  });
}

/** Creates a platform-independent, hash-sharded relative object path. */
export function createContentAddressedRelativePath(
  contentHash: string,
  options: ContentAddressedPathOptions = {},
): string {
  if (!SHA_256_PATTERN.test(contentHash)) {
    fail("INVALID_CONTENT_HASH");
  }

  const directory = normalizeRelativePath(options.directory ?? "objects");
  const extension = options.extension ?? ".json";
  if (!SAFE_EXTENSION.test(extension)) {
    fail("INVALID_RELATIVE_PATH");
  }

  return `${directory}/${contentHash.slice(0, 2)}/${contentHash.slice(
    2,
    4,
  )}/${contentHash}${extension}`;
}

/** Hashes bytes, derives their immutable path, and commits them atomically. */
export async function writeContentAddressedFile(
  options: ContentAddressedWriteOptions,
): Promise<AtomicWriteResult> {
  const stableBytes = Uint8Array.from(options.bytes);
  const contentHash = sha256Hex(stableBytes);
  const relativePath = createContentAddressedRelativePath(contentHash, {
    ...(options.directory === undefined
      ? {}
      : { directory: options.directory }),
    ...(options.extension === undefined
      ? {}
      : { extension: options.extension }),
  });

  return atomicWriteImmutableFile({
    allowedRoot: options.allowedRoot,
    bytes: stableBytes,
    expectedContentHash: contentHash,
    ...(options.commitMarkerRelativePath === undefined
      ? {}
      : { commitMarkerRelativePath: options.commitMarkerRelativePath }),
    ...(options.operations === undefined
      ? {}
      : { operations: options.operations }),
    relativePath,
  });
}

// Shared with atomicReplaceFile.ts so that mutable replacements follow the same
// root, relative-path, reserved-name and symbolic-link rules.
export {
  bestEffortUnlink,
  establishRoot,
  openUniqueTemporaryFile,
  operationsWith,
  prepareTarget,
  writeAndSync,
};
export type { PreparedTarget, RootContext };
