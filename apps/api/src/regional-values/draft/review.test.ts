import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { IssueSourceRecordSchema } from "@ehime-vote-navigator/contracts";
import type { DraftTask } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  candidateRequest,
  checkContextFor,
  createClock,
  createFakeClient,
  createTempRoot,
  createTestDeps,
  FIXTURE_FACTS,
  passingCandidate,
  passingQuestionDraft,
  passingSummary,
  questionRequest,
  summaryRequest,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import type { TempRoot } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { countValidApprovals, hashOf, readLedger } from "./approvalLedger.js";
import { readAiContribution } from "./contribution.js";
import { deriveDisposition } from "./disposition.js";
import { PROMPT_VERSION } from "./prompts/index.js";
import { adoptDraft, approveTarget, rejectDraft, revokeApproval } from "./review.js";
import type { ReviewDeps } from "./review.js";
import type { DraftRequest } from "./request.js";
import { runDraft } from "./runDraft.js";
import { writeImmutableRecord } from "./draftStore.js";

const temps: TempRoot[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((temp) => temp.remove()));
});

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const temp = await createTempRoot("FIXTURE");
  temps.push(temp);
  const fake = createFakeClient((call) => {
    if (call.text.includes("evidenceId")) {
      return JSON.stringify(passingSummary());
    }
    if (call.text.includes("themeId: TRANSPORT")) {
      return JSON.stringify(passingQuestionDraft("TRADEOFF"));
    }
    return JSON.stringify(passingCandidate());
  });
  const { deps } = createTestDeps(temp.root, fake.client);
  const review: ReviewDeps = { store: deps.store, now: createClock("2026-11-20T00:00:00.000Z", 60_000) };
  return { temp, fake, deps, review };
}

