import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  StageRunKeySchema,
  StageRunSchema,
  type StageRun,
  type StageRunKey,
} from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex, type Result } from "@ehime-vote-navigator/domain";

import {
  atomicWriteImmutableFile,
  type AtomicFileOperationOverrides,
} from "../store/atomicFiles.js";

export type StageStoreError = Readonly<{
  code: "INVALID_RUN" | "STORE_READ_FAILED" | "STORE_WRITE_FAILED";
}>;

/** Where the runs of one stage of one source revision are kept. */
export type StageLocation = Pick<StageRunKey, "revision" | "sourceSha256" | "stage">;

export type StageStore = Readonly<{
  /** The stored SUCCEEDED run with exactly this key, or null when there is none. */
  findSucceeded: (key: StageRunKey) => Promise<Result<StageRun | null, StageStoreError>>;
  /** Every stored run of one stage, oldest first. A corrupt file fails the whole read. */
  listRuns: (location: StageLocation) => Promise<Result<StageRun[], StageStoreError>>;
  /** Writes one run as a new immutable file. An existing file is never changed. */
  saveRun: (run: StageRun) => Promise<Result<void, StageStoreError>>;
}>;

export type FileStageStoreOptions = Readonly<{
  /** Test seam for the atomic writes; the real filesystem is the default. */
  operations?: AtomicFileOperationOverrides;
  /** Absolute path of `data/real` (Git ignored). */
  realDataRoot: string;
}>;

const SUCCEEDED_FILE = /^([0-9a-f]{64})\.json$/u;
const FAILED_FILE = /^([0-9a-f]{64})\.failed-([0-9a-f]{16})\.json$/u;
const LocationSchema = StageRunKeySchema.pick({
  revision: true,
  sourceSha256: true,
  stage: true,
});

const INVALID_RUN: Result<never, StageStoreError> = {
  ok: false,
  error: Object.freeze({ code: "INVALID_RUN" as const }),
};
const READ_FAILED: Result<never, StageStoreError> = {
  ok: false,
  error: Object.freeze({ code: "STORE_READ_FAILED" as const }),
};
const WRITE_FAILED: Result<never, StageStoreError> = {
  ok: false,
  error: Object.freeze({ code: "STORE_WRITE_FAILED" as const }),
};

/** `stageRunId = sha256Hex(canonical JSON of the key)`; key order does not matter. */
export function computeStageRunId(key: StageRunKey): string {
  return sha256Hex(encodeCanonicalJson(key));
}

/** The newest SUCCEEDED run of a list returned by `listRuns` (oldest first). */
export function latestSucceeded(runs: readonly StageRun[]): StageRun | undefined {
  return runs.filter((run) => run.status === "SUCCEEDED").at(-1);
}

function relativeDirectory(location: StageLocation): string {
  return `stages/${location.sourceSha256}/${location.revision}/${location.stage}`;
}

function recordHash(run: StageRun): string {
  return sha256Hex(encodeCanonicalJson(run)).slice(0, 16);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readRunFile(
  directory: string,
  name: string,
  location: StageLocation,
): Promise<StageRun> {
  const text = await readFile(join(directory, name), "utf8");
  const parsed = StageRunSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error("corrupt run");
  }

  const run = parsed.data;
  const succeeded = SUCCEEDED_FILE.exec(name);
  const failed = FAILED_FILE.exec(name);
  const nameId = (succeeded ?? failed)?.[1];
  const consistent =
    nameId === run.stageRunId &&
    computeStageRunId(run.key) === run.stageRunId &&
    run.key.sourceSha256 === location.sourceSha256 &&
    run.key.revision === location.revision &&
    run.key.stage === location.stage &&
    (succeeded === null
      ? run.status === "FAILED" && failed?.[2] === recordHash(run)
      : run.status === "SUCCEEDED");
  if (!consistent) {
    throw new Error("inconsistent run");
  }
  return run;
}

/**
 * File-backed stage store below `data/real/stages/<sourceSha256>/<revision>/<stage>/`.
 * A SUCCEEDED run is written once as `<stageRunId>.json`. A FAILED run goes to a
 * separate file (`<stageRunId>.failed-<hash>.json`), so it never replaces a
 * SUCCEEDED run and is never returned as a cache hit. Files are written through a
 * synchronised temporary file and an atomic rename; a failed write leaves the
 * existing files untouched.
 */
export function createFileStageStore(options: FileStageStoreOptions): StageStore {
  const operations =
    options.operations === undefined ? {} : { operations: options.operations };

  function absoluteDirectory(location: StageLocation): string {
    return join(options.realDataRoot, ...relativeDirectory(location).split("/"));
  }

  return {
    async findSucceeded(key) {
      const parsed = StageRunKeySchema.safeParse(key);
      if (!parsed.success) {
        return INVALID_RUN;
      }
      try {
        const name = `${computeStageRunId(parsed.data)}.json`;
        try {
          const run = await readRunFile(absoluteDirectory(parsed.data), name, parsed.data);
          return { ok: true, value: run };
        } catch (error) {
          if (isMissing(error)) {
            return { ok: true, value: null };
          }
          throw error;
        }
      } catch {
        return READ_FAILED;
      }
    },

    async listRuns(location) {
      // Only these three fields select the directory; any other field of `location` is ignored.
      const parsed = LocationSchema.safeParse({
        revision: location.revision,
        sourceSha256: location.sourceSha256,
        stage: location.stage,
      });
      if (!parsed.success) {
        return INVALID_RUN;
      }
      try {
        const directory = absoluteDirectory(parsed.data);
        let names: string[];
        try {
          names = await readdir(directory);
        } catch (error) {
          if (isMissing(error)) {
            return { ok: true, value: [] };
          }
          throw error;
        }

        const runs: StageRun[] = [];
        // Files that do not look like a run (for example a leftover temporary file) are ignored.
        for (const name of names.sort()) {
          if (SUCCEEDED_FILE.test(name) || FAILED_FILE.test(name)) {
            runs.push(await readRunFile(directory, name, parsed.data));
          }
        }
        runs.sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.stageRunId.localeCompare(right.stageRunId) ||
            left.status.localeCompare(right.status),
        );
        return { ok: true, value: runs };
      } catch {
        return READ_FAILED;
      }
    },

    async saveRun(run) {
      const parsed = StageRunSchema.safeParse(run);
      if (!parsed.success || computeStageRunId(parsed.data.key) !== parsed.data.stageRunId) {
        return INVALID_RUN;
      }

      let bytes: Uint8Array;
      try {
        bytes = encodeCanonicalJson(parsed.data);
      } catch {
        return INVALID_RUN;
      }

      const name =
        parsed.data.status === "SUCCEEDED"
          ? `${parsed.data.stageRunId}.json`
          : `${parsed.data.stageRunId}.failed-${sha256Hex(bytes).slice(0, 16)}.json`;
      try {
        await mkdir(options.realDataRoot, { recursive: true });
        await atomicWriteImmutableFile({
          allowedRoot: options.realDataRoot,
          bytes,
          relativePath: `${relativeDirectory(parsed.data.key)}/${name}`,
          ...operations,
        });
        return { ok: true, value: undefined };
      } catch {
        return WRITE_FAILED;
      }
    },
  };
}