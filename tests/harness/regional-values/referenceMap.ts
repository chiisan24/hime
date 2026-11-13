import type { MapError, MapInput, ValuesMap } from "@ehime-vote-navigator/contracts";

/**
 * A reference implementation of the map generation, written from the design
 * alone and kept naive on purpose: rounding by an exhaustive BigInt search, the
 * classification by plain loops. It imports no code or constant of the
 * implementation (only types), so that a shared mistake cannot hide in a shared
 * helper. Used by the reference test and by the property tests.
 */

export type ReferenceOutcome =
  | { ok: true; value: ValuesMap }
  | { ok: false; error: MapError };

type Axis = ValuesMap["themes"][number]["importance"];
type Level = -2 | -1 | 0 | 1 | 2;
type Reason = "UNSURE" | "DECLINE" | "UNANSWERED";

const IMPORTANCE_VALUES = new Map<string, number>([
  ["VERY_IMPORTANT", 2],
  ["IMPORTANT", 1],
  ["NEUTRAL", 0],
  ["NOT_VERY_IMPORTANT", -1],
  ["NOT_IMPORTANT", -2],
]);

const TRADEOFF_VALUES = new Map<string, number>([
  ["A_STRONG", 2],
  ["A_LEAN", 1],
  ["BALANCED", 0],
  ["B_LEAN", -1],
  ["B_STRONG", -2],
]);

const REASON_ORDER: readonly Reason[] = ["UNSURE", "DECLINE", "UNANSWERED"];

const ALL_THEMES: readonly string[] = [
  "TRANSPORT",
  "EDUCATION_CHILDCARE",
  "ECONOMY_EMPLOYMENT",
  "HEALTHCARE_WELFARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
];

/** The one integer k with (2k - 1) m <= 200 n < (2k + 1) m, found by search with BigInt. */
function roundHalfUp(n: number, m: number): number {
  const scaled = BigInt(200 * n);
  const bigM = BigInt(m);
  for (let k = -200; k <= 200; k += 1) {
    if (BigInt(2 * k - 1) * bigM <= scaled && scaled < BigInt(2 * k + 1) * bigM) {
      return k;
    }
  }
  throw new Error(`no rounding of ${n}/${m} within -200..200`);
}

function levelFor(score: number, t1: number, t2: number): Level {
  const size = Math.abs(score);
  if (size < t1) {
    return 0;
  }
  if (size < t2) {
    return score > 0 ? 1 : -1;
  }
  return score > 0 ? 2 : -2;
}

function reasonOf(value: unknown): Reason | undefined {
  return value === "UNSURE" || value === "DECLINE" || value === "UNANSWERED" ? value : undefined;
}

