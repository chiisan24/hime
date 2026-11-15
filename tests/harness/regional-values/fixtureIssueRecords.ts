import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FixtureFactSchema, ISOInstantSchema, IssueCardSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { loadBuildConfig, loadNeutralityConfig } from "../../../apps/api/src/regional-values/build/loadConfig.js";
import { factNumeralsOf, runDraftChecks } from "../../../apps/api/src/regional-values/draft/checks.js";
import { createDraftStore, draftIdOf, makeDraftEvent } from "../../../apps/api/src/regional-values/draft/draftStore.js";
import type { DraftStore } from "../../../apps/api/src/regional-values/draft/draftStore.js";
import { buildPrompt, PROMPT_VERSION } from "../../../apps/api/src/regional-values/draft/prompts/index.js";
import { DraftRequestSchema } from "../../../apps/api/src/regional-values/draft/request.js";
import { adoptDraft, approveTarget } from "../../../apps/api/src/regional-values/draft/review.js";
import type { RecordRoot } from "../../../apps/api/src/regional-values/draft/types.js";
import { DraftRunSettingsSchema } from "../../../apps/api/src/regional-values/draftCli.js";
import type { IssueSettings } from "../../../apps/api/src/regional-values/issues/loadIssueSnapshot.js";
import { createClock } from "./draftSupport.js";
import { ALL_CONFIRMED } from "./issueSupport.js";

/**
 * The input records of the fictional issues (task 16.14). Everything is fictional, and the lists of
 * words are the test-only ones of `test-config/draft-settings.json`, not the lists that a person
 * approves (13.1). The records are made by the functions of the draft process with a fake of the
 * model that answers from a script, so the IDs of the drafts and the events are computed, not written
 * by hand. The same code makes the same files, which a test checks against the files in Git.
 */

export const FIXTURE_ISSUE_APPROVER = "fixture-issue-approver-v1";
export const FIXTURE_ISSUE_REVIEWER = "fixture-issue-reviewer-v1";
/** The models of the roles. The draft of a fictional issue says that a fictional model made it. */
export const FIXTURE_DRAFT_MODELS = { generation: "fixture-draft-model-v1", verification: "fixture-review-model-v1" } as const;
export const FIXTURE_APPROVED_AT = "2026-01-04T09:00:00.000Z";
const DRAFTING_STARTS_AT = "2026-01-04T08:00:00.000Z";

const CONFIG_DIRECTORY = fileURLToPath(new URL("./test-config/", import.meta.url));
const CARDS_PATH = fileURLToPath(new URL("../../../packages/fixtures/src/regional-values/cards.json", import.meta.url));

/** The settings of the checks that the fictional issues are made and read with (a directory of test-only settings). */
export async function loadTestIssueSettings(): Promise<IssueSettings> {
  const neutrality = await loadNeutralityConfig(CONFIG_DIRECTORY);
  const build = await loadBuildConfig(CONFIG_DIRECTORY);
  const settings = DraftRunSettingsSchema.parse(JSON.parse(await readFile(join(CONFIG_DIRECTORY, "draft-settings.json"), "utf8")));
  if (!neutrality.ok || !build.ok) {
    throw new Error("The test-only settings cannot be read");
  }
  return {
    requiredApprovers: build.value.requiredApprovers,
    checks: {
      neutrality: neutrality.value,
      properNouns: build.value.properNouns,
      sentenceMaxChars: settings.sentenceMaxChars,
      words: { causalWords: settings.causalWords, hedgeEndings: settings.hedgeEndings, comparisonWords: settings.comparisonWords },
    },
    themes: settings.themes,
  };
}

function fact(over: Record<string, unknown>): FixtureFact {
  return FixtureFactSchema.parse({ dataKind: "FIXTURE", ...over });
}

