import type { Level, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import { entryOf, inThemeOrder, levelKey, resultTextOf, say, themeRef } from "../support.js";
import type { ChartBand, Entry, JaText, ResultMapView, ViewBundle } from "../viewTypes.js";

/**
 * The notice, the explanation, the priority theme and the importance groups with
 * their chart. No rank or number of a theme is output. The priority theme comes from
 * the answer to the priority-theme question only, never from the importance levels.
 */

export function buildNotice(bundle: ViewBundle): JaText {
  return say(bundle, "notice");
}

const EXPLAINER_ITEMS = [
  {
    code: "STAGE_MEANING",
    heading: "explainer.STAGE_MEANING.heading",
    body: "explainer.STAGE_MEANING.body",
  },
  {
    code: "GROUP_READING",
    heading: "explainer.GROUP_READING.heading",
    body: "explainer.GROUP_READING.body",
  },
  {
    code: "HESITANT_MEANING",
    heading: "explainer.HESITANT_MEANING.heading",
    body: "explainer.HESITANT_MEANING.body",
  },
] as const;

export function buildExplainer(bundle: ViewBundle): ResultMapView["explainer"] {
  return {
    heading: say(bundle, "section.explainer"),
    items: EXPLAINER_ITEMS.map((item) => ({
      code: item.code,
      heading: say(bundle, item.heading),
      body: [say(bundle, item.body)],
    })),
  };
}

export function buildPriority(bundle: ViewBundle, map: ValuesMap): ResultMapView["priority"] {
  const heading = say(bundle, "section.priority");
  const { priority } = map;
  if (priority.state === "NOT_ASKED") {
    return { heading, state: "NOT_ASKED", text: say(bundle, "priority.NOT_ASKED"), themes: [] };
  }
  if (priority.state === "SELECTED") {
    const themes = inThemeOrder(bundle, priority.themeIds, (themeId) => themeId).map((themeId) =>
      themeRef(bundle, themeId),
    );
    return { heading, state: "SELECTED", text: say(bundle, "priority.SELECTED"), themes };
  }
  // UNSURE, DECLINE and UNANSWERED: asked, but no theme was chosen.
  return { heading, state: "NONE_SELECTED", text: say(bundle, "priority.NONE_SELECTED"), themes: [] };
}

function bandId(level: Level): string {
  return `level:${level > 0 ? "+" : ""}${level}`;
}

function badgesOf(bundle: ViewBundle, map: ValuesMap, themeId: ThemeId): Entry[] {
  const badges: Entry[] = [];
  if (map.priority.state === "SELECTED" && map.priority.themeIds.includes(themeId)) {
    badges.push(entryOf(bundle, "PRIORITY", "badge.priority"));
  }
  if (map.hesitantThemes.some((hesitant) => hesitant.themeId === themeId)) {
    badges.push(entryOf(bundle, "HESITANT", "badge.hesitant"));
  }
  return badges;
}

function chipsOf(
  bundle: ViewBundle,
  map: ValuesMap,
  themeIds: readonly ThemeId[],
): ChartBand["chips"] {
  return inThemeOrder(bundle, themeIds, (themeId) => themeId).map((themeId) => ({
    themeId,
    name: themeRef(bundle, themeId).name,
    badges: badgesOf(bundle, map, themeId),
  }));
}

/**
 * The five groups (+2 down to -2, always all five), a note when no theme differs or
 * two groups share a level, and the chart. The chart is made from the same groups as
 * the lists, plus a band for the themes without a level and a band for the themes
 * that were not asked.
 */
export function buildImportance(bundle: ViewBundle, map: ValuesMap): ResultMapView["importance"] {
  const groups = map.importanceGroups.map((group) => {
    const themeIds = inThemeOrder(bundle, group.themeIds, (themeId) => themeId);
    return {
      level: group.level,
      heading: say(bundle, levelKey(group.level)),
      themes: themeIds.map((themeId) => ({
        ...themeRef(bundle, themeId),
        explanation: resultTextOf(bundle, themeId, "IMPORTANCE", group.level),
      })),
      emptyText: themeIds.length === 0 ? say(bundle, "empty.group") : null,
    };
  });
  const withoutLevel = map.themes
    .filter((axes) => axes.importance.state === "UNDETERMINED")
    .map((axes) => axes.themeId);
  const bands: ChartBand[] = [
    ...map.importanceGroups.map((group) => ({
      id: bandId(group.level),
      heading: say(bundle, levelKey(group.level)),
      chips: chipsOf(bundle, map, group.themeIds),
    })),
    { id: "undetermined", heading: say(bundle, "chart.undetermined"), chips: chipsOf(bundle, map, withoutLevel) },
    { id: "notAsked", heading: say(bundle, "chart.notAsked"), chips: chipsOf(bundle, map, map.notAskedThemes) },
  ];
  return {
    heading: say(bundle, "section.importance"),
    noThemeDifference: map.notices.noThemeDifference ? say(bundle, "note.noThemeDifference") : null,
    equalLevelNote: map.notices.equalLevelGroupExists ? say(bundle, "note.equalLevel") : null,
    chart: { heading: say(bundle, "section.chart"), bands },
    groups,
  };
}