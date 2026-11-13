import {
  IMPORTANCE_VALUE,
  QuestionBankSchema,
  TRADEOFF_VALUE,
  ValuesMapSchema,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  DEMO_GUIDANCE,
  DEMO_GUIDANCE_THEME_IDS,
  DEMO_QUESTION_BANK,
  DEMO_RESULT_TEXTS,
  DEMO_VALUES_MAP,
} from "./demoData.js";
import { IMPORTANCE_CODE_ORDER, TRADEOFF_CODE_ORDER } from "./questionView.js";

/*
 * デモデータが正式な契約（packages/contracts/src/models/regional/core.ts）に適合することを確かめる。
 * 契約の値（Zod のスキーマ）は、テストだけで読み込む。画面のコードは型だけを読み込む。
 */

describe("価値観診断のデモデータ", () => {
  it("質問バンクが正式な契約 QuestionBankSchema に適合する", () => {
    const result = QuestionBankSchema.safeParse(DEMO_QUESTION_BANK);
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
  });

  it("クイック版は3テーマ×（大切さ1問＋優先条件1問）の6問で、最優先テーマの選択を含まない", () => {
    const quick = DEMO_QUESTION_BANK.diagnosticSets.find((set) => set.setKind === "QUICK");
    expect(quick).toBeDefined();
    if (quick === undefined) {
      return;
    }
    const questions = quick.questionIds.map((questionId) =>
      DEMO_QUESTION_BANK.questions.find((question) => question.questionId === questionId),
    );
    expect(questions).toHaveLength(6);
    expect(questions.every((question) => question !== undefined)).toBe(true);
    expect(questions.some((question) => question?.kind === "PRIORITY_PICK")).toBe(false);
    expect(new Set(quick.themeIds).size).toBe(3);

    for (const themeId of quick.themeIds) {
      const ofTheme = questions.filter(
        (question) => question !== undefined && question.kind !== "PRIORITY_PICK" && question.themeId === themeId,
      );
      expect(ofTheme.map((question) => question?.kind).sort()).toEqual(["IMPORTANCE", "TRADEOFF"]);
    }
    // 質問の重みはすべて1（Req 3.2 c）
    expect(questions.every((question) => question?.weight === 1)).toBe(true);
    // データ種別はすべて架空データ
    expect(DEMO_QUESTION_BANK.dataKind).toBe("FIXTURE");
  });

  it("デモの固定結果が正式な契約 ValuesMapSchema に適合し、クイック版では最優先テーマが未出題になる", () => {
    const result = ValuesMapSchema.safeParse(DEMO_VALUES_MAP);
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
    expect(DEMO_VALUES_MAP.priority).toEqual({ state: "NOT_ASKED" });
    // 未出題・わからない・回答しないが別々の項目に入っている
    expect(DEMO_VALUES_MAP.notAskedThemes.length).toBeGreaterThan(0);
    expect(DEMO_VALUES_MAP.hesitantThemes.length).toBeGreaterThan(0);
    expect(DEMO_VALUES_MAP.declinedThemes.length).toBeGreaterThan(0);
  });

  it("結果解説と活かし方の問いが、デモの固定結果に必要な組合せをそろえている", () => {
    for (const entry of DEMO_VALUES_MAP.themes) {
      for (const axis of ["IMPORTANCE", "TRADEOFF"] as const) {
        const state = axis === "IMPORTANCE" ? entry.importance : entry.tradeoff;
        if (state.state !== "DETERMINED") {
          continue;
        }
        const text = DEMO_RESULT_TEXTS.find(
          (candidate) =>
            candidate.themeId === entry.themeId && candidate.axis === axis && candidate.level === state.level,
        );
        expect(text, `${entry.themeId} ${axis} ${state.level}`).toBeDefined();
      }
    }
    for (const themeId of DEMO_GUIDANCE_THEME_IDS) {
      const scenes = DEMO_GUIDANCE.filter((entry) => entry.themeId === themeId).map((entry) => entry.scene);
      expect(scenes.sort()).toEqual(["DAILY_LIFE", "ELECTION", "MOVE_OR_JOB"]);
    }
    // 活かし方の問いは文末が「か」の1文（Req 6.6）
    expect(DEMO_GUIDANCE.every((entry) => entry.text.endsWith("か"))).toBe(true);
  });

  it("優先条件の結果解説が Req 5.3 の型に合い、否定表現を含まない", () => {
    const tradeoffTexts = DEMO_RESULT_TEXTS.filter((entry) => entry.axis === "TRADEOFF");
    expect(tradeoffTexts.length).toBeGreaterThan(0);
    for (const entry of tradeoffTexts) {
      expect(entry.text).toMatch(/^どちらかを選ぶなら、.+では.+を先に進めたい考えに近い（(やや|強く)）$/u);
      expect(entry.text).not.toMatch(/しない|せず|やめる|ではなく|重視していません|軽視/u);
    }
  });

  it("画面の回答値の並びが、契約の回答値（+2 から −2）の並びと同じ", () => {
    expect([...IMPORTANCE_CODE_ORDER]).toEqual(Object.keys(IMPORTANCE_VALUE));
    expect([...TRADEOFF_CODE_ORDER]).toEqual(Object.keys(TRADEOFF_VALUE));
  });
});
