import type { MapInput } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  GOLDEN_VECTORS,
  V13_ACCEPTED_THRESHOLDS,
  type GoldenVector,
} from "../../../../../tests/harness/regional-values/goldenVectors.js";
import {
  ED,
  TB_QUICK,
  importanceId,
  mapInput,
} from "../../../../../tests/harness/regional-values/testBanks.js";
import { generateValuesMap } from "./generateValuesMap.js";

/**
 * The golden vectors V01 to V18 of the design (Req 12.1). The expected values are
 * hand-computed fixed values (see goldenVectors.ts for the formulas); none of
 * them is produced by this code.
 */

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

const vectors: [string, GoldenVector][] = GOLDEN_VECTORS.map((vector): [string, GoldenVector] => [
  vector.id,
  vector,
]);

describe("generateValuesMap: golden vectors", () => {
  it.each(vectors)("%s gives the hand-computed output", (_id, vector) => {
    expect(generateValuesMap(vector.input)).toEqual(vector.expected);
  });

  it("covers V01 to V18", () => {
    const ids = new Set(GOLDEN_VECTORS.map((vector) => vector.id.replace(/[a-z].*$|-.*$/u, "")));
    for (let number = 1; number <= 18; number += 1) {
      expect(ids.has(`V${String(number).padStart(2, "0")}`)).toBe(true);
    }
  });

  it.each(V13_ACCEPTED_THRESHOLDS)(
    "V13: the thresholds ($t1, $t2) are accepted and set the level of score 100 to $level",
    ({ t1, t2, level }) => {
      const result = generateValuesMap(
        mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "IMPORTANT" }, { t1, t2 }),
      );
      expect(result.ok).toBe(true);
      const ed = result.ok ? result.value.themes.find((theme) => theme.themeId === ED) : undefined;
      expect(ed?.importance).toEqual({ state: "DETERMINED", score: 100, level });
    },
  );
});

describe("generateValuesMap: behaviour that every vector must keep", () => {
  it.each(vectors)("%s does not change a frozen input", (_id, vector) => {
    const before = JSON.stringify(vector.input);
    const frozen: MapInput = deepFreeze(JSON.parse(before));
    const result = generateValuesMap(frozen);
    expect(result.ok).toBe(vector.expected.ok);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it.each(vectors)("%s gives the same output twice", (_id, vector) => {
    expect(generateValuesMap(vector.input)).toEqual(generateValuesMap(vector.input));
  });

  it.each(vectors)("%s returns no part of a map with an error", (_id, vector) => {
    const result = generateValuesMap(vector.input);
    if (!result.ok) {
      expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
      expect(JSON.stringify(result)).not.toMatch(/"themes"|"importanceGroups"|"counts"/u);
    }
  });

  it.each(vectors)("%s has no key that could carry a rank or a candidate", (_id, vector) => {
    const result = generateValuesMap(vector.input);
    if (result.ok) {
      expect(JSON.stringify(result.value)).not.toMatch(
        /"(rank|ranking|order|candidate\w*|party\w*|match\w*|recommend\w*|ideology|personality)"/iu,
      );
    }
  });
});