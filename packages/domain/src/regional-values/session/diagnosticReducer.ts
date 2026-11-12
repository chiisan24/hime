import type { Answers, MapError, MapInput, SetKind, ThemeId, ValuesMap } from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { generateValuesMap } from "../map/generateValuesMap.js";
import { clearAnswer, isAnswered, selectAnswer, togglePick } from "./answerEditing.js";
import type {
  DiagnosticEvent,
  DiagnosticState,
  Hint,
  Session,
  SessionBundle,
  SessionQuestion,
  SessionSet,
} from "./sessionTypes.js";
import { toMapInput } from "./toMapInput.js";

/**
 * The state machine of a diagnosis: a pure function from a state and an event to
 * the next state. It uses no random number, no clock and no network, and it does not
 * change its input. An event that the table does not list for the state gives back
 * the same object.
 *
 * Unexpected exceptions (a defect, not a fault of the answers) are caught here: the
 * result is the terminal state UNEXPECTED_ERROR, which keeps only the bundle and the
 * diagnostic set. Nothing about the exception, the answers or the question IDs is kept
 * or written anywhere (Req 5.19). A `MapError` is an ordinary result and is not caught.
 */

export type ReducerDependencies = Readonly<{
  generateValuesMap: (input: MapInput) => Result<ValuesMap, MapError>;
}>;

export const initialDiagnosticState: DiagnosticState = { phase: "LOADING" };

function themeOrderOf(bundle: SessionBundle): ThemeId[] {
  return bundle.themes.map((theme) => theme.themeId);
}

function freshSession(bundle: SessionBundle): Session {
  return { bundle, setKind: null, answers: {}, position: 0, current: null, previous: null };
}

function setOf(session: Session): SessionSet {
  const set = session.bundle.diagnosticSets.find((candidate) => candidate.setKind === session.setKind);
  if (set === undefined) {
    throw new Error("the diagnostic set of the session is not in the bundle");
  }
  return set;
}

function questionById(session: Session, questionId: string): SessionQuestion {
  const question = session.bundle.questions.find((candidate) => candidate.questionId === questionId);
  if (question === undefined) {
    throw new Error("a question of the diagnostic set is not in the bundle");
  }
  return question;
}

function questionAt(session: Session, position: number): SessionQuestion {
  const questionId = setOf(session).questionIds[position];
  if (questionId === undefined) {
    throw new Error("the position is outside the diagnostic set");
  }
  return questionById(session, questionId);
}

/** The first question of the diagnostic set, with no answer, result or earlier result. */
function startQuestions(session: Session, setKind: SetKind): DiagnosticState {
  return {
    phase: "QUESTION",
    session: { ...session, setKind, answers: {}, position: 0, current: null, previous: null },
    hint: "NONE",
  };
}

function restartOf(session: Session): DiagnosticState {
  const setKind = session.setKind;
  return setKind === null ? { phase: "INTRO", session: freshSession(session.bundle) } : startQuestions(session, setKind);
}

function isInvalidConfig(session: Session): boolean {
  const current = session.current;
  return current !== null && !current.ok && current.error.code === "INVALID_CONFIG";
}

function sessionOf(state: DiagnosticState): Session | undefined {
  return "session" in state ? state.session : undefined;
}

function applyAnswerEvent(
  answers: Answers,
  question: SessionQuestion,
  themeOrder: readonly ThemeId[],
  event: DiagnosticEvent,
): Readonly<{ answers: Answers; hint: Hint }> | undefined {
  switch (event.type) {
    case "SELECT_ANSWER":
      return { answers: selectAnswer(answers, question, event.value), hint: "NONE" };
    case "TOGGLE_PICK":
      return togglePick(answers, question, event.item, themeOrder);
    case "CLEAR_ANSWER":
      return { answers: clearAnswer(answers, question.questionId), hint: "NONE" };
    default:
      return undefined;
  }
}