function pickOf(value: unknown): string[] {
  if (typeof value === "object" && value !== null && "pick" in value && Array.isArray(value.pick)) {
    return value.pick.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/** Whether `value` is an acceptable answer for a question of this kind. */
function accepts(kind: string | undefined, value: unknown): boolean {
  if (reasonOf(value) !== undefined) {
    return true;
  }
  if (kind === "IMPORTANCE") {
    return typeof value === "string" && IMPORTANCE_VALUES.has(value);
  }
  if (kind === "TRADEOFF") {
    return typeof value === "string" && TRADEOFF_VALUES.has(value);
  }
  if (kind === "PRIORITY_PICK") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    if (Object.keys(value).length !== 1 || !("pick" in value) || !Array.isArray(value.pick)) {
      return false;
    }
    const pick: unknown[] = value.pick;
    return (
      pick.length >= 1 &&
      pick.length <= 2 &&
      new Set(pick).size === pick.length &&
      pick.every((item) => typeof item === "string" && ALL_THEMES.includes(item))
    );
  }
  return false;
}

function fail(error: MapError): ReferenceOutcome {
  return { ok: false, error };
}

export function referenceGenerate(input: MapInput): ReferenceOutcome {
  const { bank, thresholds } = input;
  const { t1, t2 } = thresholds;
  const set = bank.sets.find((candidate) => candidate.setKind === input.setKind);
  const bankIds = new Set(bank.questions.map((question) => question.questionId));

  // (1) configuration
  if (!(Number.isInteger(t1) && Number.isInteger(t2) && t1 > 0 && t1 < t2 && t2 <= 200)) {
    return fail({ code: "INVALID_CONFIG" });
  }
  if (set === undefined || set.questionIds.some((id) => !bankIds.has(id))) {
    return fail({ code: "INVALID_CONFIG" });
  }
  const setIds = new Set(set.questionIds);
  const setQuestions = bank.questions.filter((question) => setIds.has(question.questionId));
  const picks = setQuestions.filter((question) => question.kind === "PRIORITY_PICK");
  const unattributable = setQuestions.some(
    (question) =>
      question.kind !== "PRIORITY_PICK" &&
      (question.themeId === null || !bank.themeOrder.includes(question.themeId)),
  );
  if (
    setQuestions.some((question) => !Number.isSafeInteger(question.weight) || question.weight < 1) ||
    picks.length > 1 ||
    unattributable
  ) {
    return fail({ code: "INVALID_CONFIG" });
  }

  // (2) answer keys that are not questions of the set
  const entries = Object.entries(input.answers);
  const unknownKeys = entries
    .map(([key]) => key)
    .filter((key) => !bankIds.has(key) || !setIds.has(key))
    .sort();
  if (unknownKeys.length > 0) {
    return fail({ code: "UNKNOWN_QUESTION", questionIds: unknownKeys });
  }

  // (3) values that do not fit the question kind
  const kindOf = new Map(setQuestions.map((question) => [question.questionId, question.kind]));
  const invalidKeys = entries
    .filter(([key, value]) => !accepts(kindOf.get(key), value))
    .map(([key]) => key)
    .sort();
  if (invalidKeys.length > 0) {
    return fail({ code: "INVALID_ANSWER", questionIds: invalidKeys });
  }

  // (4) a question without a key is unanswered
  const given = new Map(entries);
  const rows = setQuestions.map((question) => ({
    question,
    value: given.has(question.questionId) ? given.get(question.questionId) : "UNANSWERED",
  }));

  // (5) nothing but non-opinion answers
  if (rows.every((row) => reasonOf(row.value) !== undefined)) {
    return fail({ code: "NO_OPINION_ANSWERS" });
  }

  const themeOrder = bank.themeOrder;

  const axisOf = (theme: string, kind: "IMPORTANCE" | "TRADEOFF"): Axis => {
    const axisRows = rows.filter(
      (row) => row.question.themeId === theme && row.question.kind === kind,
    );
    if (axisRows.length === 0) {
      return { state: "NOT_ASKED" };
    }
    const values = kind === "IMPORTANCE" ? IMPORTANCE_VALUES : TRADEOFF_VALUES;
    let numerator = 0;
    let denominator = 0;
    for (const row of axisRows) {
      const answer = typeof row.value === "string" ? values.get(row.value) : undefined;
      if (answer !== undefined) {
        numerator += row.question.weight * answer;
        denominator += row.question.weight;
      }
    }
    if (denominator === 0) {
      const present = axisRows.map((row) => reasonOf(row.value));
      return {
        state: "UNDETERMINED",
        reasons: REASON_ORDER.filter((reason) => present.includes(reason)),
      };
    }
    const score = roundHalfUp(numerator, denominator);
    return { state: "DETERMINED", score, level: levelFor(score, t1, t2) };
  };

  const themes = themeOrder.map((themeId) => ({
    themeId,
    importance: axisOf(themeId, "IMPORTANCE"),
    tradeoff: axisOf(themeId, "TRADEOFF"),
  }));

  const levels: Level[] = [2, 1, 0, -1, -2];
  const importanceGroups = levels.map((level) => ({
    level,
    themeIds: themes
      .filter((theme) => theme.importance.state === "DETERMINED" && theme.importance.level === level)
      .map((theme) => theme.themeId),
  }));

  // the priority themes
  const pickRow = picks.length === 1 ? rows.find((row) => row.question.kind === "PRIORITY_PICK") : undefined;
  let priority: ValuesMap["priority"] = { state: "NOT_ASKED" };
  let selected: ValuesMap["themes"][number]["themeId"][] = [];
  if (pickRow !== undefined) {
    const reason = reasonOf(pickRow.value);
    if (reason !== undefined) {
      priority = { state: reason };
    } else {
      const chosen = pickOf(pickRow.value);
      selected = themeOrder.filter((themeId) => chosen.includes(themeId));
      priority = { state: "SELECTED", themeIds: selected };
    }
  }

  const notAskedThemes = themes
    .filter((theme) => theme.importance.state === "NOT_ASKED" && theme.tradeoff.state === "NOT_ASKED")
    .map((theme) => theme.themeId);

  const hesitantThemes: ValuesMap["hesitantThemes"] = [];
  const declinedThemes: ValuesMap["declinedThemes"] = [];
  for (const theme of themes) {
    if (notAskedThemes.includes(theme.themeId)) {
      continue;
    }
    const reasons = rows
      .filter((row) => row.question.themeId === theme.themeId && row.question.kind !== "PRIORITY_PICK")
      .map((row) => reasonOf(row.value));
    const conflict =
      selected.includes(theme.themeId) &&
      theme.importance.state === "DETERMINED" &&
      theme.importance.level <= -1;
    if (reasons.includes("UNSURE") || conflict) {
      hesitantThemes.push({
        themeId: theme.themeId,
        reasons: [
          ...(reasons.includes("UNSURE") ? (["UNSURE"] as const) : []),
          ...(conflict ? (["PICK_CONFLICT"] as const) : []),
        ],
      });
    }
    if (!reasons.includes("UNSURE") && (reasons.includes("DECLINE") || reasons.includes("UNANSWERED"))) {
      declinedThemes.push({
        themeId: theme.themeId,
        reasons: [
          ...(reasons.includes("DECLINE") ? (["DECLINE"] as const) : []),
          ...(reasons.includes("UNANSWERED") ? (["UNANSWERED"] as const) : []),
        ],
      });
    }
  }

  const excludedQuestions: ValuesMap["excludedQuestions"] = [];
  for (const row of rows) {
    const reason = reasonOf(row.value);
    if (reason !== undefined) {
      excludedQuestions.push({ questionId: row.question.questionId, reason });
    }
  }

  const determinedLevels = themes.flatMap((theme) =>
    theme.importance.state === "DETERMINED" ? [theme.importance.level] : [],
  );

  return {
    ok: true,
    value: {
      setKind: input.setKind,
      themes,
      importanceGroups,
      priority,
      hesitantThemes,
      declinedThemes,
      notAskedThemes,
      excludedQuestions,
      counts: {
        askedThemes: themeOrder.length - notAskedThemes.length,
        totalThemes: themeOrder.length,
        usableQuestions: rows.length - excludedQuestions.length,
        askedQuestions: rows.length,
      },
      notices: {
        noThemeDifference:
          determinedLevels.length >= 2 && determinedLevels.every((level) => level === determinedLevels[0]),
        equalLevelGroupExists: importanceGroups.some((group) => group.themeIds.length >= 2),
      },
    },
  };
}