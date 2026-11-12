import type { SetKind } from "@ehime-vote-navigator/contracts";

import {
  diagnosticReducer,
  initialDiagnosticState,
} from "../../../packages/domain/src/regional-values/session/diagnosticReducer.js";
import type {
  DiagnosticEvent,
  DiagnosticState,
  Session,
  SessionBundle,
} from "../../../packages/domain/src/regional-values/session/sessionTypes.js";

/** Helpers that drive the diagnostic reducer in tests. */

export type Reducer = (state: DiagnosticState, event: DiagnosticEvent) => DiagnosticState;
export type SelectValue = Extract<DiagnosticEvent, { type: "SELECT_ANSWER" }>["value"];

export function play(
  state: DiagnosticState,
  events: readonly DiagnosticEvent[],
  reducer: Reducer = diagnosticReducer,
): DiagnosticState {
  return events.reduce(reducer, state);
}

export function sessionOf(state: DiagnosticState): Session {
  if (!("session" in state)) {
    throw new Error(`the ${state.phase} state has no session`);
  }
  return state.session;
}

export function select(questionId: string, value: SelectValue): DiagnosticEvent {
  return { type: "SELECT_ANSWER", questionId, value };
}

/** From LOADING to the first question of the set (choosing the set when the bundle has two). */
export function started(bundle: SessionBundle, setKind: SetKind, reducer: Reducer = diagnosticReducer): DiagnosticState {
  const intro = play(initialDiagnosticState, [{ type: "BUNDLE_LOADED", bundle }, { type: "START" }], reducer);
  return intro.phase === "SET_SELECT" ? play(intro, [{ type: "SELECT_SET", setKind }], reducer) : intro;
}

/** The answers of design example 1 (V15), in presentation order of the QUICK set. */
export const V15_STEPS: readonly (readonly [string, SelectValue])[] = [
  ["q-ed-imp", "NOT_VERY_IMPORTANT"],
  ["q-ed-tra", "BALANCED"],
  ["q-dp-imp", "IMPORTANT"],
  ["q-dp-tra", "B_STRONG"],
  ["q-pr-imp", "VERY_IMPORTANT"],
  ["q-pr-tra", "A_LEAN"],
];

/** Answers each question of the steps and moves on; after the last one the state is RESULT. */
export function answerAll(
  state: DiagnosticState,
  steps: readonly (readonly [string, SelectValue])[] = V15_STEPS,
  reducer: Reducer = diagnosticReducer,
): DiagnosticState {
  return steps.reduce<DiagnosticState>(
    (current, [questionId, value]) => play(current, [select(questionId, value), { type: "NEXT" }], reducer),
    state,
  );
}