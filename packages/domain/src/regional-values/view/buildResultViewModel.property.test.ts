import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AnswersSchema } from "@ehime-vote-navigator/contracts";

import { validInputArb } from "../../../../../tests/harness/regional-values/generators.js";
import { viewBundleFor } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { mapOf } from "../../../../../tests/harness/regional-values/viewDriver.js";
import { buildResultViewModel, defaultSectionOrder } from "./buildResultViewModel.js";
import type { ResultMapView } from "./viewTypes.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_048, numRuns: 120 };

const BANNED_KEYS = ["rank", "ranking", "score", "rating", "percent", "percentage", "match", "matchRate", "recommend"];
const ALLOWED_NUMBER_PATHS = [/^importance\.groups\.\d+\.level$/u, /^reflection\.rows\.\d+\.position$/u];

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  }
  return [];
}

function numberPaths(value: unknown, path: readonly string[] = []): string[] {
  if (typeof value === "number") {
    return [path.join(".")];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => numberPaths(child, [...path, String(index)]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => numberPaths(child, [...path, key]));
  }
  return [];
}

const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

/** A map view for a random valid input, with the map it was made from. */
const viewArb = validInputArb.map((input) => {
  const bundle = viewBundleFor(input.bank, input.thresholds);
  const answers = AnswersSchema.parse(input.answers);
  const current = mapOf(bundle, input.setKind, answers);
  if (!current.ok) {
    throw new Error(`a valid input made no map: ${current.error.code}`);
  }
  const view = buildResultViewModel({ bundle, setKind: input.setKind, answers, current, previous: null, focusThemeId: null });
  if (view.kind !== "MAP") {
    throw new Error("not a map view");
  }
  return { view, map: current.value };
});

