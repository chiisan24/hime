import {
  DiagnosticSetSchema,
  GUIDANCE_SCENES,
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  QuestionSchema,
  ResultTextSchema,
  ThemeDefSchema,
  type IssueCard,
  type Level,
  type Question,
  type ResultText,
} from "@ehime-vote-navigator/contracts";

import type { ViewBundle } from "../../../packages/domain/src/regional-values/view/viewTypes.js";
import {
  DEFAULT_THRESHOLDS,
  TB_FULL,
  TB_QUICK,
  THEME_ORDER,
  type BankQuestion,
  type MapBank,
  type ThemeValue,
  type Thresholds,
} from "./testBanks.js";
import { syntheticFixedTexts } from "./testFixedTexts.js";

/**
 * A test view bundle made from a test bank: real contract objects (parsed, so they
 * are valid), with synthetic texts. The wording is not real; each result text and
 * guidance question names the theme, the axis and the level it belongs to, so that a
 * test can see where a part of a view model came from.
 */

export const THEME_LABELS: Readonly<Record<ThemeValue, string>> = {
  TRANSPORT: "交通",
  EDUCATION_CHILDCARE: "教育・子育て",
  ECONOMY_EMPLOYMENT: "経済・雇用",
  HEALTHCARE_WELFARE: "医療・福祉",
  DISASTER_PREVENTION: "防災",
  POPULATION_REVITALIZATION: "人口減少・地域活性化",
};

export const IMPORTANCE_LABELS = ["とても大切", "大切", "どちらでもない", "あまり大切でない", "大切でない"] as const;
export const TRADEOFF_LABELS = ["Aを強く", "Aをやや", "同程度", "Bをやや", "Bを強く"] as const;

const LEVELS: readonly Level[] = [2, 1, 0, -1, -2];
const APPROVAL = { status: "APPROVED", approverId: "test-approver", approvedAt: "2026-01-01T00:00:00Z" };

export function syntheticResultText(themeId: string, axis: string, level: number): string {
  return `〈result:${themeId}:${axis}:${level}〉`;
}

export function syntheticGuidanceText(themeId: string, scene: string): string {
  return `〈guidance:${themeId}:${scene}〉か`;
}

export function questionTextOf(questionId: string): string {
  return `質問:${questionId}`;
}

export function explanationOf(questionId: string): string {
  return `${"これは試験用の説明文です。".repeat(5)}説明:${questionId}。`;
}

export function fixtureCardOf(cardId: string, themeId: ThemeValue): IssueCard {
  return IssueCardSchema.parse({
    cardId,
    dataKind: "FIXTURE",
    themeId,
    title: `〈${cardId}〉`,
    background: "架空の背景説明です。",
    glossary: [{ term: "試験用", description: `〈glossary:${cardId}〉` }],
    quote: { sourceId: `fsrc-${cardId}`, text: "架空の引用" },
    aiInvolvement: "HUMAN",
    updatedOn: "2026-01-01",
    approval: APPROVAL,
    sources: [{ dataKind: "FIXTURE", sourceId: `fsrc-${cardId}` }],
    facts: [],
  });
}

/** A real-data card with one source, to test what depends on the terms of use of a source. */
export function realCardOf(
  cardId: string,
  themeId: ThemeValue,
  source: Readonly<{
    sourceId: string;
    usage: "CONFIRMED" | "UNKNOWN" | "RESTRICTED";
    reference: "url" | "document-id";
  }>,
): IssueCard {
  return IssueCardSchema.parse({
    cardId,
    dataKind: "REAL_AI",
    themeId,
    title: `〈${cardId}〉`,
    background: "試験用の背景説明です。",
    glossary: [{ term: "試験用", description: `〈glossary:${cardId}〉` }],
    quote: { sourceId: source.sourceId, text: "試験用の引用" },
    aiInvolvement: "HUMAN",
    updatedOn: "2026-01-01",
    approval: APPROVAL,
    sources: [
      {
        dataKind: "REAL_AI",
        sourceId: source.sourceId,
        revision: "rev-1",
        reference:
          source.reference === "url"
            ? { kind: "url", url: `https://example.com/${source.sourceId}` }
            : { kind: "document-id", documentId: `doc-${source.sourceId}` },
        publisher: "試験用の公開者",
        publishedOn: "2026-01-01",
        retrievedAt: "2026-02-01T00:00:00Z",
        locator: { kind: "pdf-page", page: 1 },
        sha256: "a".repeat(64),
        usage: { status: source.usage, checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "試験用" },
        datasetNote: null,
        transmission: { status: "UNKNOWN" },
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      },
    ],
    facts: [],
  });
}

