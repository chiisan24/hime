import { describe, expect, it } from "vitest";

import { FULL_VIEW_BUNDLE, QUICK_VIEW_BUNDLE, realCardOf } from "../../../../../../tests/harness/regional-values/testViewBundle.js";
import {
  ANSWERS_V15,
  ANSWERS_V16,
  ANSWERS_V18,
  mapValue,
  mapViewOf,
} from "../../../../../../tests/harness/regional-values/viewDriver.js";
import { buildGuidance, guidanceThemeIds } from "./reflectionDiffGuidance.js";

const quick = QUICK_VIEW_BUNDLE;
const full = FULL_VIEW_BUNDLE;

const V15_CHANGED = { ...ANSWERS_V15, "q-ed-imp": "VERY_IMPORTANT" } as const;

describe("review of the answers", () => {
  it("lists the asked questions in the order of the set: theme, question, answer", () => {
    const rows = mapViewOf(quick, "QUICK", ANSWERS_V15).reflection.rows;
    expect(rows.map((row) => [row.position, row.themeLabel, row.question, row.answer])).toEqual([
      [1, "教育・子育て", "質問:q-ed-imp", "あまり大切でない"],
      [2, "教育・子育て", "質問:q-ed-tra", "同程度"],
      [3, "防災", "質問:q-dp-imp", "大切"],
      [4, "防災", "質問:q-dp-tra", "Bを強く"],
      [5, "人口減少・地域活性化", "質問:q-pr-imp", "とても大切"],
      [6, "人口減少・地域活性化", "質問:q-pr-tra", "Aをやや"],
    ]);
  });

  it("shows UNSURE, DECLINE and a missing answer in three different words", () => {
    const view = mapViewOf(quick, "QUICK", ANSWERS_V16);
    const answers = view.reflection.rows.map((row) => row.answer);
    expect(answers).toEqual(["わからない", "Aを強く", "大切", "回答しない", "〈state.UNANSWERED〉", "Bをやや"]);
    expect(new Set([answers[0], answers[3], answers[4]]).size).toBe(3);
  });

  it("shows the priority pick as theme names in the theme definition order, under a cross-theme label", () => {
    const rows = mapViewOf(full, "FULL", ANSWERS_V18).reflection.rows;
    expect(rows).toHaveLength(13);
    expect(rows[12]).toMatchObject({
      position: 13,
      themeLabel: "〈reflection.crossTheme〉",
      answer: "医療・福祉、防災",
    });
  });

  it("does not show themes or questions that were not asked", () => {
    const rows = mapViewOf(full, "QUICK", ANSWERS_V15).reflection.rows;
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.themeLabel)).not.toContain("交通");
  });

  it("marks no change when nothing was changed before", () => {
    expect(mapViewOf(quick, "QUICK", ANSWERS_V15).reflection.rows.every((row) => row.change === null)).toBe(true);
  });
});

describe("difference before and after a change", () => {
  const previous = mapValue(quick, "QUICK", ANSWERS_V15);
  const view = mapViewOf(quick, "QUICK", V15_CHANGED, previous);

  it("is absent without an earlier result, and out of the section order", () => {
    const first = mapViewOf(quick, "QUICK", ANSWERS_V15);
    expect(first.diff).toBeNull();
    expect(first.sectionOrder).not.toContain("diff");
  });

  it("is present after a change, between the review and the guidance", () => {
    const order = view.sectionOrder;
    expect(order.indexOf("diff")).toBe(order.indexOf("reflection") + 1);
    expect(order.indexOf("diff")).toBe(order.indexOf("guidance") - 1);
  });

  it("shows the wording before and after for every asked theme, and tells a change from no change in words", () => {
    const rows = view.diff?.rows ?? [];
    expect(view.diff?.heading).toBe("〈section.diff〉");
    expect(rows.map((row) => row.theme.name)).toEqual(["教育・子育て", "防災", "人口減少・地域活性化"]);
    expect(rows[0]?.importance).toEqual({
      before: "〈level.importance.-1〉",
      after: "〈level.importance.+2〉",
      changed: true,
      note: "〈diff.changed〉",
    });
    expect(rows[0]?.tradeoff).toEqual({
      before: "〈result:EDUCATION_CHILDCARE:TRADEOFF:0〉",
      after: "〈result:EDUCATION_CHILDCARE:TRADEOFF:0〉",
      changed: false,
      note: "〈diff.unchanged〉",
    });
  });

  it("has changed exactly when the wording before and after differ", () => {
    for (const row of view.diff?.rows ?? []) {
      for (const cell of [row.importance, row.tradeoff]) {
        expect(cell.changed).toBe(cell.before !== cell.after);
        expect(cell.note).toBe(cell.changed ? "〈diff.changed〉" : "〈diff.unchanged〉");
      }
    }
  });

  it("says 'cannot be decided' for an axis that became undecided", () => {
    const rows = mapViewOf(quick, "QUICK", ANSWERS_V16, previous).diff?.rows ?? [];
    expect(rows[0]?.importance).toMatchObject({ after: "〈state.UNDETERMINED〉", changed: true });
  });

  it("marks the rows of the review by whether the result of their theme changed", () => {
    const changes = view.reflection.rows.map((row) => row.change?.code);
    expect(changes).toEqual(["CHANGED", "CHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED"]);
    expect(view.reflection.rows[0]?.change?.text).toBe("〈diff.changed〉");
  });
});

