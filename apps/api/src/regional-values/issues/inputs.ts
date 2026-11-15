import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { FactItemSchema, RegionalSourceSchema } from "@ehime-vote-navigator/contracts";
import type { FactItem, RealSource, RegionalSource } from "@ehime-vote-navigator/contracts";

import { readRecordArray, readRecords } from "../draft/recordReader.js";
import type { ReadRecordsError } from "../draft/recordReader.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome, RecordRoot } from "../draft/types.js";

/**
 * What `loadIssueSnapshot` reads besides the records of the issues and the approval ledger: the
 * fact items, the sources and the originals. It is a seam, so that a test can give a world of its
 * own, and the build and `issues export` give the files of the repository.
 *
 * The layout of the records of real data below `data/real/regional-values/` is the one that the
 * intake and the creation of fact items (13.10, 13.11) will write; this is the layout that they are
 * to follow:
 *
 *   facts/<factId>.json                          a fact item of real data
 *   sources/<sourceId>/<revision>.json           the record of a source of real data
 *   data/real/raw/regional-values/<sourceId>/<revision>/<file>   the originals
 *
 * Fictional data keeps its fact items in one registry, `facts.json`, and a fictional source is only
 * the ID that a fact item names (Req 7.17), so it has no record of its own.
 */

export type IssueInputError = ReadRecordsError;

export type IssueInputs = Readonly<{
  root: RecordRoot;
  readFacts: () => Promise<Outcome<readonly FactItem[], IssueInputError>>;
  readSources: () => Promise<Outcome<readonly RegionalSource[], IssueInputError>>;
  /**
   * The SHA-256 of each file of the original of a source as it is now. `null` when the original
   * cannot be looked at (the directory is not there), which counts as a changed original.
   */
  originalHashes: (source: RealSource) => Promise<readonly string[] | null>;
}>;

export type FileIssueInputOptions = Readonly<{
  /** The directory of the originals (`data/real/raw/regional-values/`). The default is next to the root of the records. */
  rawRoot?: string;
}>;

async function hashesInDirectory(directory: string): Promise<readonly string[] | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const hashes: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      try {
        hashes.push(createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex"));
      } catch {
        return null;
      }
    }
  }
  return hashes.sort();
}

/** The inputs from the files of a record root. Real data is read from `facts/` and `sources/`, fictional data from `facts.json`. */
export function createFileIssueInputs(root: RecordRoot, options: FileIssueInputOptions = {}): IssueInputs {
  const rawRoot = options.rawRoot ?? join(root.rootDir, "..", "raw", "regional-values");
  const readFacts: IssueInputs["readFacts"] = async () => {
    if (root.dataKind === "FIXTURE") {
      return readRecordArray(root, "facts.json", FactItemSchema);
    }
    const read = await readRecords(root, "facts", FactItemSchema);
    return read.ok ? succeed(read.value.map((stored) => stored.record)) : fail(read.error);
  };
  const readSources: IssueInputs["readSources"] = async () => {
    if (root.dataKind === "FIXTURE") {
      const facts = await readFacts();
      if (!facts.ok) {
        return facts;
      }
      const ids = [...new Set(facts.value.flatMap((fact) => (fact.dataKind === "FIXTURE" ? [fact.fictionalSourceId] : [])))].sort();
      return succeed(ids.map((sourceId): RegionalSource => ({ dataKind: "FIXTURE", sourceId })));
    }
    const read = await readRecords(root, "sources", RegionalSourceSchema, { recursive: true });
    return read.ok ? succeed(read.value.map((stored) => stored.record)) : fail(read.error);
  };
  const originalHashes: IssueInputs["originalHashes"] = (source) => hashesInDirectory(join(rawRoot, source.sourceId, source.revision));
  return { root, readFacts, readSources, originalHashes };
}
