import { describe, expect, it } from "vitest";

import {
  FIXTURE_FACTS,
  SUMMARY_EVIDENCE,
  candidateRequest,
  checkContextFor,
  evidenceUnit,
  fixtureFact,
  passingCandidate,
  passingQuestionDraft,
  passingSummary,
  questionRequest,
  summaryRequest,
  testCheckConfig,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import type { FixtureFact } from "@ehime-vote-navigator/contracts";
import { factNumeralsOf, runDraftChecks } from "./checks.js";
import type { DraftCheckContext, DraftCheckResult } from "./checks.js";
import type { DraftRequest } from "./request.js";

function run(request: DraftRequest, output: unknown, over: Partial<DraftCheckContext> = {}): DraftCheckResult {
  return runDraftChecks(typeof output === "string" ? output : JSON.stringify(output), checkContextFor(request, over));
}

/** The failed checks with their places, as `CHECK:target`. */
function failures(result: DraftCheckResult): readonly string[] {
  return result.ok ? [] : result.violations.map((violation) => `${violation.check}:${violation.target}`);
}

const candidate = candidateRequest();

/** The record without some of its keys. */
function without(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

describe("runDraftChecks: the JSON (DR_JSON)", () => {
  it("accepts a candidate that passes every check, and returns the parsed output", () => {
    const result = run(candidate, passingCandidate());
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toEqual(passingCandidate());
  });

  it("refuses text that is not one JSON object, and does not repair it", () => {
    const text = JSON.stringify(passingCandidate());
    for (const broken of ["", "not json", `\`\`\`json\n${text}\n\`\`\``, `Here it is: ${text}`, `${text}\n以上です`, "[]", "null", `${text.slice(0, -1)}`]) {
      expect(failures(run(candidate, broken))).toEqual(["DR_JSON:output"]);
    }
  });

  it("refuses a key that the contract does not know, such as a rank or a score", () => {
    for (const extra of [{ rank: 1 }, { score: 0.9 }, { recommended: true }, { superiority: "A" }]) {
      expect(failures(run(candidate, { ...passingCandidate(), ...extra }))).toEqual(["DR_JSON:output"]);
    }
  });

  it("refuses a missing key and a wrong type, with the place", () => {
    expect(failures(run(candidate, without(passingCandidate(), "title")))).toEqual(["DR_JSON:title"]);
    expect(failures(run(candidate, passingCandidate({ title: 3 })))).toEqual(["DR_JSON:title"]);
  });
});

describe("runDraftChecks: the ground of a card (DR_GROUND_EXISTS, DR_GROUND_MATCH)", () => {
  const summary = summaryRequest();

  it("accepts a sentence whose numbers and dates are in the quotation", () => {
    expect(run(summary, passingSummary()).ok).toBe(true);
  });

  it("refuses a ground that is not in the input, with the place of the ground", () => {
    const output = passingSummary({ sentences: [{ text: "2025年度にバス路線が12本運行された", groundIds: ["E1", "E9"] }] });
    expect(failures(run(summary, output))).toEqual(["DR_GROUND_EXISTS:sentences[0].groundIds[1]"]);
  });

  it("refuses a number, a date and a proper noun that the quotation does not have", () => {
    for (const text of ["2025年度にバス路線が13本運行された", "2026年4月1日にバス路線が運行された", "試験町でバス路線が運行された"]) {
      expect(failures(run(summary, passingSummary({ sentences: [{ text, groundIds: ["E1"] }] })))).toEqual(["DR_GROUND_MATCH:sentences[0]"]);
    }
  });

  it("finds the numbers of a sentence in the quotations of all of its grounds", () => {
    const request = summaryRequest({ evidence: [SUMMARY_EVIDENCE, evidenceUnit("E2", "鉄道は3本である。")] });
    const output = passingSummary({ sentences: [{ text: "バス路線は12本、鉄道は3本ある", groundIds: ["E1", "E2"] }] });
    expect(run(request, output).ok).toBe(true);
    expect(failures(run(request, passingSummary({ sentences: [{ text: "バス路線は12本、鉄道は3本ある", groundIds: ["E1"] }] })))).toEqual(["DR_GROUND_MATCH:sentences[0]"]);
  });

  it("checks the title and the terms for the words that are not allowed, and each sentence of a gloss for its ground", () => {
    const background = { ...summary, task: "BACKGROUND_DRAFT" as const };
    expect(run(background, { title: "路線の背景", sentences: [{ text: "2025年度に12本運行された", groundIds: ["E1"] }] }).ok).toBe(true);
    expect(failures(run(background, { title: "推奨語の背景", sentences: [{ text: "2025年度に12本運行された", groundIds: ["E1"] }] }))).toEqual(["DR_FORBIDDEN_WORDS:title"]);
    const gloss = { ...summary, task: "TERM_GLOSS" as const };
    const items = [{ term: "路線", sentences: [{ text: "バス路線は12本である", groundIds: ["E1"] }, { text: "バス路線は14本である", groundIds: ["E1"] }] }];
    expect(failures(run(gloss, { items }))).toEqual(["DR_GROUND_MATCH:items[0].sentences[1]"]);
  });
});

describe("runDraftChecks: the words that are not allowed (DR_FORBIDDEN_WORDS)", () => {
  it("refuses a recommendation, a superiority, an urging to vote and a banned word, in a card and in a candidate", () => {
    for (const word of ["推奨語", "優劣語", "投票語", "おすすめ", "ランキング"]) {
      const card = passingSummary({ sentences: [{ text: `2025年度に${word}の路線が12本運行された`, groundIds: ["E1"] }] });
      expect(failures(run(summaryRequest(), card))).toContain("DR_FORBIDDEN_WORDS:sentences[0]");
      const proposal = passingCandidate({ statement: `${word}を確かめたい仮説語尾` });
      expect(failures(run(candidate, proposal))).toContain("DR_FORBIDDEN_WORDS:statement");
    }
  });
});

describe("runDraftChecks: the length of a sentence (DR_SENTENCE_LENGTH)", () => {
  it("accepts 60 code points and refuses 61", () => {
    const sentence = (length: number): string => `2025年度に12本運行された${"あ".repeat(length - 15)}`;
    expect(Array.from(sentence(60))).toHaveLength(60);
    expect(run(summaryRequest(), passingSummary({ sentences: [{ text: sentence(60), groundIds: ["E1"] }] })).ok).toBe(true);
    expect(failures(run(summaryRequest(), passingSummary({ sentences: [{ text: sentence(61), groundIds: ["E1"] }] })))).toEqual(["DR_SENTENCE_LENGTH:sentences[0].text"]);
  });

  it("applies a limit of the settings that is stricter than the contract", () => {
    const strict = { ...testCheckConfig(), sentenceMaxChars: 20 };
    const output = passingSummary({ sentences: [{ text: `2025年度に12本運行された${"あ".repeat(10)}`, groundIds: ["E1"] }] });
    expect(failures(run(summaryRequest(), output, { config: strict }))).toEqual(["DR_SENTENCE_LENGTH:sentences[0]"]);
  });

  it("refuses a statement of a candidate that is too long", () => {
    expect(run(candidate, passingCandidate({ statement: `${"あ".repeat(56)}仮説語尾` })).ok).toBe(true);
    expect(failures(run(candidate, passingCandidate({ statement: `${"あ".repeat(57)}仮説語尾` })))).toEqual(["DR_SENTENCE_LENGTH:statement"]);
  });
});

describe("runDraftChecks: the theme (DR_THEME_RANGE)", () => {
  it("accepts one of the six themes and UNCLASSIFIED for a classification and a candidate", () => {
    const request = { ...summaryRequest(), task: "THEME_CLASSIFY" as const };
    expect(run(request, { themeId: "TRANSPORT" }).ok).toBe(true);
    expect(run(request, { themeId: "UNCLASSIFIED" }).ok).toBe(true);
    expect(run(candidate, passingCandidate({ themeId: "UNCLASSIFIED" })).ok).toBe(true);
  });

  it("refuses a theme that is not in the list, and UNCLASSIFIED for a question", () => {
    const request = { ...summaryRequest(), task: "THEME_CLASSIFY" as const };
    expect(failures(run(request, { themeId: "SPORTS" }))).toEqual(["DR_THEME_RANGE:themeId"]);
    expect(failures(run(candidate, passingCandidate({ themeId: "SPORTS" })))).toEqual(["DR_THEME_RANGE:themeId"]);
    expect(failures(run(questionRequest("IMPORTANCE"), { ...passingQuestionDraft("IMPORTANCE"), themeId: "UNCLASSIFIED" }))).toEqual(["DR_THEME_RANGE:themeId"]);
  });
});

describe("runDraftChecks: a question (DR_QUESTION_RULES)", () => {
  it("accepts a draft of each form that passes the checks of the question bank", () => {
    expect(run(questionRequest("IMPORTANCE"), passingQuestionDraft("IMPORTANCE")).ok).toBe(true);
    expect(run(questionRequest("TRADEOFF"), passingQuestionDraft("TRADEOFF")).ok).toBe(true);
    expect(run(questionRequest("PRIORITY_PICK"), passingQuestionDraft("PRIORITY_PICK")).ok).toBe(true);
  });

  const tradeoff = questionRequest("TRADEOFF");
  const withChange = (change: Record<string, unknown>): unknown => ({ ...passingQuestionDraft("TRADEOFF"), ...change });

  it("applies the checks of a question written by a person, with the check as the place", () => {
    expect(failures(run(tradeoff, withChange({ text: "試験候補甲について、どちらを先に進めたいですか" })))).toEqual(["DR_QUESTION_RULES:NAME_FREE"]);
    expect(failures(run(tradeoff, withChange({ premise: "どちらかを先に進める場面を考えてください" })))).toEqual(["DR_QUESTION_RULES:PREMISE"]);
    expect(failures(run(tradeoff, withChange({ directionA: { text: "情報を届けることをやめる取り組み", category: "CHANGE" } })))).toContain("DR_QUESTION_RULES:POSITIVE_FRAMING");
    expect(
      failures(run(tradeoff, withChange({ opinionLabels: ["方向Aを強く優先", "方向Aをやや優先", "どちらでもよい", "方向Bをやや優先", "方向Bを強く優先"] }))),
    ).toEqual(["DR_QUESTION_RULES:NON_EXCLUSIVE"]);
    expect(failures(run(tradeoff, withChange({ text: "地域交通について、かつ予算の使い道で、どちらを先に進めたいですか" })))).toContain("DR_QUESTION_RULES:SINGLE_ISSUE");
  });

  it("refuses a number that is the number of a fact (NO_FACT_NUMBERS) when the facts are known", () => {
    const output = withChange({ text: "地域交通の12について、どちらを先に進めたいですか" });
    expect(failures(run(tradeoff, output, { factNumerals: new Set(["12"]) }))).toContain("DR_QUESTION_RULES:NO_FACT_NUMBERS");
    expect(failures(run(tradeoff, output, { factNumerals: new Set() }))).not.toContain("DR_QUESTION_RULES:NO_FACT_NUMBERS");
  });

  it("refuses a form that the contract of a question does not accept, with the place", () => {
    expect(failures(run(questionRequest("IMPORTANCE"), { ...passingQuestionDraft("IMPORTANCE"), explanation: "短い解説です" }))).toEqual(["DR_QUESTION_RULES:explanation"]);
    expect(failures(run(tradeoff, withChange({ directionA: { text: "あ".repeat(61), category: "CHANGE" } })))).toContain("DR_QUESTION_RULES:directionA.text");
  });

  it("refuses a theme that has no label, because the text of an importance question is made from it", () => {
    expect(failures(run(questionRequest("IMPORTANCE"), passingQuestionDraft("IMPORTANCE"), { themes: [] }))).toEqual(["DR_QUESTION_RULES:themeId"]);
  });

  it("refuses the words that are not allowed in a question", () => {
    expect(failures(run(tradeoff, withChange({ explanation: `${(passingQuestionDraft("TRADEOFF") as { explanation: string }).explanation}推奨語` })))).toContain("DR_FORBIDDEN_WORDS:explanation");
  });
});

describe("runDraftChecks: an issue candidate (DR_CANDIDATE_FACTS)", () => {
  it("refuses a basis fact that is not among the facts of the input", () => {
    const output = passingCandidate({
      basisFactIds: ["fx-1", "fx-9"],
      factSummary: [{ text: "架空市のバス路線は12本である", groundFactIds: ["fx-1"] }],
    });
    expect(failures(run(candidate, output))).toEqual(["DR_CANDIDATE_FACTS:basisFactIds[1]"]);
  });

  it("refuses a ground that is not one of the basis facts", () => {
    const output = passingCandidate({ factSummary: [{ text: "架空市のバス路線は12本である", groundFactIds: ["fx-2"] }] });
    expect(failures(run(candidate, output))).toEqual(["DR_CANDIDATE_FACTS:factSummary[0].groundFactIds[0]"]);
  });

  it("refuses a number, a date or a proper name that is not in the fact that the sentence rests on", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["a different number", { factSummary: [{ text: "架空市のバス路線は13本である", groundFactIds: ["fx-1"] }] }],
      ["the number of another fact", { factSummary: [{ text: "架空市のバス路線は3本である", groundFactIds: ["fx-1"] }] }],
      ["a calculated value in the statement", { statement: "路線は合わせて15本あることを確かめたい仮説語尾" }],
      ["a date that is not the date of the facts", { factSummary: [{ text: "2024年に架空市のバス路線は12本である", groundFactIds: ["fx-1"] }] }],
      ["a name that the facts do not have", { statement: "試験町の路線を確かめたい仮説語尾" }],
      ["a number in the background", { background: [{ text: "架空市のバス路線は99本である", groundFactIds: ["fx-1"] }] }],
      ["a number in a scene", { decisionScenes: ["路線が20本になる場面"] }],
    ];
    for (const [name, change] of cases) {
      expect(failures(run(candidate, passingCandidate(change))), name).toContainEqual(expect.stringMatching(/^DR_CANDIDATE_FACTS:/u));
    }
  });

  it("finds a date that is written in the form of the year, the date and the Japanese form", () => {
    const dated: FixtureFact = fixtureFact("fx-d", { sentence: "架空市の集計日は2025年4月1日である。", surveyDate: "2025-04-01", value: { amount: 7, unit: "本" } });
    const request = candidateRequest({ facts: [dated] });
    const output = passingCandidate({
      basisFactIds: ["fx-d"],
      factSummary: [{ text: "2025年4月1日に架空市は7本である", groundFactIds: ["fx-d"] }],
    });
    expect(run(request, output).ok).toBe(true);
    expect(failures(run(request, passingCandidate({ basisFactIds: ["fx-d"], factSummary: [{ text: "2025年5月1日に架空市は7本である", groundFactIds: ["fx-d"] }] })))).toEqual(["DR_CANDIDATE_FACTS:factSummary[0]"]);
  });
});

