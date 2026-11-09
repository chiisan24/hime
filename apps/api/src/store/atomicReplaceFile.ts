import { sha256Hex, type ContentHash } from "@ehime-vote-navigator/domain";

import {
  AtomicFileError,
  bestEffortUnlink,
  establishRoot,
  openUniqueTemporaryFile,
  operationsWith,
  prepareTarget,
  writeAndSync,
  type AtomicFileOperationOverrides,
  type AtomicFileOperations,
} from "./atomicFiles.js";

/**
 * Replaces (or creates) one mutable file, such as the election registry, so a
 * reader sees either the complete old bytes or the complete new bytes.
 *
 * It reuses the root, relative-path, reserved-name and symbolic-link checks of
 * `atomicFiles.ts`. The new bytes go to a unique sibling temporary file, are
 * synchronized and read back for verification, and only then renamed over the
 * target. Any failure before the rename leaves the target untouched, and the
 * temporary file is removed on a best-effort basis. Errors carry fixed
 * messages and never expose filesystem paths.
 */
export type AtomicReplaceOptions = Readonly<{
  allowedRoot: string;
  bytes: Uint8Array;
  operations?: AtomicFileOperationOverrides;
  relativePath: string;
}>;

export type AtomicReplaceState = "created" | "replaced";

export type AtomicReplaceResult = Readonly<{
  absolutePath: string;
  contentHash: ContentHash;
  relativePath: string;
  state: AtomicReplaceState;
}>;

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function inspectTarget(
  absolutePath: string,
  operations: AtomicFileOperations,
): Promise<"file" | "missing"> {
  try {
    const stats = await operations.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new AtomicFileError("SYMLINK_NOT_ALLOWED");
    }
    if (!stats.isFile()) {
      throw new AtomicFileError("FILESYSTEM_ERROR");
    }
    return "file";
  } catch (error) {
    if (error instanceof AtomicFileError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      return "missing";
    }
    throw new AtomicFileError("FILESYSTEM_ERROR", error);
  }
}

async function verifyTemporaryBytes(
  temporaryPath: string,
  expectedHash: ContentHash,
  operations: AtomicFileOperations,
): Promise<void> {
  let written: Uint8Array;
  try {
    written = await operations.readFile(temporaryPath);
  } catch (error) {
    throw new AtomicFileError("FILESYSTEM_ERROR", error);
  }

  if (sha256Hex(written) !== expectedHash) {
    throw new AtomicFileError("TEMPORARY_WRITE_FAILED");
  }
}

export async function atomicReplaceFile(
  options: AtomicReplaceOptions,
): Promise<AtomicReplaceResult> {
  if (!(options.bytes instanceof Uint8Array)) {
    throw new AtomicFileError("TEMPORARY_WRITE_FAILED");
  }

  const stableBytes = Uint8Array.from(options.bytes);
  const contentHash = sha256Hex(stableBytes);
  const operations = operationsWith(options.operations);
  const root = await establishRoot(options.allowedRoot, operations);
  const target = await prepareTarget(root, options.relativePath, operations);
  const existing = await inspectTarget(target.absolutePath, operations);

  const temporary = await openUniqueTemporaryFile(target.absolutePath, operations);
  try {
    await writeAndSync(temporary.handle, stableBytes);
    await verifyTemporaryBytes(temporary.path, contentHash, operations);

    try {
      await operations.rename(temporary.path, target.absolutePath);
    } catch (error) {
      throw new AtomicFileError("ATOMIC_RENAME_FAILED", error);
    }
  } finally {
    await bestEffortUnlink(temporary.path, operations);
  }

  return Object.freeze({
    absolutePath: target.absolutePath,
    contentHash,
    relativePath: target.normalizedRelativePath,
    state: existing === "file" ? "replaced" : "created",
  });
}