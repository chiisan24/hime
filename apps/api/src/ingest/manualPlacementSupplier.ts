import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ISOInstantSchema, isValidOfficialUrl } from "@ehime-vote-navigator/contracts";

import { supplyFailure, type SourceSupplier } from "./sourceSupplier.js";

export type ManualPlacementOptions = Readonly<{
  /** Absolute path of `data/real/raw`, where the developer placed the file. */
  rawDirectory: string;
  /** The official page the file was downloaded from; required, never guessed. */
  officialUrl?: string;
  /** When the file was downloaded (ISO 8601 with a timezone); defaults to now. */
  retrievedAt?: string;
  now?: () => Date;
}>;

const FORBIDDEN_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/u;
const WINDOWS_RESERVED_BASE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const MAX_FILE_NAME_LENGTH = 200;

function isSafeFileName(name: string): boolean {
  const baseName = name.split(".")[0] ?? "";

  return (
    name.length > 0 &&
    name.length <= MAX_FILE_NAME_LENGTH &&
    name === name.trim() &&
    !name.startsWith(".") &&
    !name.includes("..") &&
    !FORBIDDEN_NAME_CHARACTERS.test(name) &&
    !WINDOWS_RESERVED_BASE_NAME.test(baseName)
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Supplies a PDF the developer placed directly in `data/real/raw`. It accepts
 * only a plain file name (no path), refuses links and non-PDF names, and does
 * not read anything until the official URL and retrieval time are valid.
 */
export function createManualPlacementSupplier(
  options: ManualPlacementOptions,
): SourceSupplier {
  const now = options.now ?? (() => new Date());

  return {
    async supply(reference) {
      const officialUrl =
        typeof options.officialUrl === "string" ? options.officialUrl.trim() : "";
      const retrievedAt =
        options.retrievedAt === undefined
          ? now().toISOString()
          : options.retrievedAt.trim();

      const invalidFields: string[] = [];
      if (!isValidOfficialUrl(officialUrl)) {
        invalidFields.push("officialUrl");
      }
      if (!ISOInstantSchema.safeParse(retrievedAt).success) {
        invalidFields.push("retrievedAt");
      }
      if (invalidFields.length > 0) {
        return supplyFailure("SUPPLY_INCOMPLETE", invalidFields);
      }

      if (typeof reference !== "string" || !isSafeFileName(reference)) {
        return supplyFailure("FILE_NAME_INVALID");
      }
      if (!/\.pdf$/iu.test(reference)) {
        return supplyFailure("UNSUPPORTED_FILE_TYPE");
      }

      const absolutePath = join(options.rawDirectory, reference);
      try {
        const stats = await lstat(absolutePath);
        if (stats.isSymbolicLink()) {
          return supplyFailure("SYMLINK_NOT_ALLOWED");
        }
        if (!stats.isFile()) {
          return supplyFailure("FILE_UNREADABLE");
        }
      } catch (error) {
        return supplyFailure(
          hasErrorCode(error, "ENOENT") ? "FILE_NOT_FOUND" : "FILE_UNREADABLE",
        );
      }

      let content: Buffer;
      try {
        content = await readFile(absolutePath);
      } catch {
        return supplyFailure("FILE_UNREADABLE");
      }

      return {
        ok: true,
        value: { bytes: new Uint8Array(content), officialUrl, retrievedAt },
      };
    },
  };
}