/** The fact items that the three cards have. They are the first three of the registry, as they are in `cards.json`. */
export async function factsOfCards(): Promise<FixtureFact[]> {
  const cards = IssueCardSchema.array().parse(JSON.parse(await readFile(CARDS_PATH, "utf8")) as unknown);
  return cards.flatMap((card) => card.facts.flatMap((item) => (item.dataKind === "FIXTURE" ? [item] : [])));
}

/** The four fact items that only the issues have (fictional municipalities, fictional values). */
export const ADDED_FACTS: readonly FixtureFact[] = [
  fact({
    factId: "fixture-fact-population-2023-v1",
    sentence: "架空市あおばの地域の集まりの参加者は、2023年度が延べ480人です。",
    value: { amount: 480, unit: "人" },
    surveyDate: 2023,
    area: "架空市あおば",
    fictionalSourceId: "fixture-source-population-v1",
  }),
  fact({
    factId: "fixture-fact-population-2024-v1",
    sentence: "架空市あおばの地域の集まりの参加者は、2024年度が延べ420人です。",
    value: { amount: 420, unit: "人" },
    surveyDate: 2024,
    area: "架空市あおば",
    fictionalSourceId: "fixture-source-population-v1",
  }),
  fact({
    factId: "fixture-fact-disaster-hills-v1",
    sentence: "架空町みなとの高台にある避難場所は3か所です。",
    value: { amount: 3, unit: "か所" },
    surveyDate: 2025,
    area: "架空町みなと",
    fictionalSourceId: "fixture-source-disaster-v1",
  }),
  fact({
    factId: "fixture-fact-education-users-v1",
    sentence: "架空村ひなたの子育て相談の利用は延べ54人です。",
    value: { amount: 54, unit: "人" },
    surveyDate: "2025-09-01",
    area: "架空村ひなた",
    fictionalSourceId: "fixture-source-education-v1",
  }),
];

type IssueSpec = Readonly<{
  issueId: string;
  /** The fact items that the candidate rests on, by ID. */
  factIds: readonly string[];
  /** What the fake of the model answers: the candidate of the issue. */
  candidate: Record<string, unknown>;
}>;

const direction = (label: string, description: string, category: "CHANGE" | "CONTINUE") => ({
  label,
  description,
  category,
  status: "REFERENCE_ONLY",
});

