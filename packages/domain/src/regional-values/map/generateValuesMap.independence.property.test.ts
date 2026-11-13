import type { MapInput, ValuesMap } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  answersArb,
  permutationArb,
  validInputArb,
  withAnswerOrder,
} from "../../../../../tests/harness/regional-values/generators.js";
import {
  THEME_ORDER,
  questionsOfSet,
  type BankQuestion,
} from "../../../../../tests/harness/regional-values/testBanks.js";
import { generateValuesMap } from "./generateValuesMap.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 330_004, numRuns: 150 };

function tryMap(input: MapInput): ValuesMap | undefined {
  const result = generateValuesMap(input);
  return result.ok ? result.value : undefined;
}

function mapOf(input: MapInput): ValuesMap {
  const value = tryMap(input);
  if (value === undefined) {
    throw new Error("the generated input should give a map");
  }
  return value;
}

/** An arbitrary of an input, the questions to change, and valid new answers for them. */
function changedArb(
  select: (question: BankQuestion) => boolean,
  base: fc.Arbitrary<MapInput> = validInputArb,
) {
  return base.chain((input) => {
    const questions = questionsOfSet(input.bank, input.setKind).filter(select);
    return answersArb(questions).map((replacement) => ({ input, questions, replacement }));
  });
}

function applyChange(
  input: MapInput,
  questions: readonly BankQuestion[],
  replacement: Record<string, unknown>,
): MapInput {
  const answers: Record<string, unknown> = { ...input.answers };
  for (const question of questions) {
    delete answers[question.questionId];
  }
  return { ...input, answers: { ...answers, ...replacement } };
}

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysDeep);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
  }
  return [];
}

const NON_OPINION = ["UNSURE", "DECLINE", "UNANSWERED"];