describe("runDraftChecks: a cause, a hypothesis and a comparison (DR_CAUSAL_CLAIMS, DR_HEDGE_REQUIRED, DR_COMPARISON)", () => {
  it("refuses a word that states a cause in the statement, the summary and the background", () => {
    expect(failures(run(candidate, passingCandidate({ statement: "本数が因果語で減ったことを確かめたい仮説語尾" })))).toEqual(["DR_CAUSAL_CLAIMS:statement"]);
    expect(failures(run(candidate, passingCandidate({ factSummary: [{ text: "因果語で架空市のバス路線は12本である", groundFactIds: ["fx-1"] }] })))).toEqual(["DR_CAUSAL_CLAIMS:factSummary[0]"]);
    expect(failures(run(candidate, passingCandidate({ background: [{ text: "因果語で鉄道路線は3本である", groundFactIds: ["fx-3"] }] })))).toEqual(["DR_CAUSAL_CLAIMS:background[0]"]);
  });

  it("requires the statement to end like a hypothesis, with or without the full stop", () => {
    expect(run(candidate, passingCandidate({ statement: "路線の本数を確かめたい仮説語尾。" })).ok).toBe(true);
    expect(failures(run(candidate, passingCandidate({ statement: "路線の本数は少ない" })))).toEqual(["DR_HEDGE_REQUIRED:statement"]);
    expect(failures(run(candidate, passingCandidate({ statement: "仮説語尾の路線を確かめる" })))).toEqual(["DR_HEDGE_REQUIRED:statement"]);
  });

  it("requires a sentence that compares to rest on two facts of the same unit, area and year", () => {
    const comparing = (grounds: string[]): unknown =>
      passingCandidate({ factSummary: [{ text: "架空市のバス路線と鉄道路線を比較語する", groundFactIds: grounds }] });
    expect(run(candidate, comparing(["fx-1", "fx-3"])).ok).toBe(true);
    expect(failures(run(candidate, comparing(["fx-1"])))).toEqual(["DR_COMPARISON:factSummary[0]"]);
    const mixed = candidateRequest({ facts: [FIXTURE_FACTS[0] as FixtureFact, FIXTURE_FACTS[1] as FixtureFact] });
    expect(failures(run(mixed, passingCandidate({ basisFactIds: ["fx-1", "fx-2"], factSummary: [{ text: "架空市のバス路線とバス停を比較語する", groundFactIds: ["fx-1", "fx-2"] }] })))).toEqual([
      "DR_COMPARISON:factSummary[0]",
    ]);
  });

  it("requires the facts of a comparison of different areas to name both areas, and refuses a superiority", () => {
    const other = fixtureFact("fx-t", { sentence: "試験町のバス路線は5本である。", value: { amount: 5, unit: "本" }, area: "試験町" });
    const request = candidateRequest({ facts: [FIXTURE_FACTS[0] as FixtureFact, other] });
    const compare = (text: string): unknown =>
      passingCandidate({ basisFactIds: ["fx-1", "fx-t"], factSummary: [{ text, groundFactIds: ["fx-1", "fx-t"] }] });
    expect(run(request, compare("架空市は12本、試験町は5本で比較語する")).ok).toBe(true);
    expect(failures(run(request, compare("バス路線は12本と5本で比較語する")))).toEqual(["DR_COMPARISON:factSummary[0]"]);
    expect(failures(run(request, compare("架空市は12本、試験町は5本で優劣語を比較語する")))).toEqual(
      expect.arrayContaining(["DR_COMPARISON:factSummary[0]", "DR_FORBIDDEN_WORDS:factSummary[0]"]),
    );
  });

  it("requires a sentence that compares facts of different years to write both years", () => {
    const older = fixtureFact("fx-old", { sentence: "架空市のバス路線は10本である。", value: { amount: 10, unit: "本" }, surveyDate: 2020 });
    const request = candidateRequest({ facts: [FIXTURE_FACTS[0] as FixtureFact, older] });
    const compare = (text: string): unknown =>
      passingCandidate({ basisFactIds: ["fx-1", "fx-old"], factSummary: [{ text, groundFactIds: ["fx-1", "fx-old"] }] });
    expect(run(request, compare("架空市は2025年に12本、2020年に10本で比較語する")).ok).toBe(true);
    expect(failures(run(request, compare("架空市は12本と10本で比較語する")))).toEqual(["DR_COMPARISON:factSummary[0]"]);
  });
});

