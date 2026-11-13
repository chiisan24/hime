import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { QuestionBankSchema, type NeutralityConfig, type QuestionBank } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  BALANCE_INJECTION_CASES,
  FIXED_IMPORTANCE_LABELS,
  FULL_ONLY_IMPORTANCE_ID,
  FULL_ONLY_TRADEOFF_ID,
  QUICK_TRADEOFF_ID,
  approvalAround,
  bankFromSetSpec,
  bankFromSwapAndDirection,
  bankWithApproval,
  bankWithDirectionLengths,
  bankWithImportanceLabels,
  labelsOfLengths,
  validSetSpec,
  type SetSpec,
  type TradeoffSpec,
} from "../../../../../tests/harness/regional-values/balanceInjection.js";
import { TEST_NEUTRALITY_CONFIG, buildPassingBank } from "../../../../../tests/harness/regional-values/bankInjection.js";
import { BALANCE_CHECK_IDS, IMPORTANCE_LABELS, checkBalance, type BalanceViolation } from "./balanceChecks.js";

const CONFIG = TEST_NEUTRALITY_CONFIG;
const BANK = buildPassingBank();

function run(bank: QuestionBank, config: NeutralityConfig = CONFIG): BalanceViolation[] {
  return checkBalance(bank, config);
}

/** The violations of one check. */
function of(check: BalanceViolation["check"], bank: QuestionBank, config: NeutralityConfig = CONFIG): BalanceViolation[] {
  return run(bank, config).filter((violation) => violation.check === check);
}

function tradeoffs(swapped: number, kept: number): TradeoffSpec[] {
  return [
    ...Array.from({ length: swapped }, (): TradeoffSpec => ({ swapDirections: true, directionA: "NEUTRAL" })),
    ...Array.from({ length: kept }, (): TradeoffSpec => ({ swapDirections: false, directionA: "NEUTRAL" })),
  ];
}

function directions(change: number, keep: number, neutral = 0): TradeoffSpec[] {
  const make = (count: number, directionA: TradeoffSpec["directionA"]): TradeoffSpec[] =>
    Array.from({ length: count }, (): TradeoffSpec => ({ swapDirections: false, directionA }));
  return [...make(change, "CHANGE"), ...make(keep, "CONTINUE"), ...make(neutral, "NEUTRAL")];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("the passing bank and the fixture bank", () => {
  it("pass every balance, composition and approval check", () => {
    expect(run(BANK)).toEqual([]);
  });

  it("list the checks in the order that a result follows", () => {
    expect([...BALANCE_CHECK_IDS]).toEqual([
      "LABEL_SYMMETRY",
      "DIRECTION_LENGTH",
      "SWAP_BALANCE",
      "DIRECTION_BALANCE",
      "SET_COMPOSITION",
      "REVIEW_APPROVAL",
    ]);
  });

  it("accept the fixture question bank, so that the build can use it", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/src/regional-values/question-bank.json", import.meta.url));
    const fixture = QuestionBankSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    expect(run(fixture)).toEqual([]);
  });

  it("use the importance wording of the requirements, whose middle label is どちらともいえない", () => {
    expect([...IMPORTANCE_LABELS]).toEqual(FIXED_IMPORTANCE_LABELS);
    expect(IMPORTANCE_LABELS[2]).toBe("どちらともいえない");
  });
});

describe("LABEL_SYMMETRY (Req 3.6)", () => {
  it("accepts the fixed wording, whose +1 and -1 labels differ by 6 characters, at the limit of 6", () => {
    expect(of("LABEL_SYMMETRY", bankWithImportanceLabels(labelsOfLengths([null, null, null, null, null])))).toEqual([]);
  });

  it("rejects the fixed wording when the limit is 5, because 大切 and あまり大切でない differ by 6", () => {
    const bank = bankWithImportanceLabels(labelsOfLengths([null, null, null, null, null]));
    expect(of("LABEL_SYMMETRY", bank, { ...CONFIG, labelLengthDiffMax: 5 })).toHaveLength(1);
    expect(of("LABEL_SYMMETRY", bank, { ...CONFIG, labelLengthDiffMax: 6 })).toEqual([]);
  });

  it("rejects each label that differs from the fixed wording", () => {
    for (const index of [0, 1, 2, 3, 4]) {
      const lengths = [null, null, null, null, null].map((_, position) => (position === index ? 3 : null));
      const bank = bankWithImportanceLabels(labelsOfLengths(lengths));
      expect(of("LABEL_SYMMETRY", bank), `label ${index}`).toEqual([
        { check: "LABEL_SYMMETRY", questionId: "test-transport-importance-v1" },
      ]);
    }
  });

  it("rejects the old wording どちらでもない", () => {
    const bank = bankWithImportanceLabels(["とても大切", "大切", "どちらでもない", "あまり大切でない", "大切でない"]);
    expect(of("LABEL_SYMMETRY", bank)).toHaveLength(1);
  });

  it("does not read a trade-off question, whose labels have another wording", () => {
    const labels = BANK.questions.flatMap((question) => (question.kind === "TRADEOFF" ? [question.opinionLabels] : []));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((tradeoffLabels) => tradeoffLabels[0] !== IMPORTANCE_LABELS[0])).toBe(true);
    expect(of("LABEL_SYMMETRY", BANK)).toEqual([]);
  });
});

