import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS, V13_ACCEPTED_THRESHOLDS } from "./goldenVectors.js";
import { referenceGenerate } from "./referenceMap.js";
import { TB_QUICK, ED, importanceId, mapInput } from "./testBanks.js";

describe("reference map generation", () => {
  it.each(GOLDEN_VECTORS.map((vector) => [vector.id, vector] as const))(
    "reproduces the hand-computed output of %s",
    (_id, vector) => {
      expect(referenceGenerate(vector.input)).toEqual(vector.expected);
    },
  );

  it.each(V13_ACCEPTED_THRESHOLDS)("accepts the thresholds ($t1, $t2) of V13", ({ t1, t2, level }) => {
    const outcome = referenceGenerate(
      mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "IMPORTANT" }, { t1, t2 }),
    );
    expect(outcome.ok).toBe(true);
    const ed = outcome.ok ? outcome.value.themes.find((theme) => theme.themeId === ED) : undefined;
    expect(ed?.importance).toEqual({ state: "DETERMINED", score: 100, level });
  });

  it("returns the same outcome for the same input and leaves the input unchanged", () => {
    const input = GOLDEN_VECTORS.find((vector) => vector.id === "V18")?.input;
    expect(input).toBeDefined();
    if (input === undefined) {
      return;
    }
    const before = JSON.stringify(input);
    const first = referenceGenerate(input);
    expect(referenceGenerate(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
  });
});