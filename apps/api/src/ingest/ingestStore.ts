import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  IngestRecordSchema,
  isValidIngestSourceId,
  type IngestRecord,
} from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, type Result } from "@ehime-vote-navigator/domain";

import {
  atomicWriteImmutableFile,
  writeContentAddressedFile,
  type AtomicFileOperationOverrides,
} from "../store/atomicFiles.js";
import type { IngestStore, IngestStoreError } from "./ingest.js";

export type FileIngestStoreOptions = Readonly<{
  /** Test seam for the atomic writes; the real filesystem is the default. */
  operations?: AtomicFileOperationOverrides;
  /** Absolute path of `data/real` (Git ignored). */
  realDataRoot: string;
}>;

const RECORD_FILE_PATTERN = /^r([1-9][0-9]*)\.json$/u;

const READ_FAILED: Result<never, IngestStoreError> = {
  ok: false,
  error: Object.freeze({ code: "STORE_READ_FAILED" as const }),
};
const WRITE_FAILED: Result<never, IngestStoreError> = {
  ok: false,
  error: Object.freeze({ code: "STORE_WRITE_FAILED" as const }),
};

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * File-backed store below `data/real`: raw bodies at
 * `raw/objects/<xx>/<yy>/<sha256>.pdf` (content-addressed, written once) and one
 * immutable record per revision at `ingest/<sourceId>/<revision>.json`.
 * A corrupt record directory makes every read fail closed.
 */
export function createFileIngestStore(options: FileIngestStoreOptions): IngestStore {
  const rawRoot = join(options.realDataRoot, "raw");
  const ingestRoot = join(options.realDataRoot, "ingest");
  const operations =
    options.operations === undefined ? {} : { operations: options.operations };

  async function readSourceRecords(sourceId: string): Promise<IngestRecord[]> {
    let names: string[];
    try {
      names = await readdir(join(ingestRoot, sourceId));
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }

    const numbers = names
      .map((name) => RECORD_FILE_PATTERN.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .sort((left, right) => left - right);

    const records: IngestRecord[] = [];
    for (const [position, number] of numbers.entries()) {
      if (number !== position + 1) {
        throw new Error("revision gap");
      }
      const text = await readFile(join(ingestRoot, sourceId, `r${number}.json`), "utf8");
      const parsed = IngestRecordSchema.safeParse(JSON.parse(text));
      if (
        !parsed.success ||
        parsed.data.sourceId !== sourceId ||
        parsed.data.revision !== `r${number}`
      ) {
        throw new Error("corrupt record");
      }
      records.push(parsed.data);
    }
    return records;
  }

  return {
    async listRecords(sourceId) {
      if (!isValidIngestSourceId(sourceId)) {
        return READ_FAILED;
      }
      try {
        return { ok: true, value: await readSourceRecords(sourceId) };
      } catch {
        return READ_FAILED;
      }
    },

    async findSourceIdsBySha256(sha256) {
      try {
        let entries;
        try {
          entries = await readdir(ingestRoot, { withFileTypes: true });
        } catch (error) {
          if (isMissing(error)) {
            return { ok: true, value: [] };
          }
          throw error;
        }

        const holders: string[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || !isValidIngestSourceId(entry.name)) {
            continue;
          }
          const records = await readSourceRecords(entry.name);
          if (records.some((record) => record.sha256 === sha256)) {
            holders.push(entry.name);
          }
        }
        return { ok: true, value: holders };
      } catch {
        return READ_FAILED;
      }
    },

    async saveRawObject(bytes) {
      try {
        await mkdir(rawRoot, { recursive: true });
        const written = await writeContentAddressedFile({
          allowedRoot: rawRoot,
          bytes,
          directory: "objects",
          extension: ".pdf",
          ...operations,
        });
        return { ok: true, value: written.relativePath };
      } catch {
        return WRITE_FAILED;
      }
    },

    async saveRecord(record) {
      try {
        await mkdir(options.realDataRoot, { recursive: true });
        await atomicWriteImmutableFile({
          allowedRoot: options.realDataRoot,
          bytes: encodeCanonicalJson(record),
          relativePath: `ingest/${record.sourceId}/${record.revision}.json`,
          ...operations,
        });
        return { ok: true, value: undefined };
      } catch {
        return WRITE_FAILED;
      }
    },
  };
}