describe("generateValuesMap: independence properties", () => {
  // Feature: regional-values-map, Property 7: groups and no rank
  // **Validates: Requirements 4.10, 4.11, 12.2**
  it("always has the five groups, holds the determined themes in definition order, and has no rank key", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const map = mapOf(input);
        expect(map.importanceGroups.map((group) => group.level)).toEqual([2, 1, 0, -1, -2]);
        const determined = map.themes.flatMap((theme) =>
          theme.importance.state === "DETERMINED"
            ? [{ themeId: theme.themeId, score: theme.importance.score, level: theme.importance.level }]
            : [],
        );
        for (const group of map.importanceGroups) {
          expect(group.themeIds).toEqual(
            determined.filter((entry) => entry.level === group.level).map((entry) => entry.themeId),
          );
        }
        for (const first of determined) {
          for (const second of determined) {
            if (first.score === second.score) {
              expect(first.level).toBe(second.level);
            }
            if (first.score > second.score) {
              expect(first.level).toBeGreaterThanOrEqual(second.level);
            }
          }
        }
        expect(keysDeep(map).filter((key) => /^(rank|ranking|order|position|place|index)$/iu.test(key))).toEqual([]);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 8: independence between themes
  // **Validates: Requirements 4.4, 12.2**
  it("keeps every other theme as it was when only the answers of one theme change", () => {
    const arb = validInputArb.chain((input) => {
      const asked = THEME_ORDER.filter((theme) =>
        questionsOfSet(input.bank, input.setKind).some((question) => question.themeId === theme),
      );
      return fc.constantFrom(...asked).chain((theme) => {
        const questions = questionsOfSet(input.bank, input.setKind).filter((q) => q.themeId === theme);
        return answersArb(questions).map((replacement) => ({ input, theme, questions, replacement }));
      });
    });
    fc.assert(
      fc.property(arb, ({ input, theme, questions, replacement }) => {
        const before = mapOf(input);
        const after = tryMap(applyChange(input, questions, replacement));
        fc.pre(after !== undefined);
        const others = (map: ValuesMap | undefined) =>
          map?.themes.filter((entry) => entry.themeId !== theme);
        expect(others(after)).toEqual(others(before));
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 9: independence of the trade-off answers
  // **Validates: Requirements 4.4, 12.2**
  it("keeps every importance axis, the groups and the priority themes when only trade-off answers change", () => {
    fc.assert(
      fc.property(
        changedArb((question) => question.kind === "TRADEOFF"),
        ({ input, questions, replacement }) => {
          const before = mapOf(input);
          const after = tryMap(applyChange(input, questions, replacement));
          fc.pre(after !== undefined);
          expect(after?.themes.map((theme) => theme.importance)).toEqual(
            before.themes.map((theme) => theme.importance),
          );
          expect(after?.importanceGroups).toEqual(before.importanceGroups);
          expect(after?.priority).toEqual(before.priority);
        },
      ),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 10: independence of the importance answers
  // **Validates: Requirements 4.4, 12.2**
  it("keeps every trade-off axis when only importance answers change", () => {
    fc.assert(
      fc.property(
        changedArb((question) => question.kind === "IMPORTANCE"),
        ({ input, questions, replacement }) => {
          const before = mapOf(input);
          const after = tryMap(applyChange(input, questions, replacement));
          fc.pre(after !== undefined);
          expect(after?.themes.map((theme) => theme.tradeoff)).toEqual(
            before.themes.map((theme) => theme.tradeoff),
          );
        },
      ),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 11: independence of the priority-theme answer
  // **Validates: Requirements 4.4, 12.1, 12.2**
  it("keeps both axes of every theme when only the priority-theme answer changes", () => {
    const withPick = validInputArb.filter((input) =>
      questionsOfSet(input.bank, input.setKind).some((question) => question.kind === "PRIORITY_PICK"),
    );
    fc.assert(
      fc.property(
        changedArb((question) => question.kind === "PRIORITY_PICK", withPick),
        ({ input, questions, replacement }) => {
          const before = mapOf(input);
          const after = tryMap(applyChange(input, questions, replacement));
          fc.pre(after !== undefined);
          expect(after?.themes).toEqual(before.themes);
          expect(after?.importanceGroups).toEqual(before.importanceGroups);
        },
      ),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 12: theme definition order
  // **Validates: Requirements 4.11, 12.2**
  it("keeps each theme as it was under another theme definition order and only reorders the lists", () => {
    fc.assert(
      fc.property(validInputArb, permutationArb(THEME_ORDER), (input, order) => {
        const before = mapOf(input);
        const after = mapOf({ ...input, bank: { ...input.bank, themeOrder: order } });
        expect(after.themes.map((theme) => theme.themeId)).toEqual(order);
        const byTheme = (map: ValuesMap) => new Map(map.themes.map((theme) => [theme.themeId, theme]));
        for (const theme of order) {
          expect(byTheme(after).get(theme)).toEqual(byTheme(before).get(theme));
        }
        const memberships = (map: ValuesMap) =>
          map.importanceGroups.map((group) => [group.level, [...group.themeIds].sort()]);
        expect(memberships(after)).toEqual(memberships(before));
        for (const group of after.importanceGroups) {
          expect(group.themeIds).toEqual(order.filter((theme) => group.themeIds.includes(theme)));
        }
        expect(after.notAskedThemes).toEqual(order.filter((theme) => before.notAskedThemes.includes(theme)));
        expect(after.hesitantThemes).toEqual(
          order.flatMap((theme) => before.hesitantThemes.filter((entry) => entry.themeId === theme)),
        );
        expect(after.declinedThemes).toEqual(
          order.flatMap((theme) => before.declinedThemes.filter((entry) => entry.themeId === theme)),
        );
        expect(after.counts).toEqual(before.counts);
        expect(after.notices).toEqual(before.notices);
        if (before.priority.state === "SELECTED" && after.priority.state === "SELECTED") {
          expect(after.priority.themeIds).toEqual(
            order.filter((theme) => before.priority.state === "SELECTED" && before.priority.themeIds.includes(theme)),
          );
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 15: changes to what is not asked
  // **Validates: Requirements 4.21, 12.2**
  it("is not affected by questions of the bank that are not in the diagnostic set", () => {
    const extrasArb = fc.array(
      fc.record({
        theme: fc.constantFrom(...THEME_ORDER),
        kind: fc.constantFrom<"IMPORTANCE" | "TRADEOFF">("IMPORTANCE", "TRADEOFF"),
        weight: fc.integer({ min: 1, max: 3 }),
        atStart: fc.boolean(),
      }),
      { maxLength: 5 },
    );
    fc.assert(
      fc.property(validInputArb, extrasArb, fc.integer({ min: 1, max: 3 }), (input, extras, reweight) => {
        const inSet = new Set(questionsOfSet(input.bank, input.setKind).map((question) => question.questionId));
        const extraQuestions = extras.map((extra, index) => ({
          question: {
            questionId: `extra-${index}`,
            kind: extra.kind,
            themeId: extra.theme,
            weight: extra.weight,
          },
          atStart: extra.atStart,
        }));
        const changed: MapInput = {
          ...input,
          bank: {
            ...input.bank,
            questions: [
              ...extraQuestions.filter((entry) => entry.atStart).map((entry) => entry.question),
              ...input.bank.questions.map((question) =>
                inSet.has(question.questionId) ? question : { ...question, weight: reweight },
              ),
              ...extraQuestions.filter((entry) => !entry.atStart).map((entry) => entry.question),
            ],
          },
        };
        const before = mapOf(input);
        const after = mapOf(changed);
        expect(after).toEqual(before);
        for (const theme of after.notAskedThemes) {
          expect(after.hesitantThemes.map((entry) => entry.themeId)).not.toContain(theme);
          expect(after.declinedThemes.map((entry) => entry.themeId)).not.toContain(theme);
        }
      }),
      PARAMETERS,
    );
  });
});

describe("generateValuesMap: the four states, determinism and fact items", () => {
  it("keeps not asked, unsure, declined and unanswered apart, each with its own reason", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const map = mapOf(input);
        const questions = questionsOfSet(input.bank, input.setKind);
        const answerOf = (question: BankQuestion): string => {
          const value = input.answers[question.questionId];
          return value === undefined ? "UNANSWERED" : JSON.stringify(value);
        };
        const plain = (question: BankQuestion): string => answerOf(question).replaceAll('"', "");

        expect(map.excludedQuestions).toEqual(
          questions
            .filter((question) => NON_OPINION.includes(plain(question)))
            .map((question) => ({ questionId: question.questionId, reason: plain(question) })),
        );
        const themeAnswers = (theme: string) =>
          questions
            .filter((question) => question.themeId === theme && question.kind !== "PRIORITY_PICK")
            .map(plain);
        for (const entry of map.hesitantThemes) {
          expect(entry.reasons.includes("UNSURE")).toBe(themeAnswers(entry.themeId).includes("UNSURE"));
        }
        for (const entry of map.declinedThemes) {
          const answers = themeAnswers(entry.themeId);
          expect(answers).not.toContain("UNSURE");
          expect(entry.reasons.includes("DECLINE")).toBe(answers.includes("DECLINE"));
          expect(entry.reasons.includes("UNANSWERED")).toBe(answers.includes("UNANSWERED"));
        }
        for (const theme of map.notAskedThemes) {
          expect(questions.every((question) => question.themeId !== theme)).toBe(true);
          expect(map.hesitantThemes.map((entry) => entry.themeId)).not.toContain(theme);
          expect(map.declinedThemes.map((entry) => entry.themeId)).not.toContain(theme);
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 1: determinism and independence of the answer order
  // **Validates: Requirements 4.1, 12.1**
  it("gives the same map for the same answers, however often and in whatever order they are listed", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const first = mapOf(input);
        expect(mapOf(input)).toEqual(first);
        const reversed = withAnswerOrder(input.answers, Object.keys(input.answers).reverse());
        expect(mapOf({ ...input, answers: reversed })).toEqual(first);
      }),
      PARAMETERS,
    );
  });

  it("ignores fact items, cards and sources that are attached to the input", () => {
    fc.assert(
      fc.property(validInputArb, fc.integer({ min: -1_000_000, max: 1_000_000 }), (input, number) => {
        const facts = [{ factId: "f1", value: number, unit: "count", sourceId: "s1" }];
        const withFacts = {
          ...input,
          facts,
          cards: [{ cardId: "c1", facts }],
          sources: [{ sourceId: "s1", url: "https://example.invalid/source" }],
          bank: {
            ...input.bank,
            facts,
            questions: input.bank.questions.map((question) => ({ ...question, factValue: number })),
          },
        };
        expect(mapOf(withFacts)).toEqual(mapOf(input));
      }),
      PARAMETERS,
    );
  });
});