/** The events that open the fact card or the About screen and return to the screen they were opened from. */
function overlay(state: DiagnosticState, event: DiagnosticEvent): DiagnosticState | undefined {
  const session = sessionOf(state);
  if (session === undefined) {
    return undefined;
  }
  if (event.type === "OPEN_ABOUT") {
    return { phase: "ABOUT", session, returnTo: state };
  }
  if (event.type === "OPEN_CARD" && ["QUESTION", "RESULT", "ANSWER_EDIT"].includes(state.phase)) {
    const known = session.bundle.cards.some((card) => card.cardId === event.cardId);
    return known ? { phase: "FACT_CARD", session, cardId: event.cardId, returnTo: state } : undefined;
  }
  return undefined;
}

function transition(
  state: DiagnosticState,
  event: DiagnosticEvent,
  dependencies: ReducerDependencies,
): DiagnosticState {
  switch (state.phase) {
    case "LOADING":
      if (event.type === "BUNDLE_LOADED") {
        return { phase: "INTRO", session: freshSession(event.bundle) };
      }
      return event.type === "BUNDLE_FAILED" ? { phase: "LOAD_ERROR", code: event.code } : state;

    case "LOAD_ERROR":
      return state;

    case "UNEXPECTED_ERROR": {
      if (event.type !== "RESTART" || state.bundle === null) {
        return state;
      }
      const session = freshSession(state.bundle);
      const set = state.bundle.diagnosticSets.find((candidate) => candidate.setKind === state.setKind);
      return set === undefined ? { phase: "INTRO", session } : startQuestions(session, set.setKind);
    }

    case "INTRO": {
      if (event.type === "START") {
        const sets = state.session.bundle.diagnosticSets;
        const [only] = sets;
        if (sets.length === 1 && only !== undefined) {
          return startQuestions(state.session, only.setKind);
        }
        return sets.length >= 2 ? { phase: "SET_SELECT", session: state.session } : state;
      }
      return overlay(state, event) ?? state;
    }

    case "SET_SELECT": {
      if (event.type === "SELECT_SET") {
        const known = state.session.bundle.diagnosticSets.some((set) => set.setKind === event.setKind);
        return known ? startQuestions(state.session, event.setKind) : state;
      }
      return overlay(state, event) ?? state;
    }

    case "QUESTION": {
      const session = state.session;
      switch (event.type) {
        case "SELECT_ANSWER":
        case "TOGGLE_PICK":
        case "CLEAR_ANSWER": {
          const question = questionAt(session, session.position);
          if (event.questionId !== question.questionId) {
            return state;
          }
          const applied = applyAnswerEvent(session.answers, question, themeOrderOf(session.bundle), event);
          if (applied === undefined || (applied.answers === session.answers && applied.hint === state.hint)) {
            return state;
          }
          return { phase: "QUESTION", session: { ...session, answers: applied.answers }, hint: applied.hint };
        }
        case "NEXT": {
          const question = questionAt(session, session.position);
          if (!isAnswered(session.answers, question.questionId)) {
            return state.hint === "SELECT_REQUIRED" ? state : { ...state, hint: "SELECT_REQUIRED" };
          }
          if (session.position < setOf(session).questionIds.length - 1) {
            return { phase: "QUESTION", session: { ...session, position: session.position + 1 }, hint: "NONE" };
          }
          if (session.setKind === null) {
            throw new Error("no diagnostic set is selected");
          }
          const current = dependencies.generateValuesMap(toMapInput(session.bundle, session.setKind, session.answers));
          return { phase: "RESULT", session: { ...session, current, previous: null }, focusThemeId: null };
        }
        case "BACK":
          return session.position >= 1
            ? { phase: "QUESTION", session: { ...session, position: session.position - 1 }, hint: "NONE" }
            : state;
        case "RESTART":
          return restartOf(session);
        default:
          return overlay(state, event) ?? state;
      }
    }

    case "FACT_CARD":
      if (event.type === "CLOSE_CARD") {
        return state.returnTo;
      }
      return event.type === "OPEN_ABOUT" ? { phase: "ABOUT", session: state.session, returnTo: state } : state;

    case "ABOUT":
      return event.type === "CLOSE_ABOUT" ? state.returnTo : state;

    case "RESULT": {
      const session = state.session;
      const current = session.current;
      switch (event.type) {
        case "FOCUS_THEME": {
          if (event.themeId !== null) {
            const known =
              current !== null && current.ok && current.value.hesitantThemes.some((entry) => entry.themeId === event.themeId);
            if (!known) {
              return state;
            }
          }
          return event.themeId === state.focusThemeId ? state : { ...state, focusThemeId: event.themeId };
        }
        case "OPEN_EDIT": {
          if (current === null) {
            return state;
          }
          const set = setOf(session);
          if (event.scope === "ALL") {
            if (isInvalidConfig(session)) {
              return state;
            }
            return { phase: "ANSWER_EDIT", session, draft: session.answers, editable: [...set.questionIds], hint: "NONE" };
          }
          const themeId = event.scope.themeId;
          const hesitant = current.ok ? current.value.hesitantThemes.find((entry) => entry.themeId === themeId) : undefined;
          if (hesitant === undefined) {
            return state;
          }
          const editable = set.questionIds.filter((questionId) => {
            const question = questionById(session, questionId);
            return question.kind === "PRIORITY_PICK"
              ? hesitant.reasons.includes("PICK_CONFLICT")
              : question.themeId === themeId;
          });
          return { phase: "ANSWER_EDIT", session, draft: session.answers, editable, hint: "NONE" };
        }
        case "RESTART":
          return isInvalidConfig(session) ? state : restartOf(session);
        default:
          return overlay(state, event) ?? state;
      }
    }

    case "ANSWER_EDIT": {
      const session = state.session;
      switch (event.type) {
        case "SELECT_ANSWER":
        case "TOGGLE_PICK":
        case "CLEAR_ANSWER": {
          if (!state.editable.includes(event.questionId)) {
            return state;
          }
          const question = questionById(session, event.questionId);
          const applied = applyAnswerEvent(state.draft, question, themeOrderOf(session.bundle), event);
          if (applied === undefined || (applied.answers === state.draft && applied.hint === state.hint)) {
            return state;
          }
          return { ...state, draft: applied.answers, hint: applied.hint };
        }
        case "CONFIRM_EDIT": {
          if (session.setKind === null) {
            throw new Error("no diagnostic set is selected");
          }
          const before = session.current;
          const previous = before !== null && before.ok ? before.value : session.previous;
          const current = dependencies.generateValuesMap(toMapInput(session.bundle, session.setKind, state.draft));
          return { phase: "RESULT", session: { ...session, answers: state.draft, current, previous }, focusThemeId: null };
        }
        case "CANCEL_EDIT":
          return { phase: "RESULT", session, focusThemeId: null };
        case "RESTART":
          return isInvalidConfig(session) ? state : restartOf(session);
        default:
          return overlay(state, event) ?? state;
      }
    }
  }
}

/** The terminal state for an exception: the bundle and the diagnostic set only. */
function unexpectedErrorFrom(state: DiagnosticState): DiagnosticState {
  if (state.phase === "LOAD_ERROR" || state.phase === "UNEXPECTED_ERROR") {
    return state;
  }
  const session = sessionOf(state);
  return {
    phase: "UNEXPECTED_ERROR",
    bundle: session === undefined ? null : session.bundle,
    setKind: session === undefined ? null : session.setKind,
  };
}

/** A reducer with its map generation supplied, so that a test can make it throw. */
export function createDiagnosticReducer(
  dependencies: ReducerDependencies,
): (state: DiagnosticState, event: DiagnosticEvent) => DiagnosticState {
  return (state, event) => {
    try {
      return transition(state, event, dependencies);
    } catch {
      // Nothing about the exception is kept or written (Req 5.19).
      return unexpectedErrorFrom(state);
    }
  };
}

export const diagnosticReducer = createDiagnosticReducer({ generateValuesMap });