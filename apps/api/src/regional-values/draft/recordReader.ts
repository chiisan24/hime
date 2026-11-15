import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { validateDataBoundary } from "@ehime-vote-navigator/domain";
import type { z } from "zod";

import { fail, succeed } from "./types.js";
import type { Outcome, RecordRoot } from "./types.js";

/**
 * The one way to read the records of the draft process: drafts, events, the approval ledger and
 * the records of issues (decision D29). Every read goes through the data boundary check
 * (`validateDataBoundary`, scope RUN), which finds a record of the other data kind (the records of
 * fictional data and of real data are not mixed) and a place that is not the place of the kind.
 *
 * It only reads. The check is for the records that are read; the files that are written to
 * `dist/` are not read here (the rule of the place does not cover `dist/`).
 */

export const READ_RECORDS_ERROR_CODES = [
  "DATA_KIND_INVALID",
  "DATA_KIND_MIXED",
  "STORAGE_ROOT_MISMATCH",
  "BOUNDARY_INPUT_INVALID",
  "RECORD_INVALID",
  "READ_FAILED",
] as const;

export type ReadRecordsErrorCode = (typeof READ_RECORDS_ERROR_CODES)[number];

export type ReadRecordsError = Readonly<{ code: ReadRecordsErrorCode }>;

export type StoredRecord<T> = Readonly<{
  /** The path of the file below the root, with `/`. */
  relativePath: string;
  record: T;
}>;

export type ReadRecordsOptions = Readonly<{
  /** Reads the files of the sub-directories too (the approval ledger: `<targetKind>/<targetId>/<hash>.json`). */
  recursive?: boolean;
  /**
   * Whether a record says its own data kind (`dataKind`). It does for drafts, events and issues, and a
   * record without it is refused. A record of the approval ledger has none, and is of the kind of the
   * root that it is read from.
   */
  declaresDataKind?: boolean;
}>;

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

/** The relative paths of the `.json` files, in the order of their names. */
async function listJsonFiles(absolute: string, relative: string, recursive: boolean): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const found: string[] = [];
  for (const entry of [...entries].sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recursive) {
        found.push(...(await listJsonFiles(join(absolute, entry.name), child, true)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      found.push(child);
    }
  }
  return found;
}

/**
 * Reads a registry file that holds an array of records (for example `facts.json`), with the same
 * checks as `readRecords`: each element against the schema, and the elements as a whole against the
 * data boundary. A file that does not exist is an empty registry.
 */
export async function readRecordArray<T>(
  root: RecordRoot,
  fileName: string,
  schema: z.ZodType<T>,
): Promise<Outcome<readonly T[], ReadRecordsError>> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(root.rootDir, fileName), "utf8"));
  } catch (error) {
    return isNotFound(error) ? succeed([]) : fail({ code: "RECORD_INVALID" });
  }
  if (!Array.isArray(json)) {
    return fail({ code: "RECORD_INVALID" });
  }
  const records: T[] = [];
  const boundaryRecords: { dataKind: unknown; recordId: string; payload: unknown }[] = [];
  for (const [index, element] of (json as unknown[]).entries()) {
    const parsed = schema.safeParse(element);
    if (!parsed.success || typeof element !== "object" || element === null || Array.isArray(element)) {
      return fail({ code: "RECORD_INVALID" });
    }
    records.push(parsed.data);
    boundaryRecords.push({ dataKind: (element as { dataKind?: unknown }).dataKind, recordId: `${fileName}#${index}`, payload: element });
  }
  if (boundaryRecords.length > 0) {
    const boundary = validateDataBoundary({
      dataKind: root.dataKind,
      scope: "RUN",
      storagePath: `${root.logicalRoot}/${fileName}`,
      records: boundaryRecords,
    });
    if (!boundary.ok) {
      return fail({ code: boundary.error.code });
    }
  }
  return succeed(records);
}

/**
 * Reads the records of a directory below the root, checks each against the schema, and checks the
 * records as a whole against the data boundary. A directory that does not exist has no records.
 * The records are returned in the order of their paths, so the same files give the same order.
 *
 * A record is of the data kind that it says (`dataKind`). A record that does not say it fails the
 * read, except when the caller says that such records have none (`declaresDataKind: false`, the
 * approval ledger): those are of the data kind of the root.
 */
export async function readRecords<T>(
  root: RecordRoot,
  directory: string,
  schema: z.ZodType<T>,
  options: ReadRecordsOptions = {},
): Promise<Outcome<readonly StoredRecord<T>[], ReadRecordsError>> {
  let paths: string[];
  try {
    paths = await listJsonFiles(join(root.rootDir, directory), "", options.recursive === true);
  } catch {
    return fail({ code: "READ_FAILED" });
  }

  const records: StoredRecord<T>[] = [];
  const boundaryRecords: { dataKind: unknown; recordId: string; payload: unknown }[] = [];
  for (const path of paths) {
    const relativePath = `${directory}/${path}`;
    let json: unknown;
    try {
      json = JSON.parse(await readFile(join(root.rootDir, directory, path), "utf8"));
    } catch {
      return fail({ code: "RECORD_INVALID" });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success || typeof json !== "object" || json === null || Array.isArray(json)) {
      return fail({ code: "RECORD_INVALID" });
    }
    const declared = (json as { dataKind?: unknown }).dataKind;
    records.push({ relativePath, record: parsed.data });
    boundaryRecords.push({
      dataKind: options.declaresDataKind === false ? root.dataKind : declared,
      recordId: relativePath,
      payload: json,
    });
  }

  if (boundaryRecords.length > 0) {
    const boundary = validateDataBoundary({
      dataKind: root.dataKind,
      scope: "RUN",
      storagePath: `${root.logicalRoot}/${directory}`,
      records: boundaryRecords,
    });
    if (!boundary.ok) {
      return fail({ code: boundary.error.code });
    }
  }
  return succeed(records);
}
