import {
  GUIDANCE_SCENES,
  IMPORTANCE_VALUE,
  TRADEOFF_VALUE,
  type Answers,
  type AxisState,
  type Level,
  type Question,
  type SetKind,
  type ThemeId,
  type ValuesMap,
} from "@ehime-vote-navigator/contracts";

import { entryOf, inThemeOrder, levelKey, resultTextOf, say, themeName, themeRef } from "../support.js";
import type { DiffCell, JaText, ResultMapView, RichText, ViewBundle } from "../viewTypes.js";

/**
 * The review of the answers, the before-and-after difference and the guidance for
 * daily life. The guidance themes are chosen from the priority themes and the
 * importance levels only: not from the priority-condition answers, a date or an
 * election (Req 6.8, 6.12).
 */

function setOf(bundle: ViewBundle, setKind: SetKind) {
  return bundle.diagnosticSets.find((candidate) => candidate.setKind === setKind);
}

function plainOf(text: RichText): string {
  return text.map((part) => part.v).join("");
}

// ---------------------------------------------------------------------------
// Review of the answers (Req 6.1)
// ---------------------------------------------------------------------------

function opinionLabel(question: Question, code: string): string | undefined {
  if (question.kind === "PRIORITY_PICK") {
    return undefined;
  }
  const table = question.kind === "IMPORTANCE" ? IMPORTANCE_VALUE : TRADEOFF_VALUE;
  const value = Object.entries(table).find(([name]) => name === code)?.[1];
  return value === undefined ? undefined : question.opinionLabels[2 - value];
}

/** An opinion answer is the label of the bank; the others are fixed words. A missing key is unanswered. */
function answerText(bundle: ViewBundle, question: Question, answers: Answers): JaText {
  const answer = Object.hasOwn(answers, question.questionId) ? answers[question.questionId] : undefined;
  if (answer === undefined || answer === "UNANSWERED") {
    return say(bundle, "state.UNANSWERED");
  }
  if (answer === "UNSURE") {
    return question.unsureLabel;
  }
  if (answer === "DECLINE") {
    return question.declineLabel;
  }
  if (typeof answer === "object") {
    return inThemeOrder(bundle, answer.pick, (themeId) => themeId)
      .map((themeId) => themeName(bundle, themeId))
      .join("、");
  }
  return opinionLabel(question, answer) ?? say(bundle, "state.UNANSWERED");
}

export function buildReflection(
  bundle: ViewBundle,
  setKind: SetKind,
  answers: Answers,
  current: ValuesMap,
  previous: ValuesMap | null,
): ResultMapView["reflection"] {
  const rows = (setOf(bundle, setKind)?.questionIds ?? []).flatMap((questionId, index) => {
    const question = bundle.questions.find((candidate) => candidate.questionId === questionId);
    if (question === undefined) {
      return [];
    }
    const changed =
      previous === null || question.kind === "PRIORITY_PICK"
        ? null
        : themeChanged(bundle, question.themeId, current, previous);
    return [
      {
        position: index + 1,
        themeLabel:
          question.kind === "PRIORITY_PICK"
            ? say(bundle, "reflection.crossTheme")
            : themeName(bundle, question.themeId),
        question: question.text,
        answer: answerText(bundle, question, answers),
        change:
          changed === null ? null : changed ? entryOf(bundle, "CHANGED", "diff.changed") : entryOf(bundle, "UNCHANGED", "diff.unchanged"),
      },
    ];
  });
  return { heading: say(bundle, "section.reflection"), rows };
}

// ---------------------------------------------------------------------------
// Difference before and after a change (Req 6.2)
// ---------------------------------------------------------------------------

/** The words shown for one axis: the level wording, "cannot be decided", or "not asked". */
function axisText(
  bundle: ViewBundle,
  themeId: ThemeId,
  axis: "IMPORTANCE" | "TRADEOFF",
  state: AxisState | undefined,
): JaText {
  if (state === undefined || state.state === "NOT_ASKED") {
    return say(bundle, "state.NOT_ASKED");
  }
  if (state.state === "UNDETERMINED") {
    return say(bundle, "state.UNDETERMINED");
  }
  return axis === "IMPORTANCE"
    ? say(bundle, levelKey(state.level))
    : plainOf(resultTextOf(bundle, themeId, "TRADEOFF", state.level));
}

