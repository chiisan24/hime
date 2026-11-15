import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { REVISION_PATTERN, RealSourceSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { RealSource, Sha256 } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";

import { readRecords } from "../draft/recordReader.js";
import type { ReadRecordsErrorCode } from "../draft/recordReader.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { SOURCES_DIRECTORY, sourceRecordPath } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * The records of the sources of real data and their originals, for the intake and for the fact
 * items. The rule of the revisions is the one of the existing `ingest` (`decideIngest`): the same
 * SHA-256 as the latest revision of a source ID changes nothing, any other SHA-256 (also one that is
 * the content of an earlier revision) is the next revision, and an earlier revision is never touched.
 */

/** A read that failed. The cause is a fixed code of the reader, never a path or a value. */
export type ReadFailure = Readonly<{ code: "STORE_READ_FAILED"; cause: ReadRecordsErrorCode | "PATH_MISMATCH" | "REVISION_INVALID" }>;

/** Every source record of real data, in the order of the paths. A record that is not at the path of its own ID and revision fails the read. */
export async function readRealSources(store: IntakeStore): Promise<Outcome<readonly RealSource[], ReadFailure>> {
  const read = await readRecords(store.root, SOURCES_DIRECTORY, RealSourceSchema, { recursive: true });
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  for (const stored of read.value) {
    if (stored.relativePath !== sourceRecordPath(stored.record.sourceId, stored.record.revision)) {
      return fail({ code: "STORE_READ_FAILED", cause: "PATH_MISMATCH" });
    }
  }
  return succeed(read.value.map((stored) => stored.record));
}

/** The number of a revision `r12`, or `null` for a revision that the intake does not make. */
export function revisionNumber(revision: string): number | null {
  return REVISION_PATTERN.test(revision) ? Number(revision.slice(1)) : null;
}

/**
 * The latest revision of a source ID among the records. `undefined` when the source has no record.
 * A revision that is not `r<n>` makes the next revision impossible to tell, so it fails the read.
 */
export function latestRevisionOf(sources: readonly RealSource[], sourceId: string): Outcome<RealSource | undefined, ReadFailure> {
  let latest: RealSource | undefined;
  let latestNumber = 0;
  for (const source of sources) {
    if (source.sourceId !== sourceId) {
      continue;
    }
    const number = revisionNumber(source.revision);
    if (number === null) {
      return fail({ code: "STORE_READ_FAILED", cause: "REVISION_INVALID" });
    }
    if (number > latestNumber) {
      latest = source;
      latestNumber = number;
    }
  }
  return succeed(latest);
}

export type IntakeDecision =
  | Readonly<{ kind: "CREATE"; revision: string }>
  | Readonly<{ kind: "UNCHANGED"; source: RealSource }>;

/** The revision decision (the same as `decideIngest`): a pure function of the latest record and the SHA-256. */
export function decideIntake(latest: RealSource | undefined, sha256: string): IntakeDecision {
  if (latest === undefined) {
    return { kind: "CREATE", revision: "r1" };
  }
  if (latest.sha256 === sha256) {
    return { kind: "UNCHANGED", source: latest };
  }
  // `latestRevisionOf` has checked that the revision is `r<n>`.
  return { kind: "CREATE", revision: `r${(revisionNumber(latest.revision) ?? 0) + 1}` };
}

/** The other source IDs that already hold a record with this SHA-256 (the rule of `DUPLICATE_CONTENT`). The revisions of the same source ID are not duplicates. */
export function otherHoldersOf(sources: readonly RealSource[], sourceId: string, sha256: string): readonly string[] {
  return [...new Set(sources.filter((source) => source.sha256 === sha256 && source.sourceId !== sourceId).map((source) => source.sourceId))].sort();
}

export type RawFile = Readonly<{ name: string; sha256: Sha256; bytes: Uint8Array }>;

/**
 * The files of the directory of an original (`<raw>/<sourceId>/<revision>/`), each with its SHA-256.
 * Only regular files count, as in `createFileIssueInputs`. `null` when the directory is not there.
 */
export async function readRawFiles(store: IntakeStore, sourceId: string, revision: string): Promise<Outcome<readonly RawFile[] | null, ReadFailure>> {
  const directory = join(store.rawRoot, sourceId, revision);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return succeed(null);
    }
    return fail({ code: "STORE_READ_FAILED", cause: "READ_FAILED" });
  }
  const files: RawFile[] = [];
  for (const entry of [...entries].sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))) {
    if (!entry.isFile()) {
      continue;
    }
    try {
      const bytes = new Uint8Array(await readFile(join(directory, entry.name)));
      files.push({ name: entry.name, sha256: Sha256Schema.parse(sha256Hex(bytes)), bytes });
    } catch {
      return fail({ code: "STORE_READ_FAILED", cause: "READ_FAILED" });
    }
  }
  return succeed(files);
}

export type OriginalLookup =
  | Readonly<{ state: "FOUND"; file: RawFile }>
  /** The directory is not there, or has no file. */
  | Readonly<{ state: "MISSING" }>
  /** There are files, and none of them has the SHA-256 that the record has. */
  | Readonly<{ state: "CHANGED" }>;

/** The file of the original that the record names by its SHA-256. */
export async function findOriginal(store: IntakeStore, source: RealSource): Promise<Outcome<OriginalLookup, ReadFailure>> {
  const files = await readRawFiles(store, source.sourceId, source.revision);
  if (!files.ok) {
    return files;
  }
  if (files.value === null || files.value.length === 0) {
    return succeed({ state: "MISSING" });
  }
  const file = files.value.find((candidate) => candidate.sha256 === source.sha256);
  return succeed(file === undefined ? { state: "CHANGED" } : { state: "FOUND", file });
}
