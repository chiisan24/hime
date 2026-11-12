import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { validInputArb } from "../../../../../../tests/harness/regional-values/generators.js";
import { THEME_ORDER } from "../../../../../../tests/harness/regional-values/testBanks.js";
import { FULL_VIEW_BUNDLE, viewBundleFor } from "../../../../../../tests/harness/regional-values/testViewBundle.js";
import { ANSWERS_V18, mapOf, mapValue } from "../../../../../../tests/harness/regional-values/viewDriver.js";
import { AnswersSchema } from "@ehime-vote-navigator/contracts";
import { guidanceThemeIds } from "./reflectionDiffGuidance.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_051, numRuns: 120 };

const TRADEOFF_CHOICES = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG", "UNSURE", "DECLINE"] as const;

const WITHOUT_TRADEOFFS = Object.fromEntries(Object.entries(ANSWERS_V18).filter(([id]) => !id.endsWith("-tra")));

describe("guidance themes", () => {
  // Feature: regional-values-map, Property 51: the themes of the guidance
  // **Validates: Requirements 6.6, 6.8, 6.12**
  it("do not depend on the answers to the priority-condition (trade-off) questions", () => {
    const baseline = guidanceThemeIds(FULL_VIEW_BUNDLE, mapValue(FULL_VIEW_BUNDLE, "FULL", WITHOUT_TRADEOFFS));
    expect(baseline.length).toBeGreaterThan(0);
    fc.assert(
      fc.property(
        fc.tuple(...THEME_ORDER.map(() => fc.option(fc.constantFrom(...TRADEOFF_CHOICES), { nil: undefined }))),
        (choices) => {
          const answers = {
            ...WITHOUT_TRADEOFFS,
            ...Object.fromEntries(
              THEME_ORDER.flatMap((_themeId, index) => {
                const choice = choices[index];
                return choice === undefined ? [] : [[`q-${["tr", "ed", "ec", "hc", "dp", "pr"][index]}-tra`, choice]];
              }),
            ),
          };
          const map = mapValue(FULL_VIEW_BUNDLE, "FULL", AnswersSchema.parse(answers));
          expect(guidanceThemeIds(FULL_VIEW_BUNDLE, map)).toEqual(baseline);
        },
      ),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 51: the themes of the guidance (selection rule)
  // **Validates: Requirements 6.6, 6.8**
  it("are asked themes only, at most the limit, in the theme definition order, each a priority theme or at +2 or +1", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const bundle = viewBundleFor(input.bank, input.thresholds);
        const current = mapOf(bundle, input.setKind, AnswersSchema.parse(input.answers));
        expect(current.ok).toBe(true);
        if (!current.ok) {
          return;
        }
        const map = current.value;
        const ids = guidanceThemeIds(bundle, map);
        const asked = bundle.diagnosticSets.find((set) => set.setKind === input.setKind)?.themeIds ?? [];
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeLessThanOrEqual(bundle.mapConfig.guidanceMaxThemes);
        expect(ids.every((themeId) => asked.includes(themeId))).toBe(true);
        expect(ids.map((themeId) => THEME_ORDER.indexOf(themeId))).toEqual(
          ids.map((themeId) => THEME_ORDER.indexOf(themeId)).sort((a, b) => a - b),
        );
        const priority = map.priority.state === "SELECTED" ? map.priority.themeIds : [];
        const high = map.importanceGroups.filter((group) => group.level >= 1).flatMap((group) => group.themeIds);
        expect(ids.every((themeId) => priority.includes(themeId) || high.includes(themeId))).toBe(true);
      }),
      PARAMETERS,
    );
  });
});