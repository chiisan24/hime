import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FixedTextsSchema,
  GuidanceQuestionSchema,
  ResultTextSchema,
  requiredFixedTextKeys,
  type FixedTexts,
  type GuidanceQuestion,
  type ResultText,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

const DIRECTORY = new URL("./", import.meta.url);

function jsonFile(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}`, DIRECTORY)), "utf8")) as unknown;
}

function fixedTexts(): FixedTexts {
  return FixedTextsSchema.parse(jsonFile("fixed-texts.json"));
}

function resultTexts(): ResultText[] {
  return ResultTextSchema.array().parse(jsonFile("result-texts.json"));
}

function guidance(): GuidanceQuestion[] {
  return GuidanceQuestionSchema.array().parse(jsonFile("guidance.json"));
}

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function sentencesOf(value: string): string[] {
  return value.split(/[。？！\r\n]/u).filter((sentence) => sentence.trim() !== "");
}

const QUICK_THEMES = ["POPULATION_REVITALIZATION", "DISASTER_PREVENTION", "EDUCATION_CHILDCARE"] as const;
const AXES = ["IMPORTANCE", "TRADEOFF"] as const;
const LEVELS = [2, 1, 0, -1, -2] as const;
const SCENES = ["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"] as const;

describe("regional values FIXTURE texts", () => {
  it("has exactly one approved fixed text for every required FIXTURE key", () => {
    const fixed = fixedTexts();
    const keys = fixed.items.map((item) => item.key);
    expect(fixed.dataKind).toBe("FIXTURE");
    expect(keys).toEqual(requiredFixedTextKeys("FIXTURE"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(fixed.items.every((item) => item.approval.status === "APPROVED")).toBe(true);
  });

  it("has 30 approved FIXTURE result texts: three themes, two axes, five levels", () => {
    const values = resultTexts();
    expect(values).toHaveLength(30);
    expect(values.every((item) => item.dataKind === "FIXTURE" && item.approval.status === "APPROVED")).toBe(true);
    for (const themeId of QUICK_THEMES) {
      for (const axis of AXES) {
        expect(values.filter((item) => item.themeId === themeId && item.axis === axis).map((item) => item.level)).toEqual(
          LEVELS,
        );
      }
    }
  });

  it("has nine approved FIXTURE guidance questions: three themes and three scenes", () => {
    const values = guidance();
    expect(values).toHaveLength(9);
    expect(values.every((item) => item.approval.status === "APPROVED" && item.linkSourceId === null)).toBe(true);
    for (const themeId of QUICK_THEMES) {
      expect(values.filter((item) => item.themeId === themeId).map((item) => item.scene)).toEqual(SCENES);
    }
  });

  it("keeps every fixture text within the 60-character sentence limit", () => {
    const shown = [
      ...fixedTexts().items.map((item) => item.text),
      ...resultTexts().map((item) => item.text),
      ...guidance().map((item) => item.text),
    ];
    for (const text of shown) {
      expect(sentencesOf(text).every((sentence) => codePointCount(sentence.trim()) <= 60)).toBe(true);
    }
    expect(guidance().every((item) => codePointCount(item.text.trim()) <= 60)).toBe(true);
  });

  it("uses a non-negative, non-ranked result text for every trade-off level", () => {
    for (const text of resultTexts().filter((item) => item.axis === "TRADEOFF").map((item) => item.text)) {
      expect(text).not.toMatch(/重視していません|軽視|どうでもよい/u);
      expect(text).not.toMatch(/順位|ランキング|おすすめ/u);
    }
  });

  it("does not present the fixture texts as official data", () => {
    const text = JSON.stringify({ fixed: fixedTexts(), results: resultTexts(), guidance: guidance() });
    expect(text).toContain("デモ用の架空データです");
    expect(text).not.toContain("公式資料で確認");
    expect(text).not.toContain("REAL_AI");
  });
});