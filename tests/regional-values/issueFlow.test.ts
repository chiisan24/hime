import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IssueSourceRecordSchema, IssuesFileSchema } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runBuild } from "../../apps/api/src/regional-values/build/runBuild.js";
import type { IssueSource } from "../../apps/api/src/regional-values/build/runBuild.js";
import { createSafeLogger } from "../../apps/api/src/logging/safeLogger.js";
import { countValidApprovals, hashOf, readLedger } from "../../apps/api/src/regional-values/draft/approvalLedger.js";
import { createDraftStore, writeImmutableRecord } from "../../apps/api/src/regional-values/draft/draftStore.js";
import type { DraftRequest } from "../../apps/api/src/regional-values/draft/request.js";
import { adoptDraft, approveTarget, revokeApproval } from "../../apps/api/src/regional-values/draft/review.js";
import { runDraft } from "../../apps/api/src/regional-values/draft/runDraft.js";
import { defaultRecordRoot } from "../../apps/api/src/regional-values/draft/types.js";
import { runIssuesExport, verifyOutput } from "../../apps/api/src/regional-values/issues/exportIssues.js";
import { createIssueSource } from "../../apps/api/src/regional-values/issuesCli.js";
import { createBuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import { checkContextFor, createClock, createFakeClient, createTestDeps, evidenceUnit, TEST_LIMITS } from "../harness/regional-values/draftSupport.js";
import { realFact, realSource } from "../harness/regional-values/draftSupport.js";
import { loadTestIssueSettings } from "../harness/regional-values/fixtureIssueRecords.js";
import {
  ALL_CONFIRMED,
  createIssueWorld,
  ISSUE_SETTINGS,
  ORIGINAL_BYTES,
  realCandidate,
  realIssue,
  realMaterial,
  settingsWith,
} from "../harness/regional-values/issueSupport.js";
import type { IssueWorld } from "../harness/regional-values/issueSupport.js";

// 16.8: the flow of an issue, from a verified fact to an issue that is withdrawn and approved again, in
// temporary directories, with a fake of the model. The data is made for the test. Nothing is fetched.

const ISSUE = "issue-r1";
const TWO_APPROVERS = settingsWith({ requiredApprovers: 2 });
const GENERATED_AT = "2026-11-13T04:00:00Z";

describe("the flow of an issue (16.8)", () => {
  let world: IssueWorld;
  let workspace: string;

  const stateText = (): Promise<string> => readFile(join(workspace, "dist", "regional-values", "issues", "real", "issues-export-report.json"), "utf8");
  const issuesText = (): Promise<string> => readFile(join(workspace, "dist", "regional-values", "issues", "real", "issues.json"), "utf8");
  const place = (): { workspaceRoot: string; dataKind: "REAL_AI" } => ({ workspaceRoot: workspace, dataKind: "REAL_AI" });

  async function exportAll(): Promise<void> {
    const outcome = await runIssuesExport(
      { workspaceRoot: workspace, dataKind: "REAL_AI", generatedAt: GENERATED_AT },
      { now: () => "2026-11-13T05:00:00.000Z", inputs: world.inputs, settings: () => Promise.resolve(TWO_APPROVERS) },
    );
    expect(outcome).toMatchObject({ ok: true });
  }

  /** What the records say now, with two approvers needed. */
  async function digest() {
    const loaded = await world.load(TWO_APPROVERS);
    if (!loaded.ok) {
      throw new Error("The input was not loaded");
    }
    return loaded.value;
  }

  beforeEach(async () => {
    world = await createIssueWorld("REAL_AI");
    workspace = await mkdtemp(join(tmpdir(), "rv-issue-flow-"));
  });
  afterEach(async () => {
    await world.remove();
    await rm(workspace, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("goes from a verified fact to an approved issue, is withdrawn when the original changes, and is valid again with a new version and new approvals", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { fact, source } = realMaterial();
    await world.setRealFact(fact);
    await world.setRealSource(source);
    await world.setOriginal(source, ORIGINAL_BYTES);

    // 1. A candidate of the fake of the model, which passes the checks of the draft process, and is kept as PENDING.
    const fake = createFakeClient([JSON.stringify(realCandidate())]);
    const request: DraftRequest = { task: "ISSUE_CANDIDATE", dataKind: "REAL_AI", facts: [fact], evidence: [], sources: [source] };
    const { deps } = createTestDeps(world.root, fake.client, { gate: { limits: TEST_LIMITS, currentSha256: (candidate) => candidate.sha256 } });
    const drafted = await runDraft(deps, request);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    expect(fake.calls).toHaveLength(1);
    // A candidate is not an issue: it has no record of an issue, and no approval.
    expect((await digest()).issues).toEqual([]);

    // 2. A person edits the candidate, and the edit goes through the checks again. The record of version 1 is made.
    const store = createDraftStore(world.root);
    const adopted = await adoptDraft(
      { store, now: createClock("2026-11-13T00:30:00.000Z", 1000) },
      {
        task: "ISSUE_CANDIDATE",
        draftId: drafted.value.draftId,
        reviewerId: "reviewer-a",
        target: { targetKind: "ISSUE", targetId: ISSUE },
        edited: realCandidate({ title: "試験町の施設の配置" }),
        recheck: checkContextFor(request),
      },
    );
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) {
      return;
    }
    expect(adopted.value.event.kind).toBe("HUMAN_EDITED");
    expect(adopted.value.issueRecord).toMatchObject({ issueId: ISSUE, version: 1, provenance: { humanEdited: true } });

    // 3. One approval is not enough when two approvers are needed, and an issue that was never approved is in neither list.
    expect((await digest()).withdrawn).toEqual([]);
    await world.approve(ISSUE, 1, "approver-a", "2026-11-13T01:00:00.000Z");
    expect((await digest()).withdrawn).toEqual([{ issueId: ISSUE, version: 1, reason: "APPROVAL_INSUFFICIENT" }]);
    await world.approve(ISSUE, 1, "approver-b", "2026-11-13T01:10:00.000Z");
    const approved = await digest();
    expect(approved.withdrawn).toEqual([]);
    expect(approved.issues).toHaveLength(1);
    expect(approved.issues[0]).toMatchObject({ issueId: ISSUE, version: 1, approval: { approverCount: 2 } });

    // 4. The output, and what says that it may be used.
    await exportAll();
    expect(IssuesFileSchema.parse(JSON.parse(await issuesText())).issues.map((issue) => issue.issueId)).toEqual([ISSUE]);
    expect((await verifyOutput(place(), { currentInputDigest: (await digest()).inputDigest })).status).toBe("OK");

    // 5. The original changes: the output is stale, and the next output has the issue as withdrawn (SOURCE_CHANGED).
    const changed = new TextEncoder().encode("name,count\nfacility,13\n");
    await world.setOriginal(source, changed);
    expect((await verifyOutput(place(), { currentInputDigest: (await digest()).inputDigest })).status).toBe("STALE");
    await exportAll();
    const withdrawn = IssuesFileSchema.parse(JSON.parse(await issuesText()));
    expect(withdrawn.issues).toEqual([]);
    expect(withdrawn.withdrawn).toEqual([{ issueId: ISSUE, version: 1, reason: "SOURCE_CHANGED" }]);
    expect((await verifyOutput(place(), { currentInputDigest: (await digest()).inputDigest })).status).toBe("OK");

    // 6. A new revision of the source is taken in and the fact is verified again; the content of the issue is changed (version 2).
    const newSha = sha256Hex(changed);
    const newSource = realSource({ revision: "rev-2", sha256: newSha });
    await world.setRealSource(newSource);
    await world.setOriginal(newSource, changed);
    await world.setRealFact(realFact("rf-1", { sha256: newSha }));
    await world.addIssue(realIssue(ISSUE, 2, { title: "試験町の施設の配置を確かめる" }));
    const renewed = await digest();
    // The approvals of version 1 are not carried to version 2.
    expect(renewed.withdrawn).toEqual([{ issueId: ISSUE, version: 2, reason: "CONTENT_CHANGED" }]);
    await world.approve(ISSUE, 2, "approver-a", "2026-11-13T03:00:00.000Z");
    expect((await digest()).withdrawn).toEqual([{ issueId: ISSUE, version: 2, reason: "APPROVAL_INSUFFICIENT" }]);
    await world.approve(ISSUE, 2, "approver-b", "2026-11-13T03:10:00.000Z");
    await exportAll();
    const again = IssuesFileSchema.parse(JSON.parse(await issuesText()));
    expect(again.withdrawn).toEqual([]);
    expect(again.issues).toHaveLength(1);
    expect(again.issues[0]).toMatchObject({ issueId: ISSUE, version: 2, title: "試験町の施設の配置を確かめる", approval: { approverCount: 2 } });
    expect(again.issues[0]?.issueHash).not.toBe(approved.issues[0]?.issueHash);
    expect((await verifyOutput(place(), { currentInputDigest: (await digest()).inputDigest })).status).toBe("OK");

    // The state record says what the last run did, and nothing was fetched.
    expect(JSON.parse(await stateText())).toMatchObject({ status: "SUCCESS", exitCode: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes an issue of version 1 withdrawn when an approval is revoked, and the same settings give the same judgment again", async () => {
    const { fact, source } = realMaterial();
    await world.setRealFact(fact);
    await world.setRealSource(source);
    await world.setOriginal(source, ORIGINAL_BYTES);
    await world.addIssue(realIssue(ISSUE, 1));
    await world.approve(ISSUE, 1, "approver-a", "2026-11-13T01:00:00.000Z");
    await world.approve(ISSUE, 1, "approver-b", "2026-11-13T01:10:00.000Z");
    expect((await digest()).issues).toHaveLength(1);
    await world.revoke(ISSUE, 1, "approver-b", "2026-11-13T02:00:00.000Z");
    const first = await digest();
    expect(first.withdrawn).toEqual([{ issueId: ISSUE, version: 1, reason: "REVOKED" }]);
    expect((await digest()).inputDigest).toBe(first.inputDigest);
    expect(ISSUE_SETTINGS.requiredApprovers).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The card of an approved issue, the record of links and the build (fictional data)
// ---------------------------------------------------------------------------

const CARD_APPROVER = "fixture-card-approver-v1";
const ISSUE_APPROVER = "fixture-issue-approver-v1";
const POPULATION_ISSUE = "fixture-issue-population-v1";

describe("the card of an approved issue, the record of links and the build (16.8)", () => {
  let base: BuildWorkspace | undefined;
  afterEach(async () => {
    await base?.remove();
    base = undefined;
  });

  const fixtureFile = (workspace: BuildWorkspace, name: string): string => join(workspace.root, "packages", "fixtures", "src", "regional-values", name);

  async function build(workspace: BuildWorkspace, source: IssueSource): Promise<{ exitCode: number; codes: string[] }> {
    const result = await runBuild(
      { workspaceRoot: workspace.root, configDir: workspace.configDir, buildKind: "DEMO", dataMode: "FIXTURE", generatedAt: "2026-01-04T09:00:00Z" },
      { now: () => "2026-08-10T10:00:00+09:00", logger: createSafeLogger(() => undefined), issueSource: source },
    );
    return { exitCode: result.exitCode, codes: result.report.findings.map((finding) => finding.code) };
  }

  it("keeps the approval of the card apart from the approval of the issue, takes the card as not approved when its issue is withdrawn, and has it again with a new version", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    base = await createBuildWorkspace({}, { issueRecords: true });
    const workspace = base;
    const root = defaultRecordRoot(workspace.root, "FIXTURE");
    const store = createDraftStore(root);
    const settings = await loadTestIssueSettings();
    const source = createIssueSource({ workspaceRoot: workspace.root }, settings);

    const cards = JSON.parse(await readFile(fixtureFile(workspace, "cards.json"), "utf8")) as { cardId: string; approval: unknown }[];
    const card = cards[0];
    const bank = JSON.parse(await readFile(fixtureFile(workspace, "question-bank.json"), "utf8")) as { questions: { questionId: string }[] };
    const questionId = bank.questions[0]?.questionId ?? "";
    if (card === undefined) {
      throw new Error("The fictional cards are not there");
    }
    expect(card.cardId).toBe("fixture-card-population-v1");

    // 1. The draft of a card (a fake of the model), from the text of the source of the issue, adopted by a person.
    const evidence = evidenceUnit("E1", "地域活動は12件です。", "fixture-source-population-v1");
    const request: DraftRequest = { task: "ISSUE_SUMMARY", dataKind: "FIXTURE", facts: [], evidence: [evidence], sources: [] };
    const fake = createFakeClient([JSON.stringify({ sentences: [{ text: "地域活動は12件です", groundIds: ["E1"] }] })]);
    const { deps } = createTestDeps(root, fake.client, { checks: settings.checks, themes: settings.themes });
    const drafted = await runDraft(deps, request);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    const adopted = await adoptDraft(
      { store, now: createClock("2026-01-05T00:00:00.000Z", 1000) },
      { task: "ISSUE_SUMMARY", draftId: drafted.value.draftId, reviewerId: "reviewer-a", target: { targetKind: "CARD", targetId: card.cardId } },
    );
    expect(adopted.ok).toBe(true);

    // 2. The card has its own approval. The approval of the issue does not count for the card.
    const cardHash = hashOf(Object.fromEntries(Object.entries(card).filter(([key]) => key !== "approval")));
    const before = await readLedger(root);
    expect(before.ok).toBe(true);
    if (!before.ok) {
      return;
    }
    const issueApprovalAsCard = countValidApprovals(before.value, { targetKind: "CARD", targetId: card.cardId, targetHash: cardHash }, 1);
    expect(issueApprovalAsCard.ok).toBe(false);
    const approved = await approveTarget(
      { store, now: () => new Date("2026-01-05T01:00:00.000Z") },
      { targetKind: "CARD", targetId: card.cardId, targetHash: cardHash, approverId: CARD_APPROVER },
    );
    expect(approved.ok).toBe(true);
    const after = await readLedger(root);
    expect(after.ok && countValidApprovals(after.value, { targetKind: "CARD", targetId: card.cardId, targetHash: cardHash }, 1).ok).toBe(true);
    expect(after.ok && countValidApprovals(after.value, { targetKind: "ISSUE", targetId: card.cardId, targetHash: cardHash }, 1).ok).toBe(false);

    // 3. The record of links: the card and a question rest on the issue (version 1). The build is as it was, and the bundle has no issue.
    const links = (version: number) =>
      JSON.stringify({
        schemaVersion: 1,
        dataKind: "FIXTURE",
        links: [
          { targetKind: "QUESTION", targetId: questionId, issueId: POPULATION_ISSUE, issueVersion: version },
          { targetKind: "ISSUE_CARD", targetId: card.cardId, issueId: POPULATION_ISSUE, issueVersion: version },
        ],
      });
    await writeFile(fixtureFile(workspace, "issue-links.json"), links(1));
    expect(await build(workspace, source)).toEqual({ exitCode: 0, codes: [] });
    const bundle = await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8");
    expect(bundle).not.toContain(POPULATION_ISSUE);
    expect(bundle).toContain(card.cardId);

    // 4. The approval of the issue is revoked: the question says QUESTION_ISSUE_INVALID, the card is taken as not approved, and no bundle is written.
    const revoked = await revokeApproval(
      { store, now: () => new Date("2026-01-06T00:00:00.000Z") },
      { targetKind: "ISSUE", targetId: POPULATION_ISSUE, version: 1, revokerId: ISSUE_APPROVER },
    );
    expect(revoked.ok).toBe(true);
    const failed = await build(workspace, createIssueSource({ workspaceRoot: workspace.root }, settings));
    expect(failed.exitCode).toBe(1);
    expect(failed.codes).toContain("QUESTION_ISSUE_INVALID");
    expect(failed.codes.some((code) => code === "CARD_NOT_APPROVED" || code === "CARD_COVERAGE_MISSING")).toBe(true);
    await expect(readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    // The card on the disk is as it was: its approval was not taken away, it was taken as pending in a copy.
    expect(JSON.parse(await readFile(fixtureFile(workspace, "cards.json"), "utf8"))).toEqual(cards);

    // 5. A new version of the issue, approved again, and the links that name it, make the build as it was.
    const v1 = IssueSourceRecordSchema.parse(JSON.parse(await readFile(fixtureFile(workspace, `issues/${POPULATION_ISSUE}/v1.json`), "utf8")));
    const v2 = IssueSourceRecordSchema.parse({ ...v1, version: 2, title: "地域の集まりへの参加の変化を確かめる" });
    expect((await writeImmutableRecord(root, `issues/${POPULATION_ISSUE}/v2.json`, v2)).ok).toBe(true);
    const renewed = await approveTarget(
      { store, now: () => new Date("2026-01-07T00:00:00.000Z") },
      { targetKind: "ISSUE", targetId: POPULATION_ISSUE, version: 2, approverId: ISSUE_APPROVER, issueChecks: ALL_CONFIRMED },
    );
    expect(renewed.ok).toBe(true);
    // The links still name version 1: the question is not valid until a person checks it again and writes version 2.
    expect((await build(workspace, createIssueSource({ workspaceRoot: workspace.root }, settings))).codes).toContain("QUESTION_ISSUE_INVALID");
    await writeFile(fixtureFile(workspace, "issue-links.json"), links(2));
    expect(await build(workspace, createIssueSource({ workspaceRoot: workspace.root }, settings))).toEqual({ exitCode: 0, codes: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
