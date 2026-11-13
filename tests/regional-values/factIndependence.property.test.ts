import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateValuesMap } from "../../packages/domain/src/regional-values/map/generateValuesMap.js";
import { toMapInput } from "../../packages/domain/src/regional-values/session/toMapInput.js";
import { loadFixtureBundle } from "../harness/regional-values/loadFixtureBundle.js";

const ANSWERS = {
  "fixture-population-importance-v1": "VERY_IMPORTANT",
  "fixture-population-tradeoff-v1": "A_LEAN",
  "fixture-disaster-importance-v1": "IMPORTANT",
  "fixture-disaster-tradeoff-v1": "B_STRONG",
  "fixture-education-importance-v1": "NOT_VERY_IMPORTANT",
  "fixture-education-tradeoff-v1": "BALANCED",
} as const;

describe("fixture fact independence", () => {
  // Feature: regional-values-map, Property 55: fact items do not change the map
  // **Validates: Requirements 7.22, 12.2**
  it("creates equal map inputs and maps when only cards, facts and sources differ", () => {
    const fixture = loadFixtureBundle();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999 }), (amount) => {
        const changed = {
          ...fixture,
          cards: fixture.cards.map((card) => ({
            ...card,
            title: `${card.title} ${amount}`,
            background: `${card.background} ${amount}`,
            facts: card.facts.map((fact) => ({ ...fact, value: { ...fact.value, amount } })),
          })),
        };
        const first = toMapInput(fixture, "QUICK", ANSWERS);
        const second = toMapInput(changed, "QUICK", ANSWERS);
        expect(second).toEqual(first);
        expect(generateValuesMap(second)).toEqual(generateValuesMap(first));
      }),
      { seed: 350_055, numRuns: 120 },
    );
  });
});