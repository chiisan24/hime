import { ApprovalLedgerRecordSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { ApprovalLedgerRecord, ApprovalTargetKind, Sha256 } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import type { AtomicFileOperationOverrides } from "../../store/atomicFiles.js";
import { writeImmutableRecord } from "./draftStore.js";
import type { StoreError } from "./draftStore.js";
import { readRecords } from "./recordReader.js";
import type { ReadRecordsError } from "./recordReader.js";
import { fail, succeed } from "./types.js";
import type { Outcome, RecordRoot } from "./types.js";

/**
 * The approval ledger (design: 承認者数と承認台帳). One file for each record, never changed:
 *
 *   approvals/<targetKind>/<targetId>/<SHA-256 of the record>.json
 *
 * An approval is revoked by a REVOKE record, and a change of the content of the target is a new
 * `targetHash`, so the records for the old content stop counting. Two approvers write two files, so
 * no write can lose the other (a file that is rewritten as a whole would).
 */

/** The SHA-256 of the canonical JSON of a value (a record of the ledger, the content of a target). */
export function hashOf(value: unknown): Sha256 {
  return Sha256Schema.parse(sha256Hex(encodeCanonicalJson(value)));
}

export function ledgerRecordPath(record: ApprovalLedgerRecord): string {
  return `approvals/${record.targetKind}/${record.targetId}/${hashOf(record)}.json`;
}

export type LedgerError = ReadRecordsError | StoreError | Readonly<{ code: "LEDGER_PATH_MISMATCH" }>;

/** Writes one record of the ledger. The same record written again is `already-present`. */
export async function appendLedgerRecord(
  root: RecordRoot,
  record: ApprovalLedgerRecord,
  operations?: AtomicFileOperationOverrides,
): Promise<Outcome<"created" | "already-present", StoreError>> {
  const parsed = ApprovalLedgerRecordSchema.safeParse(record);
  if (!parsed.success) {
    return fail({ code: "RECORD_INVALID" });
  }
  return writeImmutableRecord(root, ledgerRecordPath(parsed.data), parsed.data, operations);
}

/**
 * Reads the whole ledger (through `readRecords`, so a record of the other data kind or a place that
 * is not the place of the kind fails the read). A file must be where its content says it is: the
 * target kind, the target ID and the SHA-256 are in its path, so a record that was moved or edited
 * is found.
 */
export async function readLedger(root: RecordRoot): Promise<Outcome<readonly ApprovalLedgerRecord[], LedgerError>> {
  const read = await readRecords(root, "approvals", ApprovalLedgerRecordSchema, { recursive: true, declaresDataKind: false });
  if (!read.ok) {
    return fail(read.error);
  }
  for (const stored of read.value) {
    if (stored.relativePath !== ledgerRecordPath(stored.record)) {
      return fail({ code: "LEDGER_PATH_MISMATCH" });
    }
  }
  return succeed(read.value.map((stored) => stored.record));
}

export type ApprovalQuery = Readonly<{
  targetKind: ApprovalTargetKind;
  targetId: string;
  /** The SHA-256 of the content as it is now (without the fields of the approval). */
  targetHash: string;
  /**
   * The approval that the target itself holds (the `approval` of a question, a card, a text). It
   * counts as one approval like a record of the ledger, and a revocation of the content ends it too;
   * an issue has none. The type of `approval` is not changed (design).
   */
  firstApproval?: Readonly<{ approverId: string; approvedAt: string }>;
}>;

export type ApprovalCount = Readonly<{
  /** The different approvers of the valid approvals, in the order of their IDs. */
  approverIds: readonly string[];
}>;

export type ApprovalShortage = Readonly<{
  code: "APPROVER_COUNT_INSUFFICIENT";
  approverCount: number;
  requiredApprovers: number;
}>;

function instant(value: string): number {
  return Date.parse(value);
}

export type ApprovalEntry = Readonly<{ approverId: string; approvedAt: string }>;

export type ApprovalsOfContent = Readonly<{
  /** Every approval of this content (the approvals of the ledger, and the one that the target holds). */
  all: readonly ApprovalEntry[];
  /** The approvals that count: no REVOKE of the same content is as late as they are or later. */
  valid: readonly ApprovalEntry[];
  /** The approvals that a REVOKE of the same content ended. */
  revoked: readonly ApprovalEntry[];
}>;

/**
 * The approvals of one content (the same target and the same `targetHash`), told apart into the
 * ones that count and the ones that a revocation ended. An APPROVE counts when no REVOKE of the
 * same content is as late as it or later (when the times are the same, the revocation wins). The
 * order of the records does not change the result.
 */
export function approvalsOf(records: readonly ApprovalLedgerRecord[], query: ApprovalQuery): ApprovalsOfContent {
  const same = (record: ApprovalLedgerRecord): boolean =>
    record.targetKind === query.targetKind && record.targetId === query.targetId && record.targetHash === query.targetHash;
  let latestRevocation = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (record.type === "REVOKE" && same(record)) {
      latestRevocation = Math.max(latestRevocation, instant(record.revokedAt));
    }
  }
  const all: ApprovalEntry[] = [];
  if (query.firstApproval !== undefined) {
    all.push({ approverId: query.firstApproval.approverId, approvedAt: query.firstApproval.approvedAt });
  }
  for (const record of records) {
    if (record.type === "APPROVE" && same(record)) {
      all.push({ approverId: record.approverId, approvedAt: record.approvedAt });
    }
  }
  return {
    all,
    valid: all.filter((entry) => instant(entry.approvedAt) > latestRevocation),
    revoked: all.filter((entry) => instant(entry.approvedAt) <= latestRevocation),
  };
}

/**
 * The approvals that count now. An APPROVE counts when it names the content as it is now
 * (`targetHash`) and no REVOKE of the same content is as late as it or later: when the times are the
 * same, the revocation wins. The approvers are counted by their IDs, so one person who approves
 * twice counts once. Sufficient when the number reaches `requiredApprovers`; if not, the result
 * is `APPROVER_COUNT_INSUFFICIENT` (a shortage that a person can supply).
 *
 * It does not read the clock and the disk, and the order of the records does not change the result.
 */
export function countValidApprovals(
  records: readonly ApprovalLedgerRecord[],
  query: ApprovalQuery,
  requiredApprovers: number,
): Outcome<ApprovalCount, ApprovalShortage> {
  const approvers = new Set<string>(approvalsOf(records, query).valid.map((approval) => approval.approverId));
  const approverIds = [...approvers].sort();
  if (approverIds.length < requiredApprovers) {
    return fail({ code: "APPROVER_COUNT_INSUFFICIENT", approverCount: approverIds.length, requiredApprovers });
  }
  return succeed({ approverIds });
}