/** The three fictional issues (design: FIXTUREの課題情報). Each sentence is a hypothesis, and no number is a computed value. */
export const ISSUE_SPECS: readonly IssueSpec[] = [
  {
    issueId: "fixture-issue-population-v1",
    factIds: ["fixture-fact-population-2023-v1", "fixture-fact-population-2024-v1", "fixture-fact-population-v1"],
    candidate: {
      themeId: "POPULATION_REVITALIZATION",
      title: "地域の集まりへの参加の変化",
      statement: "架空市あおばでは、地域の集まりへの参加が減っている可能性があります。",
      basisFactIds: ["fixture-fact-population-2023-v1", "fixture-fact-population-2024-v1", "fixture-fact-population-v1"],
      factSummary: [
        { text: "架空市あおばの地域の集まりの参加者は、2023年度が延べ480人です。", groundFactIds: ["fixture-fact-population-2023-v1"] },
        { text: "架空市あおばの地域の集まりの参加者は、2024年度が延べ420人です。", groundFactIds: ["fixture-fact-population-2024-v1"] },
      ],
      background: [{ text: "地域活動は、2025年4月1日時点で12件あります。", groundFactIds: ["fixture-fact-population-v1"] }],
      notDeterminable: ["参加者が減った理由は、この資料からは分かりません。", "参加者の年齢や地区ごとの違いは、この資料からは分かりません。"],
      additionalChecks: ["年度ごとの開催回数を確かめる必要があります。", "参加者の数え方が年度で同じかどうかを確かめる必要があります。"],
      decisionScenes: ["地域の集まりを続けるための支え方を考える場面", "地域の外の人とのつながりを考える場面"],
      responseDirections: [
        direction("新しい集まりの場をつくる", "参加しやすい新しい場や機会を用意する取り組みです。", "CHANGE"),
        direction("今ある集まりを続ける", "今ある集まりを続けるための運営を支える取り組みです。", "CONTINUE"),
      ],
    },
  },
  {
    issueId: "fixture-issue-disaster-v1",
    factIds: ["fixture-fact-disaster-v1", "fixture-fact-disaster-hills-v1"],
    candidate: {
      themeId: "DISASTER_PREVENTION",
      title: "避難場所の立地の確認",
      statement: "架空町みなとの避難場所の立地を、確かめる必要があるかもしれません。",
      basisFactIds: ["fixture-fact-disaster-v1", "fixture-fact-disaster-hills-v1"],
      factSummary: [
        { text: "架空町みなとの避難場所は、2025年時点で8か所です。", groundFactIds: ["fixture-fact-disaster-v1"] },
        { text: "架空町みなとの高台にある避難場所は、2025年時点で3か所です。", groundFactIds: ["fixture-fact-disaster-hills-v1"] },
      ],
      background: [],
      notDeterminable: ["高台にない避難場所の安全性は、この資料からは分かりません。", "避難場所に避難できる人数は、この資料からは分かりません。"],
      additionalChecks: ["避難場所ごとの災害の種類を確かめる必要があります。", "避難場所までの道のりの状況を確かめる必要があります。"],
      decisionScenes: ["日ごろの避難の備えを考える場面", "避難場所の整え方を考える場面"],
      responseDirections: [
        direction("避難場所の整備を進める", "避難場所の場所や設備を整える取り組みです。", "CHANGE"),
        direction("避難の情報を広める", "避難に必要な情報を伝える取り組みを広げます。", "CONTINUE"),
      ],
    },
  },
  {
    issueId: "fixture-issue-education-v1",
    factIds: ["fixture-fact-education-v1", "fixture-fact-education-users-v1"],
    candidate: {
      themeId: "EDUCATION_CHILDCARE",
      title: "子育て相談の機会と利用",
      statement: "架空村ひなたの子育て相談の利用状況を、確かめる必要があるかもしれません。",
      basisFactIds: ["fixture-fact-education-v1", "fixture-fact-education-users-v1"],
      factSummary: [
        { text: "架空村ひなたの子育て相談は、2025年9月1日時点で6回です。", groundFactIds: ["fixture-fact-education-v1"] },
        { text: "架空村ひなたの子育て相談の利用は、2025年9月1日時点で延べ54人です。", groundFactIds: ["fixture-fact-education-users-v1"] },
      ],
      background: [],
      notDeterminable: ["利用した人が相談に満足したかどうかは、この資料からは分かりません。", "相談を必要とする人の数は、この資料からは分かりません。"],
      additionalChecks: ["相談の開催時間帯を確かめる必要があります。", "利用者の年齢や世帯の状況を確かめる必要があります。"],
      decisionScenes: ["子育てを支える機会の持ち方を考える場面", "子どもの学びを支える方法を考える場面"],
      responseDirections: [
        direction("相談の機会を増やす", "相談できる時間や場所を増やす取り組みです。", "CHANGE"),
        direction("今ある相談を続ける", "今ある相談の機会を続ける取り組みです。", "CONTINUE"),
      ],
    },
  },
];

/**
 * Saves the draft of a candidate the way `runDraft` does (the same prompt, the same key, the same
 * checks, the same records), with the answer taken from the script. `runDraft` itself is not used,
 * because it calls only the models that are allowed (the models of the real service), and a
 * fictional draft must not say that a real model wrote it: its model is `fixture-draft-model-v1`.
 */
