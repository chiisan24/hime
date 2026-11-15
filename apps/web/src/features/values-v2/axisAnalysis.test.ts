import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { analyzeValueAxes, SAMPLE_AXIS_VALUES, traceAxisAnswers } from "./axisAnalysis.js";
import { DEMO_DILEMMAS, DILEMMA_SCALE, UI_VALUE_AXES } from "./demoDilemmas.js";
import type { DilemmaAnswer, DilemmaAnswers } from "./uiTypes.js";

/*
 * 価値観6軸の分析と、回答と軸の対応の確認。
 * 計算方法が未確定のため、analyzeValueAxes は回答から値を作らない（独自の計算式を作らない）。
 */

const ANSWER_VALUES: readonly DilemmaAnswer[] = [...DILEMMA_SCALE.map((option) => option.code), "SKIPPED"];

/** 6問それぞれに、回答・スキップ・未回答（キーなし）のどれかを割り当てる */
const answersArbitrary: fc.Arbitrary<DilemmaAnswers> = fc
  .tuple(
    ...DEMO_DILEMMAS.map(() => fc.option(fc.constantFrom(...ANSWER_VALUES), { nil: undefined })),
  )
  .map((values) => {
    const answers: Record<string, DilemmaAnswer> = {};
    DEMO_DILEMMAS.forEach((question, index) => {
      const value = values[index];
      if (value !== undefined) {
        answers[question.questionId] = value;
      }
    });
    return answers;
  });

describe("analyzeValueAxes（計算方法の確定待ち）", () => {
  it("どの回答でも、回答から値を作らず PENDING を返す", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        expect(analyzeValueAxes({ questions: DEMO_DILEMMAS, axes: UI_VALUE_AXES, answers })).toEqual({
          status: "PENDING",
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe("SAMPLE_AXIS_VALUES（サンプル表示の見本の値）", () => {
  it("6軸を軸の順番どおりに1つずつ持ち、分析できない軸と1問からの軸の見え方も含む", () => {
    expect(SAMPLE_AXIS_VALUES.map((value) => value.axisId)).toEqual(UI_VALUE_AXES.map((axis) => axis.axisId));
    expect(SAMPLE_AXIS_VALUES.some((value) => value.state === "UNDETERMINED")).toBe(true);
    expect(
      SAMPLE_AXIS_VALUES.some((value) => value.state === "DETERMINED" && value.usableQuestions === 1),
    ).toBe(true);
  });
});

describe("traceAxisAnswers（回答と軸の対応）", () => {
  it("どの軸も、A側の質問とB側の質問の2つに、その質問への回答をそのまま対応させる", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        const snapshot = structuredClone(answers);
        const traces = traceAxisAnswers(DEMO_DILEMMAS, UI_VALUE_AXES, answers);

        expect(traces.map((trace) => trace.axis.axisId)).toEqual(UI_VALUE_AXES.map((axis) => axis.axisId));
        for (const trace of traces) {
          expect(trace.links.map((link) => link.side).sort()).toEqual(["A", "B"]);
          for (const link of trace.links) {
            const option = link.side === "A" ? link.question.optionA : link.question.optionB;
            expect(option.valueAxisId).toBe(trace.axis.axisId);
            // スキップは "SKIPPED"、未回答は undefined のまま（0点や「同程度」に変えない）
            expect(link.answer).toBe(answers[link.question.questionId]);
          }
          // 質問の提示順に並ぶ
          const order = trace.links.map((link) => DEMO_DILEMMAS.indexOf(link.question));
          expect(order).toEqual([...order].sort((left, right) => left - right));
        }
        expect(answers).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("公平性は、地域交通のAと医療・福祉のBに対応する", () => {
    const [transport, , , healthcare] = DEMO_DILEMMAS;
    if (transport === undefined || healthcare === undefined) {
      throw new Error("demo data is incomplete");
    }
    const fairness = traceAxisAnswers(DEMO_DILEMMAS, UI_VALUE_AXES, {
      [transport.questionId]: "A_LEAN",
      [healthcare.questionId]: "SKIPPED",
    }).find((trace) => trace.axis.axisId === "FAIRNESS");

    expect(
      fairness?.links.map((link) => [link.question.themeLabel, link.side, link.answer]),
    ).toEqual([
      ["地域交通", "A", "A_LEAN"],
      ["医療・福祉", "B", "SKIPPED"],
    ]);
  });
});
