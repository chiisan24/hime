import type { Answers, MapError, SetKind, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { buildErrorView } from "./errorView.js";
import { buildFrame } from "./frame.js";
import { buildExplainer, buildImportance, buildNotice, buildPriority } from "./sections/importanceSection.js";
import { buildDiff, buildGuidance, buildReflection } from "./sections/reflectionDiffGuidance.js";
import {
  buildCounts,
  buildDeclined,
  buildHesitant,
  buildNotAsked,
  buildTradeoff,
  buildUndetermined,
} from "./sections/statusSections.js";
import type { ResultViewModel, SectionId, ViewBundle } from "./viewTypes.js";

/**
 * The default order of the sections, in one place. The order that the requirements
 * fix: the notice above the priority theme, and the priority theme before the
 * importance groups. The whole order is still to be confirmed (open item 19).
 */
export const defaultSectionOrder: readonly SectionId[] = [
  "notice",
  "explainer",
  "priority",
  "importance",
  "tradeoff",
  "hesitant",
  "declined",
  "undetermined",
  "notAsked",
  "counts",
  "reflection",
  "diff",
  "guidance",
];

export type ResultViewInput = Readonly<{
  bundle: ViewBundle;
  setKind: SetKind;
  answers: Answers;
  current: Result<ValuesMap, MapError>;
  /** The map shown just before the last change of answers; null when nothing was changed. */
  previous: ValuesMap | null;
  /**
   * The theme that the screen has opened (FOCUS_THEME). Every hesitant theme already
   * carries its drill-down, so the screen opens the one it holds; this is not read here.
   */
  focusThemeId: ThemeId | null;
}>;

/**
 * Builds the view model of the result screen. A total function: for an error of the
 * map generation it returns the error view, which holds no theme, level, class or
 * count. A bundle that lacks a required fixed text is a defect and throws; the
 * bundle verification rules this out before a bundle is used.
 */
export function buildResultViewModel(input: ResultViewInput): ResultViewModel {
  const { bundle, setKind, answers, current, previous } = input;
  if (!current.ok) {
    return buildErrorView(bundle, current.error);
  }
  const map = current.value;
  return {
    kind: "MAP",
    frame: buildFrame(bundle),
    sectionOrder: previous === null ? defaultSectionOrder.filter((id) => id !== "diff") : defaultSectionOrder,
    notice: buildNotice(bundle),
    explainer: buildExplainer(bundle),
    priority: buildPriority(bundle, map),
    importance: buildImportance(bundle, map),
    tradeoff: buildTradeoff(bundle, map),
    hesitant: buildHesitant(bundle, map),
    declined: buildDeclined(bundle, map),
    undetermined: buildUndetermined(bundle, map),
    notAsked: buildNotAsked(bundle, map),
    counts: buildCounts(bundle, map),
    reflection: buildReflection(bundle, setKind, answers, map, previous),
    diff: previous === null ? null : buildDiff(bundle, setKind, map, previous),
    guidance: buildGuidance(bundle, map),
  };
}