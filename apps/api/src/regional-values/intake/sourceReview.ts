import { mkdir } from "node:fs/promises";

import { DatasetRecordSchema, RealSourceSchema } from "@ehime-vote-navigator/contracts";
import type { DatasetRecord, RealSource } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson } from "@ehime-vote-navigator/domain";

import { atomicReplaceFile } from "../../store/atomicReplaceFile.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { readDatasetRecords } from "./datasetLedger.js";
import { readRealSources } from "./sourceRecords.js";
import { datasetRecordPath, sourceRecordPath } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * The record of what a person decided about a source or a data set: the terms of use, the check for a
 * note of the data set itself, the sending to an external AI, and the adoption of a data set
 * (design 3: 人の確認). The intake starts each of them as "not decided" and never decides one. These
 * functions only write what a person gives, as it is:
 *
 *  - They never fill in a value. A review that is not given is not changed, and one that is given is
 *    taken as it is, with the person, the time and the evidence that the contract asks for. There is no
 *    default that says `CONFIRMED`, `ALLOWED` or `ADOPTED`.
 *  - What is written has to be a valid record. The whole record is checked again (a data set is
 *    `ADOPTED` only with its terms of use `CONFIRMED` and its note checked), and a record that is not valid
 *    is not written.
 *  - Nothing else in the record changes. The record is replaced as a whole, atomically, or not at all.
 */

export type UsageReviewInput = Readonly<{ status: "CONFIRMED" | "UNKNOWN" | "RESTRICTED"; checkedAt: string; checkedTarget: string; evidence: string }>;

export type DatasetNoteReviewInput = Readonly<{ hasSpecificNote: boolean; noteSummary?: string; checkedBy: string; checkedAt: string }>;

export type TransmissionReviewInput =
  | Readonly<{ status: "UNKNOWN" }>
  | Readonly<{ status: "ALLOWED" | "DENIED"; checkedBy: string; checkedAt: string; evidence: string }>;

export type AdoptionInput =
  | Readonly<{ status: "CANDIDATE" }>
  | Readonly<{ status: "ADOPTED" | "REJECTED"; decidedBy: string; decidedAt: string; reason: string }>;

/** A review that is `undefined` or left out is not given: the record keeps what it has. */
export type SourceReviewUpdate = Readonly<{
  usage?: UsageReviewInput | undefined;
  /** `null` says that the check was not made. */
  datasetNote?: DatasetNoteReviewInput | null | undefined;
  transmission?: TransmissionReviewInput | undefined;
}>;

export type DatasetReviewUpdate = SourceReviewUpdate & Readonly<{ adoption?: AdoptionInput | undefined }>;

export const REVIEW_REFUSAL_CODES = ["REVIEW_EMPTY", "REVIEW_INVALID", "RECORD_NOT_FOUND", "STORE_READ_FAILED", "STORE_WRITE_FAILED"] as const;

export type ReviewRefusalCode = (typeof REVIEW_REFUSAL_CODES)[number];

/** The names of the items that are not valid. Never a value. */
export type ReviewRefusal = Readonly<{ code: ReviewRefusalCode; fields?: readonly string[]; reason?: string }>;

const REVIEW_NAMES = ["usage", "datasetNote", "transmission", "adoption"] as const;

/** The reviews that are given. A key that is present with `undefined` is not given. */
function givenOf(update: DatasetReviewUpdate): Readonly<Record<string, unknown>> {
  const given: Record<string, unknown> = {};
  for (const name of REVIEW_NAMES) {
    const value = (update as Readonly<Record<string, unknown>>)[name];
    if (value !== undefined) {
      given[name] = value;
    }
  }
  return given;
}

async function replace(store: IntakeStore, relativePath: string, record: unknown): Promise<Outcome<void, ReviewRefusal>> {
  try {
    await mkdir(store.root.rootDir, { recursive: true });
    await atomicReplaceFile({
      allowedRoot: store.root.rootDir,
      relativePath,
      bytes: encodeCanonicalJson(record),
      ...(store.operations === undefined ? {} : { operations: store.operations }),
    });
    return succeed(undefined);
  } catch {
    return fail({ code: "STORE_WRITE_FAILED" });
  }
}

/** Records the reviews of a person in the record of a source (one revision). Returns the record that was written. */
export async function recordSourceReview(
  store: IntakeStore,
  target: Readonly<{ sourceId: string; revision: string }>,
  update: SourceReviewUpdate,
): Promise<Outcome<RealSource, ReviewRefusal>> {
  const given = givenOf(update);
  if ("adoption" in given) {
    // A source has no adoption: a data set does.
    return fail({ code: "REVIEW_INVALID", fields: ["adoption"] });
  }
  if (Object.keys(given).length === 0) {
    // A call that gives no review is a mistake, not a record.
    return fail({ code: "REVIEW_EMPTY" });
  }
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return fail({ code: "STORE_READ_FAILED", reason: sources.error.cause });
  }
  const current = sources.value.find((source) => source.sourceId === target.sourceId && source.revision === target.revision);
  if (current === undefined) {
    return fail({ code: "RECORD_NOT_FOUND" });
  }
  const parsed = RealSourceSchema.safeParse({ ...current, ...given });
  if (!parsed.success) {
    return fail({ code: "REVIEW_INVALID", fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "record")))] });
  }
  const written = await replace(store, sourceRecordPath(current.sourceId, current.revision), parsed.data);
  return written.ok ? succeed(parsed.data) : written;
}

/** Records the reviews and the adoption of a person in the record of a data set. Returns the record that was written. */
export async function recordDatasetReview(store: IntakeStore, datasetKey: string, update: DatasetReviewUpdate): Promise<Outcome<DatasetRecord, ReviewRefusal>> {
  const given = givenOf(update);
  if (Object.keys(given).length === 0) {
    return fail({ code: "REVIEW_EMPTY" });
  }
  const datasets = await readDatasetRecords(store);
  if (!datasets.ok) {
    return fail({ code: "STORE_READ_FAILED", reason: datasets.error.cause });
  }
  const current = datasets.value.find((dataset) => dataset.datasetKey === datasetKey);
  if (current === undefined) {
    return fail({ code: "RECORD_NOT_FOUND" });
  }
  const parsed = DatasetRecordSchema.safeParse({ ...current, ...given });
  if (!parsed.success) {
    return fail({ code: "REVIEW_INVALID", fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "record")))] });
  }
  const written = await replace(store, datasetRecordPath(current.datasetKey), parsed.data);
  return written.ok ? succeed(parsed.data) : written;
}
