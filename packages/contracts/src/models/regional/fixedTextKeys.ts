import type { DataKind } from "../primitives.js";

/**
 * The closed list of fixed-text keys of the regional values map, and the names
 * that each key allows to be filled in. The keys are derived from the items of the
 * result view model, the question view model and the About view model. A bundle
 * holds exactly one text for each required key.
 */

const NOTICES_AND_BANNERS = ["notice", "banner.FIXTURE", "banner.REAL_AI"] as const;

const LABELS = ["label.dataKind.REAL_AI", "label.dataKind.FIXTURE", "label.ai"] as const;

const LEVELS_AND_STATES = [
  "level.importance.+2",
  "level.importance.+1",
  "level.importance.0",
  "level.importance.-1",
  "level.importance.-2",
  "state.NOT_ASKED",
  "state.UNSURE",
  "state.DECLINE",
  "state.UNANSWERED",
  "state.UNDETERMINED",
] as const;

const SECTIONS_AND_EMPTY = [
  "section.explainer",
  "section.priority",
  "section.importance",
  "section.chart",
  "section.tradeoff",
  "section.hesitant",
  "section.declined",
  "section.declined.DECLINE",
  "section.declined.UNANSWERED",
  "section.undetermined",
  "section.notAsked",
  "section.counts",
  "section.reflection",
  "section.diff",
  "section.guidance",
  "chart.undetermined",
  "chart.notAsked",
  "badge.priority",
  "badge.hesitant",
  "empty.group",
  "empty.tradeoff",
  "empty.hesitant",
  "empty.declined.DECLINE",
  "empty.declined.UNANSWERED",
  "empty.notAsked",
] as const;

const EXPLANATIONS = [
  "reason.UNSURE",
  "reason.PICK_CONFLICT",
  "note.noThemeDifference",
  "note.equalLevel",
  "lead.tradeoff",
  "priority.NOT_ASKED",
  "priority.NONE_SELECTED",
  "priority.SELECTED",
  "explainer.STAGE_MEANING.heading",
  "explainer.STAGE_MEANING.body",
  "explainer.GROUP_READING.heading",
  "explainer.GROUP_READING.body",
  "explainer.HESITANT_MEANING.heading",
  "explainer.HESITANT_MEANING.body",
  "scene.ELECTION",
  "scene.MOVE_OR_JOB",
  "scene.DAILY_LIFE",
  "guidance.empty",
  "diff.changed",
  "diff.unchanged",
  "reflection.crossTheme",
] as const;

const COUNTS = ["counts.themes", "counts.questions"] as const;

const ERRORS = [
  "error.NO_OPINION_ANSWERS",
  "error.UNKNOWN_QUESTION",
  "error.INVALID_ANSWER",
  "error.INVALID_CONFIG",
  "error.UNEXPECTED",
  "error.UNEXPECTED.restartNote",
  "action.REVIEW_ANSWERS",
  "action.RESTART",
] as const;

const LICENSE = [
  "license.ccby.attribution",
  "license.ccby.license",
  "license.ccby.modified",
  "license.processed.YES",
  "license.processed.NO",
] as const;

const ABOUT = [
  "about.heading",
  "about.questions.heading",
  "about.author.HUMAN",
  "about.author.AI_DRAFT",
  "about.rules.heading",
  "about.rules.MAPPING.heading",
  "about.rules.MAPPING.body",
  "about.rules.WEIGHT.heading",
  "about.rules.WEIGHT.body",
  "about.rules.NON_OPINION.heading",
  "about.rules.NON_OPINION.body",
  "about.rules.GROUPING.heading",
  "about.rules.GROUPING.body",
  "about.thresholds",
  "about.dataKind.REAL_AI",
  "about.dataKind.FIXTURE",
  "about.aiScope",
  "about.coverage.totalQuestions",
  "about.coverage.totalThemes",
  "about.coverage.limitNote",
  "about.aiContribution.DRAFTED",
  "about.aiContribution.REJECTED_BY_CHECKS",
  "about.aiContribution.HUMAN_EDITED",
  "about.aiContribution.HUMAN_REJECTED",
  "about.unofficial",
] as const;

const UI = [
  "ui.appName",
  "ui.about",
  "ui.next",
  "ui.back",
  "ui.showResult",
  "ui.changeAnswer",
  "ui.hint.SELECT_REQUIRED",
  "ui.hint.PICK_LIMIT",
  "ui.option.UNSURE",
  "ui.option.DECLINE",
] as const;

export const FIXED_TEXT_KEYS = [
  ...NOTICES_AND_BANNERS,
  ...LABELS,
  ...LEVELS_AND_STATES,
  ...SECTIONS_AND_EMPTY,
  ...EXPLANATIONS,
  ...COUNTS,
  ...ERRORS,
  ...LICENSE,
  ...ABOUT,
  ...UI,
] as const;

export type FixedTextKey = (typeof FIXED_TEXT_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(FIXED_TEXT_KEYS);

export function isFixedTextKey(value: string): value is FixedTextKey {
  return KEY_SET.has(value);
}

/** Keys that exist only for the real-data (REAL_AI) bundle. */
function realOnly(key: FixedTextKey): boolean {
  return key.startsWith("license.") || key === "about.unofficial";
}

/**
 * The keys that a bundle of this data kind must hold: the common keys, the banner,
 * the label and the About description of its own data kind, and, for REAL_AI only,
 * the license texts and the unofficial notice.
 */
export function requiredFixedTextKeys(dataKind: DataKind): readonly FixedTextKey[] {
  const other = dataKind === "REAL_AI" ? "FIXTURE" : "REAL_AI";
  return FIXED_TEXT_KEYS.filter((key) => {
    if (key === `banner.${other}` || key === `label.dataKind.${other}` || key === `about.dataKind.${other}`) {
      return false;
    }
    return dataKind === "REAL_AI" || !realOnly(key);
  });
}

const THEME_NAME_PREFIXES: readonly string[] = [
  "reason.",
  "note.",
  "lead.",
  "priority.",
  "explainer.",
  "scene.",
  "guidance.",
  "diff.",
  "reflection.",
];

/** The names a text of this key may fill in, written `{name}` in the text. */
export function allowedPlaceholders(key: FixedTextKey): readonly string[] {
  if (key === "counts.themes" || key === "counts.questions") {
    return ["n", "m"];
  }
  if (key === "about.thresholds") {
    return ["t1", "t2"];
  }
  if (key.startsWith("license.")) {
    return ["publisher", "licenseName"];
  }
  if (key === "about.coverage.totalQuestions") {
    return ["totalQuestions"];
  }
  if (key === "about.coverage.totalThemes") {
    return ["totalThemes"];
  }
  if (key === "about.coverage.limitNote") {
    return ["totalQuestions", "totalThemes"];
  }
  return THEME_NAME_PREFIXES.some((prefix) => key.startsWith(prefix)) ? ["themeName"] : [];
}