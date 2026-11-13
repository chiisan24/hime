import type { AxisState, SetKind, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import { entryOf, inThemeOrder, levelKey, plainText, resultTextOf, say, themeRef } from "../support.js";
import type { JaText, ResultMapView, ThemeDrilldown, ViewBundle } from "../viewTypes.js";

/**
 * The priority condition (trade-off), the hesitant, declined, undetermined and
 * not-asked themes, and the counts. The four states stay apart: not asked, unsure,
 * decline and unanswered each have their own text and their own section.
 */

function importanceLabelOf(bundle: ViewBundle, importance: AxisState): JaText {
  if (importance.state === "DETERMINED") {
    return say(bundle, levelKey(importance.level));
  }
  return say(bundle, importance.state === "UNDETERMINED" ? "state.UNDETERMINED" : "state.NOT_ASKED");
}

/** Every theme whose trade-off axis has a level. The importance level (or why there is none) is shown beside it. */
export function buildTradeoff(bundle: ViewBundle, map: ValuesMap): ResultMapView["tradeoff"] {
  const items = inThemeOrder(bundle, map.themes, (axes) => axes.themeId).flatMap((axes) =>
    axes.tradeoff.state === "DETERMINED"
      ? [
          {
            ...themeRef(bundle, axes.themeId),
            text: resultTextOf(bundle, axes.themeId, "TRADEOFF", axes.tradeoff.level),
            importanceLabel: importanceLabelOf(bundle, axes.importance),
          },
        ]
      : [],
  );
  return {
    heading: say(bundle, "section.tradeoff"),
    lead: say(bundle, "lead.tradeoff"),
    items,
    emptyText: items.length === 0 ? say(bundle, "empty.tradeoff") : null,
  };
}

function drilldownOf(bundle: ViewBundle, setKind: SetKind, themeId: ThemeId): ThemeDrilldown {
  const set = bundle.diagnosticSets.find((candidate) => candidate.setKind === setKind);
  const explanations = (set?.questionIds ?? []).flatMap((questionId) => {
    const question = bundle.questions.find((candidate) => candidate.questionId === questionId);
    return question !== undefined && question.kind !== "PRIORITY_PICK" && question.themeId === themeId
      ? [{ questionId, text: plainText(question.explanation) }]
      : [];
  });
  return {
    explanations,
    cardLinks: bundle.cards
      .filter((card) => card.themeId === themeId)
      .map((card) => ({ cardId: card.cardId, title: card.title })),
    edit: {
      label: say(bundle, "ui.changeAnswer"),
      event: { type: "OPEN_EDIT", scope: { themeId } },
    },
  };
}

export function buildHesitant(bundle: ViewBundle, map: ValuesMap): ResultMapView["hesitant"] {
  const items = inThemeOrder(bundle, map.hesitantThemes, (hesitant) => hesitant.themeId).map((hesitant) => ({
    ...themeRef(bundle, hesitant.themeId),
    reasons: hesitant.reasons.map((reason) => entryOf(bundle, reason, `reason.${reason}`)),
    drilldown: drilldownOf(bundle, map.setKind, hesitant.themeId),
  }));
  return {
    heading: say(bundle, "section.hesitant"),
    items,
    emptyText: items.length === 0 ? say(bundle, "empty.hesitant") : null,
  };
}

const DECLINED_CODES = ["DECLINE", "UNANSWERED"] as const;

/** Two small columns. A theme with both kinds of answer appears in both. */
export function buildDeclined(bundle: ViewBundle, map: ValuesMap): ResultMapView["declined"] {
  return {
    heading: say(bundle, "section.declined"),
    columns: DECLINED_CODES.map((code) => {
      const themes = inThemeOrder(
        bundle,
        map.declinedThemes.filter((declined) => declined.reasons.includes(code)),
        (declined) => declined.themeId,
      ).map((declined) => themeRef(bundle, declined.themeId));
      return {
        code,
        heading: say(bundle, `section.declined.${code}`),
        themes,
        emptyText: themes.length === 0 ? say(bundle, `empty.declined.${code}`) : null,
      };
    }),
  };
}

const AXES = [
  ["IMPORTANCE", "importance", "section.importance"],
  ["TRADEOFF", "tradeoff", "section.tradeoff"],
] as const;

/** Axes that were asked but could not be decided. No score and no level is output. */
export function buildUndetermined(bundle: ViewBundle, map: ValuesMap): ResultMapView["undetermined"] {
  const items = inThemeOrder(bundle, map.themes, (axes) => axes.themeId).flatMap((axes) =>
    AXES.flatMap(([axis, field, nameKey]) => {
      const state = axes[field];
      return state.state === "UNDETERMINED"
        ? [
            {
              ...themeRef(bundle, axes.themeId),
              axis,
              axisName: say(bundle, nameKey),
              statement: say(bundle, "state.UNDETERMINED"),
              reasons: state.reasons.map((reason) => entryOf(bundle, reason, `state.${reason}`)),
            },
          ]
        : [];
    }),
  );
  return { heading: say(bundle, "section.undetermined"), items };
}

export function buildNotAsked(bundle: ViewBundle, map: ValuesMap): ResultMapView["notAsked"] {
  const items = inThemeOrder(bundle, map.notAskedThemes, (themeId) => themeId).map((themeId) => ({
    ...themeRef(bundle, themeId),
    text: say(bundle, "state.NOT_ASKED"),
  }));
  return {
    heading: say(bundle, "section.notAsked"),
    items,
    emptyText: items.length === 0 ? say(bundle, "empty.notAsked") : null,
  };
}

/** "n / m" for the themes and for the questions that were used (Req 5.6). */
export function buildCounts(bundle: ViewBundle, map: ValuesMap): ResultMapView["counts"] {
  return {
    themes: say(bundle, "counts.themes", { n: map.counts.askedThemes, m: map.counts.totalThemes }),
    questions: say(bundle, "counts.questions", { n: map.counts.usableQuestions, m: map.counts.askedQuestions }),
  };
}