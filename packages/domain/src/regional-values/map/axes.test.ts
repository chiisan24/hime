import type { MapInput } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS } from "../../../../../tests/harness/regional-values/goldenVectors.js";
import {
  DP,
  EC,
  ED,
  HC,
  PICK_ID,
  PR,
  TB_FULL,
  TB_QUICK,
  TB_W,
  THEME_ORDER,
  TR,
  importanceId,
  mapInput,
  tradeoffId,
} from "../../../../../tests/harness/regional-values/testBanks.js";
import { computeAxes } from "./axes.js";
import { validateMapInput } from "./validateInput.js";

function axesOf(input: MapInput): ReturnType<typeof computeAxes> {
  const validated = validateMapInput(input);
  if (!validated.ok) {
    throw new Error("the test input should be valid");
  }
  return computeAxes(validated.value);
}

function vectorInput(id: string): MapInput {
  const vector = GOLDEN_VECTORS.find((candidate) => candidate.id === id);
  if (vector === undefined) {
    throw new Error(`no golden vector ${id}`);
  }
  return vector.input;
}

const det = (score: number, level: number) => ({ state: "DETERMINED", score, level });
const NOT_ASKED = { state: "NOT_ASKED" };

function axisOf(axes: ReturnType<typeof computeAxes>, theme: string, axis: "importance" | "tradeoff") {
  return axes.find((entry) => entry.themeId === theme)?.[axis];
}

describe("computeAxes: weights and non-opinion answers (V04)", () => {
  it("leaves a non-opinion answer out of the numerator and the denominator", () => {
    const axes = axesOf(vectorInput("V04"));
    // ED: q1 (w1) UNSURE, q2 (w3) IMPORTANT: n = 3, m = 3, R = floor(603 / 6) = 100.
    expect(axisOf(axes, ED, "importance")).toEqual(det(100, 1));
    // DP: q3 (w1) DECLINE, q4 (w3) IMPORTANT: the same.
    expect(axisOf(axes, DP, "importance")).toEqual(det(100, 1));
    // PR: q5 (w1) VERY_IMPORTANT, q6 (w3) has no key: n = 2, m = 1, R = 200. With q6 as 0 it would be 50.
    expect(axisOf(axes, PR, "importance")).toEqual(det(200, 2));
  });

  it("does not read the same answers as 0 points", () => {
    // If q1 counted as 0 with weight 1, ED would be R(3, 4) = floor(603 / 8) = 75.
    expect(axisOf(axesOf(vectorInput("V04")), ED, "importance")).not.toEqual(det(75, 1));
  });
});

describe("computeAxes: weighted averages (V05 to V08)", () => {
  it.each([
    ["V05", TR, 125, 1],
    ["V06", EC, -33, 0],
    ["V07", HC, 13, 0],
    ["V08", HC, -12, 0],
  ])("%s", (id, theme, score, level) => {
    expect(axisOf(axesOf(vectorInput(id)), theme, "importance")).toEqual(det(score, level));
  });
});

describe("computeAxes: design example 1 (V15)", () => {
  it("gives every score and level", () => {
    const axes = axesOf(vectorInput("V15"));
    expect(axisOf(axes, ED, "importance")).toEqual(det(-100, -1));
    expect(axisOf(axes, ED, "tradeoff")).toEqual(det(0, 0));
    expect(axisOf(axes, DP, "importance")).toEqual(det(100, 1));
    expect(axisOf(axes, DP, "tradeoff")).toEqual(det(-200, -2));
    expect(axisOf(axes, PR, "importance")).toEqual(det(200, 2));
    expect(axisOf(axes, PR, "tradeoff")).toEqual(det(100, 1));
  });

  it("keeps a theme with no question in the set as NOT_ASKED on both axes", () => {
    const axes = axesOf(vectorInput("V15"));
    for (const theme of [TR, EC, HC]) {
      expect(axisOf(axes, theme, "importance")).toEqual(NOT_ASKED);
      expect(axisOf(axes, theme, "tradeoff")).toEqual(NOT_ASKED);
    }
  });

  it("lists the six themes in theme definition order", () => {
    expect(axesOf(vectorInput("V15")).map((entry) => entry.themeId)).toEqual([...THEME_ORDER]);
  });
});