describe("DIRECTION_LENGTH (Req 3.7)", () => {
  it("accepts a difference of 20 and rejects a difference of 21", () => {
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(5, 25))).toEqual([]);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(25, 5))).toEqual([]);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(5, 26))).toHaveLength(1);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(26, 5))).toHaveLength(1);
  });

  it("follows the limit in the settings", () => {
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(10, 10), { ...CONFIG, directionLengthDiffMax: 0 })).toEqual([]);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(10, 11), { ...CONFIG, directionLengthDiffMax: 0 })).toHaveLength(1);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(10, 40), { ...CONFIG, directionLengthDiffMax: 30 })).toEqual([]);
    expect(of("DIRECTION_LENGTH", bankWithDirectionLengths(10, 41), { ...CONFIG, directionLengthDiffMax: 30 })).toHaveLength(1);
  });

  it("counts code points without the surrounding white space", () => {
    const base = bankWithDirectionLengths(5, 5);
    const [question] = base.questions;
    if (question?.kind !== "TRADEOFF") {
      throw new Error("A trade-off question is required");
    }
    const spaced: QuestionBank = {
      ...base,
      questions: [
        {
          ...question,
          directionA: { ...question.directionA, text: `  ${"😀".repeat(5)}  ` },
          directionB: { ...question.directionB, text: "あ".repeat(25) },
        },
      ],
    };
    expect(of("DIRECTION_LENGTH", spaced)).toEqual([]);
  });
});

describe("SWAP_BALANCE (Req 3.8)", () => {
  const violates = (swapped: number, kept: number, outside: TradeoffSpec[] = []): boolean =>
    of("SWAP_BALANCE", bankFromSwapAndDirection({ inSet: tradeoffs(swapped, kept), outsideSet: outside })).length === 1;

  it("accepts a difference of 0 or 1", () => {
    for (const [swapped, kept] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 3], [4, 3]] as const) {
      expect(violates(swapped, kept), `${swapped}/${kept}`).toBe(false);
    }
  });

  it("rejects a difference of 2 or more", () => {
    for (const [swapped, kept] of [[2, 0], [0, 2], [3, 1], [1, 3], [3, 0], [4, 2], [5, 0]] as const) {
      expect(violates(swapped, kept), `${swapped}/${kept}`).toBe(true);
    }
  });

  it("does not count a trade-off question that the set does not list", () => {
    expect(violates(1, 1, tradeoffs(5, 0))).toBe(false);
  });

  it("reports the diagnostic set and no question", () => {
    const bank = bankFromSwapAndDirection({ inSet: tradeoffs(3, 0), outsideSet: [] });
    expect(of("SWAP_BALANCE", bank)).toEqual([{ check: "SWAP_BALANCE", setKind: "QUICK" }]);
  });
});

describe("DIRECTION_BALANCE (Req 3.9)", () => {
  const violates = (change: number, keep: number, neutral = 0): boolean =>
    of("DIRECTION_BALANCE", bankFromSwapAndDirection({ inSet: directions(change, keep, neutral), outsideSet: [] })).length === 1;

  it("accepts a difference of 0 or 1", () => {
    for (const [change, keep] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 3]] as const) {
      expect(violates(change, keep), `${change}/${keep}`).toBe(false);
    }
  });

  it("rejects a difference of 2 or more", () => {
    for (const [change, keep] of [[2, 0], [0, 2], [3, 1], [1, 3], [4, 0]] as const) {
      expect(violates(change, keep), `${change}/${keep}`).toBe(true);
    }
  });

  it("does not count NEUTRAL", () => {
    expect(violates(1, 1, 5)).toBe(false);
    expect(violates(2, 0, 1)).toBe(true);
    expect(violates(0, 0, 4)).toBe(false);
  });
});

