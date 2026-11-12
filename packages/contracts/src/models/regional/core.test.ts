import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import * as contracts from "../../index.js";
import {
  AnswerValueSchema,
  AnswersSchema,
  AxisStateSchema,
  DiagnosticSetSchema,
  IMPORTANCE_VALUE,
  ImportanceCodeSchema,
  LevelSchema,
  MapErrorSchema,
  MapInputSchema,
  MapQuestionSchema,
  NON_OPINION,
  NonOpinionCodeSchema,
  PickAnswerSchema,
  PriorityStateSchema,
  QUESTION_KINDS,
  QuestionApprovalSchema,
  QuestionBankSchema,
  QuestionSchema,
  SET_KINDS,
  THEME_IDS,
  ThemeDefSchema,
  ThemeIdSchema,
  TRADEOFF_VALUE,
  TradeoffCodeSchema,
  ValuesMapSchema,
} from "./core.js";
import type {
  Answers,
  AnswerValue,
  AxisState,
  ImportanceCode,
  NonOpinionCode,
  PriorityState,
  TradeoffCode,
  ValuesMap,
} from "./core.js";

// ---------------------------------------------------------------------------
// Fixtures. Every length is built from a known repeat count, so the expected
// accept/reject outcome is a hand-counted value, not something derived from
// the implementation.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const THEME_ORDER = [
  "TRANSPORT",
  "EDUCATION_CHILDCARE",
  "ECONOMY_EMPLOYMENT",
  "HEALTHCARE_WELFARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
];

const THEME_LABELS = [
  "地域交通",
  "教育・子育て",
  "地域経済・雇用",
  "医療・福祉",
  "防災",
  "人口減少・地域活性化",
];

/** `n` characters followed by the sentence delimiter 。 (the delimiter is not counted in a sentence). */
const sentence = (n: number, char = "あ"): string => `${char.repeat(n)}。`;

// Two sentences of 39 characters: 80 characters in total excluding nothing but no whitespace.
const VALID_EXPLANATION = `${sentence(39)}${sentence(39, "い")}`;

const APPROVAL: Json = {
  forVersion: 1,
  review: {
    modelId: "review-model-a",
    reviewedAt: "2026-01-10T09:00:00+09:00",
    verdict: "NO_BIAS_FOUND",
    findings: [],
  },
  approverId: "approver-a",
  approvedAt: "2026-01-11T09:00:00+09:00",
};

function baseQuestion(overrides: Json = {}): Json {
  return {
    questionId: "q-1",
    dataKind: "FIXTURE",
    author: "HUMAN",
    createdOn: "2026-01-05",
    version: 1,
    text: "地域交通は、あなたの暮らしにとってどのくらい大切ですか",
    explanation: VALID_EXPLANATION,
    unsureLabel: "わからない",
    declineLabel: "回答しない",
    weight: 1,
    swapDirections: false,
    approval: APPROVAL,
    ...overrides,
  };
}

function importanceQuestion(overrides: Json = {}): Json {
  return baseQuestion({
    questionId: "q-importance-transport",
    kind: "IMPORTANCE",
    themeId: "TRANSPORT",
    opinionLabels: ["とても大切", "大切", "どちらともいえない", "あまり大切でない", "大切でない"],
    ...overrides,
  });
}

function tradeoffQuestion(overrides: Json = {}): Json {
  return baseQuestion({
    questionId: "q-tradeoff-transport",
    kind: "TRADEOFF",
    themeId: "TRANSPORT",
    text: "地域交通で先に進めたいのは、どちらに近いですか",
    opinionLabels: [
      "Aを強く先に進めたい",
      "Aをやや先に進めたい",
      "どちらも同じくらい大切",
      "Bをやや先に進めたい",
      "Bを強く先に進めたい",
    ],
    premise: "限られた予算や人手の中で、どちらかを先に進める場面を考えてください",
    directionA: { text: "新しい取組みを始める", category: "CHANGE" },
    directionB: { text: "今の取組みを続ける", category: "CONTINUE" },
    swapDirections: true,
    ...overrides,
  });
}

function priorityPickQuestion(overrides: Json = {}): Json {
  return baseQuestion({
    questionId: "q-priority-pick",
    kind: "PRIORITY_PICK",
    text: "先に進めたいテーマを、最大2つまで選んでください",
    themeIds: [...THEME_ORDER],
    maxSelect: 2,
    ...overrides,
  });
}

function omit(value: Json, key: string): Json {
  const copy: Json = { ...value };
  delete copy[key];
  return copy;
}

function diagnosticSet(overrides: Json = {}): Json {
  return {
    setKind: "QUICK",
    themeIds: ["TRANSPORT"],
    questionIds: ["q-importance-transport", "q-tradeoff-transport"],
    ...overrides,
  };
}

function questionBank(overrides: Json = {}): Json {
  return {
    schemaVersion: 1,
    dataKind: "FIXTURE",
    themes: THEME_ORDER.map((themeId, index) => ({ themeId, label: THEME_LABELS[index] })),
    questions: [importanceQuestion(), tradeoffQuestion(), priorityPickQuestion()],
    diagnosticSets: [
      diagnosticSet(),
      diagnosticSet({
        setKind: "FULL",
        themeIds: [...THEME_ORDER],
        questionIds: ["q-importance-transport", "q-tradeoff-transport", "q-priority-pick"],
      }),
    ],
    ...overrides,
  };
}

/** Parses, requires a rejection, and returns the dotted paths of the issues. */
function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("theme, kind and answer-value constants", () => {
  it("lists the six themes in the default theme definition order", () => {
    expect([...THEME_IDS]).toEqual(THEME_ORDER);
    expect(ThemeIdSchema.safeParse("TRANSPORT").success).toBe(true);
    expect(ThemeIdSchema.safeParse("UNCLASSIFIED").success).toBe(false);
  });

  it("lists the question kinds and diagnostic set kinds", () => {
    expect([...QUESTION_KINDS]).toEqual(["IMPORTANCE", "TRADEOFF", "PRIORITY_PICK"]);
    expect([...SET_KINDS]).toEqual(["QUICK", "FULL"]);
  });

  it("maps importance and trade-off answers to +2 .. -2 in order", () => {
    expect(Object.entries(IMPORTANCE_VALUE)).toEqual([
      ["VERY_IMPORTANT", 2],
      ["IMPORTANT", 1],
      ["NEUTRAL", 0],
      ["NOT_VERY_IMPORTANT", -1],
      ["NOT_IMPORTANT", -2],
    ]);
    expect(Object.entries(TRADEOFF_VALUE)).toEqual([
      ["A_STRONG", 2],
      ["A_LEAN", 1],
      ["BALANCED", 0],
      ["B_LEAN", -1],
      ["B_STRONG", -2],
    ]);
    expect([...NON_OPINION]).toEqual(["UNSURE", "DECLINE", "UNANSWERED"]);
  });

  it("accepts only the five levels", () => {
    for (const level of [2, 1, 0, -1, -2]) {
      expect(LevelSchema.safeParse(level).success).toBe(true);
    }
    for (const level of [3, -3, 0.5, "1", null]) {
      expect(LevelSchema.safeParse(level).success).toBe(false);
    }
  });
});

describe("module boundary", () => {
  it("imports only zod and primitives.ts", () => {
    const source = readFileSync(new URL("./core.ts", import.meta.url), "utf8");
    const modules = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
    expect(modules.sort()).toEqual(["../primitives.js", "zod"]);
  });

  it("is exported from the contracts barrel", () => {
    expect(contracts.QuestionBankSchema).toBe(QuestionBankSchema);
    expect(contracts.THEME_IDS).toBe(THEME_IDS);
  });
});

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

