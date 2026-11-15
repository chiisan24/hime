import { join } from "node:path";

import type { DataKind } from "@ehime-vote-navigator/contracts";

/**
 * Where the records of the draft process are (design: 保存、冪等性、制約). The records of real
 * data are under `data/real/regional-values/` (not in Git), and those of fictional data are under
 * `packages/fixtures/src/regional-values/` (in Git).
 *
 * `rootDir` is the directory that is read and written. `logicalRoot` is the repository-relative
 * path that this directory stands for: the data boundary check (`validateDataBoundary`) reads the
 * path, not the disk, so a test can use a temporary directory and still be judged by the rule of
 * the place that it stands for.
 */
export type RecordRoot = Readonly<{
  dataKind: DataKind;
  rootDir: string;
  logicalRoot: string;
}>;

export const REAL_LOGICAL_ROOT = "data/real/regional-values";
export const FIXTURE_LOGICAL_ROOT = "packages/fixtures/src/regional-values";

/** The root of the repository's records of a data kind. */
export function defaultRecordRoot(workspaceRoot: string, dataKind: DataKind): RecordRoot {
  return dataKind === "REAL_AI"
    ? { dataKind, rootDir: join(workspaceRoot, "data", "real", "regional-values"), logicalRoot: REAL_LOGICAL_ROOT }
    : { dataKind, rootDir: join(workspaceRoot, "packages", "fixtures", "src", "regional-values"), logicalRoot: FIXTURE_LOGICAL_ROOT };
}

export type Outcome<T, E> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function succeed<T>(value: T): Outcome<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Outcome<never, E> {
  return { ok: false, error };
}
