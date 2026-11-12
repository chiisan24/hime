import type {
  SessionBundle,
  SessionQuestion,
} from "../../../packages/domain/src/regional-values/session/sessionTypes.js";
import { DEFAULT_THRESHOLDS, TB_FULL, TB_QUICK, THEME_ORDER, type MapBank, type Thresholds } from "./testBanks.js";

/**
 * A test bundle at the level of the session (no question text), made from a test
 * bank. The richer view bundle (fixed texts, issue cards) is added with the view
 * model; this file is read by the later tests and not changed.
 */

export const TEST_CARD_IDS: readonly string[] = ["card-1", "card-2"];

export function sessionBundleFor(
  bank: MapBank,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  cardIds: readonly string[] = TEST_CARD_IDS,
): SessionBundle {
  const questions: SessionQuestion[] = bank.questions.map((question) =>
    question.themeId === null
      ? { questionId: question.questionId, kind: question.kind, weight: question.weight }
      : {
          questionId: question.questionId,
          kind: question.kind,
          weight: question.weight,
          themeId: question.themeId,
        },
  );
  return {
    meta: { dataKind: "FIXTURE" },
    themes: THEME_ORDER.map((themeId) => ({ themeId })),
    questions,
    diagnosticSets: bank.sets.map((set) => ({
      setKind: set.setKind,
      themeIds: [...set.themeIds],
      questionIds: [...set.questionIds],
    })),
    mapConfig: { thresholds: { t1: thresholds.t1, t2: thresholds.t2 } },
    cards: cardIds.map((cardId) => ({ cardId })),
  };
}

/** One diagnostic set (QUICK, six questions): the set is not asked for. */
export const QUICK_BUNDLE: SessionBundle = sessionBundleFor(TB_QUICK);

/** Two diagnostic sets (FULL with the priority-theme question, and QUICK). */
export const FULL_BUNDLE: SessionBundle = sessionBundleFor(TB_FULL);

/** The view bundle (issue cards, fixed texts, result texts, guidance) is made in testViewBundle.ts. */
export { FULL_VIEW_BUNDLE, QUICK_VIEW_BUNDLE, viewBundleFor } from "./testViewBundle.js";
