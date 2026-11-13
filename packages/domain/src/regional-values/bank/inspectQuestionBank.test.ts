import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GateFindingSchema, QuestionBankSchema, type QuestionBank } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  BALANCE_INJECTION_CASES,
  QUICK_TRADEOFF_ID,
} from "../../../../../tests/harness/regional-values/balanceInjection.js";
import {
  TEST_FACT_NUMERALS,
  TEST_NEUTRALITY_CONFIG,
  TEXT_INJECTION_CASES,
  buildPassingBank,
  injectTextViolation,
} from "../../../../../tests/harness/regional-values/bankInjection.js";
import { BALANCE_CHECK_IDS } from "./balanceChecks.js";
import {
  BANK_CHECK_IDS,
  inspectQuestionBank,
  toGateFinding,
  type BankViolation,
  type InspectionContext,
} from "./inspectQuestionBank.js";
import { TEXT_CHECK_IDS } from "./textChecks.js";

const CONTEXT: InspectionContext = { config: TEST_NEUTRALITY_CONFIG, factNumerals: TEST_FACT_NUMERALS };
const BANK = buildPassingBank();

function violationsOf(bank: QuestionBank, context: InspectionContext = CONTEXT): readonly BankViolation[] {
  const result = inspectQuestionBank(bank, context);
  return result.ok ? [] : result.error.violations;
}

