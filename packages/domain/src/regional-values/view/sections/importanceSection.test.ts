import { describe, expect, it } from "vitest";

import {
  FULL_VIEW_BUNDLE,
  QUICK_VIEW_BUNDLE,
  syntheticResultText,
} from "../../../../../../tests/harness/regional-values/testViewBundle.js";
import {
  ANSWERS_V15,
  ANSWERS_V16,
  ANSWERS_V18,
  mapValue,
  mapViewOf,
} from "../../../../../../tests/harness/regional-values/viewDriver.js";
import { buildExplainer, buildImportance, buildNotice, buildPriority } from "./importanceSection.js";

const quick = QUICK_VIEW_BUNDLE;
const full = FULL_VIEW_BUNDLE;

const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

describe("notice and explanation", () => {
  const view = mapViewOf(quick, "QUICK", ANSWERS_V15);

  it("shows the approved notice as one text", () => {
    expect(buildNotice(quick)).toBe("〈notice〉");
    expect(view.notice).toBe("〈notice〉");
  });

  it("explains the three things in order, each with its own heading and body", () => {
    expect(buildExplainer(quick)).toEqual({
      heading: "〈section.explainer〉",
      items: [
        { code: "STAGE_MEANING", heading: "〈explainer.STAGE_MEANING.heading〉", body: ["〈explainer.STAGE_MEANING.body〉"] },
        { code: "GROUP_READING", heading: "〈explainer.GROUP_READING.heading〉", body: ["〈explainer.GROUP_READING.body〉"] },
        {
          code: "HESITANT_MEANING",
          heading: "〈explainer.HESITANT_MEANING.heading〉",
          body: ["〈explainer.HESITANT_MEANING.body〉"],
        },
      ],
    });
  });

  it("puts the notice above the priority theme, and the priority theme before the importance groups", () => {
    const order = view.sectionOrder;
    expect(order.indexOf("notice")).toBeLessThan(order.indexOf("priority"));
    expect(order.indexOf("priority")).toBeLessThan(order.indexOf("importance"));
  });
});

describe("priority theme", () => {
  it("QUICK asks no priority theme: it says so and does not fill one in from the importance levels", () => {
    const map = mapValue(quick, "QUICK", ANSWERS_V15);
    expect(map.importanceGroups.find((group) => group.level === 2)?.themeIds).toEqual(["POPULATION_REVITALIZATION"]);
    expect(buildPriority(quick, map)).toEqual({
      heading: "〈section.priority〉",
      state: "NOT_ASKED",
      text: "〈priority.NOT_ASKED〉",
      themes: [],
    });
  });

  it("FULL with a pick: the chosen themes in the theme definition order", () => {
    const priority = buildPriority(full, mapValue(full, "FULL", ANSWERS_V18));
    expect(priority.state).toBe("SELECTED");
    expect(priority.text).toBe("〈priority.SELECTED〉");
    expect(names(priority.themes)).toEqual(["医療・福祉", "防災"]);
  });

  it.each(["UNSURE", "DECLINE"] as const)("FULL with the pick answered %s: none selected, and the text says so", (value) => {
    const priority = buildPriority(full, mapValue(full, "FULL", { ...ANSWERS_V18, "q-pick": value }));
    expect(priority).toMatchObject({ state: "NONE_SELECTED", text: "〈priority.NONE_SELECTED〉", themes: [] });
  });

  it("FULL with the pick unanswered: none selected as well", () => {
    const withoutPick = Object.fromEntries(Object.entries(ANSWERS_V18).filter(([id]) => id !== "q-pick"));
    const priority = buildPriority(full, mapValue(full, "FULL", withoutPick));
    expect(priority.state).toBe("NONE_SELECTED");
  });

  it("keeps NOT_ASKED and NONE_SELECTED apart", () => {
    const asked = buildPriority(full, mapValue(full, "FULL", { ...ANSWERS_V18, "q-pick": "DECLINE" }));
    const notAsked = buildPriority(quick, mapValue(quick, "QUICK", ANSWERS_V15));
    expect(asked.text).not.toBe(notAsked.text);
  });
});