describe("runDraftChecks: what is not known and the directions (DR_UNKNOWN_REQUIRED, DR_DIRECTION_RULES)", () => {
  it("requires at least one item of what cannot be told and of what to check, as the contract and as this check", () => {
    expect(failures(run(candidate, passingCandidate({ notDeterminable: [] })))).toEqual(["DR_UNKNOWN_REQUIRED:notDeterminable"]);
    expect(failures(run(candidate, passingCandidate({ additionalChecks: [] })))).toEqual(["DR_UNKNOWN_REQUIRED:additionalChecks"]);
    const missing = without(passingCandidate(), "notDeterminable", "additionalChecks");
    expect(failures(run(candidate, missing))).toEqual(["DR_UNKNOWN_REQUIRED:notDeterminable", "DR_UNKNOWN_REQUIRED:additionalChecks"]);
  });

  it("refuses a description that denies the other direction or is exclusive, and a name or a description that recommends", () => {
    const direction = (change: Record<string, unknown>): unknown =>
      passingCandidate({ responseDirections: [{ label: "路線の見直し", description: "路線の配置を見直す方向", category: "CHANGE", status: "REFERENCE_ONLY", ...change }] });
    expect(failures(run(candidate, direction({ description: "路線を維持せず見直す方向" })))).toEqual(["DR_DIRECTION_RULES:responseDirections[0].description"]);
    expect(failures(run(candidate, direction({ description: "路線の配置だけを見直す方向" })))).toEqual(["DR_DIRECTION_RULES:responseDirections[0].description"]);
    expect(failures(run(candidate, direction({ label: "推奨語の見直し" })))).toEqual(
      expect.arrayContaining(["DR_DIRECTION_RULES:responseDirections[0].label"]),
    );
    expect(failures(run(candidate, direction({ description: "優劣語の見直しを進める方向" })))).toEqual(
      expect.arrayContaining(["DR_DIRECTION_RULES:responseDirections[0].description"]),
    );
  });

  it("does not take a direction as an answer choice: the status is fixed to REFERENCE_ONLY", () => {
    const output = passingCandidate({ responseDirections: [{ label: "路線の見直し", description: "路線の配置を見直す方向", category: "CHANGE", status: "ANSWER_CHOICE" }] });
    expect(failures(run(candidate, output))).toEqual(["DR_JSON:responseDirections[0].status"]);
  });
});

