import type { Level, NonOpinionCode, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import type { ThemeAxes } from "./axes.js";
import type { ResolvedQuestion, ValidatedMapInput } from "./validateInput.js";

/**
 * Groups, classification, priority themes, counts and notices.
 *
 * The four states stay apart:
 *   not asked  - the theme has no question in the set (both axes NOT_ASKED)
 *   unsure     - an importance or trade-off question of the theme was UNSURE
 *   declined   - DECLINE or UNANSWERED, and no UNSURE, among those questions
 * An unsure answer to the priority-theme question is not an answer about a theme.
 * Nothing here has a rank or an order value; lists follow the theme definition
 * order, or the bank's definition order for questions.
 */

export type Classification = Pick<
  ValuesMap,
  | "importanceGroups"
  | "priority"
  | "hesitantThemes"
  | "declinedThemes"
  | "notAskedThemes"
  | "excludedQuestions"
  | "counts"
  | "notices"
>;

/** The five groups, always all of them, from +2 down to -2. */
const LEVELS: readonly Level[] = [2, 1, 0, -1, -2];

function nonOpinionReasons(rows: readonly ResolvedQuestion[]): ReadonlySet<NonOpinionCode> {
  return new Set(
    rows.flatMap((row) => (row.answer.kind === "NON_OPINION" ? [row.answer.reason] : [])),
  );
}

/**
 * Decided by the priority-theme question alone, never from importance levels.
 * A set without that question (QUICK) is NOT_ASKED.
 */
function priorityOf(input: ValidatedMapInput): ValuesMap["priority"] {
  const row = input.questions.find((candidate) => candidate.question.kind === "PRIORITY_PICK");
  if (row === undefined) {
    return { state: "NOT_ASKED" };
  }
  const { answer } = row;
  if (answer.kind === "PICK") {
    return {
      state: "SELECTED",
      themeIds: input.themeOrder.filter((themeId) => answer.themeIds.includes(themeId)),
    };
  }
  if (answer.kind === "NON_OPINION") {
    return { state: answer.reason };
  }
  throw new Error("the priority-theme question has an answer of the wrong kind");
}

export function classify(input: ValidatedMapInput, axes: readonly ThemeAxes[]): Classification {
  const priority = priorityOf(input);
  const selected: readonly ThemeId[] = priority.state === "SELECTED" ? priority.themeIds : [];

  const notAskedThemes = axes
    .filter((theme) => theme.importance.state === "NOT_ASKED" && theme.tradeoff.state === "NOT_ASKED")
    .map((theme) => theme.themeId);

  const hesitantThemes: ValuesMap["hesitantThemes"] = [];
  const declinedThemes: ValuesMap["declinedThemes"] = [];
  for (const theme of axes) {
    if (notAskedThemes.includes(theme.themeId)) {
      continue;
    }
    const reasons = nonOpinionReasons(
      input.questions.filter(
        (row) => row.question.kind !== "PRIORITY_PICK" && row.question.themeId === theme.themeId,
      ),
    );

    const hesitantReasons: ("UNSURE" | "PICK_CONFLICT")[] = [];
    if (reasons.has("UNSURE")) {
      hesitantReasons.push("UNSURE");
    }
    if (
      selected.includes(theme.themeId) &&
      theme.importance.state === "DETERMINED" &&
      theme.importance.level <= -1
    ) {
      hesitantReasons.push("PICK_CONFLICT");
    }
    if (hesitantReasons.length > 0) {
      hesitantThemes.push({ themeId: theme.themeId, reasons: hesitantReasons });
    }

    const declinedReasons: ("DECLINE" | "UNANSWERED")[] = [];
    if (!reasons.has("UNSURE")) {
      if (reasons.has("DECLINE")) {
        declinedReasons.push("DECLINE");
      }
      if (reasons.has("UNANSWERED")) {
        declinedReasons.push("UNANSWERED");
      }
    }
    if (declinedReasons.length > 0) {
      declinedThemes.push({ themeId: theme.themeId, reasons: declinedReasons });
    }
  }

  const importanceGroups: ValuesMap["importanceGroups"] = LEVELS.map((level) => ({
    level,
    themeIds: axes
      .filter((theme) => theme.importance.state === "DETERMINED" && theme.importance.level === level)
      .map((theme) => theme.themeId),
  }));

  const excludedQuestions: ValuesMap["excludedQuestions"] = input.questions.flatMap((row) =>
    row.answer.kind === "NON_OPINION"
      ? [{ questionId: row.question.questionId, reason: row.answer.reason }]
      : [],
  );

  const determinedLevels = axes.flatMap((theme) =>
    theme.importance.state === "DETERMINED" ? [theme.importance.level] : [],
  );

  return {
    importanceGroups,
    priority,
    hesitantThemes,
    declinedThemes,
    notAskedThemes,
    excludedQuestions,
    counts: {
      askedThemes: axes.length - notAskedThemes.length,
      totalThemes: axes.length,
      usableQuestions: input.questions.length - excludedQuestions.length,
      askedQuestions: input.questions.length,
    },
    notices: {
      noThemeDifference:
        determinedLevels.length >= 2 && determinedLevels.every((level) => level === determinedLevels[0]),
      equalLevelGroupExists: importanceGroups.some((group) => group.themeIds.length >= 2),
    },
  };
}