import { THEME_IDS } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { DEMO_DILEMMAS, DILEMMA_SCALE, UI_VALUE_AXES } from "./demoDilemmas.js";

/*
 * v2 の UI 専用の仮データの確認。正式な契約の検査ではないが、仕様提案の約束（6テーマ×1問、
 * 各軸が2問に現れ1回はA側・1回はB側、数値や否定表現を含めない）を守っていることを確かめる。
 */

describe("地域課題ジレンマ（v2）の仮データ", () => {
  it("6テーマに1問ずつ、テーマ定義順で並ぶ", () => {
    expect(DEMO_DILEMMAS.map((question) => question.themeId)).toEqual([...THEME_IDS]);
    expect(new Set(DEMO_DILEMMAS.map((question) => question.questionId)).size).toBe(6);
    expect(DEMO_DILEMMAS.every((question) => question.isDemo)).toBe(true);
  });

  it("各軸が2問に現れ、1回はA側、1回はB側になる。A と B には別の軸を割り当てる", () => {
    for (const axis of UI_VALUE_AXES) {
      const asA = DEMO_DILEMMAS.filter((question) => question.optionA.valueAxisId === axis.axisId);
      const asB = DEMO_DILEMMAS.filter((question) => question.optionB.valueAxisId === axis.axisId);
      expect(asA, axis.axisId).toHaveLength(1);
      expect(asB, axis.axisId).toHaveLength(1);
    }
    for (const question of DEMO_DILEMMAS) {
      expect(question.optionA.valueAxisId).not.toBe(question.optionB.valueAxisId);
    }
  });

  it("状況文と考え方の文に、数値・否定表現・一方だけの含意の語を含めない", () => {
    for (const question of DEMO_DILEMMAS) {
      const texts = [question.situation, question.optionA.text, question.optionB.text];
      for (const text of texts) {
        expect(text, text).not.toMatch(/[0-9０-９]|令和|平成|昭和|愛媛県/u);
        expect(text, text).not.toMatch(/しない|せず|やめる|ではなく|だけ|のみ/u);
      }
      // 方向の文の長さの差は20文字以内（既存の Req 3.7 の初期値と同じ）
      const diff = Math.abs(
        Array.from(question.optionA.text).length - Array.from(question.optionB.text).length,
      );
      expect(diff, question.questionId).toBeLessThanOrEqual(20);
    }
  });

  it("5段階は A寄りから B寄りの順で、中央が「同程度」", () => {
    expect(DILEMMA_SCALE.map((option) => option.code)).toEqual([
      "A_STRONG",
      "A_LEAN",
      "BALANCED",
      "B_LEAN",
      "B_STRONG",
    ]);
    expect(DILEMMA_SCALE.map((option) => option.label)).toEqual([
      "Aを強く重視",
      "Aをやや重視",
      "同程度",
      "Bをやや重視",
      "Bを強く重視",
    ]);
  });
});