function caseIndex(prefix: string): number {
  const index = TEXT_INJECTION_CASES.findIndex((injectionCase) => injectionCase.name.startsWith(prefix));
  if (index === -1) {
    throw new Error(`No injection case starts with ${prefix}`);
  }
  return index;
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

describe("inspectQuestionBank", () => {
  it("gives a success value without a violation for the passing bank", () => {
    expect(inspectQuestionBank(BANK, CONTEXT)).toEqual({ ok: true, value: undefined });
  });

  it("accepts the fixture bank that the build uses, under the test settings", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/src/regional-values/question-bank.json", import.meta.url));
    const fixture = QuestionBankSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    expect(inspectQuestionBank(fixture, { config: TEST_NEUTRALITY_CONFIG, factNumerals: new Set() })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("lists the text checks and then the balance checks as its definition order", () => {
    expect([...BANK_CHECK_IDS]).toEqual([...TEXT_CHECK_IDS, ...BALANCE_CHECK_IDS]);
  });

  it("gives no success value when there is one violation", () => {
    const injected = injectTextViolation(BANK, { caseIndex: caseIndex("a loaded word"), questionIndex: 0, a: 0, b: 0 });
    const result = inspectQuestionBank(injected, CONTEXT);
    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });

  it("collects the violations of different checks together, text checks first", () => {
    // A balance violation (taken out of the QUICK set) and two text violations in different questions.
    const balanceCase = BALANCE_INJECTION_CASES.find((injectionCase) => injectionCase.name === "a question taken out of the QUICK set");
    if (balanceCase === undefined) {
      throw new Error("The balance case exists");
    }
    const withBalance = balanceCase.apply(BANK);
    const withTexts = [
      { caseIndex: caseIndex("a loaded word"), questionIndex: 4, a: 0, b: 0 },
      { caseIndex: caseIndex("a candidate name"), questionIndex: 1, a: 0, b: 0 },
    ].reduce((bank, injection) => injectTextViolation(bank, injection), withBalance);
    expect(violationsOf(withTexts)).toEqual([
      { check: "NAME_FREE", questionId: "test-transport-tradeoff-v1" },
      { check: "LOADED_TERMS", questionId: "test-economy-importance-v1" },
      { check: "SET_COMPOSITION", setKind: "QUICK" },
    ]);
  });

  it("reports a violation of a text check and of a balance check in the same question", () => {
    const injected = injectTextViolation(
      BALANCE_INJECTION_CASES.find((injectionCase) => injectionCase.name === "a question without an approval")?.apply(BANK) ?? BANK,
      { caseIndex: caseIndex("a negation word"), questionIndex: 3, a: 0, b: 0 },
    );
    expect(violationsOf(injected)).toEqual([
      { check: "POSITIVE_FRAMING", questionId: QUICK_TRADEOFF_ID },
      { check: "REVIEW_APPROVAL", questionId: QUICK_TRADEOFF_ID },
    ]);
  });

  it("orders the violations of one check by the bank definition", () => {
    const first = injectTextViolation(BANK, { caseIndex: caseIndex("a loaded word"), questionIndex: 5, a: 0, b: 0 });
    const second = injectTextViolation(first, { caseIndex: caseIndex("a loaded word"), questionIndex: 1, a: 0, b: 0 });
    const third = injectTextViolation(second, { caseIndex: caseIndex("a loaded word"), questionIndex: 3, a: 0, b: 0 });
    expect(violationsOf(third).map((violation) => ("questionId" in violation ? violation.questionId : violation.setKind))).toEqual([
      "test-transport-tradeoff-v1",
      QUICK_TRADEOFF_ID,
      "test-economy-tradeoff-v1",
    ]);
  });

  it("gives the same result for the same input, whatever the earlier calls were", () => {
    const injected = BALANCE_INJECTION_CASES.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
    const first = inspectQuestionBank(injected, CONTEXT);
    inspectQuestionBank(BANK, CONTEXT);
    expect(inspectQuestionBank(injected, CONTEXT)).toEqual(first);
    expect(inspectQuestionBank(structuredClone(injected), CONTEXT)).toEqual(first);
  });

  it("does not change the bank, the settings or the fact numbers", () => {
    const injected = BALANCE_INJECTION_CASES.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
    const frozenBank = deepFreeze(structuredClone(injected));
    const context: InspectionContext = {
      config: deepFreeze(structuredClone(TEST_NEUTRALITY_CONFIG)),
      factNumerals: new Set(TEST_FACT_NUMERALS),
    };
    expect(violationsOf(frozenBank, context).length).toBeGreaterThan(0);
    expect(frozenBank).toEqual(injected);
    expect(context.factNumerals).toEqual(TEST_FACT_NUMERALS);
  });

  it("has no setting that skips a question: the same wording is a violation in every theme, kind and author", () => {
    const loaded = caseIndex("a loaded word");
    for (const [questionIndex] of BANK.questions.entries()) {
      for (const author of ["HUMAN", "AI_DRAFT"] as const) {
        for (const dataKind of ["FIXTURE", "REAL_AI"] as const) {
          const changed: QuestionBank = {
            ...BANK,
            dataKind,
            questions: BANK.questions.map((question) => ({ ...question, dataKind, author })),
          };
          const injected = injectTextViolation(changed, { caseIndex: loaded, questionIndex, a: 0, b: 0 });
          const violations = violationsOf(injected);
          expect(violations, `${questionIndex} / ${author} / ${dataKind}`).toEqual([
            { check: "LOADED_TERMS", questionId: BANK.questions[questionIndex]?.questionId },
          ]);
        }
      }
    }
  });
});

describe("toGateFinding", () => {
  it("makes a missing approval a SHORTAGE that names the question", () => {
    expect(toGateFinding({ check: "REVIEW_APPROVAL", questionId: "q-1" })).toEqual({
      code: "QUESTION_NOT_APPROVED",
      class: "SHORTAGE",
      targetKind: "QUESTION",
      targetId: "q-1",
    });
  });

  it("makes a set that breaks its composition a DEFECT that names the set", () => {
    expect(toGateFinding({ check: "SET_COMPOSITION", setKind: "QUICK" })).toEqual({
      code: "SET_COMPOSITION_INVALID",
      class: "DEFECT",
      targetKind: "DIAGNOSTIC_SET",
      targetId: "QUICK",
    });
  });

  it("makes every other violation a NEUTRALITY_VIOLATION DEFECT, for a question or for a set", () => {
    expect(toGateFinding({ check: "NAME_FREE", questionId: "q-2" })).toEqual({
      code: "NEUTRALITY_VIOLATION",
      class: "DEFECT",
      targetKind: "QUESTION",
      targetId: "q-2",
    });
    expect(toGateFinding({ check: "SWAP_BALANCE", setKind: "FULL" })).toEqual({
      code: "NEUTRALITY_VIOLATION",
      class: "DEFECT",
      targetKind: "DIAGNOSTIC_SET",
      targetId: "FULL",
    });
  });

  it("gives a finding that satisfies the report contract for every violation", () => {
    const injected = BALANCE_INJECTION_CASES.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
    const violations = violationsOf(injected);
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) {
      expect(GateFindingSchema.safeParse(toGateFinding(violation)).success, violation.check).toBe(true);
    }
  });

  it("carries codes and IDs only, never the wording of a question", () => {
    const injected = injectTextViolation(BANK, { caseIndex: caseIndex("a loaded word"), questionIndex: 0, a: 0, b: 0 });
    const question = injected.questions[0];
    const findings = violationsOf(injected).map(toGateFinding);
    expect(findings).toHaveLength(1);
    const text = JSON.stringify(findings);
    expect(text).not.toContain("優劣語");
    expect(text).not.toContain(question?.explanation ?? "unreachable");
    expect(Object.keys(findings[0] ?? {}).sort()).toEqual(["class", "code", "targetId", "targetKind"]);
  });
});