describe("runDraftChecks: the second opinion and the result", () => {
  it("accepts a review in the form of the contract, and refuses one that is not", () => {
    const request = { ...summaryRequest(), task: "NEUTRALITY_REVIEW" as const };
    expect(run(request, { verdict: "NO_BIAS_FOUND", findings: [] }).ok).toBe(true);
    expect(run(request, { verdict: "BIAS_SUSPECTED", findings: [{ target: "TEXT", note: "表現が一方に傾いている" }] }).ok).toBe(true);
    expect(failures(run(request, { verdict: "MAYBE", findings: [] }))).toEqual(["DR_JSON:verdict"]);
  });

  it("returns the places and the codes only, never the text of the output", () => {
    const secret = "秘密の本文";
    const result = run(candidate, passingCandidate({ statement: `${secret}は因果語である仮説語尾` }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("gives the same result for the same output, in the order of the checks", () => {
    const output = passingCandidate({ statement: "推奨語で本数は少ない因果語" });
    const first = run(candidate, output);
    expect(run(candidate, output)).toEqual(first);
    expect(failures(first)).toEqual(["DR_FORBIDDEN_WORDS:statement", "DR_CAUSAL_CLAIMS:statement", "DR_HEDGE_REQUIRED:statement"]);
  });

  it("reports the failures of the contract first and alone: the checks of the meaning need an output of the right form", () => {
    const output = passingCandidate({ statement: "推奨語で本数は少ない因果語", additionalChecks: [] });
    expect(failures(run(candidate, output))).toEqual(["DR_UNKNOWN_REQUIRED:additionalChecks"]);
  });
});

describe("factNumeralsOf", () => {
  it("lists the amount and the year of each fact", () => {
    expect([...factNumeralsOf(FIXTURE_FACTS)].sort()).toEqual(["12", "2025", "3", "40"]);
    expect([...factNumeralsOf([fixtureFact("fx-d", { surveyDate: "2025-04-01" })])].sort()).toEqual(["12", "2025"]);
  });
});