async function draftOf(state: Setup, request: DraftRequest, response?: unknown): Promise<string> {
  const outcome = await runDraft(response === undefined ? state.deps : { ...state.deps, client: createFakeClient([JSON.stringify(response)]).client }, request);
  if (!outcome.ok) {
    throw new Error(`the draft of the test must be made: ${outcome.error.code}`);
  }
  return outcome.value.draftId;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function eventKinds(state: Setup): Promise<string[]> {
  const events = await state.deps.store.loadEvents();
  return events.ok ? events.value.map((event) => event.kind).sort() : [];
}

const ISSUE = { targetKind: "ISSUE", targetId: "issue-1" } as const;
const ALL_CHECKS = {
  factsMatch: true,
  factAndHypothesisSeparated: true,
  noCausalClaim: true,
  noRecommendation: true,
  unknownsStated: true,
  sourcesShown: true,
} as const;

describe("adoptDraft: an issue candidate", () => {
  it("adopts it as it is, makes the record of the issue, and does not count it among the edited", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const adopted = await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: ISSUE });

    expect(adopted.ok).toBe(true);
    if (!adopted.ok) {
      return;
    }
    expect(adopted.value.event).toMatchObject({ kind: "HUMAN_ADOPTED", draftId, reviewerId: "reviewer-1", target: ISSUE });
    const path = join(state.temp.root.rootDir, "issues", "issue-1", "v1.json");
    const record = IssueSourceRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
    expect(record).toMatchObject({
      issueId: "issue-1",
      version: 1,
      themeId: "TRANSPORT",
      dataKind: "FIXTURE",
      basisFactIds: ["fx-1", "fx-3"],
      provenance: { aiInvolvement: "AI_DRAFT", draftId, modelId: "jp.anthropic.claude-haiku-5-5", promptVersion: PROMPT_VERSION, humanEdited: false },
    });
    expect(adopted.value.issueRecord).toEqual(record);

    const events = await state.deps.store.loadEvents();
    expect(deriveDisposition(draftId, events.ok ? events.value : [])).toBe("ADOPTED");
    expect(await readAiContribution(state.deps.store)).toEqual({ ok: true, value: { drafted: 1, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 } });
  });

  it("does not adopt it as a card, or a question, or any other target", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    for (const targetKind of ["CARD", "QUESTION", "RESULT_TEXT", "FIXED_TEXT"] as const) {
      const result = await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: { targetKind, targetId: "x-1" } });
      expect(result).toEqual({ ok: false, error: { code: "TARGET_KIND_INVALID" } });
    }
    expect(await eventKinds(state)).toEqual(["DRAFTED"]);
    expect(await exists(join(state.temp.root.rootDir, "issues"))).toBe(false);
  });

  it("makes the record of the issue with the edit of a person, when the edit passes the checks again", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const edited = passingCandidate({ title: "架空市のバス路線の本数" });
    const adopted = await adoptDraft(state.review, {
      task: "ISSUE_CANDIDATE",
      draftId,
      reviewerId: "reviewer-1",
      target: ISSUE,
      edited,
      recheck: checkContextFor(candidateRequest()),
    });
    expect(adopted.ok && adopted.value.event.kind).toBe("HUMAN_EDITED");
    const record = IssueSourceRecordSchema.parse(JSON.parse(await readFile(join(state.temp.root.rootDir, "issues", "issue-1", "v1.json"), "utf8")));
    expect(record.title).toBe("架空市のバス路線の本数");
    expect(record.provenance.humanEdited).toBe(true);
    expect(await readAiContribution(state.deps.store)).toEqual({ ok: true, value: { drafted: 1, rejectedByChecks: 0, humanEdited: 1, humanRejected: 0 } });
  });

  it("treats an edit that changes nothing as an adoption without a change", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const adopted = await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: ISSUE, edited: passingCandidate() });
    expect(adopted.ok && adopted.value.event.kind).toBe("HUMAN_ADOPTED");
  });

  it("checks what a person changed under the same conditions as a draft, and writes nothing when it fails", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const args = { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: ISSUE } as const;

    expect(await adoptDraft(state.review, { ...args, edited: passingCandidate({ title: "別の題名" }) })).toEqual({ ok: false, error: { code: "RECHECK_CONTEXT_MISSING" } });
    const violating = passingCandidate({ statement: "推奨語の路線を確かめたい仮説語尾" });
    expect(await adoptDraft(state.review, { ...args, edited: violating, recheck: checkContextFor(candidateRequest()) })).toEqual({
      ok: false,
      error: { code: "RECHECK_FAILED", violations: [{ check: "DR_FORBIDDEN_WORDS", target: "statement" }] },
    });
    expect(await eventKinds(state)).toEqual(["DRAFTED"]);
    expect(await exists(join(state.temp.root.rootDir, "issues"))).toBe(false);
  });

  it("does not adopt a candidate that has no theme until a person decides one of the six", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest(), passingCandidate({ themeId: "UNCLASSIFIED" }));
    const args = { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: ISSUE, recheck: checkContextFor(candidateRequest()) } as const;

    expect(await adoptDraft(state.review, args)).toEqual({ ok: false, error: { code: "THEME_NOT_DECIDED" } });
    expect(await adoptDraft(state.review, { ...args, themeId: "UNCLASSIFIED" as never })).toEqual({ ok: false, error: { code: "THEME_NOT_DECIDED" } });
    expect(await exists(join(state.temp.root.rootDir, "issues"))).toBe(false);

    const adopted = await adoptDraft(state.review, { ...args, themeId: "DISASTER_PREVENTION" });
    // The theme was decided by a person, so the issue is not the output of the draft as it was.
    expect(adopted.ok && adopted.value.event.kind).toBe("HUMAN_EDITED");
    const record = IssueSourceRecordSchema.parse(JSON.parse(await readFile(join(state.temp.root.rootDir, "issues", "issue-1", "v1.json"), "utf8")));
    expect(record.themeId).toBe("DISASTER_PREVENTION");
    expect(record.provenance.humanEdited).toBe(true);
  });

  it("does not make a second issue under the same ID, and writes no record for the refused adoption", async () => {
    const state = await setup();
    const first = await draftOf(state, candidateRequest());
    const second = await draftOf(state, candidateRequest({ topic: "別の題材" }), passingCandidate({ title: "別の題名" }));
    expect((await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId: first, reviewerId: "reviewer-1", target: ISSUE })).ok).toBe(true);
    expect(await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId: second, reviewerId: "reviewer-1", target: ISSUE })).toEqual({
      ok: false,
      error: { code: "ISSUE_RECORD_CONFLICT" },
    });
    expect(await eventKinds(state)).toEqual(["DRAFTED", "DRAFTED", "HUMAN_ADOPTED"]);
  });
});