function questionOf(bankQuestion: BankQuestion): Question {
  const base = {
    questionId: bankQuestion.questionId,
    dataKind: "FIXTURE",
    author: "HUMAN",
    createdOn: "2026-01-01",
    version: 1,
    text: questionTextOf(bankQuestion.questionId),
    explanation: explanationOf(bankQuestion.questionId),
    unsureLabel: "わからない",
    declineLabel: "回答しない",
    weight: bankQuestion.weight,
    swapDirections: false,
    approval: {
      forVersion: 1,
      review: { modelId: "test-model", reviewedAt: "2026-01-01T00:00:00Z", verdict: "NO_BIAS_FOUND", findings: [] },
      approverId: "approver-1",
      approvedAt: "2026-01-02T00:00:00Z",
    },
  };
  switch (bankQuestion.kind) {
    case "IMPORTANCE":
      return QuestionSchema.parse({
        ...base,
        kind: "IMPORTANCE",
        themeId: bankQuestion.themeId,
        opinionLabels: [...IMPORTANCE_LABELS],
      });
    case "TRADEOFF":
      return QuestionSchema.parse({
        ...base,
        kind: "TRADEOFF",
        themeId: bankQuestion.themeId,
        opinionLabels: [...TRADEOFF_LABELS],
        premise: "限られた予算での選択を考えます。",
        directionA: { text: "方向Aの文", category: "CHANGE" },
        directionB: { text: "方向Bの文", category: "CONTINUE" },
      });
    case "PRIORITY_PICK":
      return QuestionSchema.parse({ ...base, kind: "PRIORITY_PICK", themeIds: [...THEME_ORDER], maxSelect: 2 });
  }
}

function resultTexts(): ResultText[] {
  return THEME_ORDER.flatMap((themeId) =>
    (["IMPORTANCE", "TRADEOFF"] as const).flatMap((axis) =>
      LEVELS.map((level) =>
        ResultTextSchema.parse({
          dataKind: "FIXTURE",
          themeId,
          axis,
          level,
          text: syntheticResultText(themeId, axis, level),
          approval: APPROVAL,
        }),
      ),
    ),
  );
}

export function viewBundleFor(bank: MapBank, thresholds: Thresholds = DEFAULT_THRESHOLDS): ViewBundle {
  return {
    meta: { dataKind: "FIXTURE" },
    themes: THEME_ORDER.map((themeId) => ThemeDefSchema.parse({ themeId, label: THEME_LABELS[themeId] })),
    questions: bank.questions.map(questionOf),
    diagnosticSets: bank.sets.map((set) => DiagnosticSetSchema.parse(set)),
    mapConfig: MapConfigSchema.parse({ thresholds, guidanceMaxThemes: 3 }),
    cards: [fixtureCardOf("card-1", "EDUCATION_CHILDCARE"), fixtureCardOf("card-2", "DISASTER_PREVENTION")],
    resultTexts: resultTexts(),
    fixedTexts: syntheticFixedTexts("FIXTURE"),
    guidance: THEME_ORDER.flatMap((themeId) =>
      GUIDANCE_SCENES.map((scene) =>
        GuidanceQuestionSchema.parse({
          themeId,
          scene,
          text: syntheticGuidanceText(themeId, scene),
          linkSourceId: null,
          approval: APPROVAL,
        }),
      ),
    ),
    aiContribution: { DRAFTED: 0, REJECTED_BY_CHECKS: 0, HUMAN_EDITED: 0, HUMAN_REJECTED: 0 },
  };
}

/** QUICK only (three themes, six questions). */
export const QUICK_VIEW_BUNDLE: ViewBundle = viewBundleFor(TB_QUICK);

/** FULL (six themes, thirteen questions, with the priority-theme question) and QUICK. */
export const FULL_VIEW_BUNDLE: ViewBundle = viewBundleFor(TB_FULL);