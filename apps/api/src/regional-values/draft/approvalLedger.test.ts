import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ApprovalLedgerRecordSchema } from "@ehime-vote-navigator/contracts";
import type { ApprovalLedgerRecord } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createTempRoot, hashOfName } from "../../../../../tests/harness/regional-values/draftSupport.js";
import type { TempRoot } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { appendLedgerRecord, countValidApprovals, hashOf, ledgerRecordPath, readLedger } from "./approvalLedger.js";
import { FIXTURE_LOGICAL_ROOT } from "./types.js";

const H1 = hashOfName("content-1");
const H2 = hashOfName("content-2");

function approve(approverId: string, approvedAt: string, over: Record<string, unknown> = {}): ApprovalLedgerRecord {
  return ApprovalLedgerRecordSchema.parse({
    type: "APPROVE",
    targetKind: "CARD",
    targetId: "card-1",
    targetHash: H1,
    approverId,
    approvedAt,
    ...over,
  });
}

function revoke(revokedAt: string, over: Record<string, unknown> = {}): ApprovalLedgerRecord {
  return ApprovalLedgerRecordSchema.parse({
    type: "REVOKE",
    targetKind: "CARD",
    targetId: "card-1",
    targetHash: H1,
    revokerId: "reviewer-9",
    revokedAt,
    ...over,
  });
}

const QUERY = { targetKind: "CARD", targetId: "card-1", targetHash: H1 } as const;

describe("countValidApprovals", () => {
  it("is sufficient when the number of different approvers of this content reaches the number that is required", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z"), approve("b", "2026-11-13T00:01:00Z")];
    expect(countValidApprovals(records, QUERY, 1)).toEqual({ ok: true, value: { approverIds: ["a", "b"] } });
    expect(countValidApprovals(records, QUERY, 2)).toEqual({ ok: true, value: { approverIds: ["a", "b"] } });
    expect(countValidApprovals(records, QUERY, 3)).toEqual({ ok: false, error: { code: "APPROVER_COUNT_INSUFFICIENT", approverCount: 2, requiredApprovers: 3 } });
  });

  it("counts one person once, however many times the person approves", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z"), approve("a", "2026-11-13T01:00:00Z")];
    expect(countValidApprovals(records, QUERY, 2)).toEqual({ ok: false, error: { code: "APPROVER_COUNT_INSUFFICIENT", approverCount: 1, requiredApprovers: 2 } });
  });

  it("ignores the approvals of another content: a change of the content makes the earlier records invalid", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z"), approve("b", "2026-11-13T00:01:00Z")];
    expect(countValidApprovals(records, { ...QUERY, targetHash: H2 }, 1)).toEqual({
      ok: false,
      error: { code: "APPROVER_COUNT_INSUFFICIENT", approverCount: 0, requiredApprovers: 1 },
    });
    const withNew = [...records, approve("c", "2026-11-14T00:00:00Z", { targetHash: H2 })];
    expect(countValidApprovals(withNew, { ...QUERY, targetHash: H2 }, 1)).toEqual({ ok: true, value: { approverIds: ["c"] } });
  });

  it("ignores the approvals of another target of the same content", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z", { targetId: "card-2" }), approve("b", "2026-11-13T00:00:00Z", { targetKind: "QUESTION" })];
    expect(countValidApprovals(records, QUERY, 1).ok).toBe(false);
  });

  it("does not count an approval that a revocation of the same content follows, and the revocation wins at the same time", () => {
    const earlier = approve("a", "2026-11-13T00:00:00Z");
    expect(countValidApprovals([earlier, revoke("2026-11-13T00:30:00Z")], QUERY, 1).ok).toBe(false);
    expect(countValidApprovals([earlier, revoke("2026-11-13T00:00:00Z")], QUERY, 1).ok).toBe(false);
    // An approval that is made after the revocation counts, and the approval before it does not.
    const records = [earlier, revoke("2026-11-13T00:30:00Z"), approve("b", "2026-11-13T01:00:00Z")];
    expect(countValidApprovals(records, QUERY, 1)).toEqual({ ok: true, value: { approverIds: ["b"] } });
  });

  it("is not changed by a revocation of other content", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z"), revoke("2026-11-13T05:00:00Z", { targetHash: H2 }), revoke("2026-11-13T05:00:00Z", { targetId: "card-2" })];
    expect(countValidApprovals(records, QUERY, 1).ok).toBe(true);
  });

  it("counts the approval that the target holds as the first, and a revocation ends it too", () => {
    const first = { approverId: "first", approvedAt: "2026-11-13T00:00:00Z" };
    const records = [approve("second", "2026-11-13T01:00:00Z")];
    expect(countValidApprovals(records, { ...QUERY, firstApproval: first }, 2)).toEqual({ ok: true, value: { approverIds: ["first", "second"] } });
    expect(countValidApprovals([], { ...QUERY, firstApproval: first }, 2).ok).toBe(false);
    // The same person is counted once.
    expect(countValidApprovals([approve("first", "2026-11-13T01:00:00Z")], { ...QUERY, firstApproval: first }, 2).ok).toBe(false);
    expect(countValidApprovals([revoke("2026-11-13T02:00:00Z")], { ...QUERY, firstApproval: first }, 1).ok).toBe(false);
  });

  it("does not depend on the order of the records", () => {
    const records = [approve("a", "2026-11-13T00:00:00Z"), revoke("2026-11-13T00:30:00Z"), approve("b", "2026-11-13T01:00:00Z"), approve("c", "2026-11-13T02:00:00Z")];
    const expected = countValidApprovals(records, QUERY, 2);
    expect(countValidApprovals([...records].reverse(), QUERY, 2)).toEqual(expected);
    expect(expected).toEqual({ ok: true, value: { approverIds: ["b", "c"] } });
  });
});

