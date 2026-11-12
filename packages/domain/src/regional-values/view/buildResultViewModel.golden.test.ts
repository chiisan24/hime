import { describe, expect, it } from "vitest";

import { GOLDEN_V15, GOLDEN_V16, GOLDEN_V18, type ViewSummary } from "../../../../../tests/harness/regional-values/goldenViews.js";
import { FULL_VIEW_BUNDLE, QUICK_VIEW_BUNDLE } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { ANSWERS_V15, ANSWERS_V16, ANSWERS_V18, mapViewOf } from "../../../../../tests/harness/regional-values/viewDriver.js";
import type { ResultMapView, RichText } from "./viewTypes.js";

const plain = (text: RichText): string => text.map((part) => part.v).join("");
const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

/** A plain projection of the view: names and words only, so that the expected values are easy to check by hand. */
function summarize(view: ResultMapView): ViewSummary {
  return {
    sectionOrder: view.sectionOrder,
    priority: [view.priority.state, names(view.priority.themes)],
    groups: view.importance.groups.map((group) => names(group.themes)),
    bands: view.importance.chart.bands.map((band) =>
      band.chips.map((chip) =>
        chip.badges.length === 0 ? chip.name : `${chip.name}[${chip.badges.map((badge) => badge.code).join(",")}]`,
      ),
    ),
    tradeoff: view.tradeoff.items.map((item) => `${item.name}|${item.importanceLabel}|${plain(item.text)}`),
    hesitant: view.hesitant.items.map((item) => `${item.name}|${item.reasons.map((reason) => reason.text).join(",")}`),
    declined: view.declined.columns.map((column) => names(column.themes)),
    undetermined: view.undetermined.items.map(
      (item) => `${item.name}|${item.axis}|${item.reasons.map((reason) => reason.code).join(",")}`,
    ),
    notAsked: names(view.notAsked.items),
    counts: [view.counts.themes, view.counts.questions],
    reflection: view.reflection.rows.map((row) => `${row.position}|${row.themeLabel}|${row.answer}`),
    guidance: view.guidance.items.map((item) => `${item.theme.name}:${item.scenes.length}`),
  };
}

describe("buildResultViewModel: golden views of the design examples", () => {
  it("V15 (design example 1): QUICK, six opinion answers", () => {
    expect(summarize(mapViewOf(QUICK_VIEW_BUNDLE, "QUICK", ANSWERS_V15))).toEqual(GOLDEN_V15);
  });

  it("V16 (design example 2): unsure, decline, unanswered and not asked at once", () => {
    expect(summarize(mapViewOf(QUICK_VIEW_BUNDLE, "QUICK", ANSWERS_V16))).toEqual(GOLDEN_V16);
  });

  it("V18 (design example 3): FULL, thirteen questions, priority HC and DP", () => {
    expect(summarize(mapViewOf(FULL_VIEW_BUNDLE, "FULL", ANSWERS_V18))).toEqual(GOLDEN_V18);
  });

  it("the frame and the empty-section texts of V15 are the approved fixed texts", () => {
    const view = mapViewOf(QUICK_VIEW_BUNDLE, "QUICK", ANSWERS_V15);
    expect(view.frame.banner.text).toBe("〈banner.FIXTURE〉");
    expect(view.hesitant.emptyText).toBe("〈empty.hesitant〉");
    expect(view.declined.columns.map((column) => column.emptyText)).toEqual([
      "〈empty.declined.DECLINE〉",
      "〈empty.declined.UNANSWERED〉",
    ]);
    expect(view.importance.groups.map((group) => group.emptyText)).toEqual([null, null, "〈empty.group〉", null, "〈empty.group〉"]);
    expect(view.notAsked.emptyText).toBeNull();
  });
});