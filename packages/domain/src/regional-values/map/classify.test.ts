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
  THEME_ORDER,
  TR,
  importanceId,
  mapInput,
  tradeoffId,
} from "../../../../../tests/harness/regional-values/testBanks.js";
import { computeAxes } from "./axes.js";
import { classify, type Classification } from "./classify.js";
import { validateMapInput } from "./validateInput.js";

function classified(input: MapInput): Classification {
  const validated = validateMapInput(input);
  if (!validated.ok) {
    throw new Error("the test input should be valid");
  }
  return classify(validated.value, computeAxes(validated.value));
}

function vectorInput(id: string): MapInput {
  const vector = GOLDEN_VECTORS.find((candidate) => candidate.id === id);
  if (vector === undefined) {
    throw new Error(`no golden vector ${id}`);
  }
  return vector.input;
}

function groupsOf(result: Classification): Record<number, string[]> {
  return Object.fromEntries(result.importanceGroups.map((group) => [group.level, group.themeIds]));
}

/** Every theme IMPORTANT and BALANCED, so that nothing but the given overrides differs. */
function fullAnswers(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      THEME_ORDER.flatMap((theme): [string, unknown][] => [
        [importanceId(theme), "IMPORTANT"],
        [tradeoffId(theme), "BALANCED"],
      ]),
    ),
    [PICK_ID]: { pick: [TR] },
    ...overrides,
  };
}

const full = (overrides: Record<string, unknown>): MapInput => mapInput(TB_FULL, "FULL", fullAnswers(overrides));

describe("classify: the design examples", () => {
  it("example 1 (V15): groups, priority, not-asked themes, counts, notices", () => {
    const result = classified(vectorInput("V15"));
    expect(groupsOf(result)).toEqual({ 2: [PR], 1: [DP], 0: [], [-1]: [ED], [-2]: [] });
    expect(result.priority).toEqual({ state: "NOT_ASKED" });
    expect(result.notAskedThemes).toEqual([TR, EC, HC]);
    expect(result.hesitantThemes).toEqual([]);
    expect(result.declinedThemes).toEqual([]);
    expect(result.excludedQuestions).toEqual([]);
    expect(result.counts).toEqual({ askedThemes: 3, totalThemes: 6, usableQuestions: 6, askedQuestions: 6 });
    expect(result.notices).toEqual({ noThemeDifference: false, equalLevelGroupExists: false });
  });

  it("example 2 (V16): the four states are separate fields with separate reasons", () => {
    const result = classified(vectorInput("V16"));
    expect(groupsOf(result)).toEqual({ 2: [], 1: [DP], 0: [], [-1]: [], [-2]: [] });
    expect(result.hesitantThemes).toEqual([{ themeId: ED, reasons: ["UNSURE"] }]);
    expect(result.declinedThemes).toEqual([
      { themeId: DP, reasons: ["DECLINE"] },
      { themeId: PR, reasons: ["UNANSWERED"] },
    ]);
    expect(result.notAskedThemes).toEqual([TR, EC, HC]);
    expect(result.excludedQuestions).toEqual([
      { questionId: importanceId(ED), reason: "UNSURE" },
      { questionId: tradeoffId(DP), reason: "DECLINE" },
      { questionId: importanceId(PR), reason: "UNANSWERED" },
    ]);
    expect(result.counts).toEqual({ askedThemes: 3, totalThemes: 6, usableQuestions: 3, askedQuestions: 6 });
    expect(result.notices).toEqual({ noThemeDifference: false, equalLevelGroupExists: false });
  });

  it("example 3 (V18): FULL, priority HC and DP, a conflict for HC", () => {
    const result = classified(vectorInput("V18"));
    expect(groupsOf(result)).toEqual({ 2: [ED, DP], 1: [TR, PR], 0: [EC], [-1]: [], [-2]: [HC] });
    expect(result.priority).toEqual({ state: "SELECTED", themeIds: [HC, DP] });
    expect(result.hesitantThemes).toEqual([{ themeId: HC, reasons: ["PICK_CONFLICT"] }]);
    expect(result.declinedThemes).toEqual([{ themeId: PR, reasons: ["DECLINE"] }]);
    expect(result.notAskedThemes).toEqual([]);
    expect(result.excludedQuestions).toEqual([{ questionId: tradeoffId(PR), reason: "DECLINE" }]);
    expect(result.counts).toEqual({ askedThemes: 6, totalThemes: 6, usableQuestions: 12, askedQuestions: 13 });
    expect(result.notices).toEqual({ noThemeDifference: false, equalLevelGroupExists: true });
  });
});