describe("the files of the ledger", () => {
  let temp: TempRoot | undefined;

  afterEach(async () => {
    await temp?.remove();
    temp = undefined;
  });

  it("names a file by the target and by the SHA-256 of the record", () => {
    const record = approve("a", "2026-11-13T00:00:00Z");
    expect(ledgerRecordPath(record)).toBe(`approvals/CARD/card-1/${hashOf(record)}.json`);
    expect(hashOf(record)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashOf(approve("b", "2026-11-13T00:00:00Z"))).not.toBe(hashOf(record));
  });

  it("writes one file for each record, writes the same record again without a change, and reads them all", async () => {
    temp = await createTempRoot("FIXTURE");
    const records = [approve("a", "2026-11-13T00:00:00Z"), approve("b", "2026-11-13T00:00:00Z"), revoke("2026-11-13T05:00:00Z"), approve("a", "2026-11-13T00:00:00Z", { targetId: "card-2" })];
    for (const record of records) {
      expect(await appendLedgerRecord(temp.root, record)).toEqual({ ok: true, value: "created" });
    }
    expect(await appendLedgerRecord(temp.root, records[0] as ApprovalLedgerRecord)).toEqual({ ok: true, value: "already-present" });
    expect(await readdir(join(temp.root.rootDir, "approvals", "CARD", "card-1"))).toHaveLength(3);

    const read = await readLedger(temp.root);
    expect(read.ok && read.value).toHaveLength(4);
    expect(read.ok && read.value.map((record) => hashOf(record)).sort()).toEqual(records.map((record) => hashOf(record)).sort());
  });

  it("does not write a record that the contract does not accept", async () => {
    temp = await createTempRoot("FIXTURE");
    const withoutChecks = { type: "APPROVE", targetKind: "ISSUE", targetId: "issue-1", targetHash: H1, targetVersion: 1, approverId: "a", approvedAt: "2026-11-13T00:00:00Z" };
    expect(await appendLedgerRecord(temp.root, withoutChecks as unknown as ApprovalLedgerRecord)).toEqual({ ok: false, error: { code: "RECORD_INVALID" } });
    const falseCheck = { ...withoutChecks, issueChecks: { factsMatch: false } };
    expect(await appendLedgerRecord(temp.root, falseCheck as unknown as ApprovalLedgerRecord)).toEqual({ ok: false, error: { code: "RECORD_INVALID" } });
    expect(await readLedger(temp.root)).toEqual({ ok: true, value: [] });
  });

  it("finds a file that is not where its content says it is", async () => {
    temp = await createTempRoot("FIXTURE");
    const record = approve("a", "2026-11-13T00:00:00Z");
    await appendLedgerRecord(temp.root, record);
    const folder = join(temp.root.rootDir, "approvals", "CARD", "card-1");
    await mkdir(join(temp.root.rootDir, "approvals", "CARD", "card-2"), { recursive: true });
    await rename(join(folder, `${hashOf(record)}.json`), join(temp.root.rootDir, "approvals", "CARD", "card-2", `${hashOf(record)}.json`));
    expect(await readLedger(temp.root)).toEqual({ ok: false, error: { code: "LEDGER_PATH_MISMATCH" } });
  });

  it("finds a file that was edited by hand: the SHA-256 in its name is not the SHA-256 of its content", async () => {
    temp = await createTempRoot("FIXTURE");
    const record = approve("a", "2026-11-13T00:00:00Z");
    await appendLedgerRecord(temp.root, record);
    const path = join(temp.root.rootDir, "approvals", "CARD", "card-1", `${hashOf(record)}.json`);
    await writeFile(path, JSON.stringify({ ...record, approverId: "someone-else" }), "utf8");
    expect(await readLedger(temp.root)).toEqual({ ok: false, error: { code: "LEDGER_PATH_MISMATCH" } });
  });

  it("is not read from a place that is not the place of the data kind", async () => {
    temp = await createTempRoot("FIXTURE");
    await appendLedgerRecord(temp.root, approve("a", "2026-11-13T00:00:00Z"));
    expect((await readLedger({ ...temp.root, dataKind: "REAL_AI", logicalRoot: FIXTURE_LOGICAL_ROOT })).ok).toBe(false);
  });
});
