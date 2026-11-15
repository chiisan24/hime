import { mkdir } from "node:fs/promises";

import { DraftEventSchema, DraftRecordSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { DraftEvent, DraftRecord, DraftRunKey, DraftTask, Sha256 } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { atomicWriteImmutableFile, AtomicFileError } from "../../store/atomicFiles.js";
import type { AtomicFileOperationOverrides } from "../../store/atomicFiles.js";
import { readRecords } from "./recordReader.js";
import type { ReadRecordsErrorCode } from "./recordReader.js";
import { fail, succeed } from "./types.js";
import type { Outcome, RecordRoot } from "./types.js";

/**
 * The saved drafts and the draft events (design: 保存、冪等性、制約). Both are written once and
 * never changed (`atomicWriteImmutableFile`): a draft has no field that changes after it is saved,
 * because what became of it is derived from the events.
 *
 *   drafts/<task>/<draftId>.json   a draft that passed the checks
 *   events/<eventId>.json          a record of the process, named by the SHA-256 of its content
 */

export type StoreErrorCode = "STORE_WRITE_FAILED" | "IMMUTABLE_CONFLICT" | "RECORD_INVALID" | ReadRecordsErrorCode;

export type StoreError = Readonly<{ code: StoreErrorCode }>;

export type DraftStore = Readonly<{
  root: RecordRoot;
  /** Saves a draft. The same draft saved again is `already-present`; a different draft with the same ID is a conflict. */
  saveDraft: (record: DraftRecord) => Promise<Outcome<"created" | "already-present", StoreError>>;
  appendEvent: (event: DraftEvent) => Promise<Outcome<"created" | "already-present", StoreError>>;
  /** The saved drafts, of one task or of every task, in the order of their paths. */
  loadDrafts: (task?: DraftTask) => Promise<Outcome<readonly DraftRecord[], StoreError>>;
  findDraft: (task: DraftTask, draftId: string) => Promise<Outcome<DraftRecord | null, StoreError>>;
  loadEvents: () => Promise<Outcome<readonly DraftEvent[], StoreError>>;
}>;

export type DraftStoreOptions = Readonly<{
  /** The seam for the faults of the file system in a test. */
  operations?: AtomicFileOperationOverrides;
}>;

const DRAFT_TASK_NAMES: readonly DraftTask[] = [
  "ISSUE_CANDIDATE",
  "ISSUE_SUMMARY",
  "BACKGROUND_DRAFT",
  "TERM_GLOSS",
  "QUESTION_DRAFT",
  "NEUTRALITY_REVIEW",
  "THEME_CLASSIFY",
];

/** The ID of a draft: the SHA-256 of the canonical JSON of its run key. */
export function draftIdOf(key: DraftRunKey): Sha256 {
  return Sha256Schema.parse(sha256Hex(encodeCanonicalJson(key)));
}

/** A draft event with its ID, which is the SHA-256 of the canonical JSON of the rest. */
export function makeDraftEvent(fields: Omit<DraftEvent, "eventId">): DraftEvent {
  const eventId = Sha256Schema.parse(sha256Hex(encodeCanonicalJson(fields)));
  return DraftEventSchema.parse({ ...fields, eventId });
}

export async function writeImmutableRecord(
  root: RecordRoot,
  relativePath: string,
  value: unknown,
  operations?: AtomicFileOperationOverrides,
): Promise<Outcome<"created" | "already-present", StoreError>> {
  try {
    await mkdir(root.rootDir, { recursive: true });
    const result = await atomicWriteImmutableFile({
      allowedRoot: root.rootDir,
      relativePath,
      bytes: encodeCanonicalJson(value),
      ...(operations === undefined ? {} : { operations }),
    });
    return succeed(result.state);
  } catch (error) {
    return fail({ code: error instanceof AtomicFileError && error.code === "IMMUTABLE_CONFLICT" ? "IMMUTABLE_CONFLICT" : "STORE_WRITE_FAILED" });
  }
}

export function createDraftStore(root: RecordRoot, options: DraftStoreOptions = {}): DraftStore {
  const saveDraft: DraftStore["saveDraft"] = async (record) => {
    const parsed = DraftRecordSchema.safeParse(record);
    if (!parsed.success) {
      return fail({ code: "RECORD_INVALID" });
    }
    return writeImmutableRecord(root, `drafts/${parsed.data.key.task}/${parsed.data.draftId}.json`, parsed.data, options.operations);
  };
  const appendEvent: DraftStore["appendEvent"] = async (event) => {
    const parsed = DraftEventSchema.safeParse(event);
    if (!parsed.success) {
      return fail({ code: "RECORD_INVALID" });
    }
    return writeImmutableRecord(root, `events/${parsed.data.eventId}.json`, parsed.data, options.operations);
  };
  const loadDrafts: DraftStore["loadDrafts"] = async (task) => {
    const drafts: DraftRecord[] = [];
    for (const name of task === undefined ? DRAFT_TASK_NAMES : [task]) {
      const read = await readRecords(root, `drafts/${name}`, DraftRecordSchema);
      if (!read.ok) {
        return fail(read.error);
      }
      drafts.push(...read.value.map((stored) => stored.record));
    }
    return succeed(drafts);
  };
  const findDraft: DraftStore["findDraft"] = async (task, draftId) => {
    const loaded = await loadDrafts(task);
    return loaded.ok ? succeed(loaded.value.find((draft) => draft.draftId === draftId) ?? null) : loaded;
  };
  const loadEvents: DraftStore["loadEvents"] = async () => {
    const read = await readRecords(root, "events", DraftEventSchema);
    return read.ok ? succeed(read.value.map((stored) => stored.record)) : fail(read.error);
  };
  return { root, saveDraft, appendEvent, loadDrafts, findDraft, loadEvents };
}
