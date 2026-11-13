import { describe, expect, it } from "vitest";

import { DEMO_QUESTION_BANK, DEMO_QUESTION_IDS } from "./demoData.js";
import { answerLabelOf, toQuestionView } from "./questionView.js";

function questionOf(questionId: string) {
  const question = DEMO_QUESTION_BANK.questions.find((candidate) => candidate.questionId === questionId);
  if (question === undefined) {
    throw new Error(`missing ${questionId}`);
  }
  return question;
}

describe("toQuestionView", () => {
  it("大切さ質問は、5段階を +2 から −2 の順に並べ、続けて「わからない」「回答しない」を置く", () => {
    const view = toQuestionView(questionOf(DEMO_QUESTION_IDS.educationImportance), DEMO_QUESTION_BANK.themes);
    expect(view?.kind).toBe("IMPORTANCE");
    expect(view?.premise).toBeNull();
    expect(view?.directions).toBeNull();
    expect(view?.options.map((option) => option.code)).toEqual([
      "VERY_IMPORTANT",
      "IMPORTANT",
      "NEUTRAL",
      "NOT_VERY_IMPORTANT",
      "NOT_IMPORTANT",
      "UNSURE",
      "DECLINE",
    ]);
    expect(view?.options.map((option) => option.label)).toEqual([
      "とても大切",
      "大切",
      "どちらともいえない",
      "あまり大切でない",
      "大切でない",
      "わからない",
      "回答しない",
    ]);
    expect(view?.themeLabel).toBe("教育・子育て");
  });

  it("優先条件質問は、前提文と方向A・Bを持ち、5段階を方向A寄りから並べる", () => {
    const view = toQuestionView(questionOf(DEMO_QUESTION_IDS.educationTradeoff), DEMO_QUESTION_BANK.themes);
    expect(view?.kind).toBe("TRADEOFF");
    expect(view?.premise).not.toBeNull();
    expect(view?.directions?.map((direction) => direction.side)).toEqual(["A", "B"]);
    expect(view?.options.map((option) => option.code)).toEqual([
      "A_STRONG",
      "A_LEAN",
      "BALANCED",
      "B_LEAN",
      "B_STRONG",
      "UNSURE",
      "DECLINE",
    ]);
    expect(view?.options[2]?.label).toBe("どちらも同じくらい大切");
  });

  it("表示位置を入れ替える優先条件質問は、方向と5段階の表示順だけを入れ替え、回答値は変えない", () => {
    const question = questionOf(DEMO_QUESTION_IDS.disasterTradeoff);
    expect(question.swapDirections).toBe(true);
    const view = toQuestionView(question, DEMO_QUESTION_BANK.themes);
    expect(view?.directions?.map((direction) => direction.side)).toEqual(["B", "A"]);
    expect(view?.options.map((option) => option.code)).toEqual([
      "B_STRONG",
      "B_LEAN",
      "BALANCED",
      "A_LEAN",
      "A_STRONG",
      "UNSURE",
      "DECLINE",
    ]);
    // 「Bに近い」は回答値 B_STRONG のまま
    expect(view?.options[0]).toEqual({ code: "B_STRONG", label: "Bに近い" });
  });
});

describe("answerLabelOf", () => {
  it("意見回答は選択肢の文言、非意見回答と未回答はそれぞれ別の文言にする", () => {
    const importance = questionOf(DEMO_QUESTION_IDS.educationImportance);
    const tradeoff = questionOf(DEMO_QUESTION_IDS.educationTradeoff);
    expect(answerLabelOf(importance, "IMPORTANT")).toBe("大切");
    expect(answerLabelOf(tradeoff, "B_LEAN")).toBe("どちらかといえばB");
    expect(answerLabelOf(importance, "UNSURE")).toBe("わからない");
    expect(answerLabelOf(importance, "DECLINE")).toBe("回答しない");
    expect(answerLabelOf(importance, undefined)).toBe("未回答");
    expect(answerLabelOf(importance, "UNANSWERED")).toBe("未回答");
  });
});