describe("classify: priority themes", () => {
  it("is NOT_ASKED for the QUICK set whatever the importance levels are (never filled in)", () => {
    const allTop = mapInput(TB_QUICK, "QUICK", {
      [importanceId(ED)]: "VERY_IMPORTANT",
      [importanceId(DP)]: "VERY_IMPORTANT",
      [importanceId(PR)]: "VERY_IMPORTANT",
    });
    expect(classified(allTop).priority).toEqual({ state: "NOT_ASKED" });
    expect(classified(vectorInput("V15")).priority).toEqual({ state: "NOT_ASKED" });
  });

  it("lists the selected themes in theme definition order, not in the order of the answer", () => {
    const result = classified(full({ [PICK_ID]: { pick: [PR, ED] } }));
    expect(result.priority).toEqual({ state: "SELECTED", themeIds: [ED, PR] });
  });

  it.each(["UNSURE", "DECLINE", "UNANSWERED"])("%s is its own state with no theme", (code) => {
    expect(classified(full({ [PICK_ID]: code })).priority).toEqual({ state: code });
  });

  it("is UNANSWERED when the key is missing", () => {
    const answers = fullAnswers({});
    delete answers[PICK_ID];
    expect(classified(mapInput(TB_FULL, "FULL", answers)).priority).toEqual({ state: "UNANSWERED" });
  });

  it("puts a non-opinion priority answer into the excluded questions and nowhere else (V11)", () => {
    const unsure = classified(vectorInput("V11a"));
    const selected = classified(vectorInput("V11b"));
    expect(unsure.excludedQuestions).toEqual([{ questionId: PICK_ID, reason: "UNSURE" }]);
    expect(unsure.hesitantThemes).toEqual([]);
    expect(unsure.declinedThemes).toEqual([]);
    expect(unsure.counts).toEqual({ askedThemes: 6, totalThemes: 6, usableQuestions: 12, askedQuestions: 13 });
    expect(selected.excludedQuestions).toEqual([]);
    expect(selected.counts).toEqual({ askedThemes: 6, totalThemes: 6, usableQuestions: 13, askedQuestions: 13 });
    expect(groupsOf(unsure)).toEqual(groupsOf(selected));
  });
});

describe("classify: PICK_CONFLICT (V10)", () => {
  it("is added at level -1, not at level 0", () => {
    const result = classified(vectorInput("V10"));
    expect(result.priority).toEqual({ state: "SELECTED", themeIds: [TR, EC] });
    expect(result.hesitantThemes).toEqual([{ themeId: EC, reasons: ["PICK_CONFLICT"] }]);
  });

  it("is added at level -2 and not at level +1", () => {
    const low = classified(full({ [PICK_ID]: { pick: [HC] }, [importanceId(HC)]: "NOT_IMPORTANT" }));
    expect(low.hesitantThemes).toEqual([{ themeId: HC, reasons: ["PICK_CONFLICT"] }]);
    const high = classified(full({ [PICK_ID]: { pick: [HC] } }));
    expect(high.hesitantThemes).toEqual([]);
  });

  it("is not added for a low-importance theme that was not selected", () => {
    const result = classified(full({ [importanceId(HC)]: "NOT_IMPORTANT" }));
    expect(result.hesitantThemes).toEqual([]);
  });

  it("is not added when the importance of the selected theme is undetermined", () => {
    const result = classified(full({ [PICK_ID]: { pick: [HC] }, [importanceId(HC)]: "DECLINE" }));
    expect(result.hesitantThemes).toEqual([]);
    expect(result.declinedThemes).toEqual([{ themeId: HC, reasons: ["DECLINE"] }]);
  });

  it("lists UNSURE before PICK_CONFLICT", () => {
    const result = classified(
      full({ [PICK_ID]: { pick: [HC] }, [importanceId(HC)]: "NOT_IMPORTANT", [tradeoffId(HC)]: "UNSURE" }),
    );
    expect(result.hesitantThemes).toEqual([{ themeId: HC, reasons: ["UNSURE", "PICK_CONFLICT"] }]);
  });
});

