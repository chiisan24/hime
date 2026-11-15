import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { ISOInstantSchema, QuestionSchema } from "@ehime-vote-navigator/contracts";
import type { Question, QuestionBank } from "@ehime-vote-navigator/contracts";
import { assembleBundleBody, finalizeBundle } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { countValidApprovals, hashOf, readLedger } from "../../apps/api/src/regional-values/draft/approvalLedger.js";
import { readAiContribution } from "../../apps/api/src/regional-values/draft/contribution.js";
import { deriveDisposition } from "../../apps/api/src/regional-values/draft/disposition.js";
import { adoptDraft, approveTarget, rejectDraft } from "../../apps/api/src/regional-values/draft/review.js";
import { runDraft } from "../../apps/api/src/regional-values/draft/runDraft.js";
import { defaultRecordRoot } from "../../apps/api/src/regional-values/draft/types.js";
import { loadFixtureData } from "../../apps/api/src/regional-values/build/loadFixtureData.js";
import { createBuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../harness/regional-values/buildWorkspace.js";
import {
  FICTIONAL_SOURCE_ID,
  FIXTURE_FACTS,
  TEST_MODELS,
  candidateRequest,
  checkContextFor,
  createClock,
  createFakeClient,
  createTestDeps,
  evidenceUnit,
  passingCandidate,
  passingTradeoffDraft,
  questionRequest,
  summaryRequest,
} from "../harness/regional-values/draftSupport.js";

/**
 * The flow of the AI draft with fictional material, from the input to the bundle (design: 架空資料で
 * AI下書きの流れを再現する手順, Req 8.21, 12.5, 12.10, 12.15). The model is a fake, the records are in
 * a temporary directory, and no `fetch` is made. The way from an issue candidate to an issue card is
 * tested at 16.8; this test is about a question, and about the candidate not being published.
 */

let workspace: BuildWorkspace | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await workspace?.remove();
  workspace = undefined;
});

const CANDIDATE_TITLE = "試験用の候補題名ABC";
const SUMMARY_TEXT = "試験用の路線は2025年度に12本だった";
const EVIDENCE = evidenceUnit("E1", `${SUMMARY_TEXT}。`, FICTIONAL_SOURCE_ID);

async function eventsOnDisk(directory: string): Promise<Record<string, unknown>[]> {
  const names = await readdir(join(directory, "events"));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, "events", name), "utf8")) as Record<string, unknown>));
}

