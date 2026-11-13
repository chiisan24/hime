import { ValuesMapSchema, type MapInput } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  anyInputArb,
  invalidThresholdsArb,
  validInputArb,
  withAnswerOrder,
} from "../../../../../tests/harness/regional-values/generators.js";
import { referenceGenerate } from "../../../../../tests/harness/regional-values/referenceMap.js";
import { THEME_ORDER, questionsOfSet } from "../../../../../tests/harness/regional-values/testBanks.js";
import { encodeCanonicalJson } from "../../serialization/canonicalJson.js";
import { sha256Hex } from "../../serialization/contentHash.js";
import { generateValuesMap } from "./generateValuesMap.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 340_005, numRuns: 150 };

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysDeep);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
  }
  return [];
}

describe("generateValuesMap: contract properties", () => {
  // Feature: regional-values-map, Property 1: determinism, answer order, unchanged input
  // **Validates: Requirements 4.1, 12.1, 12.3**
  it("gives three equal hashes for two runs and a run with the answers listed in another order, and leaves the input unchanged", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const before = JSON.stringify(input);
        const reordered: MapInput = {
          ...input,
          answers: withAnswerOrder(input.answers, Object.keys(input.answers).reverse()),
        };
        const hashes = [input, input, reordered].map((candidate) =>
          sha256Hex(encodeCanonicalJson(generateValuesMap(candidate))),
        );
        for (const hash of hashes) {
          expect(hash).toMatch(/^[0-9a-f]{64}$/u);
        }
        expect(hashes[1]).toBe(hashes[0]);
        expect(hashes[2]).toBe(hashes[0]);
        expect(JSON.stringify(input)).toBe(before);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 13: the priority themes
  // **Validates: Requirements 4.14, 5.16, 12.1**
  it("is NOT_ASKED for a set without the priority-theme question, and otherwise follows that answer alone", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = generateValuesMap(input);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        const pick = questionsOfSet(input.bank, input.setKind).find((question) => question.kind === "PRIORITY_PICK");
        if (pick === undefined) {
          expect(result.value.priority).toEqual({ state: "NOT_ASKED" });
          return;
        }
        const answer = input.answers[pick.questionId];
        if (answer === undefined) {
          expect(result.value.priority).toEqual({ state: "UNANSWERED" });
        } else if (answer === "UNSURE" || answer === "DECLINE" || answer === "UNANSWERED") {
          expect(result.value.priority).toEqual({ state: answer });
        } else if (typeof answer === "object" && answer !== null && "pick" in answer && Array.isArray(answer.pick)) {
          const chosen: unknown[] = answer.pick;
          expect(result.value.priority).toEqual({
            state: "SELECTED",
            themeIds: THEME_ORDER.filter((theme) => chosen.includes(theme)),
          });
        } else {
          throw new Error("the generated priority answer has an unexpected form");
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 14: classification, counts, notices
  // **Validates: Requirements 4.8, 4.9, 4.12, 4.13, 4.16, 4.17, 4.19, 4.21, 12.1**
  it("equals the reference implementation and keeps the not-asked themes out of the unsure and declined lists", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = generateValuesMap(input);
        expect(result).toEqual(referenceGenerate(input));
        if (!result.ok) {
          return;
        }
        const map = result.value;
        for (const theme of map.notAskedThemes) {
          expect(map.hesitantThemes.map((entry) => entry.themeId)).not.toContain(theme);
          expect(map.declinedThemes.map((entry) => entry.themeId)).not.toContain(theme);
        }
        const selected = map.priority.state === "SELECTED" ? map.priority.themeIds : [];
        for (const theme of map.themes) {
          const conflict = map.hesitantThemes.some(
            (entry) => entry.themeId === theme.themeId && entry.reasons.includes("PICK_CONFLICT"),
          );
          const expected =
            selected.includes(theme.themeId) &&
            theme.importance.state === "DETERMINED" &&
            theme.importance.level <= -1;
          expect(conflict).toBe(expected);
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 16: errors
  // **Validates: Requirements 4.3, 4.15, 4.20, 12.1**
  it("returns the outcome of the reference decision for any input, never throws, and never returns part of a map with an error", () => {
    fc.assert(
      fc.property(anyInputArb, (input) => {
        const result = generateValuesMap(input);
        expect(result).toEqual(referenceGenerate(input));
        if (!result.ok) {
          expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
          expect(["INVALID_CONFIG", "UNKNOWN_QUESTION", "INVALID_ANSWER", "NO_OPINION_ANSWERS"]).toContain(
            result.error.code,
          );
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 16: errors (thresholds)
  // **Validates: Requirements 4.20, 12.1**
  it("returns INVALID_CONFIG for thresholds that are not integers with 0 < T1 < T2 <= 200", () => {
    fc.assert(
      fc.property(validInputArb, invalidThresholdsArb, (input, thresholds) => {
        expect(generateValuesMap({ ...input, thresholds })).toEqual({
          ok: false,
          error: { code: "INVALID_CONFIG" },
        });
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 17: the output contract
  // **Validates: Requirements 1.5, 1.6, 5.11, 12.2**
  it("satisfies the strict ValuesMap contract and has no key for a candidate, party, match, recommendation, rank, ideology or personality", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = generateValuesMap(input);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(ValuesMapSchema.safeParse(result.value).success).toBe(true);
        expect(
          keysDeep(result.value).filter((key) =>
            /^(candidate\w*|party\w*|match\w*|recommend\w*|rank\w*|order|ideology|personality)$/iu.test(key),
          ),
        ).toEqual([]);
      }),
      PARAMETERS,
    );
  });
});