async function saveFictionalDraft(
  store: DraftStore,
  settings: IssueSettings,
  facts: readonly FixtureFact[],
  spec: IssueSpec,
  clock: () => Date,
): Promise<string> {
  const request = DraftRequestSchema.parse({ task: "ISSUE_CANDIDATE", dataKind: "FIXTURE", facts, evidence: [], sources: [] });
  const prompt = buildPrompt(request, { premiseTemplates: settings.checks.neutrality.premiseTemplates });
  const inputHash = Sha256Schema.parse(sha256Hex(encodeCanonicalJson({ system: prompt.system, text: prompt.text, inputSources: [] })));
  const key = { task: "ISSUE_CANDIDATE" as const, promptVersion: PROMPT_VERSION, modelId: FIXTURE_DRAFT_MODELS.generation, inputHash };
  const draftId = draftIdOf(key);
  const at = ISOInstantSchema.parse(clock().toISOString());
  const checked = runDraftChecks(JSON.stringify(spec.candidate), {
    task: "ISSUE_CANDIDATE",
    dataKind: "FIXTURE",
    config: settings.checks,
    evidence: [],
    facts,
    themes: settings.themes,
    factNumerals: factNumeralsOf(facts),
    today: at.slice(0, 10),
  });
  if (!checked.ok) {
    throw new Error(`The candidate of ${spec.issueId} does not pass the checks: ${checked.violations.map((item) => `${item.check}:${item.target}`).join(",")}`);
  }
  const saved = await store.saveDraft({
    draftId,
    key,
    dataKind: "FIXTURE",
    aiClass: "AI_DRAFT",
    modelId: FIXTURE_DRAFT_MODELS.generation,
    generatedAt: at,
    inputSources: [],
    output: checked.output,
  });
  const recorded = await store.appendEvent(makeDraftEvent({ at, dataKind: "FIXTURE", task: "ISSUE_CANDIDATE", kind: "DRAFTED", draftId }));
  if (!saved.ok || !recorded.ok) {
    throw new Error(`The draft of ${spec.issueId} was not saved`);
  }
  return draftId;
}

/**
 * Writes the input records of the fictional issues below the root: the registry of the fact items
 * (`facts.json`), and, for each issue, the draft of its candidate (made by `runDraft` with a fake of
 * the model), the events, the record of the issue (made when a person adopts the draft) and the
 * approval. It calls no model: the fake answers from the script above.
 */
export async function generateFixtureIssueRecords(root: RecordRoot): Promise<void> {
  const settings = await loadTestIssueSettings();
  const registry = [...(await factsOfCards()), ...ADDED_FACTS];
  await mkdir(root.rootDir, { recursive: true });
  await writeFile(join(root.rootDir, "facts.json"), encodeCanonicalJson(registry));

  const store = createDraftStore(root);
  const clock = createClock(DRAFTING_STARTS_AT, 1000);
  const approvalClock = (): Date => new Date(FIXTURE_APPROVED_AT);
  for (const spec of ISSUE_SPECS) {
    const facts = spec.factIds.map((factId) => {
      const found = registry.find((candidate) => candidate.factId === factId);
      if (found === undefined) {
        throw new Error(`The fact ${factId} is not in the registry`);
      }
      return found;
    });
    const draftId = await saveFictionalDraft(store, settings, facts, spec, clock);
    const adopted = await adoptDraft(
      { store, now: clock },
      {
        task: "ISSUE_CANDIDATE",
        draftId,
        reviewerId: FIXTURE_ISSUE_REVIEWER,
        target: { targetKind: "ISSUE", targetId: spec.issueId },
      },
    );
    if (!adopted.ok) {
      throw new Error(`The draft of ${spec.issueId} was not adopted: ${adopted.error.code}`);
    }
    const approved = await approveTarget(
      { store, now: approvalClock },
      { targetKind: "ISSUE", targetId: spec.issueId, version: 1, approverId: FIXTURE_ISSUE_APPROVER, issueChecks: ALL_CONFIRMED },
    );
    if (!approved.ok) {
      throw new Error(`The approval of ${spec.issueId} was not written: ${approved.error.code}`);
    }
  }
}
