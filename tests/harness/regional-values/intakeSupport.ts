import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { REAL_LOGICAL_ROOT } from "../../../apps/api/src/regional-values/draft/types.js";
import type { RecordRoot } from "../../../apps/api/src/regional-values/draft/types.js";
import type { IntakeRequest } from "../../../apps/api/src/regional-values/intake/intake.js";
import { createIntakeStore } from "../../../apps/api/src/regional-values/intake/storeLayout.js";
import type { IntakeStore } from "../../../apps/api/src/regional-values/intake/storeLayout.js";
import type { AtomicFileOperationOverrides } from "../../../apps/api/src/store/atomicFiles.js";
import { overridden } from "./override.js";
import type { Override } from "./override.js";
import { encodeUtf8 } from "./shiftJis.js";

/**
 * Test harness for the intake of real data (13.10, 13.15) and the fact items (13.11). Everything in it
 * is fictional: the publisher, the URLs (example.org), the data set and the tables. A "world" is a
 * temporary directory that stands for `data/real/`: the records are below `data/real/regional-values/`
 * and the originals below `data/real/raw/regional-values/`, as in the repository.
 */

export const FICTIONAL_TABLE = "名称,種別,件数\nあおば,A,12\nみなと,B,7\nひなた,A,3\n";

export const FICTIONAL_CATALOG = { name: "架空県オープンデータカタログ", datasetId: "fictional-pref-1" } as const;

export const FICTIONAL_LICENSE = { name: "試験用ライセンス", url: "https://example.org/license" } as const;

/** The SHA-256 and the size of a file, as a person who expects that file gives them. */
export function expectedOf(bytes: Uint8Array): IntakeRequest["expectedOriginal"] {
  return { sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
}

/**
 * A request that is complete. `over` replaces any of its items; an item that is `undefined` in it is taken out. Unless `expectedOriginal`
 * is given, it is the SHA-256 and the size of the original that the request has: the file, or the file that was converted.
 */
export function intakeRequest(over: Override<IntakeRequest> = {}): IntakeRequest {
  const made = overridden<IntakeRequest>(
    {
      sourceId: "fictional-shelters",
      fileName: "shelters.csv",
      bytes: encodeUtf8(FICTIONAL_TABLE),
      reference: { kind: "url", url: "https://example.org/dataset/shelters" },
      publisher: "架空県",
      publishedOn: "2026-07-27",
      retrievedAt: "2026-11-01T00:00:00Z",
      license: FICTIONAL_LICENSE,
      catalog: FICTIONAL_CATALOG,
      expectedOriginal: { sha256: "0".repeat(64), byteLength: 0 },
    },
    over,
  );
  if ("expectedOriginal" in over) {
    return made;
  }
  return { ...made, expectedOriginal: expectedOf(made.conversion?.originalBytes ?? made.bytes) };
}

const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 12;

/**
 * `rename`, tried again for a moment when Windows says that the file is in use. A virus scanner or an indexer can hold a
 * file that was written a moment ago, and the rename of it, or onto it (the replace of a record), then fails with `EPERM`,
 * `EACCES` or `EBUSY` and works a few milliseconds later. The tests make thousands of files, and without this they failed now
 * and then for a reason that is not in the code that they test (seen: the replace of a ledger, `EPERM`). `graceful-fs` does
 * the same. Any other error, and a fault that a test injects, is thrown at once. The code that is tested is not changed.
 */
export async function renameWithRetry(temporaryPath: string, finalPath: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporaryPath, finalPath);
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (attempt >= RENAME_ATTEMPTS || typeof code !== "string" || !TRANSIENT_RENAME_CODES.has(code)) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10 * 2 ** (attempt - 1), 200)));
    }
  }
}

/** A rename that fails for the files whose final path `matches`: a fault of the file system at one write. The others are renamed as they are. */
export function failRenameTo(matches: (finalPath: string) => boolean): AtomicFileOperationOverrides {
  return {
    rename: async (temporaryPath, finalPath) => {
      if (matches(finalPath)) {
        throw new Error("injected fault");
      }
      await renameWithRetry(temporaryPath, finalPath);
    },
  };
}

