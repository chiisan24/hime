import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { QuestionBankSchema, type QuestionBank, type ThemeId } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

const BANK_PATH = fileURLToPath(new URL("./question-bank.json", import.meta.url));

function fixtureBank(): QuestionBank {
  return QuestionBankSchema.parse(JSON.parse(readFileSync(BANK_PATH, "utf8")) as unknown);
}

function quickThemes(bank: QuestionBank): readonly ThemeId[] {
  const quick = bank.diagnosticSets.find((set) => set.setKind === "QUICK");
  if (quick === undefined) {
    throw new Error("The fixture bank needs QUICK");
  }
  return quick.themeIds;
}

describe("regional values FIXTURE question bank", () => {
  it("is a strict, schema-valid FIXTURE question bank", () => {
    const bank = fixtureBank();
    expect(bank.schemaVersion).toBe(1);
    expect(bank.dataKind).toBe("FIXTURE");
    expect(bank.themes).toHaveLength(6);
    expect(bank.questions).toHaveLength(6);
    expect(bank.questions.every((question) => question.dataKind === "FIXTURE")).toBe(true);
  });

  it("defines QUICK as the provisional three themes and six questions, without FULL", () => {
    const bank = fixtureBank();
    expect(bank.diagnosticSets).toHaveLength(1);
    expect(bank.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(quickThemes(bank)).toEqual([
      "POPULATION_REVITALIZATION",
      "DISASTER_PREVENTION",
      "EDUCATION_CHILDCARE",
    ]);
    const quick = bank.diagnosticSets[0];
    expect(quick?.questionIds).toHaveLength(6);
    expect(new Set(quick?.questionIds).size).toBe(6);
  });

  it("has one importance question and one trade-off question for each QUICK theme", () => {
    const bank = fixtureBank();
    const themes = quickThemes(bank);
    for (const themeId of themes) {
      const questions = bank.questions.filter(
        (question) => question.kind !== "PRIORITY_PICK" && question.themeId === themeId,
      );
      expect(questions.map((question) => question.kind).sort()).toEqual(["IMPORTANCE", "TRADEOFF"]);
      expect(questions.every((question) => question.weight === 1)).toBe(true);
    }
    expect(bank.questions.some((question) => question.kind === "PRIORITY_PICK")).toBe(false);
  });

  it("keeps the QUICK themes in the diagnostic-set data, not in code", () => {
    const original = fixtureBank();
    const changed = structuredClone(original);
    const quick = changed.diagnosticSets[0];
    if (quick === undefined) {
      throw new Error("The fixture bank needs QUICK");
    }
    const changedQuick = {
      ...quick,
      themeIds: ["TRANSPORT", "HEALTHCARE_WELFARE", "ECONOMY_EMPLOYMENT"],
    };
    const changedBank: QuestionBank = {
      ...changed,
      diagnosticSets: [changedQuick],
    };
    expect(quickThemes(original)).toEqual([
      "POPULATION_REVITALIZATION",
      "DISASTER_PREVENTION",
      "EDUCATION_CHILDCARE",
    ]);
    expect(quickThemes(changedBank)).toEqual([
      "TRANSPORT",
      "HEALTHCARE_WELFARE",
      "ECONOMY_EMPLOYMENT",
    ]);
  });

  it("marks the direction categories and display swaps as provisional fixture assignments", () => {
    const tradeoffs = fixtureBank().questions.filter((question) => question.kind === "TRADEOFF");
    expect(tradeoffs.map((question) => [question.questionId, question.swapDirections])).toEqual([
      ["fixture-population-tradeoff-v1", false],
      ["fixture-disaster-tradeoff-v1", true],
      ["fixture-education-tradeoff-v1", false],
    ]);
    expect(tradeoffs.map((question) => [question.directionA.category, question.directionB.category])).toEqual([
      ["CHANGE", "CONTINUE"],
      ["CONTINUE", "CHANGE"],
      ["CHANGE", "CONTINUE"],
    ]);
  });

  it("uses fictional approval IDs and never calls the fixtures official data", () => {
    const text = readFileSync(BANK_PATH, "utf8");
    expect(text).not.toContain("REAL_AI");
    expect(text).not.toContain("愛媛県");
    for (const question of fixtureBank().questions) {
      expect(question.approval?.approverId).toMatch(/^fixture-/u);
    }
  });
});