describe("ThemeDefSchema", () => {
  it("accepts a theme definition", () => {
    expect(ThemeDefSchema.safeParse({ themeId: "DISASTER_PREVENTION", label: "防災" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown theme, a blank or 21-character label, and extra keys", () => {
    expect(ThemeDefSchema.safeParse({ themeId: "OTHER", label: "防災" }).success).toBe(false);
    expect(ThemeDefSchema.safeParse({ themeId: "TRANSPORT", label: "  " }).success).toBe(false);
    expect(ThemeDefSchema.safeParse({ themeId: "TRANSPORT", label: "あ".repeat(20) }).success).toBe(
      true,
    );
    expect(ThemeDefSchema.safeParse({ themeId: "TRANSPORT", label: "あ".repeat(21) }).success).toBe(
      false,
    );
    expect(
      ThemeDefSchema.safeParse({ themeId: "TRANSPORT", label: "地域交通", extra: 1 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

describe("QuestionSchema: valid examples", () => {
  it("accepts one question of each kind", () => {
    for (const question of [importanceQuestion(), tradeoffQuestion(), priorityPickQuestion()]) {
      const result = QuestionSchema.safeParse(question);
      expect(result.success).toBe(true);
    }
  });

  it("accepts an unapproved question (approval is null)", () => {
    expect(QuestionSchema.safeParse(importanceQuestion({ approval: null })).success).toBe(true);
  });

  it("accepts swapDirections=true only on a TRADEOFF question", () => {
    expect(QuestionSchema.safeParse(tradeoffQuestion({ swapDirections: true })).success).toBe(true);
    expect(QuestionSchema.safeParse(tradeoffQuestion({ swapDirections: false })).success).toBe(true);
  });

  it("accepts a question ID of 64 characters and a weight of 1 or 3", () => {
    expect(QuestionSchema.safeParse(importanceQuestion({ questionId: "a".repeat(64) })).success).toBe(
      true,
    );
    expect(QuestionSchema.safeParse(importanceQuestion({ weight: 3 })).success).toBe(true);
  });
});

describe("QuestionSchema: structure", () => {
  it.each([
    ["IMPORTANCE", importanceQuestion()],
    ["TRADEOFF", tradeoffQuestion()],
    ["PRIORITY_PICK", priorityPickQuestion()],
  ])("rejects an extra key on a %s question", (_kind, question) => {
    expect(QuestionSchema.safeParse({ ...question, unexpected: true }).success).toBe(false);
  });

  it.each([
    ["explanation on IMPORTANCE", importanceQuestion(), "explanation"],
    ["opinionLabels on IMPORTANCE", importanceQuestion(), "opinionLabels"],
    ["themeId on IMPORTANCE", importanceQuestion(), "themeId"],
    ["approval on IMPORTANCE", importanceQuestion(), "approval"],
    ["premise on TRADEOFF", tradeoffQuestion(), "premise"],
    ["directionB on TRADEOFF", tradeoffQuestion(), "directionB"],
    ["themeIds on PRIORITY_PICK", priorityPickQuestion(), "themeIds"],
    ["maxSelect on PRIORITY_PICK", priorityPickQuestion(), "maxSelect"],
  ])("rejects a missing required key: %s", (_name, question, key) => {
    expect(QuestionSchema.safeParse(omit(question, key)).success).toBe(false);
  });

  it("rejects keys that belong to another kind", () => {
    expect(
      QuestionSchema.safeParse(importanceQuestion({ themeIds: [...THEME_ORDER] })).success,
    ).toBe(false);
    expect(QuestionSchema.safeParse(importanceQuestion({ premise: "前提" })).success).toBe(false);
    expect(QuestionSchema.safeParse(priorityPickQuestion({ themeId: "TRANSPORT" })).success).toBe(
      false,
    );
  });

  it("rejects an unknown kind, a bad date, a zero version and a 65-character ID", () => {
    expect(QuestionSchema.safeParse(importanceQuestion({ kind: "OTHER" })).success).toBe(false);
    expect(QuestionSchema.safeParse(importanceQuestion({ createdOn: "2026-02-30" })).success).toBe(
      false,
    );
    expect(QuestionSchema.safeParse(importanceQuestion({ version: 0, approval: null })).success).toBe(
      false,
    );
    expect(QuestionSchema.safeParse(importanceQuestion({ questionId: "a".repeat(65) })).success).toBe(
      false,
    );
  });
});

describe("QuestionSchema: weight and text lengths", () => {
  it.each([0, 4, 1.5])("rejects a weight of %s", (weight) => {
    expect(rejectedPaths(QuestionSchema, importanceQuestion({ weight }))).toContain("weight");
  });

  it("accepts a 60-character text and rejects a 61-character text", () => {
    expect(QuestionSchema.safeParse(importanceQuestion({ text: "あ".repeat(60) })).success).toBe(true);
    expect(rejectedPaths(QuestionSchema, importanceQuestion({ text: "あ".repeat(61) }))).toContain(
      "text",
    );
  });

  it("counts Unicode code points and ignores surrounding whitespace in a text", () => {
    // 𠮷 is one code point but two UTF-16 units.
    expect(QuestionSchema.safeParse(importanceQuestion({ text: "𠮷".repeat(60) })).success).toBe(true);
    expect(QuestionSchema.safeParse(importanceQuestion({ text: "𠮷".repeat(61) })).success).toBe(false);
    expect(
      QuestionSchema.safeParse(importanceQuestion({ text: `  ${"あ".repeat(60)}  ` })).success,
    ).toBe(true);
  });

  it("rejects a blank text, a 21-character label and a 21-character unsure label", () => {
    expect(rejectedPaths(QuestionSchema, importanceQuestion({ text: "   " }))).toContain("text");
    expect(
      rejectedPaths(
        QuestionSchema,
        importanceQuestion({
          opinionLabels: ["あ".repeat(21), "大切", "どちらともいえない", "あまり大切でない", "大切でない"],
        }),
      ),
    ).toContain("opinionLabels.0");
    expect(
      rejectedPaths(QuestionSchema, importanceQuestion({ unsureLabel: "あ".repeat(21) })),
    ).toContain("unsureLabel");
  });

  it.each([4, 6])("rejects %s opinion labels", (count) => {
    const labels = Array.from({ length: count }, (_value, index) => `ラベル${index}`);
    expect(QuestionSchema.safeParse(importanceQuestion({ opinionLabels: labels })).success).toBe(false);
  });

  it("applies the 60-character limit to the premise and to direction texts", () => {
    expect(QuestionSchema.safeParse(tradeoffQuestion({ premise: "あ".repeat(60) })).success).toBe(true);
    expect(rejectedPaths(QuestionSchema, tradeoffQuestion({ premise: "あ".repeat(61) }))).toContain(
      "premise",
    );
    expect(
      rejectedPaths(
        QuestionSchema,
        tradeoffQuestion({ directionA: { text: "あ".repeat(61), category: "CHANGE" } }),
      ),
    ).toContain("directionA.text");
    expect(
      rejectedPaths(
        QuestionSchema,
        tradeoffQuestion({ directionB: { text: "今の取組みを続ける", category: "OTHER" } }),
      ),
    ).toContain("directionB.category");
  });
});

describe("QuestionSchema: explanation length", () => {
  const joinedWithBreaks = [sentence(49), sentence(49), sentence(49), sentence(49)].join(" \n　");

  it("accepts 50 and 200 characters and rejects 49 and 201", () => {
    // sentence(n) is n characters plus the delimiter, so it counts n + 1.
    expect(QuestionSchema.safeParse(importanceQuestion({ explanation: sentence(49) })).success).toBe(
      true,
    );
    expect(QuestionSchema.safeParse(importanceQuestion({ explanation: sentence(48) })).success).toBe(
      false,
    );
    const exactly200 = sentence(49).repeat(4);
    expect(QuestionSchema.safeParse(importanceQuestion({ explanation: exactly200 })).success).toBe(
      true,
    );
    expect(
      rejectedPaths(QuestionSchema, importanceQuestion({ explanation: `${exactly200}い` })),
    ).toContain("explanation");
  });

  it("does not count whitespace or line breaks", () => {
    // Raw length 209, counted length 200.
    expect(
      QuestionSchema.safeParse(importanceQuestion({ explanation: joinedWithBreaks })).success,
    ).toBe(true);
    // Raw length 59, counted length 49.
    expect(
      QuestionSchema.safeParse(
        importanceQuestion({ explanation: `${sentence(48)}${" ".repeat(10)}` }),
      ).success,
    ).toBe(false);
  });

  it("limits each sentence to 60 characters, not counting the delimiter", () => {
    expect(QuestionSchema.safeParse(importanceQuestion({ explanation: sentence(60) })).success).toBe(
      true,
    );
    expect(rejectedPaths(QuestionSchema, importanceQuestion({ explanation: sentence(61) }))).toContain(
      "explanation",
    );
  });

  it("splits sentences on 。 ？ ！ and line breaks", () => {
    const eighty = "あ".repeat(40) + "い".repeat(40);
    expect(QuestionSchema.safeParse(importanceQuestion({ explanation: eighty })).success).toBe(false);
    expect(
      QuestionSchema.safeParse(
        importanceQuestion({ explanation: `${"あ".repeat(40)}\n${"い".repeat(40)}` }),
      ).success,
    ).toBe(true);
    expect(
      QuestionSchema.safeParse(
        importanceQuestion({ explanation: `${"あ".repeat(40)}？${"い".repeat(40)}！` }),
      ).success,
    ).toBe(true);
  });
});

describe("QuestionSchema: PRIORITY_PICK themes", () => {
  it("accepts the six themes in any order", () => {
    const reversed = [...THEME_ORDER].reverse();
    expect(QuestionSchema.safeParse(priorityPickQuestion({ themeIds: reversed })).success).toBe(true);
  });

  it("rejects five themes, seven themes, a duplicate and an unknown theme", () => {
    expect(
      QuestionSchema.safeParse(priorityPickQuestion({ themeIds: THEME_ORDER.slice(0, 5) })).success,
    ).toBe(false);
    expect(
      QuestionSchema.safeParse(priorityPickQuestion({ themeIds: [...THEME_ORDER, "TRANSPORT"] }))
        .success,
    ).toBe(false);
    expect(
      QuestionSchema.safeParse(
        priorityPickQuestion({ themeIds: [...THEME_ORDER.slice(0, 5), "TRANSPORT"] }),
      ).success,
    ).toBe(false);
    expect(
      QuestionSchema.safeParse(
        priorityPickQuestion({ themeIds: [...THEME_ORDER.slice(0, 5), "UNCLASSIFIED"] }),
      ).success,
    ).toBe(false);
  });

  it("requires maxSelect to be 2", () => {
    expect(QuestionSchema.safeParse(priorityPickQuestion({ maxSelect: 1 })).success).toBe(false);
    expect(QuestionSchema.safeParse(priorityPickQuestion({ maxSelect: 3 })).success).toBe(false);
  });
});

describe("QuestionSchema: approval and swapDirections", () => {
  it("rejects an approval written for another version", () => {
    expect(
      rejectedPaths(
        QuestionSchema,
        importanceQuestion({ version: 2, approval: { ...APPROVAL, forVersion: 1 } }),
      ),
    ).toContain("approval.forVersion");
  });

  it("rejects an approval time before the bias review time", () => {
    const earlier = { ...APPROVAL, approvedAt: "2026-01-10T08:59:59+09:00" };
    expect(rejectedPaths(QuestionSchema, importanceQuestion({ approval: earlier }))).toContain(
      "approval.approvedAt",
    );
  });

  it("accepts an approval time equal to the bias review time", () => {
    const same = { ...APPROVAL, approvedAt: "2026-01-10T09:00:00+09:00" };
    expect(QuestionSchema.safeParse(importanceQuestion({ approval: same })).success).toBe(true);
  });

  it("compares the two times as instants, not as strings", () => {
    // 09:00+09:00 is 00:00Z, which is before 00:30Z although the string sorts later.
    const approval = {
      ...APPROVAL,
      review: { ...(APPROVAL["review"] as Json), reviewedAt: "2026-01-10T00:30:00Z" },
      approvedAt: "2026-01-10T09:00:00+09:00",
    };
    expect(QuestionApprovalSchema.safeParse(approval).success).toBe(false);
  });

  it("rejects a malformed approval", () => {
    expect(
      QuestionSchema.safeParse(importanceQuestion({ approval: omit(APPROVAL, "approverId") })).success,
    ).toBe(false);
    expect(
      QuestionSchema.safeParse(importanceQuestion({ approval: { ...APPROVAL, unexpected: 1 } })).success,
    ).toBe(false);
  });

  it.each([
    ["IMPORTANCE", importanceQuestion({ swapDirections: true })],
    ["PRIORITY_PICK", priorityPickQuestion({ swapDirections: true })],
  ])("rejects swapDirections=true on a %s question", (_kind, question) => {
    expect(rejectedPaths(QuestionSchema, question)).toContain("swapDirections");
  });
});

// ---------------------------------------------------------------------------
// Diagnostic sets
// ---------------------------------------------------------------------------

describe("DiagnosticSetSchema", () => {
  it("accepts a diagnostic set", () => {
    expect(DiagnosticSetSchema.safeParse(diagnosticSet()).success).toBe(true);
  });

  it("does not check the composition of a set (QUICK, FULL) in the contract", () => {
    // One theme and one question is not a valid QUICK set, but that is checked
    // by the question-bank inspection, not by this contract.
    expect(
      DiagnosticSetSchema.safeParse(
        diagnosticSet({ themeIds: ["TRANSPORT"], questionIds: ["q-importance-transport"] }),
      ).success,
    ).toBe(true);
  });

  it("rejects a duplicate question ID, an unknown kind and extra keys", () => {
    expect(
      rejectedPaths(DiagnosticSetSchema, diagnosticSet({ questionIds: ["q-1", "q-2", "q-1"] })),
    ).toContain("questionIds.2");
    expect(DiagnosticSetSchema.safeParse(diagnosticSet({ setKind: "DETAILED" })).success).toBe(false);
    expect(DiagnosticSetSchema.safeParse(diagnosticSet({ unexpected: 1 })).success).toBe(false);
    expect(DiagnosticSetSchema.safeParse(omit(diagnosticSet(), "themeIds")).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

describe("QuestionBankSchema", () => {
  it("accepts a bank with the three question kinds and both diagnostic sets", () => {
    expect(QuestionBankSchema.safeParse(questionBank()).success).toBe(true);
  });

  it("accepts the six themes in a bank-specific order", () => {
    const reversedLabels = [...THEME_LABELS].reverse();
    const reordered = [...THEME_ORDER]
      .reverse()
      .map((themeId, index) => ({ themeId, label: reversedLabels[index] }));
    expect(QuestionBankSchema.safeParse(questionBank({ themes: reordered })).success).toBe(true);
  });

  it("accepts a REAL_AI bank whose questions are all REAL_AI", () => {
    const bank = questionBank({
      dataKind: "REAL_AI",
      questions: [
        importanceQuestion({ dataKind: "REAL_AI" }),
        tradeoffQuestion({ dataKind: "REAL_AI" }),
        priorityPickQuestion({ dataKind: "REAL_AI" }),
      ],
    });
    expect(QuestionBankSchema.safeParse(bank).success).toBe(true);
  });

  it("rejects a duplicate question ID", () => {
    const bank = questionBank({
      questions: [importanceQuestion(), importanceQuestion(), priorityPickQuestion()],
    });
    expect(rejectedPaths(QuestionBankSchema, bank)).toContain("questions.1.questionId");
  });

  it("rejects a question whose dataKind differs from the bank", () => {
    const bank = questionBank({
      questions: [
        importanceQuestion(),
        tradeoffQuestion({ dataKind: "REAL_AI" }),
        priorityPickQuestion(),
      ],
    });
    expect(rejectedPaths(QuestionBankSchema, bank)).toEqual(["questions.1.dataKind"]);
  });

  it("rejects a bank that does not define each of the six themes once", () => {
    const themes = THEME_ORDER.map((themeId, index) => ({ themeId, label: THEME_LABELS[index] }));
    expect(QuestionBankSchema.safeParse(questionBank({ themes: themes.slice(0, 5) })).success).toBe(
      false,
    );
    const duplicated = [...themes.slice(0, 5), themes[0]];
    expect(rejectedPaths(QuestionBankSchema, questionBank({ themes: duplicated }))).toContain(
      "themes.5.themeId",
    );
    expect(
      QuestionBankSchema.safeParse(questionBank({ themes: [...themes, themes[0]] })).success,
    ).toBe(false);
  });

  it("rejects two diagnostic sets of the same kind", () => {
    const bank = questionBank({ diagnosticSets: [diagnosticSet(), diagnosticSet()] });
    expect(rejectedPaths(QuestionBankSchema, bank)).toContain("diagnosticSets.1.setKind");
  });

  it("rejects a wrong schema version, extra keys and missing keys", () => {
    expect(QuestionBankSchema.safeParse(questionBank({ schemaVersion: 2 })).success).toBe(false);
    expect(QuestionBankSchema.safeParse(questionBank({ unexpected: 1 })).success).toBe(false);
    expect(QuestionBankSchema.safeParse(omit(questionBank(), "diagnosticSets")).success).toBe(false);
    expect(QuestionBankSchema.safeParse(omit(questionBank(), "dataKind")).success).toBe(false);
  });

  it("rejects an invalid question inside the bank", () => {
    const bank = questionBank({
      questions: [importanceQuestion({ weight: 0 }), tradeoffQuestion(), priorityPickQuestion()],
    });
    expect(rejectedPaths(QuestionBankSchema, bank)).toContain("questions.0.weight");
  });
});

// ===========================================================================
// Second half: answers, map input, map output, map error
//
// Everything below is fictional. Expected values are hand-written; the sample
// maps repeat examples 1 to 3 of the design document (hand-computed scores).
// ===========================================================================

const TR = "TRANSPORT";
const ED = "EDUCATION_CHILDCARE";
const EC = "ECONOMY_EMPLOYMENT";
const HC = "HEALTHCARE_WELFARE";
const DP = "DISASTER_PREVENTION";
const PR = "POPULATION_REVITALIZATION";

const NOT_ASKED_AXIS: Json = { state: "NOT_ASKED" };
const determinedAxis = (score: number, level: number): Json => ({
  state: "DETERMINED",
  score,
  level,
});
const undeterminedAxis = (...reasons: string[]): Json => ({ state: "UNDETERMINED", reasons });

function themeAxes(themeId: string, importance: Json, tradeoff: Json): Json {
  return { themeId, importance, tradeoff };
}

/** The five importance groups, +2 down to -2. */
function levelGroups(
  plus2: string[],
  plus1: string[],
  zero: string[],
  minus1: string[],
  minus2: string[],
): Json[] {
  return [
    { level: 2, themeIds: plus2 },
    { level: 1, themeIds: plus1 },
    { level: 0, themeIds: zero },
    { level: -1, themeIds: minus1 },
    { level: -2, themeIds: minus2 },
  ];
}

// Design example 1: QUICK, three themes asked, every question has an opinion answer.
const QUICK_THEMES: Json[] = [
  themeAxes(TR, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
  themeAxes(ED, determinedAxis(-100, -1), determinedAxis(0, 0)),
  themeAxes(EC, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
  themeAxes(HC, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
  themeAxes(DP, determinedAxis(100, 1), determinedAxis(-200, -2)),
  themeAxes(PR, determinedAxis(200, 2), determinedAxis(100, 1)),
];
const QUICK_GROUPS: Json[] = levelGroups([PR], [DP], [], [ED], []);

function quickMap(overrides: Json = {}): Json {
  return {
    setKind: "QUICK",
    themes: QUICK_THEMES,
    importanceGroups: QUICK_GROUPS,
    priority: { state: "NOT_ASKED" },
    hesitantThemes: [],
    declinedThemes: [],
    notAskedThemes: [TR, EC, HC],
    excludedQuestions: [],
    counts: { askedThemes: 3, totalThemes: 6, usableQuestions: 6, askedQuestions: 6 },
    notices: { noThemeDifference: false, equalLevelGroupExists: false },
    ...overrides,
  };
}

// Design example 2: QUICK, unsure / decline / unanswered / not asked all at once.
function fourStateMap(overrides: Json = {}): Json {
  return quickMap({
    themes: [
      themeAxes(TR, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
      themeAxes(ED, undeterminedAxis("UNSURE"), determinedAxis(200, 2)),
      themeAxes(EC, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
      themeAxes(HC, NOT_ASKED_AXIS, NOT_ASKED_AXIS),
      themeAxes(DP, determinedAxis(100, 1), undeterminedAxis("DECLINE")),
      themeAxes(PR, undeterminedAxis("UNANSWERED"), determinedAxis(-100, -1)),
    ],
    importanceGroups: levelGroups([], [DP], [], [], []),
    hesitantThemes: [{ themeId: ED, reasons: ["UNSURE"] }],
    declinedThemes: [
      { themeId: DP, reasons: ["DECLINE"] },
      { themeId: PR, reasons: ["UNANSWERED"] },
    ],
    excludedQuestions: [
      { questionId: "q-ed-importance", reason: "UNSURE" },
      { questionId: "q-dp-tradeoff", reason: "DECLINE" },
      { questionId: "q-pr-importance", reason: "UNANSWERED" },
    ],
    counts: { askedThemes: 3, totalThemes: 6, usableQuestions: 3, askedQuestions: 6 },
    ...overrides,
  });
}

// Design example 3: FULL, 13 questions, two priority themes.
function fullMap(overrides: Json = {}): Json {
  return {
    setKind: "FULL",
    themes: [
      themeAxes(TR, determinedAxis(100, 1), determinedAxis(100, 1)),
      themeAxes(ED, determinedAxis(200, 2), determinedAxis(0, 0)),
      themeAxes(EC, determinedAxis(0, 0), determinedAxis(-100, -1)),
      themeAxes(HC, determinedAxis(-200, -2), determinedAxis(200, 2)),
      themeAxes(DP, determinedAxis(200, 2), determinedAxis(-200, -2)),
      themeAxes(PR, determinedAxis(100, 1), undeterminedAxis("DECLINE")),
    ],
    importanceGroups: levelGroups([ED, DP], [TR, PR], [EC], [], [HC]),
    priority: { state: "SELECTED", themeIds: [HC, DP] },
    hesitantThemes: [{ themeId: HC, reasons: ["PICK_CONFLICT"] }],
    declinedThemes: [{ themeId: PR, reasons: ["DECLINE"] }],
    notAskedThemes: [],
    excludedQuestions: [{ questionId: "q-pr-tradeoff", reason: "DECLINE" }],
    counts: { askedThemes: 6, totalThemes: 6, usableQuestions: 12, askedQuestions: 13 },
    notices: { noThemeDifference: false, equalLevelGroupExists: true },
    ...overrides,
  };
}

/**
 * A QUICK map in which only TRANSPORT can be asked, with the given axes. The
 * groups and the not-asked list are made to agree with those axes (the
 * determined sample axis is level +1). The contract does not tie reasons to the
 * hesitant and declined lists; that derivation belongs to the map generation.
 */
function transportOnlyMap(importance: Json, tradeoff: Json): Json {
  const bothNotAsked = importance["state"] === "NOT_ASKED" && tradeoff["state"] === "NOT_ASKED";
  const others = [ED, EC, HC, DP, PR];
  return quickMap({
    themes: [
      themeAxes(TR, importance, tradeoff),
      ...others.map((themeId) => themeAxes(themeId, NOT_ASKED_AXIS, NOT_ASKED_AXIS)),
    ],
    importanceGroups: levelGroups([], importance["state"] === "DETERMINED" ? [TR] : [], [], [], []),
    notAskedThemes: bothNotAsked ? [TR, ...others] : others,
    counts: { askedThemes: bothNotAsked ? 0 : 1, totalThemes: 6, usableQuestions: 0, askedQuestions: 2 },
  });
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

describe("answer codes", () => {
  it("derives the code types from the schemas and keeps them aligned with the value tables", () => {
    expectTypeOf<ImportanceCode>().toEqualTypeOf<keyof typeof IMPORTANCE_VALUE>();
    expectTypeOf<TradeoffCode>().toEqualTypeOf<keyof typeof TRADEOFF_VALUE>();
    expectTypeOf<NonOpinionCode>().toEqualTypeOf<(typeof NON_OPINION)[number]>();
    expect(ImportanceCodeSchema.options).toEqual(Object.keys(IMPORTANCE_VALUE));
    expect(TradeoffCodeSchema.options).toEqual(Object.keys(TRADEOFF_VALUE));
    expect(NonOpinionCodeSchema.options).toEqual([...NON_OPINION]);
  });

  it("keeps the three code families apart", () => {
    expect(ImportanceCodeSchema.safeParse("VERY_IMPORTANT").success).toBe(true);
    expect(ImportanceCodeSchema.safeParse("A_STRONG").success).toBe(false);
    expect(TradeoffCodeSchema.safeParse("A_STRONG").success).toBe(true);
    expect(TradeoffCodeSchema.safeParse("UNSURE").success).toBe(false);
    expect(NonOpinionCodeSchema.safeParse("UNSURE").success).toBe(true);
    expect(NonOpinionCodeSchema.safeParse("NEUTRAL").success).toBe(false);
  });
});

describe("PickAnswerSchema", () => {
  it("accepts one or two distinct themes, in any order", () => {
    expect(PickAnswerSchema.safeParse({ pick: [TR] }).success).toBe(true);
    expect(PickAnswerSchema.safeParse({ pick: [TR, DP] }).success).toBe(true);
    expect(PickAnswerSchema.safeParse({ pick: [DP, TR] }).success).toBe(true);
  });

  it.each([
    ["no theme", { pick: [] }],
    ["three themes", { pick: [TR, ED, EC] }],
    ["a repeated theme", { pick: [TR, TR] }],
    ["an unknown theme", { pick: ["UNCLASSIFIED"] }],
    ["an extra key", { pick: [TR], extra: 1 }],
    ["a missing key", {}],
    ["a bare array", [TR]],
  ])("rejects %s", (_name, value) => {
    expect(PickAnswerSchema.safeParse(value).success).toBe(false);
  });
});

describe("AnswerValueSchema", () => {
  it.each([
    "VERY_IMPORTANT",
    "IMPORTANT",
    "NEUTRAL",
    "NOT_VERY_IMPORTANT",
    "NOT_IMPORTANT",
    "A_STRONG",
    "A_LEAN",
    "BALANCED",
    "B_LEAN",
    "B_STRONG",
    "UNSURE",
    "DECLINE",
    "UNANSWERED",
  ])("accepts the code %s", (code) => {
    expect(AnswerValueSchema.safeParse(code).success).toBe(true);
  });

  it("accepts a priority pick", () => {
    expect(AnswerValueSchema.safeParse({ pick: [TR, DP] }).success).toBe(true);
  });

  it.each([
    ["a lower-case code", "very_important"],
    ["a number", 2],
    ["an unknown word", "MAYBE"],
    ["a bare theme ID", TR],
    ["null", null],
    ["an empty pick", { pick: [] }],
    ["a pick of three themes", { pick: [TR, ED, EC] }],
  ])("rejects %s", (_name, value) => {
    expect(AnswerValueSchema.safeParse(value).success).toBe(false);
  });
});

describe("AnswersSchema", () => {
  it("accepts an empty record (nothing answered) and a mixed record", () => {
    expect(AnswersSchema.safeParse({}).success).toBe(true);
    expect(
      AnswersSchema.safeParse({
        "q-1": "IMPORTANT",
        "q-2": "B_LEAN",
        "q-3": "UNSURE",
        "q-4": "DECLINE",
        "q-pick": { pick: [TR] },
      }).success,
    ).toBe(true);
  });

  it("rejects an empty key, a 65-character key and an invalid value", () => {
    expect(AnswersSchema.safeParse({ "": "IMPORTANT" }).success).toBe(false);
    expect(AnswersSchema.safeParse({ ["a".repeat(65)]: "IMPORTANT" }).success).toBe(false);
    expect(AnswersSchema.safeParse({ ["a".repeat(64)]: "IMPORTANT" }).success).toBe(true);
    expect(AnswersSchema.safeParse({ "q-1": "MAYBE" }).success).toBe(false);
    expect(AnswersSchema.safeParse({ "q-1": { pick: [TR, TR] } }).success).toBe(false);
  });

  it("types the record as read-only", () => {
    expectTypeOf<Answers>().toEqualTypeOf<Readonly<Record<string, AnswerValue>>>();
  });
});

// ---------------------------------------------------------------------------
// Map input
// ---------------------------------------------------------------------------

describe("MapQuestionSchema", () => {
  const importance = { questionId: "q-1", kind: "IMPORTANCE", themeId: TR, weight: 1 };

  it("accepts a themed question and a priority-pick question with a null theme", () => {
    expect(MapQuestionSchema.safeParse(importance).success).toBe(true);
    expect(MapQuestionSchema.safeParse({ ...importance, kind: "TRADEOFF", weight: 3 }).success).toBe(true);
    expect(
      MapQuestionSchema.safeParse({ questionId: "q-pick", kind: "PRIORITY_PICK", themeId: null, weight: 2 })
        .success,
    ).toBe(true);
  });

  it("rejects a theme on a priority pick and a missing theme on the other kinds", () => {
    expect(
      rejectedPaths(MapQuestionSchema, { ...importance, kind: "PRIORITY_PICK", themeId: TR }),
    ).toContain("themeId");
    expect(rejectedPaths(MapQuestionSchema, { ...importance, themeId: null })).toContain("themeId");
    expect(
      rejectedPaths(MapQuestionSchema, { ...importance, kind: "TRADEOFF", themeId: null }),
    ).toContain("themeId");
  });

  it.each([0, 4, 1.5])("rejects a weight of %s", (weight) => {
    expect(rejectedPaths(MapQuestionSchema, { ...importance, weight })).toContain("weight");
  });

  it("accepts and rejects the same weights as QuestionSchema", () => {
    const weights = [-1, 0, 1, 2, 3, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"];
    const acceptedByQuestion = weights.map(
      (weight) => QuestionSchema.safeParse(importanceQuestion({ weight })).success,
    );
    const acceptedByMapQuestion = weights.map(
      (weight) => MapQuestionSchema.safeParse({ ...importance, weight }).success,
    );

    expect(acceptedByMapQuestion).toEqual(acceptedByQuestion);
    // Hand-counted, so the test also fails if both schemas change in the same way.
    expect(acceptedByQuestion).toEqual([
      false, false, true, true, true, false, false, false, false, false,
    ]);
  });

  it.each([
    ["text", "地域交通は、あなたの暮らしにとってどのくらい大切ですか"],
    ["explanation", "説明"],
    ["opinionLabels", []],
    ["approval", null],
    ["swapDirections", false],
  ])("rejects the question-bank key %s (the map sees no question text)", (key, value) => {
    expect(MapQuestionSchema.safeParse({ ...importance, [key]: value }).success).toBe(false);
  });

  it("rejects an empty or 65-character question ID and a missing key", () => {
    expect(MapQuestionSchema.safeParse({ ...importance, questionId: "" }).success).toBe(false);
    expect(MapQuestionSchema.safeParse({ ...importance, questionId: "a".repeat(65) }).success).toBe(false);
    expect(MapQuestionSchema.safeParse(omit(importance, "weight")).success).toBe(false);
  });
});

describe("MapInputSchema", () => {
  const importanceQ = { questionId: "q-ed-importance", kind: "IMPORTANCE", themeId: ED, weight: 1 };
  const tradeoffQ = { questionId: "q-ed-tradeoff", kind: "TRADEOFF", themeId: ED, weight: 1 };
  const pickQ = { questionId: "q-pick", kind: "PRIORITY_PICK", themeId: null, weight: 1 };

  function mapBank(overrides: Json = {}): Json {
    return {
      themeOrder: [...THEME_ORDER],
      questions: [importanceQ, tradeoffQ, pickQ],
      sets: [
        { setKind: "QUICK", themeIds: [ED], questionIds: ["q-ed-importance", "q-ed-tradeoff"] },
        {
          setKind: "FULL",
          themeIds: [...THEME_ORDER],
          questionIds: ["q-ed-importance", "q-ed-tradeoff", "q-pick"],
        },
      ],
      ...overrides,
    };
  }

  function mapInput(overrides: Json = {}): Json {
    return {
      setKind: "QUICK",
      bank: mapBank(),
      answers: { "q-ed-importance": "IMPORTANT", "q-ed-tradeoff": "A_LEAN" },
      thresholds: { t1: 50, t2: 150 },
      ...overrides,
    };
  }

  it("accepts a QUICK input and a FULL input with a priority pick", () => {
    expect(MapInputSchema.safeParse(mapInput()).success).toBe(true);
    expect(
      MapInputSchema.safeParse(
        mapInput({
          setKind: "FULL",
          answers: { "q-ed-importance": "UNSURE", "q-pick": { pick: [ED] } },
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts an input with no answers", () => {
    expect(MapInputSchema.safeParse(mapInput({ answers: {} })).success).toBe(true);
  });

  it("leaves answer faults to the map generation (UNKNOWN_QUESTION, INVALID_ANSWER)", () => {
    const answers = {
      "q-not-in-the-bank": "IMPORTANT",
      "q-ed-importance": "MAYBE",
      "q-ed-tradeoff": 42,
      "": "UNSURE",
    };
    expect(MapInputSchema.safeParse(mapInput({ answers })).success).toBe(true);
  });

  it.each([
    ["t1 = 0", { t1: 0, t2: 150 }],
    ["t1 = t2", { t1: 50, t2: 50 }],
    ["t1 > t2", { t1: 150, t2: 50 }],
    ["t2 = 201", { t1: 50, t2: 201 }],
    ["a fractional t1", { t1: 50.5, t2: 150 }],
    ["a negative t1", { t1: -1, t2: 150 }],
  ])("leaves the threshold range to the map generation (INVALID_CONFIG): %s", (_name, thresholds) => {
    expect(MapInputSchema.safeParse(mapInput({ thresholds })).success).toBe(true);
  });

  it("leaves a set kind missing in the bank to the map generation (INVALID_CONFIG)", () => {
    const quickOnly = {
      setKind: "QUICK",
      themeIds: [ED],
      questionIds: ["q-ed-importance", "q-ed-tradeoff"],
    };
    const bank = mapBank({ sets: [quickOnly] });
    expect(MapInputSchema.safeParse(mapInput({ setKind: "FULL", bank })).success).toBe(true);
  });

  it.each([
    ["a string t2", { t1: 50, t2: "150" }],
    ["NaN", { t1: Number.NaN, t2: 150 }],
    ["a missing t2", { t1: 50 }],
    ["an extra key", { t1: 50, t2: 150, t3: 200 }],
  ])("rejects non-numeric or malformed thresholds: %s", (_name, thresholds) => {
    expect(MapInputSchema.safeParse(mapInput({ thresholds })).success).toBe(false);
  });

  it.each([
    "cards",
    "facts",
    "sources",
    "issueCards",
    "questionTexts",
    "explanations",
  ])("rejects the content key %s on the input (Req 7.22)", (key) => {
    expect(MapInputSchema.safeParse(mapInput({ [key]: [] })).success).toBe(false);
    expect(MapInputSchema.safeParse(mapInput({ bank: mapBank({ [key]: [] }) })).success).toBe(false);
  });

  it("rejects question text on a map question", () => {
    const withText = { ...importanceQ, text: "地域交通は、あなたの暮らしにとってどのくらい大切ですか" };
    expect(MapInputSchema.safeParse(mapInput({ bank: mapBank({ questions: [withText] }) })).success).toBe(
      false,
    );
  });

  it("rejects a duplicate question ID and a duplicate set kind", () => {
    expect(
      rejectedPaths(MapInputSchema, mapInput({ bank: mapBank({ questions: [importanceQ, importanceQ] }) })),
    ).toContain("bank.questions.1.questionId");
    const quick = { setKind: "QUICK", themeIds: [ED], questionIds: ["q-ed-importance"] };
    expect(rejectedPaths(MapInputSchema, mapInput({ bank: mapBank({ sets: [quick, quick] }) }))).toContain(
      "bank.sets.1.setKind",
    );
  });

  it("rejects a theme order that is not the six themes once each", () => {
    expect(
      MapInputSchema.safeParse(mapInput({ bank: mapBank({ themeOrder: THEME_ORDER.slice(0, 5) }) })).success,
    ).toBe(false);
    expect(
      MapInputSchema.safeParse(
        mapInput({ bank: mapBank({ themeOrder: [...THEME_ORDER.slice(0, 5), TR] }) }),
      ).success,
    ).toBe(false);
  });

  it("rejects a missing key and an unknown set kind", () => {
    expect(MapInputSchema.safeParse(omit(mapInput(), "thresholds")).success).toBe(false);
    expect(MapInputSchema.safeParse(omit(mapInput(), "answers")).success).toBe(false);
    expect(MapInputSchema.safeParse(mapInput({ setKind: "DETAILED" })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Axis state and priority state
// ---------------------------------------------------------------------------

describe("AxisStateSchema", () => {
  it("accepts the three states", () => {
    expect(AxisStateSchema.safeParse(determinedAxis(100, 1)).success).toBe(true);
    expect(AxisStateSchema.safeParse(undeterminedAxis("UNSURE")).success).toBe(true);
    expect(AxisStateSchema.safeParse(NOT_ASKED_AXIS).success).toBe(true);
    expectTypeOf<AxisState["state"]>().toEqualTypeOf<"DETERMINED" | "UNDETERMINED" | "NOT_ASKED">();
  });

  it("accepts every undetermined reason, alone and together", () => {
    for (const reasons of [
      ["UNSURE"],
      ["DECLINE"],
      ["UNANSWERED"],
      ["UNSURE", "DECLINE", "UNANSWERED"],
    ]) {
      expect(AxisStateSchema.safeParse(undeterminedAxis(...reasons)).success).toBe(true);
    }
  });

  it("accepts the score and level boundaries", () => {
    for (const [score, level] of [
      [200, 2],
      [-200, -2],
      [0, 0],
      [-100, -1],
    ] as const) {
      expect(AxisStateSchema.safeParse(determinedAxis(score, level)).success).toBe(true);
    }
  });

  it.each([
    ["a score of 201", determinedAxis(201, 2)],
    ["a score of -201", determinedAxis(-201, -2)],
    ["a fractional score", determinedAxis(99.5, 1)],
    ["a level of 3", determinedAxis(100, 3)],
    ["a level of -3", determinedAxis(100, -3)],
    ["a missing level", { state: "DETERMINED", score: 100 }],
    ["a missing score", { state: "DETERMINED", level: 1 }],
    ["no undetermined reason", undeterminedAxis()],
    ["a repeated undetermined reason", undeterminedAxis("UNSURE", "UNSURE")],
    ["an unknown undetermined reason", undeterminedAxis("PICK_CONFLICT")],
    ["a missing reasons key", { state: "UNDETERMINED" }],
    ["an unknown state", { state: "UNKNOWN" }],
  ])("rejects %s", (_name, value) => {
    expect(AxisStateSchema.safeParse(value).success).toBe(false);
  });

  it("keeps the states apart: no score or reason on a state that does not carry one", () => {
    // A not-asked axis is not a zero, a middle value or an unanswered axis.
    expect(AxisStateSchema.safeParse({ state: "NOT_ASKED", score: 0, level: 0 }).success).toBe(false);
    expect(AxisStateSchema.safeParse({ state: "NOT_ASKED", reasons: ["UNANSWERED"] }).success).toBe(false);
    // An axis without a usable answer has no score.
    expect(
      AxisStateSchema.safeParse({ state: "UNDETERMINED", reasons: ["UNSURE"], score: 0 }).success,
    ).toBe(false);
    expect(
      AxisStateSchema.safeParse({ state: "DETERMINED", score: 0, level: 0, reasons: ["UNSURE"] }).success,
    ).toBe(false);
  });

  it("tells unsure, decline and unanswered apart by reason", () => {
    const parsed = ["UNSURE", "DECLINE", "UNANSWERED"].map((reason) =>
      AxisStateSchema.parse(undeterminedAxis(reason)),
    );
    expect(parsed).toEqual([
      { state: "UNDETERMINED", reasons: ["UNSURE"] },
      { state: "UNDETERMINED", reasons: ["DECLINE"] },
      { state: "UNDETERMINED", reasons: ["UNANSWERED"] },
    ]);
  });
});

describe("PriorityStateSchema", () => {
  it("has exactly the five states", () => {
    expectTypeOf<PriorityState["state"]>().toEqualTypeOf<
      "NOT_ASKED" | "SELECTED" | "UNSURE" | "DECLINE" | "UNANSWERED"
    >();
    for (const value of [
      { state: "NOT_ASKED" },
      { state: "SELECTED", themeIds: [TR] },
      { state: "SELECTED", themeIds: [DP, TR] },
      { state: "UNSURE" },
      { state: "DECLINE" },
      { state: "UNANSWERED" },
    ]) {
      expect(PriorityStateSchema.safeParse(value).success).toBe(true);
    }
  });

  it.each([
    ["a selection of no theme", { state: "SELECTED", themeIds: [] }],
    ["a selection of three themes", { state: "SELECTED", themeIds: [TR, ED, EC] }],
    ["a repeated theme", { state: "SELECTED", themeIds: [TR, TR] }],
    ["an unknown theme", { state: "SELECTED", themeIds: ["UNCLASSIFIED"] }],
    ["a selection without themeIds", { state: "SELECTED" }],
    ["themes on NOT_ASKED", { state: "NOT_ASKED", themeIds: [TR] }],
    ["themes on UNSURE", { state: "UNSURE", themeIds: [TR] }],
    ["themes on DECLINE", { state: "DECLINE", themeIds: [] }],
    ["an unknown state", { state: "NONE" }],
  ])("rejects %s", (_name, value) => {
    expect(PriorityStateSchema.safeParse(value).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Values map
// ---------------------------------------------------------------------------

describe("ValuesMapSchema: valid maps", () => {
  it("accepts design example 1 (QUICK, every question answered)", () => {
    expect(ValuesMapSchema.safeParse(quickMap()).success).toBe(true);
  });

  it("accepts design example 2 (unsure, decline, unanswered and not asked at once)", () => {
    expect(ValuesMapSchema.safeParse(fourStateMap()).success).toBe(true);
  });

  it("accepts design example 3 (FULL, two priority themes)", () => {
    expect(ValuesMapSchema.safeParse(fullMap()).success).toBe(true);
  });

  it.each(["UNSURE", "DECLINE", "UNANSWERED"])(
    "accepts a FULL map whose priority question was %s",
    (state) => {
      // Other fields are not tied to the priority state by the contract.
      const map = fullMap({
        priority: { state },
        hesitantThemes: [],
        excludedQuestions: [
          { questionId: "q-pick", reason: state },
          { questionId: "q-pr-tradeoff", reason: "DECLINE" },
        ],
        counts: { askedThemes: 6, totalThemes: 6, usableQuestions: 11, askedQuestions: 13 },
      });
      expect(ValuesMapSchema.safeParse(map).success).toBe(true);
    },
  );

  it("keeps the four states apart in one map: each in its own field with its own reason", () => {
    const parsed = ValuesMapSchema.parse(fourStateMap());
    expect(parsed.notAskedThemes).toEqual([TR, EC, HC]);
    expect(parsed.hesitantThemes).toEqual([{ themeId: ED, reasons: ["UNSURE"] }]);
    expect(parsed.declinedThemes).toEqual([
      { themeId: DP, reasons: ["DECLINE"] },
      { themeId: PR, reasons: ["UNANSWERED"] },
    ]);
    expect(parsed.priority).toEqual({ state: "NOT_ASKED" });
  });

  it("has no key that could carry a rank, an order or a candidate", () => {
    expectTypeOf<keyof ValuesMap>().toEqualTypeOf<
      | "setKind"
      | "themes"
      | "importanceGroups"
      | "priority"
      | "hesitantThemes"
      | "declinedThemes"
      | "notAskedThemes"
      | "excludedQuestions"
      | "counts"
      | "notices"
    >();
    expect(Object.keys(ValuesMapSchema.parse(quickMap())).sort()).toEqual(
      [
        "setKind",
        "themes",
        "importanceGroups",
        "priority",
        "hesitantThemes",
        "declinedThemes",
        "notAskedThemes",
        "excludedQuestions",
        "counts",
        "notices",
      ].sort(),
    );
  });
});

describe("ValuesMapSchema: structure", () => {
  it.each(["rank", "ranking", "order", "candidateId", "matchRate", "recommendation", "ideology"])(
    "rejects the extra top-level key %s",
    (key) => {
      expect(ValuesMapSchema.safeParse(quickMap({ [key]: 1 })).success).toBe(false);
    },
  );

  it.each([
    ["a theme entry", quickMap({ themes: QUICK_THEMES.map((t, i) => (i === 1 ? { ...t, rank: 1 } : t)) })],
    [
      "an importance group",
      quickMap({ importanceGroups: QUICK_GROUPS.map((g, i) => (i === 0 ? { ...g, rank: 1 } : g)) }),
    ],
    ["the priority", quickMap({ priority: { state: "NOT_ASKED", rank: 1 } })],
    [
      "the counts",
      quickMap({
        counts: { askedThemes: 3, totalThemes: 6, usableQuestions: 6, askedQuestions: 6, rank: 1 },
      }),
    ],
    [
      "the notices",
      quickMap({ notices: { noThemeDifference: false, equalLevelGroupExists: false, rank: 1 } }),
    ],
    [
      "a hesitant theme",
      fourStateMap({ hesitantThemes: [{ themeId: ED, reasons: ["UNSURE"], rank: 1 }] }),
    ],
  ])("rejects a rank on %s", (_name, map) => {
    expect(ValuesMapSchema.safeParse(map).success).toBe(false);
  });

  it("rejects a missing top-level key and an unknown set kind", () => {
    expect(ValuesMapSchema.safeParse(omit(quickMap(), "notices")).success).toBe(false);
    expect(ValuesMapSchema.safeParse(omit(quickMap(), "priority")).success).toBe(false);
    expect(ValuesMapSchema.safeParse(quickMap({ setKind: "DETAILED" })).success).toBe(false);
  });

  it("rejects five themes, seven themes and a repeated theme", () => {
    expect(ValuesMapSchema.safeParse(quickMap({ themes: QUICK_THEMES.slice(0, 5) })).success).toBe(false);
    expect(
      ValuesMapSchema.safeParse(quickMap({ themes: [...QUICK_THEMES, QUICK_THEMES[0]] })).success,
    ).toBe(false);
    const repeated = QUICK_THEMES.map((t, i) => (i === 5 ? themeAxes(TR, NOT_ASKED_AXIS, NOT_ASKED_AXIS) : t));
    expect(rejectedPaths(ValuesMapSchema, quickMap({ themes: repeated }))).toContain("themes.5.themeId");
  });

  it("rejects four importance groups, six groups and groups out of level order", () => {
    expect(ValuesMapSchema.safeParse(quickMap({ importanceGroups: QUICK_GROUPS.slice(0, 4) })).success).toBe(
      false,
    );
    expect(
      ValuesMapSchema.safeParse(quickMap({ importanceGroups: [...QUICK_GROUPS, { level: 2, themeIds: [] }] }))
        .success,
    ).toBe(false);
    expect(rejectedPaths(ValuesMapSchema, quickMap({ importanceGroups: [...QUICK_GROUPS].reverse() }))).toContain(
      "importanceGroups.0.level",
    );
    const twoPlusOne = levelGroups([PR], [DP], [], [ED], []).map((g, i) => (i === 4 ? { ...g, level: 2 } : g));
    expect(rejectedPaths(ValuesMapSchema, quickMap({ importanceGroups: twoPlusOne }))).toContain(
      "importanceGroups.4.level",
    );
  });

  it("rejects a group level of 3 and a theme repeated inside a group", () => {
    const badLevel = QUICK_GROUPS.map((g, i) => (i === 0 ? { ...g, level: 3 } : g));
    expect(ValuesMapSchema.safeParse(quickMap({ importanceGroups: badLevel })).success).toBe(false);
    const repeated = QUICK_GROUPS.map((g, i) => (i === 0 ? { ...g, themeIds: [PR, PR] } : g));
    expect(ValuesMapSchema.safeParse(quickMap({ importanceGroups: repeated })).success).toBe(false);
  });

  it("rejects a score of 201 or a level of 3 inside a theme", () => {
    const withAxis = (axis: Json) =>
      quickMap({ themes: QUICK_THEMES.map((t, i) => (i === 5 ? themeAxes(PR, axis, determinedAxis(100, 1)) : t)) });
    expect(ValuesMapSchema.safeParse(withAxis(determinedAxis(201, 2))).success).toBe(false);
    expect(ValuesMapSchema.safeParse(withAxis(determinedAxis(200, 3))).success).toBe(false);
  });

  it("rejects an undetermined axis with no reason inside a theme", () => {
    const empty = QUICK_THEMES.map((t, i) =>
      i === 5 ? themeAxes(PR, undeterminedAxis(), determinedAxis(100, 1)) : t,
    );
    expect(ValuesMapSchema.safeParse(quickMap({ themes: empty })).success).toBe(false);
  });
});

describe("ValuesMapSchema: priority", () => {
  it("accepts NOT_ASKED on a QUICK map", () => {
    expect(ValuesMapSchema.safeParse(quickMap({ priority: { state: "NOT_ASKED" } })).success).toBe(true);
  });

  it.each([
    [{ state: "SELECTED", themeIds: [TR] }],
    [{ state: "UNSURE" }],
    [{ state: "DECLINE" }],
    [{ state: "UNANSWERED" }],
  ])("rejects %j as the priority of a QUICK map (the QUICK set has no such question)", (priority) => {
    expect(rejectedPaths(ValuesMapSchema, quickMap({ priority }))).toEqual(["priority.state"]);
  });

  it("does not fill the priority from importance levels: a QUICK map with a +2 theme still needs NOT_ASKED", () => {
    // PR is at level +2 in the sample map; naming it as a priority theme is rejected.
    const filled = quickMap({ priority: { state: "SELECTED", themeIds: [PR] } });
    expect(rejectedPaths(ValuesMapSchema, filled)).toEqual(["priority.state"]);
  });

  it("rejects a FULL priority selection of no theme or of three themes", () => {
    expect(
      ValuesMapSchema.safeParse(fullMap({ priority: { state: "SELECTED", themeIds: [] } })).success,
    ).toBe(false);
    expect(
      ValuesMapSchema.safeParse(fullMap({ priority: { state: "SELECTED", themeIds: [TR, ED, EC] } })).success,
    ).toBe(false);
  });
});

describe("ValuesMapSchema: the two axes are independent", () => {
  const AXES: [string, Json][] = [
    ["determined", determinedAxis(100, 1)],
    ["undetermined", undeterminedAxis("UNSURE")],
    ["not asked", NOT_ASKED_AXIS],
  ];
  const combinations = AXES.flatMap(([importanceName, importance]) =>
    AXES.map(([tradeoffName, tradeoff]): [string, Json, Json] => [
      `importance ${importanceName}, trade-off ${tradeoffName}`,
      importance,
      tradeoff,
    ]),
  );

  it.each(combinations)("accepts a theme with %s", (_name, importance, tradeoff) => {
    expect(ValuesMapSchema.safeParse(transportOnlyMap(importance, tradeoff)).success).toBe(true);
  });

  it("accepts a low importance with a strong trade-off, and a high importance with a split trade-off", () => {
    // Design example 3: HEALTHCARE is level -2 for importance and +2 for trade-off.
    const parsed = ValuesMapSchema.parse(fullMap());
    const healthcare = parsed.themes.find((theme) => theme.themeId === HC);
    expect(healthcare?.importance).toEqual({ state: "DETERMINED", score: -200, level: -2 });
    expect(healthcare?.tradeoff).toEqual({ state: "DETERMINED", score: 200, level: 2 });
  });

  it("has no theme-level field that combines the two axes", () => {
    for (const key of ["score", "level", "overall", "total", "rank"]) {
      const withCombined = QUICK_THEMES.map((t, i) => (i === 1 ? { ...t, [key]: 1 } : t));
      expect(ValuesMapSchema.safeParse(quickMap({ themes: withCombined })).success).toBe(false);
    }
  });
});

describe("ValuesMapSchema: importance groups follow the importance axis alone", () => {
  it("rejects a theme whose importance is only undetermined (no filling in)", () => {
    const themes = QUICK_THEMES.map((t, i) =>
      i === 5 ? themeAxes(PR, undeterminedAxis("UNSURE"), determinedAxis(100, 1)) : t,
    );
    // PR is parked in the level-0 group although its importance has no score.
    const map = quickMap({ themes, importanceGroups: levelGroups([], [DP], [PR], [ED], []) });
    expect(rejectedPaths(ValuesMapSchema, map)).toEqual(["importanceGroups.2.themeIds.0"]);
  });

  it("rejects a theme placed in a group on the strength of its trade-off axis", () => {
    const themes = QUICK_THEMES.map((t, i) => (i === 5 ? themeAxes(PR, NOT_ASKED_AXIS, determinedAxis(200, 2)) : t));
    const map = quickMap({ themes, importanceGroups: levelGroups([PR], [DP], [], [ED], []) });
    expect(rejectedPaths(ValuesMapSchema, map)).toEqual(["importanceGroups.0.themeIds.0"]);
  });

  it("rejects a determined theme missing from the groups", () => {
    const map = quickMap({ importanceGroups: levelGroups([], [DP], [], [ED], []) });
    expect(rejectedPaths(ValuesMapSchema, map)).toEqual(["themes.5.importance"]);
  });

  it("rejects a determined theme listed in the group of another level", () => {
    const map = quickMap({ importanceGroups: levelGroups([PR, DP], [], [], [ED], []) });
    expect(rejectedPaths(ValuesMapSchema, map)).toEqual([
      "importanceGroups.0.themeIds.1",
      "themes.4.importance",
    ]);
  });

  it("rejects a not-asked theme listed in a group", () => {
    const map = quickMap({ importanceGroups: levelGroups([PR, TR], [DP], [], [ED], []) });
    expect(rejectedPaths(ValuesMapSchema, map)).toEqual(["importanceGroups.0.themeIds.1"]);
  });
});

describe("ValuesMapSchema: not-asked themes are kept apart", () => {
  it("rejects a theme with both axes not asked that is missing from notAskedThemes", () => {
    expect(rejectedPaths(ValuesMapSchema, quickMap({ notAskedThemes: [TR, EC] }))).toEqual(["themes.3"]);
  });

  it("rejects a theme with an asked axis listed as not asked", () => {
    expect(rejectedPaths(ValuesMapSchema, quickMap({ notAskedThemes: [TR, EC, HC, ED] }))).toEqual([
      "notAskedThemes.3",
    ]);
  });

  it("accepts a theme with only one axis not asked outside notAskedThemes", () => {
    // TRANSPORT importance not asked, trade-off determined: asked, so not "not asked".
    const map = transportOnlyMap(NOT_ASKED_AXIS, determinedAxis(100, 1));
    expect(ValuesMapSchema.safeParse(map).success).toBe(true);
  });

  it("rejects a repeated theme in notAskedThemes", () => {
    expect(rejectedPaths(ValuesMapSchema, quickMap({ notAskedThemes: [TR, EC, HC, HC] }))).toContain(
      "notAskedThemes.3",
    );
  });

  it("rejects a not-asked theme that is also unsure or declined", () => {
    expect(
      rejectedPaths(ValuesMapSchema, quickMap({ hesitantThemes: [{ themeId: TR, reasons: ["UNSURE"] }] })),
    ).toEqual(["hesitantThemes.0.themeId"]);
    expect(
      rejectedPaths(ValuesMapSchema, quickMap({ declinedThemes: [{ themeId: HC, reasons: ["DECLINE"] }] })),
    ).toEqual(["declinedThemes.0.themeId"]);
  });

  it("allows one theme to be both unsure and declined (Req 4.13)", () => {
    const map = fourStateMap({
      declinedThemes: [
        { themeId: ED, reasons: ["DECLINE"] },
        { themeId: DP, reasons: ["DECLINE"] },
        { themeId: PR, reasons: ["UNANSWERED"] },
      ],
    });
    expect(ValuesMapSchema.safeParse(map).success).toBe(true);
  });

  it("rejects a repeated theme in the hesitant and declined lists", () => {
    const twice = [
      { themeId: ED, reasons: ["UNSURE"] },
      { themeId: ED, reasons: ["UNSURE"] },
    ];
    expect(rejectedPaths(ValuesMapSchema, fourStateMap({ hesitantThemes: twice }))).toContain(
      "hesitantThemes.1.themeId",
    );
    const declinedTwice = [
      { themeId: DP, reasons: ["DECLINE"] },
      { themeId: DP, reasons: ["UNANSWERED"] },
    ];
    expect(rejectedPaths(ValuesMapSchema, fourStateMap({ declinedThemes: declinedTwice }))).toContain(
      "declinedThemes.1.themeId",
    );
  });
});

describe("ValuesMapSchema: reasons, excluded questions, counts and notices", () => {
  it("accepts both hesitant reasons and both declined reasons together", () => {
    const map = fullMap({
      hesitantThemes: [{ themeId: HC, reasons: ["UNSURE", "PICK_CONFLICT"] }],
      declinedThemes: [{ themeId: PR, reasons: ["DECLINE", "UNANSWERED"] }],
    });
    expect(ValuesMapSchema.safeParse(map).success).toBe(true);
  });

  it.each([
    ["no hesitant reason", { hesitantThemes: [{ themeId: HC, reasons: [] }] }],
    ["a repeated hesitant reason", { hesitantThemes: [{ themeId: HC, reasons: ["UNSURE", "UNSURE"] }] }],
    ["DECLINE as a hesitant reason", { hesitantThemes: [{ themeId: HC, reasons: ["DECLINE"] }] }],
    ["no declined reason", { declinedThemes: [{ themeId: PR, reasons: [] }] }],
    ["UNSURE as a declined reason", { declinedThemes: [{ themeId: PR, reasons: ["UNSURE"] }] }],
    ["PICK_CONFLICT as a declined reason", { declinedThemes: [{ themeId: PR, reasons: ["PICK_CONFLICT"] }] }],
    ["PICK_CONFLICT as an exclusion reason", { excludedQuestions: [{ questionId: "q-1", reason: "PICK_CONFLICT" }] }],
    ["an empty excluded question ID", { excludedQuestions: [{ questionId: "", reason: "DECLINE" }] }],
  ])("rejects %s", (_name, overrides) => {
    expect(ValuesMapSchema.safeParse(fullMap(overrides)).success).toBe(false);
  });

  it("accepts each exclusion reason", () => {
    const map = fullMap({
      excludedQuestions: [
        { questionId: "q-1", reason: "UNSURE" },
        { questionId: "q-2", reason: "DECLINE" },
        { questionId: "q-3", reason: "UNANSWERED" },
      ],
    });
    expect(ValuesMapSchema.safeParse(map).success).toBe(true);
  });

  it.each([
    ["a negative count", { askedThemes: -1, totalThemes: 6, usableQuestions: 6, askedQuestions: 6 }],
    ["a fractional count", { askedThemes: 3, totalThemes: 6, usableQuestions: 5.5, askedQuestions: 6 }],
    ["more asked themes than themes", { askedThemes: 7, totalThemes: 6, usableQuestions: 6, askedQuestions: 6 }],
    ["more usable than asked questions", { askedThemes: 3, totalThemes: 6, usableQuestions: 7, askedQuestions: 6 }],
    ["a missing count", { askedThemes: 3, totalThemes: 6, usableQuestions: 6 }],
  ])("rejects %s", (_name, counts) => {
    expect(ValuesMapSchema.safeParse(quickMap({ counts })).success).toBe(false);
  });

  it("accepts equal usable and asked questions, and zero usable questions", () => {
    const counts = { askedThemes: 3, totalThemes: 6, usableQuestions: 0, askedQuestions: 6 };
    expect(ValuesMapSchema.safeParse(quickMap({ counts })).success).toBe(true);
  });

  it("rejects non-boolean notices", () => {
    expect(
      ValuesMapSchema.safeParse(quickMap({ notices: { noThemeDifference: "no", equalLevelGroupExists: false } }))
        .success,
    ).toBe(false);
    expect(ValuesMapSchema.safeParse(quickMap({ notices: { noThemeDifference: true } })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Map error
// ---------------------------------------------------------------------------

describe("MapErrorSchema", () => {
  it("accepts the four errors", () => {
    for (const value of [
      { code: "UNKNOWN_QUESTION", questionIds: ["q-x"] },
      { code: "INVALID_ANSWER", questionIds: ["q-1", "q-2"] },
      { code: "NO_OPINION_ANSWERS" },
      { code: "INVALID_CONFIG" },
    ]) {
      expect(MapErrorSchema.safeParse(value).success).toBe(true);
    }
  });

  it("echoes offending answer keys as given, including an empty or a long key", () => {
    expect(
      MapErrorSchema.safeParse({ code: "UNKNOWN_QUESTION", questionIds: ["", "a".repeat(100), " "] }).success,
    ).toBe(true);
  });

  it.each([
    ["UNKNOWN_QUESTION without IDs", { code: "UNKNOWN_QUESTION" }],
    ["UNKNOWN_QUESTION with no ID", { code: "UNKNOWN_QUESTION", questionIds: [] }],
    ["INVALID_ANSWER with a repeated ID", { code: "INVALID_ANSWER", questionIds: ["q-1", "q-1"] }],
    ["INVALID_ANSWER with a numeric ID", { code: "INVALID_ANSWER", questionIds: [1] }],
    ["NO_OPINION_ANSWERS with IDs", { code: "NO_OPINION_ANSWERS", questionIds: ["q-1"] }],
    ["INVALID_CONFIG with IDs", { code: "INVALID_CONFIG", questionIds: ["q-1"] }],
    ["an unknown code", { code: "OTHER" }],
    ["a partial result next to the error", { code: "NO_OPINION_ANSWERS", themes: [] }],
    ["a missing code", {}],
  ])("rejects %s", (_name, value) => {
    expect(MapErrorSchema.safeParse(value).success).toBe(false);
  });
});

describe("second-half exports", () => {
  it("are re-exported from the contracts barrel", () => {
    expect(contracts.ValuesMapSchema).toBe(ValuesMapSchema);
    expect(contracts.MapInputSchema).toBe(MapInputSchema);
    expect(contracts.MapErrorSchema).toBe(MapErrorSchema);
    expect(contracts.AnswerValueSchema).toBe(AnswerValueSchema);
    expect(contracts.AxisStateSchema).toBe(AxisStateSchema);
    expect(contracts.PriorityStateSchema).toBe(PriorityStateSchema);
  });
});