describe("adoptDraft and rejectDraft: one decision for one draft", () => {
  it("adopts the draft of a question, a card and a classification as their own targets, without the record of an issue", async () => {
    const state = await setup();
    const question = await draftOf(state, questionRequest("TRADEOFF"));
    expect((await adoptDraft(state.review, { task: "QUESTION_DRAFT", draftId: question, reviewerId: "reviewer-1", target: { targetKind: "QUESTION", targetId: "q-1" } })).ok).toBe(true);
    const card = await draftOf(state, summaryRequest());
    expect((await adoptDraft(state.review, { task: "ISSUE_SUMMARY", draftId: card, reviewerId: "reviewer-1", target: { targetKind: "CARD", targetId: "card-1" } })).ok).toBe(true);
    expect(await exists(join(state.temp.root.rootDir, "issues"))).toBe(false);
    expect(await eventKinds(state)).toEqual(["DRAFTED", "DRAFTED", "HUMAN_ADOPTED", "HUMAN_ADOPTED"]);
  });

  it("rejects a draft, keeps the draft, and counts the rejection", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const rejected = await rejectDraft(state.review, { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-2" });
    expect(rejected.ok && rejected.value).toMatchObject({ kind: "HUMAN_REJECTED", draftId, reviewerId: "reviewer-2" });
    expect(await readdir(join(state.temp.root.rootDir, "drafts", "ISSUE_CANDIDATE"))).toHaveLength(1);
    const events = await state.deps.store.loadEvents();
    expect(deriveDisposition(draftId, events.ok ? events.value : [])).toBe("REJECTED");
    expect(await readAiContribution(state.deps.store)).toEqual({ ok: true, value: { drafted: 1, rejectedByChecks: 0, humanEdited: 0, humanRejected: 1 } });
  });

  it("allows one record of adoption or rejection for a draft in all", async () => {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    const base = { task: "ISSUE_CANDIDATE" as DraftTask, draftId, reviewerId: "reviewer-1" };
    expect((await adoptDraft(state.review, { ...base, target: ISSUE })).ok).toBe(true);
    expect(await adoptDraft(state.review, { ...base, target: ISSUE })).toEqual({ ok: false, error: { code: "DECISION_ALREADY_MADE" } });
    expect(await rejectDraft(state.review, base)).toEqual({ ok: false, error: { code: "DECISION_ALREADY_MADE" } });

    const other = await draftOf(state, candidateRequest({ topic: "別の題材" }), passingCandidate({ title: "別の題名" }));
    const reject = { ...base, draftId: other };
    expect((await rejectDraft(state.review, reject)).ok).toBe(true);
    expect(await rejectDraft(state.review, reject)).toEqual({ ok: false, error: { code: "DECISION_ALREADY_MADE" } });
    expect(await adoptDraft(state.review, { ...reject, target: { targetKind: "ISSUE", targetId: "issue-2" } })).toEqual({ ok: false, error: { code: "DECISION_ALREADY_MADE" } });
    expect(await exists(join(state.temp.root.rootDir, "issues", "issue-2"))).toBe(false);
  });

  it("does not decide a draft that is not saved", async () => {
    const state = await setup();
    const unknown = "f".repeat(64);
    expect(await rejectDraft(state.review, { task: "ISSUE_CANDIDATE", draftId: unknown, reviewerId: "reviewer-1" })).toEqual({ ok: false, error: { code: "DRAFT_NOT_FOUND" } });
    expect(await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId: unknown, reviewerId: "reviewer-1", target: ISSUE })).toEqual({ ok: false, error: { code: "DRAFT_NOT_FOUND" } });
  });
});

