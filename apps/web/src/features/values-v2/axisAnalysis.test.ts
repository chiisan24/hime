import { readFileSync } from "node:fs";

import { levelOf } from "@ehime-vote-navigator/domain/regional-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  analyzeValueAxes,
  AXIS_THRESHOLDS,
  axisLevelOf,
  computeValueAxes,
  contributionOf,
  roundAxisScore,
  SAMPLE_AXIS_VALUES,
  SIGNED_ANSWER,
  traceAxisAnswers,
} from "./axisAnalysis.js";
import { DEMO_DILEMMAS, DILEMMA_SCALE, UI_VALUE_AXES } from "./demoDilemmas.js";
import type {
  DilemmaAnswer,
  DilemmaAnswers,
  UiAxisResult,
  UiDilemmaQuestion,
  UiValueAxisId,
} from "./uiTypes.js";

/*
 * 価値観6軸の分析（records/values-v2-axis-analysis.md の仕様）と、回答と軸の対応の確認。
 */

const TRADEOFF_CODES = DILEMMA_SCALE.map((option) => option.code);
const ANSWER_VALUES: readonly DilemmaAnswer[] = [...TRADEOFF_CODES, "SKIPPED"];

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

function question(index: number): UiDilemmaQuestion {
  const found = DEMO_DILEMMAS[index];
  if (found === undefined) {
    throw new Error("demo data is incomplete");
  }
  return found;
}

/** 誤りのない入力の結果（軸の順） */
function results(answers: DilemmaAnswers, questions = DEMO_DILEMMAS): readonly UiAxisResult[] {
  const computed = computeValueAxes({ questions, axes: UI_VALUE_AXES, answers });
  if (computed.status !== "ANALYZED") {
    throw new Error(`unexpected ${computed.status}`);
  }
  return computed.values;
}

function resultOf(answers: DilemmaAnswers, axisId: UiValueAxisId): UiAxisResult {
  const found = results(answers).find((result) => result.axisId === axisId);
  if (found === undefined) {
    throw new Error(`missing ${axisId}`);
  }
  return found;
}

/** 軸ごとの [A側の質問, B側の質問] */
function questionsOfAxis(axisId: UiValueAxisId): readonly [UiDilemmaQuestion, UiDilemmaQuestion] {
  const onA = DEMO_DILEMMAS.find((item) => item.optionA.valueAxisId === axisId);
  const onB = DEMO_DILEMMAS.find((item) => item.optionB.valueAxisId === axisId);
  if (onA === undefined || onB === undefined) {
    throw new Error(`axis ${axisId} is not on both sides`);
  }
  return [onA, onB];
}

describe("回答値と、軸への寄与", () => {
  it("5段階を +2、+1、0、−1、−2 にし、考え方Aの軸には回答値を、考え方Bの軸には符号を反転した値を寄与させる", () => {
    expect(SIGNED_ANSWER).toEqual({ A_STRONG: 2, A_LEAN: 1, BALANCED: 0, B_LEAN: -1, B_STRONG: -2 });
    expect(TRADEOFF_CODES.map((code) => contributionOf(code, "A"))).toEqual([2, 1, 0, -1, -2]);
    expect(TRADEOFF_CODES.map((code) => contributionOf(code, "B"))).toEqual([-2, -1, 0, 1, 2]);
    // 同程度は、どちらの側でも 0（-0 にしない）
    expect(Object.is(contributionOf("BALANCED", "B"), 0)).toBe(true);
  });

  it("スキップと未回答は寄与を持たない（0 にしない）", () => {
    for (const side of ["A", "B"] as const) {
      expect(contributionOf("SKIPPED", side)).toBeNull();
      expect(contributionOf(undefined, side)).toBeNull();
    }
  });
});

describe("丸めと段階（既存の価値観マップと同じ規則）", () => {
  it("段階の境目は、既存の価値観マップの設定（config/regional-values/map.json）と同じ値", () => {
    const path = new URL("../../../../../config/regional-values/map.json", import.meta.url);
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      thresholds: { t1: number; t2: number };
    };
    expect(AXIS_THRESHOLDS).toEqual(config.thresholds);
  });

  it("得点 −200〜+200 のすべてで、domain の levelOf と同じ水準になる", () => {
    for (let score = -200; score <= 200; score += 1) {
      expect(axisLevelOf(score), String(score)).toBe(levelOf(score, AXIS_THRESHOLDS.t1, AXIS_THRESHOLDS.t2));
    }
  });

  it("R(n, m) は n / m × 100 を整数に丸め、ちょうど 0.5 は正の方向へ丸める（既存の roundRatio の例と同じ）", () => {
    expect(roundAxisScore(1, 8)).toBe(13);
    expect(roundAxisScore(-1, 8)).toBe(-12);
    expect(roundAxisScore(-1, 3)).toBe(-33);
    expect(roundAxisScore(1, 3)).toBe(33);
    expect(roundAxisScore(0, 1)).toBe(0);
    expect(roundAxisScore(-4, 2)).toBe(-200);
  });

  it("回答のある質問が0問のとき（m = 0）と、範囲の外の得点は拒否する（0点にしない）", () => {
    expect(() => roundAxisScore(0, 0)).toThrow(RangeError);
    expect(() => roundAxisScore(1.5, 2)).toThrow(RangeError);
    expect(() => axisLevelOf(201)).toThrow(RangeError);
    expect(() => axisLevelOf(-201)).toThrow(RangeError);
    expect(() => axisLevelOf(0.5)).toThrow(RangeError);
  });
});