describe("classify: unsure, declined and not asked stay apart", () => {
  it("keeps a theme with UNSURE and DECLINE out of the declined themes", () => {
    const result = classified(full({ [importanceId(ED)]: "UNSURE", [tradeoffId(ED)]: "DECLINE" }));
    expect(result.hesitantThemes).toEqual([{ themeId: ED, reasons: ["UNSURE"] }]);
    expect(result.declinedThemes).toEqual([]);
  });

  it("lists DECLINE before UNANSWERED", () => {
    const answers = fullAnswers({ [importanceId(ED)]: "DECLINE" });
    delete answers[tradeoffId(ED)];
    const result = classified(mapInput(TB_FULL, "FULL", answers));
    expect(result.declinedThemes).toEqual([{ themeId: ED, reasons: ["DECLINE", "UNANSWERED"] }]);
  });

  it("can list a theme as both hesitant (PICK_CONFLICT) and declined (DECLINE)", () => {
    const result = classified(
      full({ [PICK_ID]: { pick: [HC] }, [importanceId(HC)]: "NOT_IMPORTANT", [tradeoffId(HC)]: "DECLINE" }),
    );
    expect(result.hesitantThemes).toEqual([{ themeId: HC, reasons: ["PICK_CONFLICT"] }]);
    expect(result.declinedThemes).toEqual([{ themeId: HC, reasons: ["DECLINE"] }]);
  });

  it("never lists a theme that was not asked as hesitant or declined", () => {
    const result = classified(vectorInput("V16"));
    for (const theme of result.notAskedThemes) {
      expect(result.hesitantThemes.map((entry) => entry.themeId)).not.toContain(theme);
      expect(result.declinedThemes.map((entry) => entry.themeId)).not.toContain(theme);
    }
  });

  it("lists the excluded questions in the bank's definition order, not the order of the answers", () => {
    const answers = {
      [tradeoffId(PR)]: "DECLINE",
      [importanceId(PR)]: "UNSURE",
      [tradeoffId(ED)]: "A_LEAN",
      [tradeoffId(DP)]: "UNSURE",
    };
    const result = classified(mapInput(TB_QUICK, "QUICK", answers));
    expect(result.excludedQuestions.map((entry) => entry.questionId)).toEqual([
      importanceId(ED),
      importanceId(DP),
      tradeoffId(DP),
      importanceId(PR),
      tradeoffId(PR),
    ]);
  });
});

describe("classify: importance groups", () => {
  it("always returns the five groups, +2 down to -2", () => {
    expect(classified(vectorInput("V15")).importanceGroups.map((group) => group.level)).toEqual([2, 1, 0, -1, -2]);
  });

  it("places a theme by its importance axis alone (V14)", () => {
    const result = classified(vectorInput("V14"));
    expect(groupsOf(result)).toEqual({ 2: [EC, HC], 1: [PR], 0: [TR, ED], [-1]: [], [-2]: [DP] });
  });

  it("leaves a theme with an undetermined importance in no group, even if its trade-off is determined", () => {
    const result = classified(vectorInput("V16"));
    const grouped = result.importanceGroups.flatMap((group) => group.themeIds);
    expect(grouped).toEqual([DP]);
  });

  it("follows another theme definition order in every list", () => {
    const input = vectorInput("V01");
    const reversed: MapInput = { ...input, bank: { ...input.bank, themeOrder: [...THEME_ORDER].reverse() } };
    expect(groupsOf(classified(reversed))[2]).toEqual([...THEME_ORDER].reverse());
  });
});

describe("classify: notices", () => {
  it("noThemeDifference needs two or more determined themes, all at one level (V01)", () => {
    expect(classified(vectorInput("V01")).notices).toEqual({ noThemeDifference: true, equalLevelGroupExists: true });
    const single = classified(vectorInput("V05"));
    expect(single.notices).toEqual({ noThemeDifference: false, equalLevelGroupExists: false });
  });

  it("equalLevelGroupExists is true when two themes share a level and others differ (V02)", () => {
    expect(classified(vectorInput("V02")).notices).toEqual({ noThemeDifference: false, equalLevelGroupExists: true });
  });
});

describe("classify: no rank", () => {
  it("has no key that carries a rank or an order value", () => {
    const text = JSON.stringify(classified(vectorInput("V18")));
    expect(text).not.toMatch(/"(rank|ranking|order|position|place)"/iu);
  });
});