describe("buildResultViewModel: sections and the four states", () => {
  // Feature: regional-values-map, Property 48: every section, and the four states apart
  // **Validates: Requirements 5.2, 5.4, 5.5, 5.15, 5.16, 5.17, 12.16**
  it("always has every section and the five groups, and an empty section says that none applies", () => {
    fc.assert(
      fc.property(viewArb, ({ view }) => {
        expect(view.sectionOrder).toEqual(defaultSectionOrder.filter((id) => id !== "diff"));
        expect(view.importance.groups.map((group) => group.level)).toEqual([2, 1, 0, -1, -2]);
        for (const group of view.importance.groups) {
          expect(group.emptyText === null).toBe(group.themes.length > 0);
        }
        expect(view.declined.columns.map((column) => column.code)).toEqual(["DECLINE", "UNANSWERED"]);
        for (const column of view.declined.columns) {
          expect(column.emptyText === null).toBe(column.themes.length > 0);
        }
        expect(view.notAsked.emptyText === null).toBe(view.notAsked.items.length > 0);
        expect(view.hesitant.emptyText === null).toBe(view.hesitant.items.length > 0);
        expect(view.tradeoff.emptyText === null).toBe(view.tradeoff.items.length > 0);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 48: every section, and the four states apart (states)
  // **Validates: Requirements 5.4, 5.5, 5.15, 5.17**
  it("keeps a theme that was not asked out of every other section, and uses a different text for each state", () => {
    fc.assert(
      fc.property(viewArb, ({ view }) => {
        const notAsked = names(view.notAsked.items);
        const elsewhere = [
          ...names(view.hesitant.items),
          ...view.declined.columns.flatMap((column) => names(column.themes)),
          ...names(view.undetermined.items),
          ...view.importance.groups.flatMap((group) => names(group.themes)),
          ...names(view.tradeoff.items),
        ];
        expect(notAsked.filter((name) => elsewhere.includes(name))).toEqual([]);
        expect(view.notAsked.items.every((item) => item.text === "〈state.NOT_ASKED〉")).toBe(true);
        const reasonTexts = view.hesitant.items.flatMap((item) => item.reasons.map((reason) => reason.text));
        expect(reasonTexts.every((text) => text === "〈reason.UNSURE〉" || text === "〈reason.PICK_CONFLICT〉")).toBe(true);
        const stateTexts = view.undetermined.items.flatMap((item) => item.reasons.map((reason) => reason.text));
        expect(stateTexts.every((text) => ["〈state.UNSURE〉", "〈state.DECLINE〉", "〈state.UNANSWERED〉"].includes(text))).toBe(true);
        const [decline, unanswered] = view.declined.columns;
        expect(new Set([decline?.heading, unanswered?.heading, view.notAsked.heading]).size).toBe(3);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 48: every section, and the four states apart (priority)
  // **Validates: Requirements 5.1, 5.16, 5.17**
  it("fills the priority theme from the priority answer only, never from the importance levels", () => {
    fc.assert(
      fc.property(viewArb, ({ view, map }) => {
        if (map.priority.state === "SELECTED") {
          expect(view.priority.state).toBe("SELECTED");
          expect(view.priority.themes).toHaveLength(map.priority.themeIds.length);
          return;
        }
        expect(view.priority.state).toBe(map.priority.state === "NOT_ASKED" ? "NOT_ASKED" : "NONE_SELECTED");
        expect(view.priority.themes).toEqual([]);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 48: every section, and the four states apart (no rank)
  // **Validates: Requirements 5.2, 12.16**
  it("has no rank, score or match key, and no number except the level of a group and the number of a question", () => {
    fc.assert(
      fc.property(viewArb, ({ view }) => {
        expect(keysOf(view).filter((key) => BANNED_KEYS.includes(key))).toEqual([]);
        const stray = numberPaths(view).filter((path) => !ALLOWED_NUMBER_PATHS.some((allowed) => allowed.test(path)));
        expect(stray).toEqual([]);
      }),
      PARAMETERS,
    );
  });
});

function bandsOf(view: ResultMapView) {
  const [plus2, plus1, zero, minus1, minus2, undetermined, notAsked] = view.importance.chart.bands;
  return { levels: [plus2, plus1, zero, minus1, minus2], undetermined, notAsked };
}

describe("buildResultViewModel: the chart and the lists", () => {
  // Feature: regional-values-map, Property 49: the chart and the lists agree
  // **Validates: Requirements 5.7, 11.5**
  it("puts the same theme names under the same words in the chart and in the lists", () => {
    fc.assert(
      fc.property(viewArb, ({ view }) => {
        const { levels, undetermined, notAsked } = bandsOf(view);
        view.importance.groups.forEach((group, index) => {
          expect(levels[index]?.heading).toBe(group.heading);
          expect(levels[index]?.chips.map((chip) => chip.name)).toEqual(names(group.themes));
        });
        expect(undetermined?.chips.map((chip) => chip.name)).toEqual(
          names(view.undetermined.items.filter((item) => item.axis === "IMPORTANCE")),
        );
        expect(notAsked?.chips.map((chip) => chip.name)).toEqual(names(view.notAsked.items));
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 49: the chart and the lists agree (badges)
  // **Validates: Requirements 5.7, 11.4, 11.5**
  it("marks a priority theme and a hesitant theme in the chart exactly as the lists do, and no theme twice", () => {
    fc.assert(
      fc.property(viewArb, ({ view }) => {
        const chips = view.importance.chart.bands.flatMap((band) => band.chips);
        const priority = names(view.priority.themes);
        const hesitant = names(view.hesitant.items);
        for (const chip of chips) {
          const codes = chip.badges.map((badge) => badge.code);
          expect(codes.includes("PRIORITY")).toBe(priority.includes(chip.name));
          expect(codes.includes("HESITANT")).toBe(hesitant.includes(chip.name));
        }
        const chipNames = chips.map((chip) => chip.name);
        expect(new Set(chipNames).size).toBe(chipNames.length);
      }),
      PARAMETERS,
    );
  });
});

it("(sanity) the generator reaches both a QUICK and a FULL diagnosis", () => {
  const seen = new Set<string>();
  fc.assert(
    fc.property(viewArb, ({ map }) => {
      seen.add(map.setKind);
    }),
    { ...PARAMETERS, numRuns: 60 },
  );
  expect([...seen].sort()).toEqual(["FULL", "QUICK"]);
});