describe("importance groups", () => {
  const map = mapValue(quick, "QUICK", ANSWERS_V15);
  const importance = buildImportance(quick, map);

  it("always has the five groups, +2 down to -2, each with its heading", () => {
    expect(importance.groups.map((group) => group.level)).toEqual([2, 1, 0, -1, -2]);
    expect(importance.groups.map((group) => group.heading)).toEqual([
      "〈level.importance.+2〉",
      "〈level.importance.+1〉",
      "〈level.importance.0〉",
      "〈level.importance.-1〉",
      "〈level.importance.-2〉",
    ]);
  });

  it("lists each theme at its level, with the result text of that level", () => {
    expect(importance.groups.map((group) => names(group.themes))).toEqual([
      ["人口減少・地域活性化"],
      ["防災"],
      [],
      ["教育・子育て"],
      [],
    ]);
    expect(importance.groups[0]?.themes[0]?.explanation).toEqual([
      { t: "text", v: syntheticResultText("POPULATION_REVITALIZATION", "IMPORTANCE", 2) },
    ]);
  });

  it("shows the heading of a group with no theme, with the text that says none applies", () => {
    const empty = importance.groups.filter((group) => group.themes.length === 0);
    expect(empty.map((group) => group.level)).toEqual([0, -2]);
    expect(empty.every((group) => group.emptyText === "〈empty.group〉")).toBe(true);
    expect(importance.groups.filter((group) => group.themes.length > 0).every((group) => group.emptyText === null)).toBe(true);
  });

  it("notes the case where no theme differs, and the case where two groups share a level, only when they apply", () => {
    expect(importance.noThemeDifference).toBeNull();
    const same = buildImportance(
      quick,
      mapValue(quick, "QUICK", {
        "q-ed-imp": "IMPORTANT",
        "q-dp-imp": "IMPORTANT",
        "q-pr-imp": "IMPORTANT",
      }),
    );
    expect(same.noThemeDifference).toBe("〈note.noThemeDifference〉");
    const v18 = buildImportance(full, mapValue(full, "FULL", ANSWERS_V18));
    expect(v18.equalLevelNote).toBe("〈note.equalLevel〉");
    expect(v18.noThemeDifference).toBeNull();
  });
});

describe("importance chart", () => {
  it("has seven bands in order: the five levels, the themes without a level, the themes not asked", () => {
    const chart = buildImportance(quick, mapValue(quick, "QUICK", ANSWERS_V15)).chart;
    expect(chart.heading).toBe("〈section.chart〉");
    expect(chart.bands.map((band) => band.id)).toEqual([
      "level:+2",
      "level:+1",
      "level:0",
      "level:-1",
      "level:-2",
      "undetermined",
      "notAsked",
    ]);
    expect(chart.bands[5]?.heading).toBe("〈chart.undetermined〉");
    expect(chart.bands[6]?.heading).toBe("〈chart.notAsked〉");
  });

  it("puts the themes in the same bands as the lists, and the themes not asked apart", () => {
    const bands = buildImportance(quick, mapValue(quick, "QUICK", ANSWERS_V15)).chart.bands;
    expect(bands.map((band) => band.chips.map((chip) => chip.name))).toEqual([
      ["人口減少・地域活性化"],
      ["防災"],
      [],
      ["教育・子育て"],
      [],
      [],
      ["交通", "経済・雇用", "医療・福祉"],
    ]);
  });

  it("separates the themes without a level (unsure, declined, unanswered) from the themes not asked", () => {
    const bands = buildImportance(quick, mapValue(quick, "QUICK", ANSWERS_V16)).chart.bands;
    expect(bands[5]?.chips.map((chip) => chip.name)).toEqual(["教育・子育て", "人口減少・地域活性化"]);
    expect(bands[6]?.chips.map((chip) => chip.name)).toEqual(["交通", "経済・雇用", "医療・福祉"]);
  });

  it("marks a priority theme and a hesitant theme with words, not with colour", () => {
    const bands = buildImportance(full, mapValue(full, "FULL", ANSWERS_V18)).chart.bands;
    const chips = bands.flatMap((band) => band.chips);
    const badgesOf = (name: string) => chips.find((chip) => chip.name === name)?.badges.map((badge) => badge.code);
    expect(badgesOf("医療・福祉")).toEqual(["PRIORITY", "HESITANT"]);
    expect(badgesOf("防災")).toEqual(["PRIORITY"]);
    expect(badgesOf("教育・子育て")).toEqual([]);
    expect(chips.find((chip) => chip.name === "防災")?.badges[0]?.text).toBe("〈badge.priority〉");
  });

  it("marks a hesitant theme in a diagnosis without a priority pick", () => {
    const chips = buildImportance(quick, mapValue(quick, "QUICK", ANSWERS_V16)).chart.bands.flatMap((band) => band.chips);
    expect(chips.find((chip) => chip.name === "教育・子育て")?.badges.map((badge) => badge.code)).toEqual(["HESITANT"]);
  });
});