describe("the approval of an issue", () => {
  async function adoptedIssue(): Promise<Setup> {
    const state = await setup();
    const draftId = await draftOf(state, candidateRequest());
    expect((await adoptDraft(state.review, { task: "ISSUE_CANDIDATE", draftId, reviewerId: "reviewer-1", target: ISSUE })).ok).toBe(true);
    // The fictional facts that the issue rests on (`fx-1`, `fx-3`): an approval names them, so they have to be there.
    await writeFile(join(state.temp.root.rootDir, "facts.json"), JSON.stringify(FIXTURE_FACTS));
    return state;
  }

  async function currentHash(state: Setup, version: number): Promise<string> {
    return hashOf(JSON.parse(await readFile(join(state.temp.root.rootDir, "issues", "issue-1", `v${version}.json`), "utf8")));
  }

  it("names the record of the version by its SHA-256, and holds the six confirmations", async () => {
    const state = await adoptedIssue();
    const approved = await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS });
    expect(approved.ok).toBe(true);
    expect(approved.ok && approved.value).toMatchObject({
      type: "APPROVE",
      targetKind: "ISSUE",
      targetId: "issue-1",
      targetVersion: 1,
      targetHash: await currentHash(state, 1),
      approverId: "approver-1",
      issueChecks: ALL_CHECKS,
    });
    const ledger = await readLedger(state.temp.root);
    expect(ledger.ok && ledger.value).toHaveLength(1);
  });

  it("records the SHA-256 of each fact item that the version names, in the order of the version (the basis that the approval rests on)", async () => {
    const state = await adoptedIssue();
    const approved = await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS });
    const record = approved.ok ? approved.value : null;
    const named = ["fx-1", "fx-3"].map((factId) => FIXTURE_FACTS.find((fact) => fact.factId === factId));
    expect(record !== null && record.type === "APPROVE" ? record.basisFacts : undefined).toEqual(named.map((fact) => ({ factId: fact?.factId, sha256: hashOf(fact) })));
    // The record on the disk is the one that was returned.
    const ledger = await readLedger(state.temp.root);
    expect(ledger.ok && ledger.value[0]).toEqual(record);
  });

  it("does not approve an issue whose fact items are not all there, and writes nothing", async () => {
    const state = await adoptedIssue();
    await writeFile(join(state.temp.root.rootDir, "facts.json"), JSON.stringify(FIXTURE_FACTS.filter((fact) => fact.factId !== "fx-3")));
    expect(await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS })).toEqual({
      ok: false,
      error: { code: "BASIS_FACT_NOT_FOUND", factIds: ["fx-3"] },
    });
    expect(await readLedger(state.temp.root)).toEqual({ ok: true, value: [] });
  });

  it("does not make an approval without the confirmations, or with one that is not made", async () => {
    const state = await adoptedIssue();
    const without = await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1" });
    expect(without.ok).toBe(false);
    const half = await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: { ...ALL_CHECKS, noCausalClaim: false } as never });
    expect(half.ok).toBe(false);
    expect(await readLedger(state.temp.root)).toEqual({ ok: true, value: [] });
  });

  it("does not approve a version that does not exist, a content that is not the content of the version, or a target without its hash", async () => {
    const state = await adoptedIssue();
    expect(await approveTarget(state.review, { ...ISSUE, version: 2, approverId: "approver-1", issueChecks: ALL_CHECKS })).toEqual({ ok: false, error: { code: "TARGET_NOT_FOUND" } });
    expect(await approveTarget(state.review, { ...ISSUE, approverId: "approver-1", issueChecks: ALL_CHECKS })).toEqual({ ok: false, error: { code: "TARGET_NOT_FOUND" } });
    expect(await approveTarget(state.review, { ...ISSUE, version: 1, targetHash: "0".repeat(64), approverId: "approver-1", issueChecks: ALL_CHECKS })).toEqual({
      ok: false,
      error: { code: "TARGET_HASH_MISMATCH" },
    });
    expect(await approveTarget(state.review, { targetKind: "CARD", targetId: "card-1", approverId: "approver-1" })).toEqual({ ok: false, error: { code: "TARGET_HASH_REQUIRED" } });
    expect(await readLedger(state.temp.root)).toEqual({ ok: true, value: [] });
  });

  it("is enough for the number that is required only with the different approvers of the version that is current", async () => {
    const state = await adoptedIssue();
    const query = async (version: number) => ({ ...ISSUE, targetHash: await currentHash(state, version) });
    const approvers = async (version: number, required: number) => {
      const ledger = await readLedger(state.temp.root);
      return countValidApprovals(ledger.ok ? ledger.value : [], await query(version), required);
    };

    await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS });
    expect((await approvers(1, 1)).ok).toBe(true);
    expect((await approvers(1, 2)).ok).toBe(false);
    await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS });
    expect((await approvers(1, 2)).ok).toBe(false);
    await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-2", issueChecks: ALL_CHECKS });
    expect((await approvers(1, 2)).ok).toBe(true);

    // A new version of the content is a record of its own: the approvals of version 1 do not count for it.
    const v1 = JSON.parse(await readFile(join(state.temp.root.rootDir, "issues", "issue-1", "v1.json"), "utf8")) as Record<string, unknown>;
    const written = await writeImmutableRecord(state.temp.root, "issues/issue-1/v2.json", { ...v1, version: 2, title: "次の版の題名" });
    expect(written.ok).toBe(true);
    expect((await approvers(2, 1)).ok).toBe(false);
    expect(await approveTarget(state.review, { ...ISSUE, version: 2, approverId: "approver-1", issueChecks: ALL_CHECKS })).toMatchObject({ ok: true });
    expect((await approvers(2, 1)).ok).toBe(true);
    expect((await approvers(2, 2)).ok).toBe(false);
    // And the version 1 keeps its two approvals, which the ledger has not lost.
    expect((await approvers(1, 2)).ok).toBe(true);
  });

  it("revokes the approvals of a version by adding a record, and does not delete the approvals", async () => {
    const state = await adoptedIssue();
    await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-1", issueChecks: ALL_CHECKS });
    const before = await readdir(join(state.temp.root.rootDir, "approvals", "ISSUE", "issue-1"));
    const revoked = await revokeApproval(state.review, { ...ISSUE, version: 1, revokerId: "reviewer-9" });
    expect(revoked.ok && revoked.value.type).toBe("REVOKE");
    const after = await readdir(join(state.temp.root.rootDir, "approvals", "ISSUE", "issue-1"));
    expect(after).toHaveLength(before.length + 1);
    expect(after).toEqual(expect.arrayContaining(before));
    const ledger = await readLedger(state.temp.root);
    const result = countValidApprovals(ledger.ok ? ledger.value : [], { ...ISSUE, targetHash: await currentHash(state, 1) }, 1);
    expect(result.ok).toBe(false);
    // A person can approve again, after the revocation.
    await approveTarget(state.review, { ...ISSUE, version: 1, approverId: "approver-3", issueChecks: ALL_CHECKS });
    const again = await readLedger(state.temp.root);
    expect(countValidApprovals(again.ok ? again.value : [], { ...ISSUE, targetHash: await currentHash(state, 1) }, 1)).toEqual({ ok: true, value: { approverIds: ["approver-3"] } });
  });

  it("approves a target that is not an issue by the hash of its content", async () => {
    const state = await setup();
    const hash = hashOf({ cardId: "card-1", text: "本文" });
    const approved = await approveTarget(state.review, { targetKind: "CARD", targetId: "card-1", targetHash: hash, approverId: "approver-1" });
    expect(approved.ok && approved.value).toMatchObject({ type: "APPROVE", targetKind: "CARD", targetHash: hash });
    expect(approved.ok && "issueChecks" in approved.value).toBe(false);
    expect(await readdir(join(state.temp.root.rootDir, "approvals", "CARD", "card-1"))).toHaveLength(1);
  });
});
