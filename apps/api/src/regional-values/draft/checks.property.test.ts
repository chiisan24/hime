import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FIXTURE_FACTS,
  candidateRequest,
  checkContextFor,
  fixtureFact,
  passingCandidate,
  passingQuestionDraft,
  passingSummary,
  questionRequest,
  summaryRequest,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import { runDraftChecks } from "./checks.js";
import type { DraftCheckId } from "./checks.js";
import type { DraftRequest } from "./request.js";

const RUNS = 200;
const THEMES = ["TRANSPORT", "EDUCATION_CHILDCARE", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION", "UNCLASSIFIED"];

function pick<T>(values: readonly T[], n: number): T {
  return values[n % values.length] as T;
}

/** A candidate that passes, with variations that do not matter to the checks (the theme and the full stop). */
function baseCandidate(n: number, change: Record<string, unknown> = {}): Record<string, unknown> {
  return passingCandidate({
    themeId: pick(THEMES, n),
    statement: `路線の本数と利用の関係を確かめたい仮説語尾${n % 2 === 0 ? "" : "。"}`,
    ...change,
  });
}

type Case = Readonly<{
  name: string;
  request: DraftRequest;
  expected: DraftCheckId;
  output: (n: number) => unknown;
}>;

const [FX1, FX2] = [FIXTURE_FACTS[0] as FixtureFact, FIXTURE_FACTS[1] as FixtureFact];
const OTHER_AREA = fixtureFact("fx-t", { sentence: "試験町のバス路線は5本である。", value: { amount: 5, unit: "本" }, area: "試験町" });
const candidate = candidateRequest();
const mixedUnits = candidateRequest({ facts: [FX1, FX2] });
const twoAreas = candidateRequest({ facts: [FX1, OTHER_AREA] });
const summary = summaryRequest();
const tradeoff = questionRequest("TRADEOFF");

const FORBIDDEN = ["優劣語", "推奨語", "投票語", "おすすめ", "ランキング", "一致率"];
const NEGATIVE = ["しない", "せず", "やめる", "より", "ではなく", "だけ", "のみ", "しか"];

/** One kind of mixing for each case. The response without a mixing passes (the first test). */
const CASES: readonly Case[] = [
  // Property 27 and 57: the ground, the words, the theme, the contract.
  { name: "a basis fact that does not exist", request: candidate, expected: "DR_CANDIDATE_FACTS", output: (n) => baseCandidate(n, { basisFactIds: ["fx-1", `fx-none-${n}`], factSummary: [{ text: "架空市のバス路線は12本である", groundFactIds: ["fx-1"] }] }) },
  { name: "a ground that is not a basis fact", request: candidate, expected: "DR_CANDIDATE_FACTS", output: (n) => baseCandidate(n, { factSummary: [{ text: "架空市のバス路線は12本である", groundFactIds: [`fx-outside-${n}`] }] }) },
  { name: "a number that the fact does not have", request: candidate, expected: "DR_CANDIDATE_FACTS", output: (n) => baseCandidate(n, { factSummary: [{ text: `架空市のバス路線は${13 + (n % 80)}本である`, groundFactIds: ["fx-1"] }] }) },
  { name: "a calculated value", request: candidate, expected: "DR_CANDIDATE_FACTS", output: (n) => baseCandidate(n, { statement: `路線は合わせて${15 + (n % 50)}本あることを確かめたい仮説語尾` }) },
  { name: "a year that is not the year of the facts", request: candidate, expected: "DR_CANDIDATE_FACTS", output: (n) => baseCandidate(n, { background: [{ text: `${2000 + (n % 24)}年に架空市は12本である`, groundFactIds: ["fx-1"] }] }) },
  { name: "a word of recommendation, superiority or urging to vote", request: candidate, expected: "DR_FORBIDDEN_WORDS", output: (n) => baseCandidate(n, { statement: `${pick(FORBIDDEN, n)}の路線を確かめたい仮説語尾` }) },
  { name: "a rank or a score", request: candidate, expected: "DR_JSON", output: (n) => baseCandidate(n, { [pick(["rank", "score", "recommended", "superiority", "ranking"], n)]: n }) },
  { name: "a theme out of the list", request: candidate, expected: "DR_THEME_RANGE", output: (n) => baseCandidate(n, { themeId: pick(["SPORTS", "", "transport", "TRANSPORT ", "UNCLASSIFIED2"], n) }) },
  { name: "a sentence of more than 60 code points", request: candidate, expected: "DR_SENTENCE_LENGTH", output: (n) => baseCandidate(n, { factSummary: [{ text: `架空市のバス路線は12本である${"あ".repeat(48 + (n % 30))}`, groundFactIds: ["fx-1"] }] }) },
  { name: "a sentence of a card whose ground does not exist", request: summary, expected: "DR_GROUND_EXISTS", output: (n) => passingSummary({ sentences: [{ text: "2025年度にバス路線が12本運行された", groundIds: [`E${2 + (n % 8)}`] }] }) },
  { name: "a number that the quotation does not have", request: summary, expected: "DR_GROUND_MATCH", output: (n) => passingSummary({ sentences: [{ text: `2025年度にバス路線が${13 + (n % 80)}本運行された`, groundIds: ["E1"] }] }) },
  { name: "a date that the quotation does not have", request: summary, expected: "DR_GROUND_MATCH", output: (n) => passingSummary({ sentences: [{ text: `${2000 + (n % 24)}年${1 + (n % 12)}月${1 + (n % 28)}日にバス路線が運行された`, groundIds: ["E1"] }] }) },
  { name: "a word of the list in a card", request: summary, expected: "DR_FORBIDDEN_WORDS", output: (n) => passingSummary({ sentences: [{ text: `2025年度に${pick(FORBIDDEN, n)}の路線が12本運行された`, groundIds: ["E1"] }] }) },
  { name: "a theme classification out of the list", request: { ...summary, task: "THEME_CLASSIFY" }, expected: "DR_THEME_RANGE", output: (n) => ({ themeId: pick(["SPORTS", "", "transport", "OTHER"], n) }) },
  { name: "a name in a question", request: tradeoff, expected: "DR_QUESTION_RULES", output: (n) => ({ ...passingQuestionDraft("TRADEOFF"), text: `${pick(["試験候補甲", "試験政党乙", "ParX", "現職", "新人"], n)}について、どちらを先に進めたいですか` }) },
  { name: "a premise that is not a form of the settings", request: tradeoff, expected: "DR_QUESTION_RULES", output: (n) => ({ ...passingQuestionDraft("TRADEOFF"), premise: `どちらかを先に進める場面を考えてください${n}` }) },
  { name: "a negation in a direction of a question", request: tradeoff, expected: "DR_QUESTION_RULES", output: (n) => ({ ...passingQuestionDraft("TRADEOFF"), directionB: { text: `場所を整える取り組み${pick(["を後回しにしない", "を放置せず", "をやめる"], n)}`, category: "CONTINUE" } }) },
  { name: "a form of the contract that is broken in a question", request: questionRequest("IMPORTANCE"), expected: "DR_QUESTION_RULES", output: (n) => ({ ...passingQuestionDraft("IMPORTANCE"), explanation: "あ".repeat(1 + (n % 40)) }) },
  // Property 60: the additional checks of an issue candidate.
  { name: "a word that states a cause", request: candidate, expected: "DR_CAUSAL_CLAIMS", output: (n) => baseCandidate(n, pick([{ statement: "本数が因果語で減ったことを確かめたい仮説語尾" }, { factSummary: [{ text: "因果語で架空市のバス路線は12本である", groundFactIds: ["fx-1"] }] }, { background: [{ text: "因果語で鉄道路線は3本である", groundFactIds: ["fx-3"] }] }], n)) },
  { name: "an end of the statement that is not a hypothesis", request: candidate, expected: "DR_HEDGE_REQUIRED", output: (n) => baseCandidate(n, { statement: `路線の本数は少ない${pick(["", "です", "である", "と言える"], n)}` }) },
  { name: "a comparing sentence that rests on one fact", request: candidate, expected: "DR_COMPARISON", output: (n) => baseCandidate(n, { factSummary: [{ text: `架空市の路線は${pick(["12本", "12本である"], n)}で比較語する`, groundFactIds: ["fx-1"] }] }) },
  { name: "a comparison of facts of different units", request: mixedUnits, expected: "DR_COMPARISON", output: (n) => baseCandidate(n, { basisFactIds: ["fx-1", "fx-2"], factSummary: [{ text: `架空市のバス路線とバス停を比較語する${pick(["", "。"], n)}`, groundFactIds: ["fx-1", "fx-2"] }] }) },
  { name: "a comparison of two areas that states a superiority", request: twoAreas, expected: "DR_COMPARISON", output: (n) => baseCandidate(n, { basisFactIds: ["fx-1", "fx-t"], factSummary: [{ text: `架空市は12本、試験町は5本で${pick(FORBIDDEN.slice(0, 1), n)}を比較語する`, groundFactIds: ["fx-1", "fx-t"] }] }) },
  { name: "a comparison of two areas that does not name them", request: twoAreas, expected: "DR_COMPARISON", output: (n) => baseCandidate(n, { basisFactIds: ["fx-1", "fx-t"], factSummary: [{ text: `バス路線は12本と5本で比較語する${pick(["", "。"], n)}`, groundFactIds: ["fx-1", "fx-t"] }] }) },
  { name: "a lack of what cannot be told or what to check", request: candidate, expected: "DR_UNKNOWN_REQUIRED", output: (n) => baseCandidate(n, pick([{ notDeterminable: [] }, { additionalChecks: [] }, { notDeterminable: [], additionalChecks: [] }], n)) },
  { name: "a negation or an exclusive word in a description of a direction", request: candidate, expected: "DR_DIRECTION_RULES", output: (n) => baseCandidate(n, { responseDirections: [{ label: "路線の見直し", description: `路線の配置${pick(NEGATIVE, n)}を見直す方向`, category: "CHANGE", status: "REFERENCE_ONLY" }] }) },
  { name: "a recommendation in a direction", request: candidate, expected: "DR_DIRECTION_RULES", output: (n) => baseCandidate(n, { responseDirections: [{ label: n % 2 === 0 ? `${pick(["推奨語", "優劣語", "投票語"], n)}の見直し` : "路線の見直し", description: n % 2 === 0 ? "路線の配置を見直す方向" : `${pick(["推奨語", "優劣語", "投票語"], n)}の配置を見直す方向`, category: "CHANGE", status: "REFERENCE_ONLY" }] }) },
];

describe("Properties 27, 57 and 60: an output with one kind of mixing is refused", () => {
  /** **Validates: Requirements 8.8, 8.9, 8.10, 8.11, 8.18, 8.24, 8.26, 12.5, 12.17, 12.20** */
  it("refuses every output that has one mixing, and names the check", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CASES), fc.nat({ max: 1000 }), (item, n) => {
        const result = runDraftChecks(JSON.stringify(item.output(n)), checkContextFor(item.request));
        expect(result.ok, item.name).toBe(false);
        if (!result.ok) {
          expect(result.violations.map((violation) => violation.check), item.name).toContain(item.expected);
        }
      }),
      { numRuns: RUNS * 3 },
    );
  });

  it("has a case for each of the checks that a mixing can be refused by", () => {
    const covered = new Set(CASES.map((item) => item.expected));
    for (const check of [
      "DR_JSON",
      "DR_GROUND_EXISTS",
      "DR_GROUND_MATCH",
      "DR_FORBIDDEN_WORDS",
      "DR_SENTENCE_LENGTH",
      "DR_THEME_RANGE",
      "DR_QUESTION_RULES",
      "DR_CANDIDATE_FACTS",
      "DR_CAUSAL_CLAIMS",
      "DR_HEDGE_REQUIRED",
      "DR_COMPARISON",
      "DR_UNKNOWN_REQUIRED",
      "DR_DIRECTION_RULES",
    ] as const) {
      expect(covered.has(check), check).toBe(true);
    }
  });

  it("accepts an output that has no mixing, for any of the variations that do not matter", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), (n) => {
        expect(runDraftChecks(JSON.stringify(baseCandidate(n)), checkContextFor(candidate)).ok).toBe(true);
        expect(runDraftChecks(JSON.stringify(passingSummary()), checkContextFor(summary)).ok).toBe(true);
        for (const kind of ["IMPORTANCE", "TRADEOFF", "PRIORITY_PICK"] as const) {
          expect(runDraftChecks(JSON.stringify(passingQuestionDraft(kind, pick(THEMES.slice(0, 6), n) as "TRANSPORT")), checkContextFor(questionRequest(kind))).ok, kind).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("gives the same answer for the same output, and never puts the text of the output in the answer", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CASES), fc.nat({ max: 1000 }), (item, n) => {
        const text = JSON.stringify(item.output(n));
        const first = runDraftChecks(text, checkContextFor(item.request));
        expect(runDraftChecks(text, checkContextFor(item.request))).toEqual(first);
        if (!first.ok) {
          const reported = JSON.stringify(first.violations);
          // A place is `statement`, `factSummary[0]`, `themeId`: a short key, never a sentence.
          for (const violation of first.violations) {
            expect(violation.target.length).toBeLessThanOrEqual(60);
            expect(violation.target).toMatch(/^[A-Za-z0-9_.[\]]+$/u);
          }
          expect(reported).not.toContain("架空市のバス路線は");
        }
      }),
      { numRuns: RUNS },
    );
  });
});
