import {
  composeRealAiRun,
  type RealAiRunCompositionResult,
  type ValidatedRealAiRunBoundary,
} from "@ehime-vote-navigator/domain";

/** Production composition root: accepts only a validated REAL_AI run token. */
export function createRealRunComposition(
  boundary: ValidatedRealAiRunBoundary,
): RealAiRunCompositionResult {
  return composeRealAiRun(boundary);
}