describe("SET_COMPOSITION (Req 3.2)", () => {
  const quick = (...themes: SetSpec["declaredThemes"]): SetSpec => validSetSpec("QUICK", themes);
  const full = (): SetSpec => validSetSpec("FULL", ["TRANSPORT", "EDUCATION_CHILDCARE", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION"]);
  const violates = (spec: SetSpec): boolean => of("SET_COMPOSITION", bankFromSetSpec(spec)).length === 1;

  it("accepts QUICK for any three different themes, because the themes are data of the set", () => {
    expect(violates(quick("EDUCATION_CHILDCARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION"))).toBe(false);
    expect(violates(quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"))).toBe(false);
    expect(violates(quick("TRANSPORT", "DISASTER_PREVENTION", "HEALTHCARE_WELFARE"))).toBe(false);
  });

  it("accepts FULL with the six themes and one priority pick", () => {
    expect(violates(full())).toBe(false);
    expect(bankFromSetSpec(full()).diagnosticSets[0]?.questionIds).toHaveLength(13);
  });

  it("rejects QUICK with a priority pick", () => {
    expect(violates({ ...quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"), picks: 1 })).toBe(true);
  });

  it("rejects QUICK with two themes and with four themes", () => {
    expect(violates(quick("TRANSPORT", "ECONOMY_EMPLOYMENT"))).toBe(true);
    expect(violates(quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE", "DISASTER_PREVENTION"))).toBe(true);
  });

  it("rejects QUICK with the same theme three times", () => {
    const spec = quick("TRANSPORT", "TRANSPORT", "TRANSPORT");
    expect(violates(spec)).toBe(true);
  });

  it("rejects a theme with 0 or 2 importance questions and with 0 or 2 trade-off questions", () => {
    const base = quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE");
    for (const count of [0, 2]) {
      expect(violates({ ...base, importance: { ...base.importance, TRANSPORT: count } }), `importance ${count}`).toBe(true);
      expect(violates({ ...base, tradeoff: { ...base.tradeoff, ECONOMY_EMPLOYMENT: count } }), `trade-off ${count}`).toBe(true);
    }
  });

  it("rejects a question of a theme that the set does not declare", () => {
    const base = quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE");
    expect(violates({ ...base, importance: { ...base.importance, DISASTER_PREVENTION: 1 } })).toBe(true);
  });

  it("rejects FULL with 0 or 2 priority picks, and with a theme missing", () => {
    expect(violates({ ...full(), picks: 0 })).toBe(true);
    expect(violates({ ...full(), picks: 1 })).toBe(false);
    expect(violates({ ...full(), picks: 2 })).toBe(true);
    const base = full();
    expect(
      violates({
        ...base,
        declaredThemes: base.declaredThemes.slice(1),
        importance: { ...base.importance, TRANSPORT: 0 },
        tradeoff: { ...base.tradeoff, TRANSPORT: 0 },
      }),
    ).toBe(true);
  });

  it("rejects any weight other than 1", () => {
    expect(violates({ ...quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"), heavyAt: 0 })).toBe(true);
    expect(violates({ ...quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"), heavyAt: 5 })).toBe(true);
    expect(violates({ ...full(), heavyAt: 12 })).toBe(true);
  });

  it("rejects a question listed twice and a question that the bank does not have", () => {
    const base = quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE");
    expect(violates({ ...base, duplicateFirst: true })).toBe(true);
    expect(violates({ ...base, unknownQuestion: true })).toBe(true);
  });

  it("rejects a set whose declared themes are not the themes of its questions", () => {
    const spec = quick("TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE");
    const bank = bankFromSetSpec(spec);
    const [set] = bank.diagnosticSets;
    if (set === undefined) {
      throw new Error("The bank has a set");
    }
    const declaredElsewhere: QuestionBank = {
      ...bank,
      diagnosticSets: [{ ...set, themeIds: ["EDUCATION_CHILDCARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION"] }],
    };
    expect(of("SET_COMPOSITION", bank)).toEqual([]);
    expect(of("SET_COMPOSITION", declaredElsewhere)).toHaveLength(1);
  });

  it("reports the diagnostic set and no question", () => {
    expect(of("SET_COMPOSITION", bankFromSetSpec(quick("TRANSPORT")))).toEqual([{ check: "SET_COMPOSITION", setKind: "QUICK" }]);
  });
});

describe("REVIEW_APPROVAL (Req 3.10)", () => {
  const violates = (bank: QuestionBank): boolean => of("REVIEW_APPROVAL", bank).length === 1;

  it("accepts an approval at the review time and after it", () => {
    expect(violates(bankWithApproval(approvalAround(1, 0)))).toBe(false);
    expect(violates(bankWithApproval(approvalAround(1, 1)))).toBe(false);
    expect(violates(bankWithApproval(approvalAround(2, 3_600_000)))).toBe(false);
  });

  it("rejects an approval before the review time, even by one millisecond", () => {
    expect(violates(bankWithApproval(approvalAround(1, -1)))).toBe(true);
    expect(violates(bankWithApproval(approvalAround(1, -60_000)))).toBe(true);
  });

  it("compares instants and not strings, so that the offset does not matter", () => {
    // Reviewed at 18:00+09:00 (09:00Z) and approved at 09:00Z: the same instant. As strings, 09:00 sorts before 18:00.
    expect(violates(bankWithApproval(approvalAround(1, 0, [540, 0])))).toBe(false);
    // One millisecond earlier than the review is rejected whatever the offsets are.
    expect(violates(bankWithApproval(approvalAround(1, -1, [540, 0])))).toBe(true);
    expect(violates(bankWithApproval(approvalAround(1, -1, [0, 540])))).toBe(true);
    // Reviewed at 09:00Z and approved at 18:00+09:00 (09:00Z): the same instant. As strings, 18:00 sorts after 09:00.
    expect(violates(bankWithApproval(approvalAround(1, 0, [0, 540])))).toBe(false);
  });

  it("rejects a question without an approval", () => {
    expect(violates(bankWithApproval({ version: 1, approval: null }))).toBe(true);
  });

  it("rejects an approval of another version, and does not carry an approval over to a new version", () => {
    const approved = approvalAround(1, 1);
    expect(violates(bankWithApproval(approved))).toBe(false);
    // The question is raised to version 2 and keeps the record for version 1.
    expect(violates(bankWithApproval({ ...approved, version: 2 }))).toBe(true);
    // A record for the next version is not valid for the current one.
    expect(violates(bankWithApproval({ version: 1, approval: approvalAround(2, 1).approval }))).toBe(true);
    // A new review and approval for version 2 are valid.
    expect(violates(bankWithApproval(approvalAround(2, 1)))).toBe(false);
  });
});

describe("a result of the checks", () => {
  it("reports each injected violation and nothing else", () => {
    for (const injectionCase of BALANCE_INJECTION_CASES) {
      expect(run(injectionCase.apply(BANK)), injectionCase.name).toEqual(injectionCase.expected);
    }
  });

  it("lists every violation by check definition and then by bank definition", () => {
    const injected = BALANCE_INJECTION_CASES.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
    expect(run(injected)).toEqual([
      { check: "LABEL_SYMMETRY", questionId: FULL_ONLY_IMPORTANCE_ID },
      { check: "DIRECTION_LENGTH", questionId: QUICK_TRADEOFF_ID },
      { check: "SWAP_BALANCE", setKind: "FULL" },
      { check: "DIRECTION_BALANCE", setKind: "FULL" },
      { check: "SET_COMPOSITION", setKind: "QUICK" },
      { check: "SET_COMPOSITION", setKind: "FULL" },
      { check: "REVIEW_APPROVAL", questionId: FULL_ONLY_TRADEOFF_ID },
      { check: "REVIEW_APPROVAL", questionId: QUICK_TRADEOFF_ID },
    ]);
  });

  it("does not change the bank or the settings, and gives the same result again", () => {
    const injected = BALANCE_INJECTION_CASES.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
    const before = structuredClone(injected);
    const frozenBank = deepFreeze(structuredClone(injected));
    const frozenConfig = deepFreeze(structuredClone(CONFIG));
    const first = checkBalance(frozenBank, frozenConfig);
    expect(first.length).toBeGreaterThan(0);
    expect(checkBalance(frozenBank, frozenConfig)).toEqual(first);
    expect(frozenBank).toEqual(before);
  });

  it("does not read the data kind or the author of a question (no exemption, Req 3.11)", () => {
    const changed: QuestionBank = {
      ...BANK,
      dataKind: "REAL_AI",
      questions: BANK.questions.map((question) => ({ ...question, dataKind: "REAL_AI", author: "AI_DRAFT" })),
    };
    expect(run(changed)).toEqual(run(BANK));
  });
});