/**
 * File operations that do not wait for the disk to confirm a write (no `fsync`), for the property tests, which make
 * thousands of files. What a write does is the same; only the wait is left out. The examples keep the real operations.
 */
export const FAST_OPERATIONS: AtomicFileOperationOverrides = {
  openExclusive: async (path) => {
    const handle = await open(path, "wx");
    return {
      writeFile: (bytes) => handle.writeFile(bytes),
      sync: () => Promise.resolve(),
      close: () => handle.close(),
    };
  },
  rename: renameWithRetry,
};

/** What every store of a world has, whatever else a test gives it: the rename that is tried again. A test that gives its own `rename` replaces it. */
const WORLD_OPERATIONS: AtomicFileOperationOverrides = { rename: renameWithRetry };

export type IntakeWorld = Readonly<{
  base: string;
  store: IntakeStore;
  /** The path below the records of real data. */
  recordPath: (relativePath: string) => string;
  /** The path below the originals. */
  rawPath: (relativePath: string) => string;
  /** Every file below the world, as `records/...` and `raw/...` paths with `/`, in order. A directory is not listed. */
  files: () => Promise<readonly string[]>;
  readText: (path: string) => Promise<string>;
  readJson: (path: string) => Promise<unknown>;
  /** Writes a file of the records or of the originals by hand, as a person would. */
  putRecord: (relativePath: string, value: unknown) => Promise<void>;
  /** A record file with the text as it is (it may be a text that is not JSON). */
  putRecordText: (relativePath: string, text: string) => Promise<void>;
  putRaw: (relativePath: string, bytes: Uint8Array) => Promise<void>;
  /** A store of the same places with other seams for the file system. */
  storeWith: (operations: AtomicFileOperationOverrides) => IntakeStore;
  remove: () => Promise<void>;
}>;

async function listFiles(directory: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of [...entries].sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))) {
    if (entry.isDirectory()) {
      found.push(...(await listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)));
    } else {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

/**
 * A world of real data in a temporary directory. The records of the tests are not the repository's and not in Git. With `base`, the
 * world is made in a directory that a test already has (a workspace of the build, where the command line looks for the records), and
 * `remove` leaves that directory to its owner.
 */
export async function createIntakeWorld(options: Readonly<{ operations?: AtomicFileOperationOverrides; base?: string }> = {}): Promise<IntakeWorld> {
  const ownsBase = options.base === undefined;
  const base = options.base ?? (await mkdtemp(join(tmpdir(), "rv-intake-")));
  const root: RecordRoot = { dataKind: "REAL_AI", rootDir: join(base, "data", "real", "regional-values"), logicalRoot: REAL_LOGICAL_ROOT };
  const store = createIntakeStore(root, { operations: { ...WORLD_OPERATIONS, ...options.operations } });
  const recordPath = (relativePath: string): string => join(root.rootDir, ...relativePath.split("/"));
  const rawPath = (relativePath: string): string => join(store.rawRoot, ...relativePath.split("/"));
  const put = async (path: string, content: Uint8Array): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  return {
    base,
    store,
    recordPath,
    rawPath,
    files: async () => [...(await listFiles(root.rootDir, "records/")), ...(await listFiles(store.rawRoot, "raw/"))].sort(),
    readText: (path) => readFile(path, "utf8"),
    readJson: async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
    putRecord: (relativePath, value) => put(recordPath(relativePath), encodeCanonicalJson(value)),
    putRecordText: (relativePath, text) => put(recordPath(relativePath), encodeUtf8(text)),
    putRaw: (relativePath, bytes) => put(rawPath(relativePath), bytes),
    storeWith: (operations) => createIntakeStore(root, { operations: { ...WORLD_OPERATIONS, ...operations } }),
    remove: () => (ownsBase ? rm(base, { recursive: true, force: true }) : Promise.resolve()),
  };
}