describe("computeValueAxes（6軸の境界値）", () => {
  /**
   * 2問とも回答したときの、寄与の合計 n と水準。n / 2 × 100 = 50n が得点になる。
   * n: −4 → −2、−3 → −2、−2 → −1、−1 → −1、0 → 0、+1 → +1、+2 → +1、+3 → +2、+4 → +2
   */
  const LEVEL_BY_SUM_OF_TWO: Readonly<Record<number, number>> = {
    [-4]: -2,
    [-3]: -2,
    [-2]: -1,
    [-1]: -1,
    0: 0,
    1: 1,
    2: 1,
    3: 2,
    4: 2,
  };

  for (const axis of UI_VALUE_AXES) {
    it(`${axis.label}: 2問の回答の 25 通りと、片方だけの回答の 10 通りのすべてで、水準が仕様どおりになる`, () => {
      const [onA, onB] = questionsOfAxis(axis.axisId);
      for (const a of TRADEOFF_CODES) {
        for (const b of TRADEOFF_CODES) {
          const result = resultOf({ [onA.questionId]: a, [onB.questionId]: b }, axis.axisId);
          const n = SIGNED_ANSWER[a] - SIGNED_ANSWER[b];
          expect(result, `${a} / ${b}`).toMatchObject({
            state: "DETERMINED",
            level: LEVEL_BY_SUM_OF_TWO[n],
            score: 50 * n,
            usableQuestions: 2,
            reasons: [],
          });
        }
      }
      // 片方だけ回答（もう片方はスキップ）: 1問の寄与がそのまま水準になる
      for (const code of TRADEOFF_CODES) {
        expect(resultOf({ [onA.questionId]: code, [onB.questionId]: "SKIPPED" }, axis.axisId)).toMatchObject({
          state: "DETERMINED",
          level: SIGNED_ANSWER[code],
          score: 100 * SIGNED_ANSWER[code],
          usableQuestions: 1,
          reasons: ["SKIPPED"],
        });
        // 片方だけ回答（もう片方は未回答）: B側の質問なので符号が反転する
        expect(resultOf({ [onB.questionId]: code }, axis.axisId)).toMatchObject({
          state: "DETERMINED",
          level: -SIGNED_ANSWER[code] || 0,
          usableQuestions: 1,
          reasons: ["UNANSWERED"],
        });
      }
    });
  }

  it("同程度は回答として数える（0点の回答。スキップや未回答とは違う）", () => {
    const [onA, onB] = questionsOfAxis("FAIRNESS");
    expect(resultOf({ [onA.questionId]: "BALANCED", [onB.questionId]: "BALANCED" }, "FAIRNESS")).toMatchObject({
      state: "DETERMINED",
      level: 0,
      score: 0,
      usableQuestions: 2,
    });
    expect(resultOf({ [onA.questionId]: "SKIPPED", [onB.questionId]: "SKIPPED" }, "FAIRNESS").state).toBe(
      "UNDETERMINED",
    );
  });
});

describe("computeValueAxes（スキップ・未回答・未出題の区別）", () => {
  it("2問ともスキップ、2問とも未回答、スキップと未回答を、分析できない理由として分けて持つ", () => {
    const [onA, onB] = questionsOfAxis("COMMUNITY");
    expect(resultOf({ [onA.questionId]: "SKIPPED", [onB.questionId]: "SKIPPED" }, "COMMUNITY")).toMatchObject({
      state: "UNDETERMINED",
      reasons: ["SKIPPED"],
    });
    expect(resultOf({}, "COMMUNITY")).toMatchObject({ state: "UNDETERMINED", reasons: ["UNANSWERED"] });
    expect(resultOf({ [onB.questionId]: "SKIPPED" }, "COMMUNITY")).toMatchObject({
      state: "UNDETERMINED",
      reasons: ["SKIPPED", "UNANSWERED"],
    });
    // 分析できない軸は、得点も水準も持たない（0 にしない）
    expect(resultOf({}, "COMMUNITY")).not.toHaveProperty("level");
    expect(resultOf({}, "COMMUNITY")).not.toHaveProperty("score");
  });

  it("この診断にない軸は、未出題（NOT_ASKED）にし、分析できない軸と区別する", () => {
    const transportOnly = [question(0)];
    const computed = computeValueAxes({ questions: transportOnly, axes: UI_VALUE_AXES, answers: {} });
    expect(computed.status).toBe("ANALYZED");
    const states = computed.status === "ANALYZED" ? computed.values.map((value) => [value.axisId, value.state]) : [];
    expect(states).toEqual([
      ["FAIRNESS", "UNDETERMINED"],
      ["STABILITY", "UNDETERMINED"],
      ["FUTURE", "NOT_ASKED"],
      ["OPPORTUNITY", "NOT_ASKED"],
      ["COMMUNITY", "NOT_ASKED"],
      ["INFRASTRUCTURE", "NOT_ASKED"],
    ]);
  });
});

