import { lstat, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { BuildKind, BuildReport, RegionalBundle } from "@ehime-vote-navigator/contracts";
import { encodePortableCanonicalJson } from "@ehime-vote-navigator/domain";

import { atomicReplaceFile } from "../../store/atomicReplaceFile.js";

/**
 * Where the build writes its files, and how (design: "ビルドパイプライン" steps 2 and 9).
 *
 * The files go to `dist/regional-values/<kind>/` below the workspace root: `bundle.json` and
 * `build-report.json`. A bundle is written only by a successful build. Before the build, an older
 * `bundle.json` is removed, so that a failed build can never leave an old bundle that looks current.
 */

export const BUNDLE_FILE_NAME = "bundle.json";
export const REPORT_FILE_NAME = "build-report.json";

const OUTPUT_ROOT = ["dist", "regional-values"] as const;

/** The directory kind name of a build kind: `demo` or `public`. */
export function outputDirectoryName(buildKind: BuildKind): "demo" | "public" {
  return buildKind === "DEMO" ? "demo" : "public";
}

/** The path of an output file, relative to the workspace root and with forward slashes. */
export function relativeOutputPath(buildKind: BuildKind, fileName: string): string {
  return [...OUTPUT_ROOT, outputDirectoryName(buildKind), fileName].join("/");
}

/** The files could not be handled. The error carries a fixed code and nothing else. */
export type OutputFailure = Readonly<{ code: "OUTPUT_REMOVE_FAILED" | "OUTPUT_WRITE_FAILED" }>;

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Operations that a test can replace to make removing or writing fail. */
export type OutputOperations = Readonly<{
  remove: (absolutePath: string) => Promise<void>;
}>;

const DEFAULT_OPERATIONS: OutputOperations = {
  async remove(absolutePath) {
    const stats = await lstat(absolutePath);
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      throw new Error("Not a file");
    }
    await unlink(absolutePath);
  },
};

/**
 * Removes the `bundle.json` of an earlier build. A file that is not there is not a failure; a file
 * that cannot be removed is, because the build must not go on with an old bundle in place.
 */
export async function removeOldBundle(
  workspaceRoot: string,
  buildKind: BuildKind,
  operations: OutputOperations = DEFAULT_OPERATIONS,
): Promise<{ ok: true } | { ok: false; error: OutputFailure }> {
  const absolutePath = join(workspaceRoot, ...OUTPUT_ROOT, outputDirectoryName(buildKind), BUNDLE_FILE_NAME);
  try {
    await operations.remove(absolutePath);
    return { ok: true };
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return { ok: true };
    }
    return { ok: false, error: { code: "OUTPUT_REMOVE_FAILED" } };
  }
}

/** The bytes of a file: the portable canonical JSON of the value, so the same value gives the same bytes. */
export function outputBytes(value: unknown): Uint8Array {
  return encodePortableCanonicalJson(value);
}

async function writeFile(workspaceRoot: string, relativePath: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: OutputFailure }> {
  try {
    await atomicReplaceFile({ allowedRoot: workspaceRoot, relativePath, bytes });
    return { ok: true };
  } catch {
    return { ok: false, error: { code: "OUTPUT_WRITE_FAILED" } };
  }
}

/** Writes the bundle. The number of bytes is that of the file. */
export async function writeBundle(
  workspaceRoot: string,
  buildKind: BuildKind,
  bundle: RegionalBundle,
): Promise<{ ok: true; bytes: number; relativePath: string } | { ok: false; error: OutputFailure }> {
  const bytes = outputBytes(bundle);
  const relativePath = relativeOutputPath(buildKind, BUNDLE_FILE_NAME);
  const written = await writeFile(workspaceRoot, relativePath, bytes);
  return written.ok ? { ok: true, bytes: bytes.length, relativePath } : written;
}

/** Writes the build report. A failed build writes this file only. */
export async function writeReport(
  workspaceRoot: string,
  buildKind: BuildKind,
  report: BuildReport,
): Promise<{ ok: true } | { ok: false; error: OutputFailure }> {
  return writeFile(workspaceRoot, relativeOutputPath(buildKind, REPORT_FILE_NAME), outputBytes(report));
}