function cellOf(
  bundle: ViewBundle,
  themeId: ThemeId,
  axis: "IMPORTANCE" | "TRADEOFF",
  before: ValuesMap,
  after: ValuesMap,
): DiffCell {
  const pick = (map: ValuesMap) => map.themes.find((axes) => axes.themeId === themeId);
  const beforeText = axisText(bundle, themeId, axis, axis === "IMPORTANCE" ? pick(before)?.importance : pick(before)?.tradeoff);
  const afterText = axisText(bundle, themeId, axis, axis === "IMPORTANCE" ? pick(after)?.importance : pick(after)?.tradeoff);
  const changed = beforeText !== afterText;
  return {
    before: beforeText,
    after: afterText,
    changed,
    note: say(bundle, changed ? "diff.changed" : "diff.unchanged"),
  };
}

function themeChanged(bundle: ViewBundle, themeId: ThemeId, current: ValuesMap, previous: ValuesMap): boolean {
  return (
    cellOf(bundle, themeId, "IMPORTANCE", previous, current).changed ||
    cellOf(bundle, themeId, "TRADEOFF", previous, current).changed
  );
}

/** Every asked theme, in the theme definition order: the wording before and after, and whether it changed. */
export function buildDiff(
  bundle: ViewBundle,
  setKind: SetKind,
  current: ValuesMap,
  previous: ValuesMap,
): NonNullable<ResultMapView["diff"]> {
  const themeIds = inThemeOrder(bundle, setOf(bundle, setKind)?.themeIds ?? [], (themeId) => themeId);
  return {
    heading: say(bundle, "section.diff"),
    rows: themeIds.map((themeId) => ({
      theme: themeRef(bundle, themeId),
      importance: cellOf(bundle, themeId, "IMPORTANCE", previous, current),
      tradeoff: cellOf(bundle, themeId, "TRADEOFF", previous, current),
    })),
  };
}

// ---------------------------------------------------------------------------
// Guidance for daily life (Req 6.6 to 6.9, 6.12)
// ---------------------------------------------------------------------------

/**
 * The themes the guidance is about: asked themes only, in this order of preference:
 * the priority themes, then importance +2, then +1; inside each class the theme
 * definition order; at most `guidanceMaxThemes`.
 */
export function guidanceThemeIds(bundle: ViewBundle, map: ValuesMap): ThemeId[] {
  const asked = new Set<ThemeId>(setOf(bundle, map.setKind)?.themeIds ?? []);
  const inGroup = (level: Level): readonly ThemeId[] =>
    map.importanceGroups.find((group) => group.level === level)?.themeIds ?? [];
  const priority = map.priority.state === "SELECTED" ? map.priority.themeIds : [];
  const preferred = [
    ...inThemeOrder(bundle, priority, (themeId) => themeId),
    ...inThemeOrder(bundle, inGroup(2), (themeId) => themeId),
    ...inThemeOrder(bundle, inGroup(1), (themeId) => themeId),
  ];
  const chosen: ThemeId[] = [];
  for (const themeId of preferred) {
    if (asked.has(themeId) && !chosen.includes(themeId) && chosen.length < bundle.mapConfig.guidanceMaxThemes) {
      chosen.push(themeId);
    }
  }
  return inThemeOrder(bundle, chosen, (themeId) => themeId);
}

/**
 * The link to an official page: only a real-data source whose terms of use are
 * CONFIRMED and that has a URL. Anything else gives no link (Req 6.9).
 */
function linkOf(bundle: ViewBundle, linkSourceId: string | null): Readonly<{ href: string; label: JaText }> | null {
  if (linkSourceId === null) {
    return null;
  }
  for (const card of bundle.cards) {
    for (const source of card.sources) {
      if (source.dataKind === "REAL_AI" && source.sourceId === linkSourceId) {
        return source.usage.status === "CONFIRMED" && source.reference.kind === "url"
          ? { href: source.reference.url, label: source.publisher }
          : null;
      }
    }
  }
  return null;
}
/** The questions are shown in the theme definition order. */
export function buildGuidance(bundle: ViewBundle, map: ValuesMap): ResultMapView["guidance"] {
  const items = guidanceThemeIds(bundle, map).map((themeId) => ({
    theme: themeRef(bundle, themeId),
    scenes: GUIDANCE_SCENES.flatMap((scene) => {
      const found = bundle.guidance.find((candidate) => candidate.themeId === themeId && candidate.scene === scene);
      return found === undefined
        ? []
        : [{ scene, sceneLabel: say(bundle, `scene.${scene}`), question: found.text, link: linkOf(bundle, found.linkSourceId) }];
    }),
  }));
  return {
    heading: say(bundle, "section.guidance"),
    emptyText: items.length === 0 ? say(bundle, "guidance.empty") : null,
    items,
  };
}