describe("computeValueAxes（根拠の追跡）", () => {
  it("どの軸の結果も、計算に使った質問・考え方の側・比べた相手・回答・寄与を、質問の提示順に持つ", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        for (const result of results(answers)) {
          expect(result.evidence.map((item) => item.side).sort()).toEqual(["A", "B"]);
          for (const item of result.evidence) {
            const source = DEMO_DILEMMAS.find((candidate) => candidate.questionId === item.questionId);
            const own = item.side === "A" ? source?.optionA : source?.optionB;
            const other = item.side === "A" ? source?.optionB : source?.optionA;
            expect(own?.valueAxisId).toBe(result.axisId);
            expect(item.opposingAxisId).toBe(other?.valueAxisId);
            expect(item.themeLabel).toBe(source?.themeLabel);
            expect(item.answer).toBe(answers[item.questionId]);
            expect(item.contribution).toBe(contributionOf(item.answer, item.side));
          }
          const order = result.evidence.map((item) =>
            DEMO_DILEMMAS.findIndex((candidate) => candidate.questionId === item.questionId),
          );
          expect(order).toEqual([...order].sort((left, right) => left - right));
          if (result.state === "DETERMINED") {
            // 得点は、根拠の寄与だけから決まる
            const usable = result.evidence.flatMap((item) => (item.contribution === null ? [] : [item.contribution]));
            expect(result.usableQuestions).toBe(usable.length);
            expect(result.score).toBe(
              roundAxisScore(
                usable.reduce<number>((sum, value) => sum + value, 0),
                usable.length,
              ),
            );
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("computeValueAxes（再現性・独立性・再計算）", () => {
  it("同じ入力からは同じ結果を返し、回答の対応の列挙順によらず、入力を書き換えない", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        const snapshot = structuredClone(answers);
        const reversed = Object.fromEntries(Object.entries(answers).reverse());
        const first = computeValueAxes({ questions: DEMO_DILEMMAS, axes: UI_VALUE_AXES, answers });
        expect(computeValueAxes({ questions: DEMO_DILEMMAS, axes: UI_VALUE_AXES, answers })).toEqual(first);
        expect(computeValueAxes({ questions: DEMO_DILEMMAS, axes: UI_VALUE_AXES, answers: reversed })).toEqual(first);
        expect(answers).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  it("1問の回答を変えると、その質問の2つの軸だけが変わりうる。ほかの4軸の結果は変わらない", () => {
    fc.assert(
      fc.property(
        answersArbitrary,
        fc.integer({ min: 0, max: DEMO_DILEMMAS.length - 1 }),
        fc.option(fc.constantFrom(...ANSWER_VALUES), { nil: undefined }),
        (answers, index, next) => {
          const target = question(index);
          const changed: Record<string, DilemmaAnswer> = { ...answers };
          if (next === undefined) {
            delete changed[target.questionId];
          } else {
            changed[target.questionId] = next;
          }
          const before = results(answers);
          const after = results(changed);
          const touched = new Set([target.optionA.valueAxisId, target.optionB.valueAxisId]);
          before.forEach((result, axisIndex) => {
            if (!touched.has(result.axisId)) {
              expect(after[axisIndex]).toEqual(result);
            }
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("答え直すと、新しい回答から計算し直す（前の回答は残らない）", () => {
    const transport = question(0);
    const healthcare = question(3);
    const first = { [transport.questionId]: "A_STRONG", [healthcare.questionId]: "B_STRONG" } as const;
    expect(resultOf(first, "FAIRNESS")).toMatchObject({ level: 2, score: 200 });
    const edited = { ...first, [transport.questionId]: "B_STRONG" } as const;
    expect(resultOf(edited, "FAIRNESS")).toMatchObject({ level: 0, score: 0 });
    const skipped = { ...first, [transport.questionId]: "SKIPPED" } as const;
    expect(resultOf(skipped, "FAIRNESS")).toMatchObject({ level: 2, usableQuestions: 1, reasons: ["SKIPPED"] });
  });

  it("質問の考え方AとBを入れ替え、回答も左右を入れ替えると、どの軸の結果も同じになる", () => {
    const mirror: Readonly<Record<DilemmaAnswer, DilemmaAnswer>> = {
      A_STRONG: "B_STRONG",
      A_LEAN: "B_LEAN",
      BALANCED: "BALANCED",
      B_LEAN: "A_LEAN",
      B_STRONG: "A_STRONG",
      SKIPPED: "SKIPPED",
    };
    const swapped = DEMO_DILEMMAS.map((item) => ({ ...item, optionA: item.optionB, optionB: item.optionA }));
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        const mirrored = Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, mirror[value]]));
        // 根拠の「考え方の側」は入れ替わるので、根拠以外（状態、水準、得点、問数、理由）を比べる
        const withoutEvidence = (result: UiAxisResult) => {
          const copy: Record<string, unknown> = { ...result };
          delete copy.evidence;
          return copy;
        };
        expect(results(mirrored, swapped).map(withoutEvidence)).toEqual(results(answers).map(withoutEvidence));
      }),
      { numRuns: 200 },
    );
  });

  it("すべて回答すると、6軸の寄与の合計は0になる（全部の軸を外側にはできない）", () => {
    fc.assert(
      fc.property(fc.tuple(...DEMO_DILEMMAS.map(() => fc.constantFrom(...TRADEOFF_CODES))), (codes) => {
        const answers: Record<string, DilemmaAnswer> = {};
        DEMO_DILEMMAS.forEach((item, index) => {
          const code = codes[index];
          if (code !== undefined) {
            answers[item.questionId] = code;
          }
        });
        expect(Object.keys(answers)).toHaveLength(DEMO_DILEMMAS.length);
        const sum = results(answers)
          .flatMap((result) => result.evidence)
          .reduce((total, item) => total + (item.contribution ?? 0), 0);
        expect(sum).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe("computeValueAxes（不正な入力の拒否）", () => {
  it("質問にない質問ID、決められていない回答値を拒否し、値を作らない", () => {
    expect(
      computeValueAxes({
        questions: DEMO_DILEMMAS,
        axes: UI_VALUE_AXES,
        answers: { "no-such-question": "A_STRONG", [question(0).questionId]: "STRONGLY_A" as DilemmaAnswer },
      }),
    ).toEqual({
      status: "INVALID",
      issues: [
        { code: "INVALID_ANSWER_VALUE", questionId: question(0).questionId },
        { code: "UNKNOWN_QUESTION_ID", questionId: "no-such-question" },
      ],
    });
    for (const bad of ["UNSURE", "DECLINE", "UNANSWERED", "", 0, null, undefined]) {
      const computed = computeValueAxes({
        questions: DEMO_DILEMMAS,
        axes: UI_VALUE_AXES,
        answers: { [question(1).questionId]: bad as unknown as DilemmaAnswer },
      });
      expect(computed, String(bad)).toEqual({
        status: "INVALID",
        issues: [{ code: "INVALID_ANSWER_VALUE", questionId: question(1).questionId }],
      });
    }
  });

  it("重複した軸ID・質問ID、軸の一覧にない軸、AとBが同じ軸の質問を拒否する", () => {
    const first = question(0);
    const broken: UiDilemmaQuestion[] = [
      first,
      first,
      { ...question(1), optionA: { ...question(1).optionA, valueAxisId: "UNKNOWN" as UiValueAxisId } },
      { ...question(2), optionB: { ...question(2).optionB, valueAxisId: question(2).optionA.valueAxisId } },
    ];
    const axes = [...UI_VALUE_AXES, ...UI_VALUE_AXES.slice(0, 1)];
    expect(computeValueAxes({ questions: broken, axes, answers: {} })).toEqual({
      status: "INVALID",
      issues: [
        { code: "DUPLICATE_AXIS_ID", axisId: "FAIRNESS" },
        { code: "DUPLICATE_QUESTION_ID", questionId: first.questionId },
        { code: "UNKNOWN_AXIS_ID", questionId: question(1).questionId, side: "A", axisId: "UNKNOWN" },
        { code: "SAME_AXIS_ON_BOTH_SIDES", questionId: question(2).questionId, axisId: "FUTURE" },
      ],
    });
  });

  it("結果画面の既定の分析（analyzeValueAxes）は computeValueAxes と同じ結果を返す", () => {
    fc.assert(
      fc.property(answersArbitrary, (answers) => {
        const input = { questions: DEMO_DILEMMAS, axes: UI_VALUE_AXES, answers };
        expect(analyzeValueAxes(input)).toEqual(computeValueAxes(input));
      }),
      { numRuns: 50 },
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