describe("the flow of the AI draft with fictional material", () => {
  it("saves the drafts that pass, refuses the ones that do not, and puts only what a person approved in the bundle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    workspace = await createBuildWorkspace();
    const root = defaultRecordRoot(workspace.root, "FIXTURE");
    const loaded = await loadFixtureData(root.rootDir);
    if (!loaded.ok) {
      throw new Error("the fictional data of the repository must be readable");
    }
    const data = loaded.value;

    const quick = data.bank.diagnosticSets.find((set) => set.setKind === "QUICK");
    const replaced = data.bank.questions.find((question) => question.kind === "TRADEOFF" && quick?.questionIds.includes(question.questionId));
    if (quick === undefined || replaced === undefined || replaced.kind !== "TRADEOFF") {
      throw new Error("the QUICK set of the fictional data has a trade-off question");
    }
    const themeId = replaced.themeId;

    const draftsAt = (task: string): string => join(root.rootDir, "drafts", task);
    const model = (script: Parameters<typeof createFakeClient>[0]) => createFakeClient(script);

    // 1. An issue candidate, from the facts of fictional data, and a summary of a card and a question, from fictional quotations.
    const fakeCandidate = model([
      JSON.stringify(
        passingCandidate({
          title: CANDIDATE_TITLE,
          factSummary: [{ text: "試験用の事実要約は12本である", groundFactIds: ["fx-1"] }, { text: "架空市の鉄道路線は3本である", groundFactIds: ["fx-3"] }],
        }),
      ),
    ]);
    const { deps } = createTestDeps(root, fakeCandidate.client);
    const candidate = await runDraft(deps, candidateRequest());
    expect(candidate.ok).toBe(true);

    const fakeSummary = model([JSON.stringify({ sentences: [{ text: SUMMARY_TEXT, groundIds: ["E1"] }] })]);
    const summaryDeps = { ...deps, client: fakeSummary.client };
    const summaryRequestOfFlow = summaryRequest({ evidence: [EVIDENCE] });
    const summary = await runDraft(summaryDeps, summaryRequestOfFlow);
    expect(summary.ok).toBe(true);

    const draftQuestion = passingTradeoffDraft(themeId);
    const fakeQuestion = model([JSON.stringify(draftQuestion)]);
    const question = await runDraft({ ...deps, client: fakeQuestion.client }, questionRequest("TRADEOFF", { themeId }));
    expect(question.ok).toBe(true);

    // 2. Every draft that passed is saved as PENDING; the candidate and the summary are not facts and not cards.
    const store = deps.store;
    const savedEvents = await store.loadEvents();
    expect(savedEvents.ok).toBe(true);
    const events = savedEvents.ok ? savedEvents.value : [];
    for (const outcome of [candidate, summary, question]) {
      expect(outcome.ok && deriveDisposition(outcome.value.draftId, events)).toBe("PENDING");
    }

    // 3. Outputs that must be refused: a ground that does not exist, a number that the material does not have, a recommendation.
    const refusedResponses: readonly [string, string][] = [
      [JSON.stringify({ sentences: [{ text: SUMMARY_TEXT, groundIds: ["E7"] }] }), "DR_GROUND_EXISTS"],
      [JSON.stringify({ sentences: [{ text: "試験用の路線は2025年度に13本だった", groundIds: ["E1"] }] }), "DR_GROUND_MATCH"],
      [JSON.stringify({ sentences: [{ text: "試験用の路線は2025年度に12本で推奨語だった", groundIds: ["E1"] }] }), "DR_FORBIDDEN_WORDS"],
    ];
    const savedBefore = await readdir(draftsAt("ISSUE_SUMMARY"));
    for (const [index, [response, expected]] of refusedResponses.entries()) {
      const refused = await runDraft({ ...deps, client: model([response]).client }, summaryRequest({ evidence: [EVIDENCE], topic: `別の題材${index}` }));
      expect(refused.ok === false && refused.error.code).toBe("CHECK_FAILED");
      expect(refused.ok === false && refused.error.code === "CHECK_FAILED" && refused.error.violations.map((violation) => violation.check)).toContain(expected);
    }
    expect(await readdir(draftsAt("ISSUE_SUMMARY"))).toEqual(savedBefore);

    // 4. A person edits the question a little and adopts it, rejects the summary, and leaves the candidate as it is.
    const reviewDeps = { store, now: createClock("2026-11-20T00:00:00.000Z", 60_000) };
    const edited = { ...draftQuestion, unsureLabel: "分からない" };
    const adopted = await adoptDraft(reviewDeps, {
      task: "QUESTION_DRAFT",
      draftId: question.ok ? question.value.draftId : "",
      reviewerId: "reviewer-1",
      target: { targetKind: "QUESTION", targetId: "q-ai-1" },
      edited,
      recheck: checkContextFor(questionRequest("TRADEOFF", { themeId })),
    });
    expect(adopted.ok && adopted.value.event.kind).toBe("HUMAN_EDITED");
    expect((await rejectDraft(reviewDeps, { task: "ISSUE_SUMMARY", draftId: summary.ok ? summary.value.draftId : "", reviewerId: "reviewer-1" })).ok).toBe(true);

    // 5. The question that was adopted is a question of the bank, written by an AI draft and not yet approved.
    const base = {
      questionId: "q-ai-1",
      dataKind: "FIXTURE" as const,
      author: "AI_DRAFT" as const,
      createdOn: "2026-11-13",
      version: 1,
      kind: "TRADEOFF" as const,
      themeId,
      text: edited.text,
      explanation: edited.explanation,
      unsureLabel: edited.unsureLabel,
      declineLabel: edited.declineLabel,
      opinionLabels: edited.opinionLabels,
      premise: edited.premise,
      directionA: edited.directionA,
      directionB: edited.directionB,
      weight: replaced.weight,
      swapDirections: replaced.swapDirections,
    };
    const unapproved: Question = QuestionSchema.parse({ ...base, approval: null });
    const bankWith = (question: Question): QuestionBank => ({
      ...data.bank,
      questions: data.bank.questions.map((existing) => (existing.questionId === replaced.questionId ? question : existing)),
      diagnosticSets: data.bank.diagnosticSets.map((set) => ({
        ...set,
        questionIds: set.questionIds.map((id) => (id === replaced.questionId ? question.questionId : id)),
      })),
    });
    const identity = {
      buildKind: "DEMO" as const,
      dataKind: "FIXTURE" as const,
      dataModeRequested: "FIXTURE" as const,
      dataModeResolved: "FIXTURE" as const,
      switched: false,
      switchReasonCodes: [],
      generatedAt: "2026-11-20T09:00:00Z",
      dataVersion: "2026-01-01.1",
    };
    const mapConfig = { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 };
    const contribution = await readAiContribution(store);
    if (!contribution.ok) {
      throw new Error("the contribution must be counted");
    }
    const assemble = (bank: QuestionBank) =>
      assembleBundleBody({ identity, bank, cards: data.cards, resultTexts: data.resultTexts, fixedTexts: data.fixedTexts, guidance: data.guidance, mapConfig, aiContribution: contribution.value });

    // A question without an approval is not in the bundle: the bundle is not made.
    const refusal = assemble(bankWith(unapproved));
    expect(refusal.ok).toBe(false);
    expect(!refusal.ok && refusal.error.findings.map((finding) => [finding.code, finding.targetId])).toContainEqual(["QUESTION_NOT_APPROVED", "q-ai-1"]);

    // 6. The second opinion by the other model, and the approval of a person in the ledger.
    const reviewRequest = {
      task: "NEUTRALITY_REVIEW" as const,
      dataKind: "FIXTURE" as const,
      facts: [],
      evidence: [],
      sources: [],
      question: unapproved,
      draftModelId: TEST_MODELS.generation,
    };
    const fakeReview = model([JSON.stringify({ verdict: "NO_BIAS_FOUND", findings: [] })]);
    const review = await runDraft({ ...deps, client: fakeReview.client }, reviewRequest);
    expect(review.ok).toBe(true);
    expect(fakeReview.calls[0]?.modelId).toBe(TEST_MODELS.verification);
    const reviewed = await store.loadDrafts("NEUTRALITY_REVIEW");
    const reviewedAt = reviewed.ok ? reviewed.value[0]?.generatedAt : undefined;
    expect(reviewedAt).toBeDefined();

    // The content that is approved is the question without its approval.
    const content = Object.fromEntries(Object.entries(unapproved).filter(([key]) => key !== "approval"));
    const approved = await approveTarget(reviewDeps, { targetKind: "QUESTION", targetId: "q-ai-1", targetHash: hashOf(content), approverId: "approver-1" });
    expect(approved.ok).toBe(true);
    const ledger = await readLedger(root);
    const counted = countValidApprovals(ledger.ok ? ledger.value : [], { targetKind: "QUESTION", targetId: "q-ai-1", targetHash: hashOf(content) }, 1);
    expect(counted).toEqual({ ok: true, value: { approverIds: ["approver-1"] } });

    const approvedQuestion: Question = QuestionSchema.parse({
      ...base,
      approval: {
        forVersion: 1,
        review: { modelId: TEST_MODELS.verification, reviewedAt, verdict: "NO_BIAS_FOUND", findings: [] },
        approverId: "approver-1",
        approvedAt: approved.ok && approved.value.type === "APPROVE" ? approved.value.approvedAt : ISOInstantSchema.parse("2026-11-21T00:00:00Z"),
      },
    });

    // 7. The final counts include the review (a saved draft) and the three refused outputs.
    const finalContribution = await readAiContribution(store);
    expect(finalContribution).toEqual({ ok: true, value: { drafted: 7, rejectedByChecks: 3, humanEdited: 1, humanRejected: 1 } });
    const body = assembleBundleBody({
      identity,
      bank: bankWith(approvedQuestion),
      cards: data.cards,
      resultTexts: data.resultTexts,
      fixedTexts: data.fixedTexts,
      guidance: data.guidance,
      mapConfig,
      aiContribution: finalContribution.ok ? finalContribution.value : contribution.value,
    });
    expect(body.ok).toBe(true);
    if (!body.ok) {
      return;
    }
    expect(body.value.body.questions.find((item) => item.questionId === "q-ai-1")).toMatchObject({ author: "AI_DRAFT", approval: { approverId: "approver-1" } });

    // 8. The bundle holds the four numbers that the records give: the ones that are counted from the files, not from the code.
    const onDisk = await eventsOnDisk(root.rootDir);
    const countOf = (kind: string): number => onDisk.filter((event) => event.kind === kind).length;
    const bundle = await finalizeBundle(body.value.body);
    expect(bundle.ok).toBe(true);
    expect(bundle.ok && bundle.value.aiContribution).toEqual({
      drafted: countOf("DRAFTED"),
      rejectedByChecks: countOf("REJECTED_BY_CHECKS"),
      humanEdited: countOf("HUMAN_EDITED"),
      humanRejected: countOf("HUMAN_REJECTED"),
    });

    // 9. The candidate, the summary and what the model said are not in the bundle: only the fields of the contract are.
    const text = JSON.stringify(bundle.ok ? bundle.value : null);
    for (const unpublished of [CANDIDATE_TITLE, SUMMARY_TEXT, "試験用の事実要約", "推奨語"]) {
      expect(text).not.toContain(unpublished);
    }
    expect(Object.keys(body.value.body)).not.toContain("issueCandidates");
    expect(Object.keys(body.value.body)).not.toContain("drafts");

    // 10. FIXTURE_FACTS are the facts of the candidate: no fact of the input became a fact item of a card.
    expect(body.value.body.cards.flatMap((card) => card.facts.map((fact) => fact.factId))).not.toContain(FIXTURE_FACTS[0]?.factId);

    // 11. Nothing went to the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
