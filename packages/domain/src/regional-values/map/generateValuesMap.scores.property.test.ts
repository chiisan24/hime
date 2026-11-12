import type { MapInput, ValuesMap } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { validInputArb } from "../../../../../tests/harness/regional-values/generators.js";
import { referenceGenerate } from "../../../../../tests/harness/regional-values/referenceMap.js";
import { questionsOfSet } from "../../../../../tests/harness/regional-values/testBanks.js";
import { generateValuesMap } from "./generateValuesMap.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 320_003, numRuns: 150 };

type Axis = ValuesMap["themes"][number]["importance"];

function mapOf(input: MapInput): ValuesMap {
  const result = generateValuesMap(input);
  if (!result.ok) {
    throw new Error(`unexpected error ${result.error.code}`);
  }
  return result.value;
}

/** The score and level of a determined axis; the state name of any other axis. */
function summary(axis: Axis): { score: number; level: number } | string {
  return axis.state === "DETERMINED" ? { score: axis.score, level: axis.level } : axis.state;
}

function summaries(map: ValuesMap) {
  return map.themes.map((theme) => ({
    themeId: theme.themeId,
    importance: summary(theme.importance),
    tradeoff: summary(theme.tradeoff),
  }));
}

/** The level of a score by the definition, from the magnitude. */
function levelByDefinition(score: number, t1: number, t2: number): number {
  const size = Math.abs(score);
  const steps = size < t1 ? 0 : size < t2 ? 1 : 2;
  return steps === 0 ? 0 : score < 0 ? -steps : steps;
}

const IMPORTANCE_ORDER = ["VERY_IMPORTANT", "IMPORTANT", "NEUTRAL", "NOT_VERY_IMPORTANT", "NOT_IMPORTANT"];

function importanceOpinionQuestions(input: MapInput) {
  return questionsOfSet(input.bank, input.setKind).filter(
    (question) =>
      question.kind === "IMPORTANCE" &&
      IMPORTANCE_ORDER.includes(String(input.answers[question.questionId])),
  );
}

describe("generateValuesMap: score, level, weight and non-opinion properties", () => {
  // Feature: regional-values-map, Property 3: score and level
  // **Validates: Requirements 4.5, 4.6, 4.7, 12.2**
  it("gives each determined axis the reference score and the level of the definition", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const map = mapOf(input);
        const reference = referenceGenerate(input);
        expect(reference.ok).toBe(true);
        if (reference.ok) {
          expect(map.themes).toEqual(reference.value.themes);
        }
        for (const theme of map.themes) {
          for (const axis of [theme.importance, theme.tradeoff]) {
            if (axis.state === "DETERMINED") {
              expect(Number.isInteger(axis.score)).toBe(true);
              expect(axis.score).toBeGreaterThanOrEqual(-200);
              expect(axis.score).toBeLessThanOrEqual(200);
              expect(axis.level).toBe(levelByDefinition(axis.score, input.thresholds.t1, input.thresholds.t2));
            }
          }
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 4: monotonic level
  // **Validates: Requirements 4.7, 12.2**
  it("never lowers the level of a theme when one of its importance answers rises, and leaves every other theme alone", () => {
    const monotonicArb = validInputArb
      .filter((input) => importanceOpinionQuestions(input).length > 0)
      .chain((input) =>
        fc
          .tuple(fc.constantFrom(...importanceOpinionQuestions(input)), fc.integer({ min: 0, max: 4 }))
          .map(([question, target]) => ({ input, question, target })),
      );
    fc.assert(
      fc.property(monotonicArb, ({ input, question, target }) => {
        const current = IMPORTANCE_ORDER.indexOf(String(input.answers[question.questionId]));
        const raised = Math.min(current, target); // a smaller index is a higher answer
        const higher: MapInput = {
          ...input,
          answers: { ...input.answers, [question.questionId]: IMPORTANCE_ORDER[raised] },
        };
        const before = mapOf(input);
        const after = mapOf(higher);
        const beforeTheme = before.themes.find((theme) => theme.themeId === question.themeId);
        const afterTheme = after.themes.find((theme) => theme.themeId === question.themeId);
        expect(beforeTheme?.importance.state).toBe("DETERMINED");
        if (beforeTheme?.importance.state === "DETERMINED" && afterTheme?.importance.state === "DETERMINED") {
          expect(afterTheme.importance.score).toBeGreaterThanOrEqual(beforeTheme.importance.score);
          expect(afterTheme.importance.level).toBeGreaterThanOrEqual(beforeTheme.importance.level);
        } else {
          expect(afterTheme?.importance.state).toBe("DETERMINED");
        }
        expect(afterTheme?.tradeoff).toEqual(beforeTheme?.tradeoff);
        const others = (map: ValuesMap) => summaries(map).filter((theme) => theme.themeId !== question.themeId);
        expect(others(after)).toEqual(others(before));
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 5: weight scale invariance
  // **Validates: Requirements 4.5, 4.6, 12.2**
  it("keeps every score and level when all weights are multiplied by k (weights above 3 allowed here)", () => {
    fc.assert(
      fc.property(validInputArb, fc.integer({ min: 1, max: 12 }), (input, k) => {
        const scaled: MapInput = {
          ...input,
          bank: {
            ...input.bank,
            questions: input.bank.questions.map((question) => ({ ...question, weight: question.weight * k })),
          },
        };
        expect(summaries(mapOf(scaled))).toEqual(summaries(mapOf(input)));
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 6: replacing non-opinion answers
  // **Validates: Requirements 4.8, 12.2**
  it("keeps every score and level when UNSURE, DECLINE, UNANSWERED and a missing key replace one another", () => {
    const replacementsArb = fc.array(fc.constantFrom("UNSURE", "DECLINE", "UNANSWERED", "ABSENT"), {
      minLength: 13,
      maxLength: 13,
    });
    fc.assert(
      fc.property(validInputArb, replacementsArb, (input, replacements) => {
        const answers: Record<string, unknown> = { ...input.answers };
        questionsOfSet(input.bank, input.setKind).forEach((question, index) => {
          const value = answers[question.questionId];
          const nonOpinion = value === undefined || value === "UNSURE" || value === "DECLINE" || value === "UNANSWERED";
          if (nonOpinion) {
            const replacement = replacements[index] ?? "ABSENT";
            if (replacement === "ABSENT") {
              delete answers[question.questionId];
            } else {
              answers[question.questionId] = replacement;
            }
          }
        });
        const before = mapOf(input);
        const after = mapOf({ ...input, answers });
        expect(summaries(after)).toEqual(summaries(before));
        expect(after.excludedQuestions.map((entry) => entry.questionId)).toEqual(
          before.excludedQuestions.map((entry) => entry.questionId),
        );
        expect(after.counts).toEqual(before.counts);
        expect(after.importanceGroups).toEqual(before.importanceGroups);
      }),
      PARAMETERS,
    );
  });
});