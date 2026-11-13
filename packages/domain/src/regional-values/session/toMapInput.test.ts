import type { Answers } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS } from "../../../../../tests/harness/regional-values/goldenVectors.js";
import { TB_FULL, TB_QUICK } from "../../../../../tests/harness/regional-values/testBanks.js";
import { FULL_BUNDLE, QUICK_BUNDLE, sessionBundleFor } from "../../../../../tests/harness/regional-values/testBundle.js";
import { generateValuesMap } from "../map/generateValuesMap.js";
import { toMapInput } from "./toMapInput.js";

describe("toMapInput", () => {
  it("passes only the ID, kind, theme and weight of a question, and the thresholds", () => {
    const input = toMapInput(FULL_BUNDLE, "FULL", {});
    expect(Object.keys(input).sort()).toEqual(["answers", "bank", "setKind", "thresholds"]);
    expect(Object.keys(input.bank).sort()).toEqual(["questions", "sets", "themeOrder"]);
    for (const question of input.bank.questions) {
      expect(Object.keys(question).sort()).toEqual(["kind", "questionId", "themeId", "weight"]);
    }
    expect(input.thresholds).toEqual({ t1: 50, t2: 150 });
    expect(input.bank.questions.find((question) => question.kind === "PRIORITY_PICK")?.themeId).toBeNull();
  });

  it("is the same whatever the issue cards of the bundle are", () => {
    const withOtherCards = sessionBundleFor(TB_FULL, { t1: 50, t2: 150 }, ["x-1", "x-2", "x-3"]);
    expect(toMapInput(withOtherCards, "FULL", {})).toEqual(toMapInput(FULL_BUNDLE, "FULL", {}));
  });

  it("takes the thresholds from the bundle", () => {
    const wide = sessionBundleFor(TB_QUICK, { t1: 100, t2: 200 });
    expect(toMapInput(wide, "QUICK", {}).thresholds).toEqual({ t1: 100, t2: 200 });
  });

  it("copies the answers and does not change the bundle", () => {
    const answers: Answers = { "q-ed-imp": "IMPORTANT" };
    const input = toMapInput(QUICK_BUNDLE, "QUICK", answers);
    expect(input.answers).toEqual(answers);
    expect(input.answers).not.toBe(answers);
    input.bank.questions.length = 0;
    expect(QUICK_BUNDLE.questions.length).toBe(6);
  });

  it("gives the golden map of V15 when the answers of that vector are used", () => {
    const answers: Answers = {
      "q-ed-imp": "NOT_VERY_IMPORTANT",
      "q-ed-tra": "BALANCED",
      "q-dp-imp": "IMPORTANT",
      "q-dp-tra": "B_STRONG",
      "q-pr-imp": "VERY_IMPORTANT",
      "q-pr-tra": "A_LEAN",
    };
    const v15 = GOLDEN_VECTORS.find((vector) => vector.id === "V15");
    expect(v15).toBeDefined();
    expect(generateValuesMap(toMapInput(QUICK_BUNDLE, "QUICK", answers))).toEqual(v15?.expected);
  });
});