describe("computeAxes: undetermined axes", () => {
  const withReasons = (answers: Record<string, unknown>, setKind: "QUICK" | "FULL" = "QUICK") =>
    axesOf(mapInput(TB_W, setKind, { q5: "IMPORTANT", ...answers }));

  it("is UNDETERMINED, with no score, when every question of the axis has a non-opinion answer", () => {
    const axes = axesOf(mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "UNSURE", [tradeoffId(ED)]: "A_STRONG" }));
    expect(axisOf(axes, ED, "importance")).toEqual({ state: "UNDETERMINED", reasons: ["UNSURE"] });
    expect(axisOf(axes, ED, "tradeoff")).toEqual(det(200, 2));
  });

  it("lists the reasons in the order UNSURE, DECLINE, UNANSWERED without repeats", () => {
    expect(axisOf(withReasons({ q1: "DECLINE", q2: "UNSURE" }), ED, "importance")).toEqual({
      state: "UNDETERMINED",
      reasons: ["UNSURE", "DECLINE"],
    });
    expect(axisOf(withReasons({ q1: "UNANSWERED", q2: "DECLINE" }), ED, "importance")).toEqual({
      state: "UNDETERMINED",
      reasons: ["DECLINE", "UNANSWERED"],
    });
    expect(axisOf(withReasons({ q2: "UNSURE" }), ED, "importance")).toEqual({
      state: "UNDETERMINED",
      reasons: ["UNSURE", "UNANSWERED"],
    });
    expect(axisOf(withReasons({ q1: "UNSURE", q2: "UNSURE" }), ED, "importance")).toEqual({
      state: "UNDETERMINED",
      reasons: ["UNSURE"],
    });
    expect(
      axisOf(withReasons({ "hc-w3a": "UNSURE", "hc-w3b": "DECLINE" }, "FULL"), HC, "importance"),
    ).toEqual({ state: "UNDETERMINED", reasons: ["UNSURE", "DECLINE", "UNANSWERED"] });
  });

  it("is not a score of 0: a neutral answer is a score and UNSURE is not", () => {
    const neutral = axisOf(
      axesOf(mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "NEUTRAL", [importanceId(DP)]: "UNSURE" })),
      ED,
      "importance",
    );
    expect(neutral).toEqual(det(0, 0));
    const unsure = axisOf(
      axesOf(mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "NEUTRAL", [importanceId(DP)]: "UNSURE" })),
      DP,
      "importance",
    );
    expect(unsure).toEqual({ state: "UNDETERMINED", reasons: ["UNSURE"] });
  });
});

describe("computeAxes: importance and trade-off are independent", () => {
  const importanceCodes = ["VERY_IMPORTANT", "IMPORTANT", "NEUTRAL", "NOT_VERY_IMPORTANT", "NOT_IMPORTANT"];
  const tradeoffCodes = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG"];
  const anchor = { [importanceId(ED)]: "IMPORTANT", [tradeoffId(ED)]: "A_LEAN" };

  it("does not move the importance axis when only trade-off answers change", () => {
    const base = axisOf(axesOf(mapInput(TB_QUICK, "QUICK", anchor)), ED, "importance");
    for (const code of [...tradeoffCodes, "UNSURE", "DECLINE"]) {
      const axes = axesOf(mapInput(TB_QUICK, "QUICK", { ...anchor, [tradeoffId(ED)]: code }));
      expect(axisOf(axes, ED, "importance")).toEqual(base);
    }
  });

  it("does not move the trade-off axis when only importance answers change", () => {
    const base = axisOf(axesOf(mapInput(TB_QUICK, "QUICK", anchor)), ED, "tradeoff");
    for (const code of [...importanceCodes, "UNSURE", "DECLINE"]) {
      const axes = axesOf(mapInput(TB_QUICK, "QUICK", { ...anchor, [importanceId(ED)]: code, [importanceId(DP)]: "IMPORTANT" }));
      expect(axisOf(axes, ED, "tradeoff")).toEqual(base);
    }
  });

  it("does not use the priority-theme answer in any axis", () => {
    const answers = { [importanceId(ED)]: "IMPORTANT", [tradeoffId(ED)]: "A_LEAN" };
    const base = axesOf(mapInput(TB_FULL, "FULL", answers));
    for (const pick of [{ pick: [ED] }, { pick: [TR, PR] }, "UNSURE", "DECLINE", "UNANSWERED"]) {
      expect(axesOf(mapInput(TB_FULL, "FULL", { ...answers, [PICK_ID]: pick }))).toEqual(base);
    }
  });

  it("shows an importance of -2 and a trade-off of +2 together for one theme", () => {
    const axes = axesOf(vectorInput("V18"));
    expect(axisOf(axes, HC, "importance")).toEqual(det(-200, -2));
    expect(axisOf(axes, HC, "tradeoff")).toEqual(det(200, 2));
  });
});

describe("computeAxes: theme definition order and thresholds", () => {
  it("follows a different theme definition order, with the same scores for each theme", () => {
    const input = vectorInput("V18");
    const reversed: MapInput = { ...input, bank: { ...input.bank, themeOrder: [...THEME_ORDER].reverse() } };
    const forward = axesOf(input);
    const backward = axesOf(reversed);
    expect(backward.map((entry) => entry.themeId)).toEqual([...THEME_ORDER].reverse());
    expect([...backward].reverse()).toEqual(forward);
  });

  it("applies the thresholds to the level and not to the score", () => {
    const input = mapInput(TB_QUICK, "QUICK", { [importanceId(ED)]: "IMPORTANT" });
    const strict = axesOf({ ...input, thresholds: { t1: 120, t2: 150 } });
    const initial = axesOf(input);
    expect(axisOf(strict, ED, "importance")).toEqual(det(100, 0));
    expect(axisOf(initial, ED, "importance")).toEqual(det(100, 1));
  });
});