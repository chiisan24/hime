import { join } from "node:path";

import type { AtomicFileOperationOverrides } from "../../store/atomicFiles.js";
import type { RecordRoot } from "../draft/types.js";

/**
 * Where the records of real data are (design: 実データの取り込み手順), for the intake (13.10, 13.15)
 * and the fact items (13.11). The places are the ones that `createFileIssueInputs` already reads:
 *
 *   data/real/raw/regional-values/<sourceId>/<revision>/<file>   the original, written once
 *   data/real/regional-values/sources/<sourceId>/<revision>.json  the record of a source
 *   data/real/regional-values/datasets/<datasetKey>.json          the ledger of a data set
 *   data/real/regional-values/facts/<factId>.json                 a fact item
 *   data/real/regional-values/aggregations/<factId>.json          the record of a computation
 *
 * `data/real/` is not in Git. A test gives a temporary directory that stands for it.
 */

export type IntakeStore = Readonly<{
  /** The records of real data. Its data kind is `REAL_AI`: the intake takes in nothing else. */
  root: RecordRoot;
  /** The absolute path of the originals (`data/real/raw/regional-values`). */
  rawRoot: string;
  /** The seam for the faults of the file system, in a test. */
  operations?: AtomicFileOperationOverrides;
}>;

/** The originals are next to the records, as `createFileIssueInputs` expects them. */
export function defaultRawRoot(root: RecordRoot): string {
  return join(root.rootDir, "..", "raw", "regional-values");
}

export type IntakeStoreOptions = Readonly<{
  rawRoot?: string;
  operations?: AtomicFileOperationOverrides;
}>;

export function createIntakeStore(root: RecordRoot, options: IntakeStoreOptions = {}): IntakeStore {
  return {
    root,
    rawRoot: options.rawRoot ?? defaultRawRoot(root),
    ...(options.operations === undefined ? {} : { operations: options.operations }),
  };
}

export const SOURCES_DIRECTORY = "sources";
export const DATASETS_DIRECTORY = "datasets";
export const FACTS_DIRECTORY = "facts";
export const AGGREGATIONS_DIRECTORY = "aggregations";

export const sourceRecordPath = (sourceId: string, revision: string): string => `${SOURCES_DIRECTORY}/${sourceId}/${revision}.json`;
export const datasetRecordPath = (datasetKey: string): string => `${DATASETS_DIRECTORY}/${datasetKey}.json`;
export const factRecordPath = (factId: string): string => `${FACTS_DIRECTORY}/${factId}.json`;
export const aggregationRecordPath = (factId: string): string => `${AGGREGATIONS_DIRECTORY}/${factId}.json`;
export const rawFileRelativePath = (sourceId: string, revision: string, fileName: string): string => `${sourceId}/${revision}/${fileName}`;

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/**
 * A name that can be a file below the places above: ASCII letters, digits, `.`, `_` and `-`, not
 * beginning with a symbol, not ending with a dot, not a reserved device name of Windows. It is the rule
 * of `atomicWriteImmutableFile`, written down here so that a wrong name is refused with its own code
 * before anything is written. A name is at most `maxLength` characters (the IDs of the contracts are 64).
 */
export function isSafeRecordName(name: string, maxLength = 64): boolean {
  return name.length <= maxLength && SAFE_NAME.test(name) && !WINDOWS_RESERVED_NAME.test(name) && !name.endsWith(".");
}
