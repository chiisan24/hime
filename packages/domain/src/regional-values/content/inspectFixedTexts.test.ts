import {
  FIXED_TEXT_KEYS,
  requiredFixedTextKeys,
  type FixedTexts,
  type GateFinding,
  type GuidanceQuestion,
  type Level,
  type ResultText,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { TEST_NEUTRALITY_CONFIG } from "../../../../../tests/harness/regional-values/bankInjection.js";
import {
  FIXTURE_QUICK_THEMES,
  loadFixtureFixedTexts,
  loadFixtureGuidance,
  loadFixtureResultTexts,
} from "../../../../../tests/harness/regional-values/contentFixtures.js";
import {
  inspectFixedTexts,
  inspectGuidance,
  inspectResultTexts,
  matchesTradeoffForm,
  type FixedTextsToCheck,
} from "./inspectFixedTexts.js";

const CONFIG = TEST_NEUTRALITY_CONFIG;
const FIXED = loadFixtureFixedTexts();
const RESULTS = loadFixtureResultTexts();
const GUIDANCE = loadFixtureGuidance();

function codes(findings: readonly GateFinding[]): string[] {
  return findings.map((finding) => `${finding.code}:${finding.targetId}`);
}

function withFixedText(key: string, text: string): FixedTexts {
  return { ...FIXED, items: FIXED.items.map((item) => (item.key === key ? { ...item, text } : item)) };
}

function withResultText(match: (item: ResultText) => boolean, change: (item: ResultText) => ResultText): ResultText[] {
  return RESULTS.map((item) => (match(item) ? change(item) : item));
}

function tradeoff(themeId: string, level: Level): (item: ResultText) => boolean {
  return (item) => item.themeId === themeId && item.axis === "TRADEOFF" && item.level === level;
}

describe("the fictional texts of the repository", () => {
  it("pass the fixed text, result text and guidance checks with no finding", () => {
    expect(inspectFixedTexts(FIXED, CONFIG)).toEqual([]);
    expect(inspectResultTexts(RESULTS, CONFIG, FIXTURE_QUICK_THEMES)).toEqual([]);
    expect(inspectGuidance(GUIDANCE, CONFIG, FIXTURE_QUICK_THEMES)).toEqual([]);
  });

  it("have all 103 required keys, 30 result texts and 9 guidance questions", () => {
    expect(FIXED.items).toHaveLength(requiredFixedTextKeys("FIXTURE").length);
    expect(FIXED.items).toHaveLength(103);
    expect(RESULTS).toHaveLength(30);
    expect(GUIDANCE).toHaveLength(9);
    expect(FIXED_TEXT_KEYS.length).toBeGreaterThan(103);
  });
});

describe("inspectFixedTexts", () => {
  it("reports a banned word in a fixed text, as a defect that names the key", () => {
    const result = inspectFixedTexts(withFixedText("section.explainer", "あなたへのおすすめを示します"), CONFIG);
    expect(result).toEqual([{ code: "FIXED_TEXT_INVALID", class: "DEFECT", targetKind: "FIXED_TEXT", targetId: "section.explainer" }]);
  });

  it("reports each word of the list and of the three categories", () => {
    for (const word of ["一致率", "ランキング", "保守", "優劣語", "推奨語", "投票語"]) {
      expect(codes(inspectFixedTexts(withFixedText("section.chart", `図の${word}`), CONFIG)), word).toEqual([
        "FIXED_TEXT_INVALID:section.chart",
      ]);
    }
  });

  it("does not tell the half-width and the full-width spelling of a banned word apart", () => {
    const config = { ...CONFIG, bannedWords: [...CONFIG.bannedWords, "ABC"] };
    expect(codes(inspectFixedTexts(withFixedText("section.chart", "図のＡＢＣ"), config))).toEqual(["FIXED_TEXT_INVALID:section.chart"]);
  });

  it("exempts the notice, and only the notice, from the banned words", () => {
    expect(inspectFixedTexts(withFixedText("notice", "この結果は自己理解の参考であり、投票先の推奨語ではありません。"), CONFIG)).toEqual([]);
    expect(codes(inspectFixedTexts(withFixedText("banner.FIXTURE", "デモ用の推奨語です。"), CONFIG))).toEqual([
      "FIXED_TEXT_INVALID:banner.FIXTURE",
    ]);
  });

  it("reports a sentence that tells what the user is", () => {
    for (const text of ["あなたは慎重な人です", "地域重視派です", "市民主義です"]) {
      expect(codes(inspectFixedTexts(withFixedText("section.chart", text), CONFIG)), text).toEqual(["FIXED_TEXT_INVALID:section.chart"]);
    }
    expect(inspectFixedTexts(withFixedText("section.chart", "回答の整理です"), CONFIG)).toEqual([]);
  });

  it("accepts a sentence of 60 characters and reports one of 61", () => {
    expect(inspectFixedTexts(withFixedText("section.chart", "あ".repeat(60)), CONFIG)).toEqual([]);
    expect(codes(inspectFixedTexts(withFixedText("section.chart", "あ".repeat(61)), CONFIG))).toEqual(["FIXED_TEXT_INVALID:section.chart"]);
    expect(inspectFixedTexts(withFixedText("section.chart", `${"あ".repeat(60)}。${"い".repeat(60)}`), CONFIG)).toEqual([]);
  });

  it("allows the placeholders of the key and no other", () => {
    expect(inspectFixedTexts(withFixedText("counts.themes", "{n} / {m}"), CONFIG)).toEqual([]);
    expect(codes(inspectFixedTexts(withFixedText("counts.themes", "{n} / {themeName}"), CONFIG))).toEqual(["FIXED_TEXT_INVALID:counts.themes"]);
    expect(codes(inspectFixedTexts(withFixedText("section.chart", "図{n}"), CONFIG))).toEqual(["FIXED_TEXT_INVALID:section.chart"]);
    expect(inspectFixedTexts(withFixedText("reason.UNSURE", "{themeName}は判断に迷いました"), CONFIG)).toEqual([]);
  });

  it("reports a key that is not in the closed list and a key that is repeated", () => {
    const [first] = FIXED.items;
    if (first === undefined) {
      throw new Error("The fixture has a fixed text");
    }
    const unknown: FixedTextsToCheck = { ...FIXED, items: [...FIXED.items, { ...first, key: "not.a.key" }] };
    expect(codes(inspectFixedTexts(unknown, CONFIG))).toEqual(["FIXED_TEXT_INVALID:not.a.key"]);
    const repeated: FixedTexts = { ...FIXED, items: [...FIXED.items, first] };
    expect(codes(inspectFixedTexts(repeated, CONFIG))).toEqual([`FIXED_TEXT_INVALID:${first.key}`]);
  });

  it("reports a text that is not approved, as a shortage", () => {
    const [first] = FIXED.items;
    if (first === undefined) {
      throw new Error("The fixture has a fixed text");
    }
    const pending: FixedTexts = {
      ...FIXED,
      items: FIXED.items.map((item) => (item.key === first.key ? { ...item, approval: { status: "PENDING" } } : item)),
    };
    expect(inspectFixedTexts(pending, CONFIG)).toEqual([
      { code: "FIXED_TEXT_NOT_APPROVED", class: "SHORTAGE", targetKind: "FIXED_TEXT", targetId: first.key },
    ]);
  });

  it("reports each required key that is missing, in the order of the closed list", () => {
    const missing: FixedTexts = { ...FIXED, items: FIXED.items.filter((item) => item.key !== "ui.next" && item.key !== "notice") };
    expect(codes(inspectFixedTexts(missing, CONFIG))).toEqual([
      "FIXED_TEXT_NOT_APPROVED:notice",
      "FIXED_TEXT_NOT_APPROVED:ui.next",
    ]);
  });

  it("does not ask the REAL_AI keys of a FIXTURE bundle", () => {
    expect(requiredFixedTextKeys("FIXTURE")).not.toContain("about.unofficial");
    expect(inspectFixedTexts(FIXED, CONFIG)).toEqual([]);
  });

  it("reports an invalid and unapproved text with both codes", () => {
    const changed: FixedTexts = {
      ...FIXED,
      items: FIXED.items.map((item) =>
        item.key === "section.chart" ? { ...item, text: "図のランキング", approval: { status: "PENDING" } } : item,
      ),
    };
    expect(codes(inspectFixedTexts(changed, CONFIG))).toEqual(["FIXED_TEXT_INVALID:section.chart", "FIXED_TEXT_NOT_APPROVED:section.chart"]);
  });
});

describe("matchesTradeoffForm (Req 5.3, 5.18)", () => {
  const one = (degree: string): string => `どちらかを選ぶなら、地域交通では移動手段の確保を先に進めたい考えに近い（${degree}）`;

  it("takes やや for the levels 1 and -1 and 強く for the levels 2 and -2", () => {
    for (const level of [1, -1] as const) {
      expect(matchesTradeoffForm(level, one("やや"))).toBe(true);
      expect(matchesTradeoffForm(level, one("強く"))).toBe(false);
    }
    for (const level of [2, -2] as const) {
      expect(matchesTradeoffForm(level, one("強く"))).toBe(true);
      expect(matchesTradeoffForm(level, one("やや"))).toBe(false);
    }
  });

  it("accepts the full stop at the end and the example of the requirements", () => {
    expect(matchesTradeoffForm(2, `${one("強く")}。`)).toBe(true);
    expect(matchesTradeoffForm(2, "どちらかを選ぶなら、地域交通では移動手段の確保を先に進めたい考えに近い（強く）")).toBe(true);
  });

  it("rejects a text that is not of the form", () => {
    for (const text of [
      "地域交通では移動手段の確保を先に進めたい考えに近い（強く）",
      "どちらかを選ぶなら、地域交通では移動手段の確保を強く先に進めたい考えに近い。",
      "どちらかを選ぶなら、移動手段の確保を先に進めたい考えに近い（強く）",
      "どちらかを選ぶなら、地域交通では移動手段の確保を先に進めたい（強く）",
      `${one("強く")}。別の文です。`,
      "",
    ]) {
      expect(matchesTradeoffForm(2, text), text).toBe(false);
    }
  });

  it("takes a text of level 0 that states both directions as equal, and not a one-sided one", () => {
    expect(matchesTradeoffForm(0, "地域交通では、二つの取り組みを同じくらい先に進めたい考えに近い。")).toBe(true);
    expect(matchesTradeoffForm(0, one("やや"))).toBe(false);
    expect(matchesTradeoffForm(0, one("強く"))).toBe(false);
    expect(matchesTradeoffForm(0, "地域交通では移動手段の確保を先に進めたい考えに近い。")).toBe(false);
    expect(matchesTradeoffForm(0, "どちらかを選ぶなら、地域交通では二つを同じくらい先に進めたい考えに近い（やや）")).toBe(false);
  });
});

describe("inspectResultTexts", () => {
  const theme = "DISASTER_PREVENTION";

  it("reports a trade-off text that is not of the form of its level", () => {
    const changed = withResultText(tradeoff(theme, 2), (item) => ({ ...item, text: "防災の備えでは取り組みを強く先に進めたい考えに近い。" }));
    expect(inspectResultTexts(changed, CONFIG)).toEqual([
      { code: "FIXED_TEXT_INVALID", class: "DEFECT", targetKind: "RESULT_TEXT", targetId: `${theme}/TRADEOFF/2` },
    ]);
  });

  it("reports a degree that does not belong to the level", () => {
    const changed = withResultText(tradeoff(theme, 1), (item) => ({
      ...item,
      text: "どちらかを選ぶなら、防災の備えでは避難に必要な情報を届ける取り組みを先に進めたい考えに近い（強く）。",
    }));
    expect(codes(inspectResultTexts(changed, CONFIG))).toEqual([`FIXED_TEXT_INVALID:${theme}/TRADEOFF/1`]);
  });

  it("reports a negation word and a word that makes light of the other direction in a trade-off text", () => {
    for (const word of [...CONFIG.negationWords, ...CONFIG.disparagingWords]) {
      const changed = withResultText(tradeoff(theme, -2), (item) => ({
        ...item,
        text: `どちらかを選ぶなら、防災の備えでは避難する場所を整える取り組みを先に進めたい考えに近い（強く）。${word}`,
      }));
      expect(codes(inspectResultTexts(changed, CONFIG)), word).toContain(`FIXED_TEXT_INVALID:${theme}/TRADEOFF/-2`);
    }
  });

  it("does not look for a negation word in an importance text", () => {
    const changed = withResultText(
      (item) => item.themeId === theme && item.axis === "IMPORTANCE" && item.level === 2,
      (item) => ({ ...item, text: "防災の備えをとても大切だけでなく、ほかよりも大切と回答したことを表します。" }),
    );
    expect(inspectResultTexts(changed, CONFIG)).toEqual([]);
  });

  it("reports a banned word, a sentence that tells what the user is and a sentence of 61 characters", () => {
    const importance = (level: Level) => (item: ResultText) => item.themeId === theme && item.axis === "IMPORTANCE" && item.level === level;
    const banned = withResultText(importance(2), (item) => ({ ...item, text: "防災の備えが一致率に表れます。" }));
    expect(codes(inspectResultTexts(banned, CONFIG))).toEqual([`FIXED_TEXT_INVALID:${theme}/IMPORTANCE/2`]);
    const claim = withResultText(importance(1), (item) => ({ ...item, text: "あなたは備えを大切にする慎重な人です。" }));
    expect(codes(inspectResultTexts(claim, CONFIG))).toEqual([`FIXED_TEXT_INVALID:${theme}/IMPORTANCE/1`]);
    const long = withResultText(importance(0), (item) => ({ ...item, text: "あ".repeat(61) }));
    expect(codes(inspectResultTexts(long, CONFIG))).toEqual([`FIXED_TEXT_INVALID:${theme}/IMPORTANCE/0`]);
    const exact = withResultText(importance(0), (item) => ({ ...item, text: "あ".repeat(60) }));
    expect(inspectResultTexts(exact, CONFIG)).toEqual([]);
  });

  it("reports a text that is not approved, as a shortage", () => {
    const changed = withResultText(tradeoff(theme, 0), (item) => ({ ...item, approval: { status: "PENDING" } }));
    expect(inspectResultTexts(changed, CONFIG)).toEqual([
      { code: "RESULT_TEXT_NOT_APPROVED", class: "SHORTAGE", targetKind: "RESULT_TEXT", targetId: `${theme}/TRADEOFF/0` },
    ]);
  });

  it("reports a text of the same theme, axis and level that appears twice", () => {
    const [first] = RESULTS;
    if (first === undefined) {
      throw new Error("The fixture has a result text");
    }
    expect(codes(inspectResultTexts([...RESULTS, first], CONFIG))).toEqual([
      `FIXED_TEXT_INVALID:${first.themeId}/${first.axis}/${first.level}`,
    ]);
  });

  it("reports each text of a required theme that is missing, and asks nothing when no theme is required", () => {
    const without = RESULTS.filter((item) => !(item.themeId === theme && item.axis === "IMPORTANCE" && item.level === -1));
    expect(inspectResultTexts(without, CONFIG)).toEqual([]);
    expect(codes(inspectResultTexts(without, CONFIG, [theme]))).toEqual([`RESULT_TEXT_NOT_APPROVED:${theme}/IMPORTANCE/-1`]);
    expect(inspectResultTexts([], CONFIG, ["TRANSPORT", "TRANSPORT"])).toHaveLength(10);
  });
});

describe("inspectGuidance", () => {
  function withGuidance(index: number, change: (item: GuidanceQuestion) => GuidanceQuestion): GuidanceQuestion[] {
    return GUIDANCE.map((item, position) => (position === index ? change(item) : item));
  }

  it("reports a listed name, each word that urges a choice and a banned word", () => {
    for (const word of [...CONFIG.guidanceNames, ...CONFIG.choiceEncouragingWords, "一致率", "推奨語"]) {
      const changed = withGuidance(0, (item) => ({ ...item, text: `${word}について確かめますか？` }));
      expect(codes(inspectGuidance(changed, CONFIG)), word).toEqual(["FIXED_TEXT_INVALID:POPULATION_REVITALIZATION/ELECTION"]);
    }
  });

  it("reports a question that does not end with か, and a question of two sentences", () => {
    for (const text of ["確かめます。", "確かめますか。もう一度確かめますか？", "確かめましょう"]) {
      const changed = withGuidance(1, (item) => ({ ...item, text }));
      expect(codes(inspectGuidance(changed, CONFIG)), text).toEqual(["FIXED_TEXT_INVALID:POPULATION_REVITALIZATION/MOVE_OR_JOB"]);
    }
  });

  it("accepts a question that ends with か, with or without the question mark", () => {
    for (const text of ["確かめますか", "確かめますか？", "確かめますか?"]) {
      expect(inspectGuidance(withGuidance(0, (item) => ({ ...item, text })), CONFIG)).toEqual([]);
    }
  });

  it("accepts a question of 60 characters and reports one of 61", () => {
    expect(inspectGuidance(withGuidance(0, (item) => ({ ...item, text: `${"あ".repeat(59)}か` })), CONFIG)).toEqual([]);
    expect(codes(inspectGuidance(withGuidance(0, (item) => ({ ...item, text: `${"あ".repeat(60)}か` })), CONFIG))).toEqual([
      "FIXED_TEXT_INVALID:POPULATION_REVITALIZATION/ELECTION",
    ]);
  });

  it("reports a question that is not approved, as a shortage", () => {
    const changed = withGuidance(2, (item) => ({ ...item, approval: { status: "PENDING" } }));
    expect(inspectGuidance(changed, CONFIG)).toEqual([
      { code: "FIXED_TEXT_NOT_APPROVED", class: "SHORTAGE", targetKind: "GUIDANCE_QUESTION", targetId: "POPULATION_REVITALIZATION/DAILY_LIFE" },
    ]);
  });

  it("reports a pair of theme and scene that appears twice", () => {
    const [first] = GUIDANCE;
    if (first === undefined) {
      throw new Error("The fixture has a guidance question");
    }
    expect(codes(inspectGuidance([...GUIDANCE, first], CONFIG))).toEqual([`FIXED_TEXT_INVALID:${first.themeId}/${first.scene}`]);
  });

  it("reports each pair of a required theme that is missing, and asks nothing when no theme is required", () => {
    const without = GUIDANCE.filter((item) => !(item.themeId === "DISASTER_PREVENTION" && item.scene === "DAILY_LIFE"));
    expect(inspectGuidance(without, CONFIG)).toEqual([]);
    expect(codes(inspectGuidance(without, CONFIG, ["DISASTER_PREVENTION"]))).toEqual(["FIXED_TEXT_NOT_APPROVED:DISASTER_PREVENTION/DAILY_LIFE"]);
    expect(inspectGuidance([], CONFIG, ["TRANSPORT", "TRANSPORT"])).toHaveLength(3);
  });

  it("does not read the link of the question", () => {
    const changed = withGuidance(0, (item) => ({ ...item, linkSourceId: "any-source" }));
    expect(inspectGuidance(changed, CONFIG)).toEqual([]);
  });
});

describe("the findings", () => {
  it("carry codes and IDs only, never the text", () => {
    const changed = withFixedText("section.chart", "図のランキング");
    const result = inspectFixedTexts(changed, CONFIG);
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(["class", "code", "targetId", "targetKind"]);
    expect(JSON.stringify(result)).not.toContain("ランキング");
  });

  it("do not change the input, and are the same again", () => {
    const before = structuredClone({ FIXED, RESULTS, GUIDANCE });
    const changed = withFixedText("section.chart", "図のランキング");
    const first = inspectFixedTexts(changed, CONFIG);
    expect(inspectFixedTexts(changed, CONFIG)).toEqual(first);
    inspectResultTexts(RESULTS, CONFIG, FIXTURE_QUICK_THEMES);
    inspectGuidance(GUIDANCE, CONFIG, FIXTURE_QUICK_THEMES);
    expect({ FIXED, RESULTS, GUIDANCE }).toEqual(before);
  });
});
