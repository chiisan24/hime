import type { Answers, MapInput, SetKind } from "@ehime-vote-navigator/contracts";

import type { SessionBundle } from "./sessionTypes.js";

/**
 * Builds the input of the map generation from a bundle and the answers. Of a
 * question it passes the ID, kind, theme and weight and nothing else: no question
 * text, issue card, fact item or source. The thresholds come from the bundle.
 */
export function toMapInput(bundle: SessionBundle, setKind: SetKind, answers: Answers): MapInput {
  return {
    setKind,
    bank: {
      themeOrder: bundle.themes.map((theme) => theme.themeId),
      questions: bundle.questions.map((question) => ({
        questionId: question.questionId,
        kind: question.kind,
        themeId: question.themeId ?? null,
        weight: question.weight,
      })),
      sets: bundle.diagnosticSets.map((set) => ({
        setKind: set.setKind,
        themeIds: [...set.themeIds],
        questionIds: [...set.questionIds],
      })),
    },
    answers: { ...answers },
    thresholds: { t1: bundle.mapConfig.thresholds.t1, t2: bundle.mapConfig.thresholds.t2 },
  };
}