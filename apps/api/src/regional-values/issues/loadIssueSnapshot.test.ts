import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FIXTURE_FACTS, FICTIONAL_SOURCE_ID, realFact, realSource, testCheckConfig } from "../../../../../tests/harness/regional-values/draftSupport.js";
import {
  createIssueWorld,
  fixtureIssue,
  ISSUE_SETTINGS,
  ORIGINAL_BYTES,
  realIssue,
  realMaterial,
  settingsWith,
} from "../../../../../tests/harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../../../../../tests/harness/regional-values/issueSupport.js";
import { hashOf } from "../draft/approvalLedger.js";
import type { IssueSnapshot } from "./loadIssueSnapshot.js";

// Every record here is fictional or made for the test. The words of the checks are made-up markers.

const FACT_1 = FIXTURE_FACTS[0] as FixtureFact;
const FACT_3 = FIXTURE_FACTS[2] as FixtureFact;
// The approval of the process writes the time as `toISOString()` does, with the milliseconds.
const T1 = "2026-11-13T01:00:00.000Z";
const T2 = "2026-11-13T02:00:00.000Z";
const T3 = "2026-11-13T03:00:00.000Z";

async function snapshotOf(world: IssueWorld, settings = ISSUE_SETTINGS): Promise<IssueSnapshot> {
  const loaded = await world.load(settings);
  if (!loaded.ok) {
    throw new Error(`The snapshot was not loaded: ${loaded.error.code}`);
  }
  return loaded.value;
}

const reasonsOf = (snapshot: IssueSnapshot): string[] => snapshot.withdrawn.map((item) => `${item.issueId}:${item.version}:${item.reason}`);