describe("guidance for daily life", () => {
  it("picks the importance +2 and +1 themes, shown in the theme definition order, with the three scenes each", () => {
    const guidance = mapViewOf(quick, "QUICK", ANSWERS_V15).guidance;
    expect(guidance.heading).toBe("〈section.guidance〉");
    expect(guidance.emptyText).toBeNull();
    expect(guidance.items.map((item) => item.theme.name)).toEqual(["防災", "人口減少・地域活性化"]);
    expect(guidance.items[0]?.scenes).toEqual([
      { scene: "ELECTION", sceneLabel: "〈scene.ELECTION〉", question: "〈guidance:DISASTER_PREVENTION:ELECTION〉か", link: null },
      { scene: "MOVE_OR_JOB", sceneLabel: "〈scene.MOVE_OR_JOB〉", question: "〈guidance:DISASTER_PREVENTION:MOVE_OR_JOB〉か", link: null },
      { scene: "DAILY_LIFE", sceneLabel: "〈scene.DAILY_LIFE〉", question: "〈guidance:DISASTER_PREVENTION:DAILY_LIFE〉か", link: null },
    ]);
  });

  it("takes the priority themes first, then importance +2, up to the limit of three", () => {
    const map = mapValue(full, "FULL", ANSWERS_V18);
    expect(guidanceThemeIds(full, map)).toEqual(["EDUCATION_CHILDCARE", "HEALTHCARE_WELFARE", "DISASTER_PREVENTION"]);
  });

  it("keeps to the limit of the bundle", () => {
    const one = { ...full, mapConfig: { ...full.mapConfig, guidanceMaxThemes: 1 } };
    expect(guidanceThemeIds(one, mapValue(one, "FULL", ANSWERS_V18))).toEqual(["HEALTHCARE_WELFARE"]);
  });

  it("shows no theme and the text that says so when no theme is at +2 or +1 and none is a priority", () => {
    const answers = { "q-ed-imp": "NEUTRAL", "q-dp-imp": "NEUTRAL", "q-pr-imp": "NOT_IMPORTANT" } as const;
    const guidance = buildGuidance(quick, mapValue(quick, "QUICK", answers));
    expect(guidance.items).toEqual([]);
    expect(guidance.emptyText).toBe("〈guidance.empty〉");
  });

  it("links to an official page only for a real-data source with confirmed terms of use and a URL", () => {
    const sceneOf = (usage: "CONFIRMED" | "UNKNOWN" | "RESTRICTED", reference: "url" | "document-id", linkSourceId: string | null) => {
      const base = quick;
      const bundle = {
        ...base,
        cards: [...base.cards, realCardOf("card-real", "DISASTER_PREVENTION", { sourceId: "src-link", usage, reference })],
        guidance: base.guidance.map((entry) =>
          entry.themeId === "DISASTER_PREVENTION" && entry.scene === "ELECTION" ? { ...entry, linkSourceId } : entry,
        ),
      };
      const map = mapValue(bundle, "QUICK", ANSWERS_V15);
      const item = buildGuidance(bundle, map).items.find((candidate) => candidate.theme.name === "防災");
      return item?.scenes.find((scene) => scene.scene === "ELECTION")?.link;
    };
    expect(sceneOf("CONFIRMED", "url", "src-link")).toEqual({ href: "https://example.com/src-link", label: "試験用の公開者" });
    expect(sceneOf("UNKNOWN", "url", "src-link")).toBeNull();
    expect(sceneOf("RESTRICTED", "url", "src-link")).toBeNull();
    expect(sceneOf("CONFIRMED", "document-id", "src-link")).toBeNull();
    expect(sceneOf("CONFIRMED", "url", "src-other")).toBeNull();
    expect(sceneOf("CONFIRMED", "url", null)).toBeNull();
  });

  it("gives no link when the bundle has no real-data source (a fictional source has no URL)", () => {
    const items = mapViewOf(full, "FULL", ANSWERS_V18).guidance.items;
    expect(items.flatMap((item) => item.scenes).every((scene) => scene.link === null)).toBe(true);
  });
});