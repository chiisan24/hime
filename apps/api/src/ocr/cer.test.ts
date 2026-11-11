import { describe, expect, it } from "vitest";

import { editDistance, normaliseForScoring, scoreText } from "./cer.js";

describe("normaliseForScoring", () => {
  it("applies NFKC and removes whitespace", () => {
    expect(normaliseForScoring("ＡＢ １ 2\n　あ")).toEqual(["A", "B", "1", "2", "あ"]);
  });
});

describe("editDistance", () => {
  it("counts substitutions, insertions and deletions", () => {
    expect(editDistance([..."kitten"], [..."sitting"])).toBe(3);
    expect(editDistance([], [..."abc"])).toBe(3);
    expect(editDistance([..."abc"], [])).toBe(3);
    expect(editDistance([..."同じ"], [..."同じ"])).toBe(0);
  });
});

describe("scoreText", () => {
  it("scores identical text as perfect, ignoring spacing and width", () => {
    expect(scoreText("教育 に ついて", "教育についてＡ")).toMatchObject({ cer: 1 / 6, referenceChars: 6 });
    expect(scoreText("教育について", "教育 について")).toEqual({
      cer: 0,
      f1: 1,
      hypothesisChars: 6,
      precision: 1,
      recall: 1,
      referenceChars: 6,
    });
  });

  it("counts a misread character in both the CER and the order-free F1", () => {
    const score = scoreText("防災対策", "防災対束");

    expect(score.cer).toBe(0.25);
    expect(score.recall).toBe(0.75);
    expect(score.precision).toBe(0.75);
    expect(score.f1).toBe(0.75);
  });

  it("separates a different reading order from misread characters", () => {
    const score = scoreText("ABCD", "ABDC");

    expect(score.f1).toBe(1);
    expect(score.cer).toBe(0.5);
  });

  it("handles empty text on either side", () => {
    expect(scoreText("", "")).toMatchObject({ cer: 0, f1: 1 });
    expect(scoreText("", "余分")).toMatchObject({ cer: 1, f1: 0 });
    expect(scoreText("本文", "")).toMatchObject({ cer: 1, f1: 0, recall: 0 });
  });
});