describe("loadIssueSnapshot: fictional data", () => {
  let world: IssueWorld;
  beforeEach(async () => {
    world = await createIssueWorld("FIXTURE");
    await world.setFixtureFacts([FACT_1, FACT_3]);
  });
  afterEach(async () => {
    await world.remove();
  });

  it("puts an issue with a valid approval in issues, with its facts, its source and its approval", async () => {
    const record = fixtureIssue();
    await world.addIssue(record);
    await world.approve("issue-1", 1, "approver-a", T1);
    const snapshot = await snapshotOf(world);
    expect(snapshot.withdrawn).toEqual([]);
    expect(snapshot.issues).toHaveLength(1);
    const [issue] = snapshot.issues;
    expect(issue).toMatchObject({
      dataKind: "FIXTURE",
      issueId: "issue-1",
      version: 1,
      issueHash: hashOf(record),
      approval: { status: "APPROVED", approverId: "approver-a", approvedAt: T1, approverCount: 1 },
      basisFacts: [FACT_1, FACT_3],
      sources: [{ dataKind: "FIXTURE", sourceId: FICTIONAL_SOURCE_ID }],
    });
  });

  it("leaves an issue that was never approved in neither list", async () => {
    await world.addIssue(fixtureIssue());
    const snapshot = await snapshotOf(world);
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.withdrawn).toEqual([]);
  });

  it("counts the approvers by their IDs, and withdraws an issue with too few (APPROVAL_INSUFFICIENT)", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    await world.approve("issue-1", 1, "approver-a", T2);
    const settings = settingsWith({ requiredApprovers: 2 });
    expect(reasonsOf(await snapshotOf(world, settings))).toEqual(["issue-1:1:APPROVAL_INSUFFICIENT"]);

    await world.approve("issue-1", 1, "approver-b", T3);
    const snapshot = await snapshotOf(world, settings);
    expect(snapshot.withdrawn).toEqual([]);
    // The approval that is shown is the earliest valid one, and the count is of different approvers.
    expect(snapshot.issues[0]?.approval).toEqual({ status: "APPROVED", approverId: "approver-a", approvedAt: T1, approverCount: 2 });
  });

  it("withdraws an issue whose approval was revoked (REVOKED), and a later approval makes it valid again", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    await world.revoke("issue-1", 1, "approver-a", T2);
    const revoked = await snapshotOf(world);
    expect(reasonsOf(revoked)).toEqual(["issue-1:1:REVOKED"]);
    expect(revoked.reasons.get("issue-1")).toEqual(["REVOKED", "APPROVAL_INSUFFICIENT"]);

    await world.approve("issue-1", 1, "approver-a", T3);
    expect((await snapshotOf(world)).issues.map((issue) => issue.issueId)).toEqual(["issue-1"]);
  });

  it("does not carry an approval to a new version (CONTENT_CHANGED), and a new approval makes the new version valid", async () => {
    await world.addIssue(fixtureIssue("issue-1", 1));
    await world.approve("issue-1", 1, "approver-a", T1);
    const second = fixtureIssue("issue-1", 2, { title: "架空市のバス路線の見直し" });
    await world.addIssue(second);

    const changed = await snapshotOf(world);
    expect(reasonsOf(changed)).toEqual(["issue-1:2:CONTENT_CHANGED"]);
    expect(changed.reasons.get("issue-1")).toEqual(["CONTENT_CHANGED", "APPROVAL_INSUFFICIENT"]);

    await world.approve("issue-1", 2, "approver-a", T2);
    const renewed = await snapshotOf(world);
    expect(renewed.withdrawn).toEqual([]);
    expect(renewed.issues[0]).toMatchObject({ issueId: "issue-1", version: 2, issueHash: hashOf(second), title: "架空市のバス路線の見直し" });
  });

  it("does not count an approval that did not record the facts it rests on, and does not fill them in from the facts of today", async () => {
    await world.addIssue(fixtureIssue());
    await world.approveWithoutBasis("issue-1", 1, "approver-a", T1);
    const legacy = await snapshotOf(world);
    expect(legacy.issues).toEqual([]);
    expect(reasonsOf(legacy)).toEqual(["issue-1:1:CONTENT_CHANGED"]);
    expect(legacy.reasons.get("issue-1")).toEqual(["CONTENT_CHANGED", "APPROVAL_INSUFFICIENT"]);

    // Reading it again does not change it: the old approval is not written over, and stays what it was.
    const before = await world.treeText();
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-1:1:CONTENT_CHANGED"]);
    expect(await world.treeText()).toBe(before);

    // A person approves the same version again, now on the facts that are there: it is valid, and the old record is still in the ledger.
    await world.approve("issue-1", 1, "approver-a", T2);
    const renewed = await snapshotOf(world);
    expect(renewed.withdrawn).toEqual([]);
    expect(renewed.issues[0]?.approval).toEqual({ status: "APPROVED", approverId: "approver-a", approvedAt: T2, approverCount: 1 });
  });

  it("does not give an approval back to fact items that were made again (CONTENT_CHANGED), with the same record of the issue, until the version is approved again", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    expect((await snapshotOf(world)).issues).toHaveLength(1);

    // The fact item that the issue rests on is made again: the same ID, the same value, from another fictional source.
    const again = { ...FACT_3, fictionalSourceId: "fictional-doc-2" };
    await world.setFixtureFacts([FACT_1, again]);
    const stale = await snapshotOf(world);
    expect(stale.issues).toEqual([]);
    expect(reasonsOf(stale)).toEqual(["issue-1:1:CONTENT_CHANGED"]);
    expect(stale.reasons.get("issue-1")).toEqual(["CONTENT_CHANGED", "APPROVAL_INSUFFICIENT"]);

    // The facts go back to what they were: the approval is for them, and counts again.
    await world.setFixtureFacts([FACT_1, FACT_3]);
    expect((await snapshotOf(world)).withdrawn).toEqual([]);

    // Made again, and approved again on the new facts: valid. The earlier approval does not count for the new facts.
    await world.setFixtureFacts([FACT_1, again]);
    await world.approve("issue-1", 1, "approver-b", T3);
    const renewed = await snapshotOf(world);
    expect(renewed.withdrawn).toEqual([]);
    expect(renewed.issues[0]?.approval).toEqual({ status: "APPROVED", approverId: "approver-b", approvedAt: T3, approverCount: 1 });

    // The facts go back again: the first approval is the one that was made on them, and it is the one that counts.
    await world.setFixtureFacts([FACT_1, FACT_3]);
    const back = await snapshotOf(world);
    expect(back.withdrawn).toEqual([]);
    expect(back.issues[0]?.approval).toEqual({ status: "APPROVED", approverId: "approver-a", approvedAt: T1, approverCount: 1 });
  });

  it("counts only the approvers who approved the facts that are there: of two approvers, one approved before the facts changed", async () => {
    const settings = settingsWith({ requiredApprovers: 2 });
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    const again = { ...FACT_3, fictionalSourceId: "fictional-doc-2" };
    await world.setFixtureFacts([FACT_1, again]);
    await world.approve("issue-1", 1, "approver-b", T2);
    const one = await snapshotOf(world, settings);
    expect(reasonsOf(one)).toEqual(["issue-1:1:APPROVAL_INSUFFICIENT"]);

    await world.approve("issue-1", 1, "approver-a", T3);
    const both = await snapshotOf(world, settings);
    expect(both.withdrawn).toEqual([]);
    expect(both.issues[0]?.approval).toEqual({ status: "APPROVED", approverId: "approver-b", approvedAt: T2, approverCount: 2 });
  });

  it("withdraws an issue whose fact is not among the facts (FACT_UNVERIFIED)", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    // The fact item is taken away after the approval, which named it.
    await world.setFixtureFacts([FACT_1]);
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-1:1:FACT_UNVERIFIED"]);
    // The same fact item is there again: it is the same facts, and the approval counts again.
    await world.setFixtureFacts([FACT_1, FACT_3]);
    expect((await snapshotOf(world)).withdrawn).toEqual([]);
  });

  it("runs the checks of a draft again with the words now, and withdraws an issue that does not pass (CHECK_FAILED)", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    const words = testCheckConfig().words;
    const causal = settingsWith({ checks: { ...testCheckConfig(), words: { ...words, causalWords: ["利用"] } } });
    expect(reasonsOf(await snapshotOf(world, causal))).toEqual(["issue-1:1:CHECK_FAILED"]);
    const hedge = settingsWith({ checks: { ...testCheckConfig(), words: { ...words, hedgeEndings: ["別の語尾"] } } });
    expect(reasonsOf(await snapshotOf(world, hedge))).toEqual(["issue-1:1:CHECK_FAILED"]);
    expect(reasonsOf(await snapshotOf(world))).toEqual([]);
  });

  it("gives every reason that holds in the order of precedence, and the first one as the reason", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    await world.revoke("issue-1", 1, "approver-a", T2);
    await world.setFixtureFacts([FACT_1]);
    const causal = settingsWith({ checks: { ...testCheckConfig(), words: { ...testCheckConfig().words, causalWords: ["利用"] } } });
    const snapshot = await snapshotOf(world, causal);
    expect(snapshot.reasons.get("issue-1")).toEqual(["REVOKED", "APPROVAL_INSUFFICIENT", "FACT_UNVERIFIED", "CHECK_FAILED"]);
    expect(snapshot.withdrawn).toEqual([{ issueId: "issue-1", version: 1, reason: "REVOKED" }]);
  });

  it("lists each issue once, in the order of its ID, whatever the order of the files", async () => {
    const forward = fixtureIssue("issue-a");
    const backward = fixtureIssue("issue-b");
    await world.addIssue(backward);
    await world.addIssue(forward);
    await world.approve("issue-b", 1, "approver-a", T1);
    await world.approve("issue-a", 1, "approver-a", T1);
    const snapshot = await snapshotOf(world);
    expect(snapshot.issues.map((issue) => issue.issueId)).toEqual(["issue-a", "issue-b"]);

    const other = await createIssueWorld("FIXTURE");
    try {
      await other.setFixtureFacts([FACT_3, FACT_1]);
      await other.addIssue(forward);
      await other.addIssue(backward);
      await other.approve("issue-a", 1, "approver-a", T1);
      await other.approve("issue-b", 1, "approver-a", T1);
      const again = await snapshotOf(other);
      expect(again.inputDigest).toBe(snapshot.inputDigest);
      expect(JSON.stringify(again.issues)).toBe(JSON.stringify(snapshot.issues));
    } finally {
      await other.remove();
    }
  });

  it("writes nothing: the files are the same before and after, and the result is the same when it is read again", async () => {
    await world.addIssue(fixtureIssue());
    await world.approve("issue-1", 1, "approver-a", T1);
    await world.revoke("issue-1", 1, "approver-a", T2);
    const before = await world.treeText();
    const first = await snapshotOf(world);
    const second = await snapshotOf(world);
    expect(await world.treeText()).toBe(before);
    expect(second.inputDigest).toBe(first.inputDigest);
    expect(second.withdrawn).toEqual(first.withdrawn);
  });

  it("changes the input digest when any input changes: an approval, a revocation, a fact, a record, the words, the number of approvers", async () => {
    await world.addIssue(fixtureIssue());
    const digests = new Set<string>();
    const note = async (settings = ISSUE_SETTINGS): Promise<void> => {
      digests.add((await snapshotOf(world, settings)).inputDigest);
    };
    await note();
    await world.approve("issue-1", 1, "approver-a", T1);
    await note();
    await world.revoke("issue-1", 1, "approver-a", T2);
    await note();
    await world.setFixtureFacts([FACT_1, { ...FACT_3, value: { amount: 4, unit: "本" } }]);
    await note();
    await world.addIssue(fixtureIssue("issue-1", 2, { title: "別の題" }));
    await note();
    await note(settingsWith({ requiredApprovers: 2 }));
    await note(settingsWith({ checks: { ...testCheckConfig(), words: { ...testCheckConfig().words, causalWords: ["別の語"] } } }));
    expect(digests.size).toBe(7);
  });

  it("refuses a record of the other data kind, with a fixed code", async () => {
    await world.addIssue(realIssue("issue-r1"));
    const loaded = await world.load();
    expect(loaded).toEqual({ ok: false, error: { code: "DATA_KIND_MIXED" } });
  });
});

describe("loadIssueSnapshot: real data", () => {
  let world: IssueWorld;
  const material = realMaterial();

  async function prepare(options: Readonly<{ original?: boolean; fact?: Record<string, unknown>; source?: Record<string, unknown> }> = {}): Promise<void> {
    const { fact, source } = realMaterial({ ...(options.fact === undefined ? {} : { fact: options.fact }), ...(options.source === undefined ? {} : { source: options.source }) });
    await world.setRealFact(fact);
    await world.setRealSource(source);
    if (options.original !== false) {
      await world.setOriginal(source, ORIGINAL_BYTES);
    }
    await world.addIssue(realIssue());
    await world.approve("issue-r1", 1, "approver-a", T1);
  }

  beforeEach(async () => {
    world = await createIssueWorld("REAL_AI");
  });
  afterEach(async () => {
    await world.remove();
  });

  it("makes an approved issue of real data from verified facts, a confirmed source, and an original that did not change", async () => {
    await prepare();
    const snapshot = await snapshotOf(world);
    expect(snapshot.withdrawn).toEqual([]);
    expect(snapshot.issues).toHaveLength(1);
    expect(snapshot.issues[0]).toMatchObject({
      dataKind: "REAL_AI",
      basisFacts: [{ factId: "rf-1", verification: { status: "VERIFIED" } }],
      sources: [{ sourceId: material.source.sourceId, revision: material.source.revision }],
    });
  });

  it("withdraws the issue when the original changed (SOURCE_CHANGED), or cannot be looked at", async () => {
    await prepare();
    await world.setOriginal(material.source, new TextEncoder().encode("name,count\nfacility,13\n"));
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-r1:1:SOURCE_CHANGED"]);

    const missing = await createIssueWorld("REAL_AI");
    try {
      const { fact, source } = realMaterial();
      await missing.setRealFact(fact);
      await missing.setRealSource(source);
      await missing.addIssue(realIssue());
      await missing.approve("issue-r1", 1, "approver-a", T1);
      expect(reasonsOf(await snapshotOf(missing))).toEqual(["issue-r1:1:SOURCE_CHANGED"]);
    } finally {
      await missing.remove();
    }
  });

  it("does not give the approval back when the original changed, a new revision was taken in, the fact item was made again and verified, and the record of the issue is the same", async () => {
    await prepare();
    expect((await snapshotOf(world)).issues).toHaveLength(1);

    // 1. The original changes: the issue is withdrawn for the source.
    const newBytes = new TextEncoder().encode("name,count\nfacility,13\n");
    await world.setOriginal(material.source, newBytes);
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-r1:1:SOURCE_CHANGED"]);

    // 2. A new revision is taken in, and the fact item is made again from it and verified by a person. The record of the issue is not touched.
    const newSha = sha256Hex(newBytes);
    const renewedMaterial = realMaterial({
      fact: { sha256: newSha, retrievedAt: "2026-11-20T00:00:00Z", verification: { status: "VERIFIED", verifierId: "tester-2", verifiedAt: "2026-11-20T01:00:00Z" } },
      source: { sha256: newSha, revision: "rev-2", retrievedAt: "2026-11-20T00:00:00Z" },
    });
    await world.setRealSource(renewedMaterial.source);
    await world.setOriginal(renewedMaterial.source, newBytes);
    await world.setRealFact(renewedMaterial.fact);

    // Everything under the issue is in order again, and the old approval is of the old facts: the issue is not valid until it is approved again.
    const stale = await snapshotOf(world);
    expect(stale.issues).toEqual([]);
    expect(reasonsOf(stale)).toEqual(["issue-r1:1:CONTENT_CHANGED"]);
    expect(stale.reasons.get("issue-r1")).toEqual(["CONTENT_CHANGED", "APPROVAL_INSUFFICIENT"]);

    // 3. A person approves the version again on the new fact item. The first approval stays in the ledger and does not count.
    await world.approve("issue-r1", 1, "approver-a", T3);
    const renewed = await snapshotOf(world);
    expect(renewed.withdrawn).toEqual([]);
    expect(renewed.issues[0]).toMatchObject({ issueId: "issue-r1", version: 1, approval: { approverId: "approver-a", approvedAt: T3 }, basisFacts: [{ factId: "rf-1", sha256: newSha }] });
  });

  it("does not count an approval of real data that did not record its facts (an approval made before the basis was recorded)", async () => {
    const { fact, source } = realMaterial();
    await world.setRealFact(fact);
    await world.setRealSource(source);
    await world.setOriginal(source, ORIGINAL_BYTES);
    await world.addIssue(realIssue());
    await world.approveWithoutBasis("issue-r1", 1, "approver-a", T1);
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-r1:1:CONTENT_CHANGED"]);
    await world.approve("issue-r1", 1, "approver-a", T2);
    expect((await snapshotOf(world)).issues).toHaveLength(1);
  });

  it("withdraws the issue when a fact is not verified any more (FACT_UNVERIFIED)", async () => {
    await prepare({ fact: { verification: { status: "PROVISIONAL" } } });
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-r1:1:FACT_UNVERIFIED"]);
  });

  it("withdraws the issue when the terms of use are not confirmed, or the source may not be sent to an external AI (USAGE_CHANGED)", async () => {
    await prepare({ source: { usage: { status: "UNKNOWN", checkedAt: "2026-01-02", checkedTarget: "利用条件のページ", evidence: "確認できなかった" } } });
    expect(reasonsOf(await snapshotOf(world))).toEqual(["issue-r1:1:USAGE_CHANGED"]);

    const denied = await createIssueWorld("REAL_AI");
    try {
      const { fact, source } = realMaterial({ source: { transmission: { status: "UNKNOWN" } } });
      await denied.setRealFact(fact);
      await denied.setRealSource(source);
      await denied.setOriginal(source, ORIGINAL_BYTES);
      await denied.addIssue(realIssue());
      await denied.approve("issue-r1", 1, "approver-a", T1);
      expect(reasonsOf(await snapshotOf(denied))).toEqual(["issue-r1:1:USAGE_CHANGED"]);
    } finally {
      await denied.remove();
    }
  });

  it("names the source of a fact that has no record of its source as a changed source and a changed use", async () => {
    await world.setRealFact(realFact("rf-1", { sha256: material.fact.sha256 }));
    await world.addIssue(realIssue());
    await world.approve("issue-r1", 1, "approver-a", T1);
    const snapshot = await snapshotOf(world);
    expect(snapshot.reasons.get("issue-r1")).toEqual(["SOURCE_CHANGED", "USAGE_CHANGED"]);
  });

  it("does not use a source of another SHA-256 for a fact", async () => {
    await prepare({ source: { sha256: "e".repeat(64) } });
    const snapshot = await snapshotOf(world);
    expect(snapshot.reasons.get("issue-r1")).toEqual(["SOURCE_CHANGED", "USAGE_CHANGED"]);
  });

  it("changes the input digest when the original changes", async () => {
    await prepare();
    const before = (await snapshotOf(world)).inputDigest;
    await world.setOriginal(material.source, new TextEncoder().encode("changed"));
    expect((await snapshotOf(world)).inputDigest).not.toBe(before);
  });

  it("is not affected by a source that no fact rests on", async () => {
    await prepare();
    await world.setRealSource(realSource({ sourceId: "src-other", sha256: "f".repeat(64) }));
    expect((await snapshotOf(world)).issues).toHaveLength(1);
  });
});
