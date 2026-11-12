import type {
  Answers,
  DataKind,
  ImportanceCode,
  MapError,
  QuestionKind,
  SetKind,
  ThemeId,
  TradeoffCode,
  ValuesMap,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import type { BundleLoadErrorCode } from "../bundle/verifyBundleText.js";

/**
 * The state of a diagnosis, for the pure reducer `diagnosticReducer`. A screen
 * holds one `DiagnosticState`, sends `DiagnosticEvent`s and draws the state; it
 * decides nothing itself. Nothing here uses a clock, a random number or the network.
 */

export type QuestionId = string;

/** Why the last operation did not do what was asked. A screen shows a fixed text for it. */
export type Hint = "NONE" | "SELECT_REQUIRED" | "PICK_LIMIT";

/** The facts about a question that the state machine needs. A full `Question` satisfies this. */
export type SessionQuestion = Readonly<{
  questionId: QuestionId;
  kind: QuestionKind;
  weight: number;
  /** Absent for the priority-theme question, which belongs to no single theme. */
  themeId?: ThemeId;
}>;

export type SessionSet = Readonly<{
  setKind: SetKind;
  themeIds: readonly ThemeId[];
  /** Presentation order. */
  questionIds: readonly QuestionId[];
}>;

/**
 * The read-only part of a published bundle that the state machine reads. The
 * richer view bundle and the verified bundle satisfy it structurally.
 */
export type SessionBundle = Readonly<{
  meta: Readonly<{ dataKind: DataKind }>;
  /** The array order is the theme definition order (not a ranking). */
  themes: readonly Readonly<{ themeId: ThemeId }>[];
  questions: readonly SessionQuestion[];
  diagnosticSets: readonly SessionSet[];
  mapConfig: Readonly<{ thresholds: Readonly<{ t1: number; t2: number }> }>;
  cards: readonly Readonly<{ cardId: string }>[];
}>;

export type Session = Readonly<{
  bundle: SessionBundle;
  setKind: SetKind | null;
  /** Latest answer per question ID; a question without a key is unanswered. */
  answers: Answers;
  /** 0-based, in the presentation order of the diagnostic set. */
  position: number;
  /** The most recent result. */
  current: Result<ValuesMap, MapError> | null;
  /** The result shown just before the last change of answers: one map at most. */
  previous: ValuesMap | null;
}>;

export type DiagnosticState =
  | Readonly<{ phase: "LOADING" }>
  | Readonly<{ phase: "LOAD_ERROR"; code: BundleLoadErrorCode }>
  | Readonly<{ phase: "INTRO"; session: Session }>
  | Readonly<{ phase: "SET_SELECT"; session: Session }>
  | Readonly<{ phase: "QUESTION"; session: Session; hint: Hint }>
  | Readonly<{ phase: "FACT_CARD"; session: Session; cardId: string; returnTo: DiagnosticState }>
  | Readonly<{ phase: "RESULT"; session: Session; focusThemeId: ThemeId | null }>
  | Readonly<{
      phase: "ANSWER_EDIT";
      session: Session;
      draft: Answers;
      editable: readonly QuestionId[];
      hint: Hint;
    }>
  | Readonly<{ phase: "ABOUT"; session: Session; returnTo: DiagnosticState }>
  /**
   * An unexpected internal error (Req 5.19). Terminal. It keeps the bundle (public
   * data) and the diagnostic set so that a restart is possible, and nothing else: no
   * answer, no result, no message of the error.
   */
  | Readonly<{ phase: "UNEXPECTED_ERROR"; bundle: SessionBundle | null; setKind: SetKind | null }>;

export type DiagnosticEvent =
  | Readonly<{ type: "BUNDLE_LOADED"; bundle: SessionBundle }>
  | Readonly<{ type: "BUNDLE_FAILED"; code: BundleLoadErrorCode }>
  | Readonly<{ type: "START" }>
  | Readonly<{ type: "SELECT_SET"; setKind: SetKind }>
  | Readonly<{
      type: "SELECT_ANSWER";
      questionId: QuestionId;
      value: ImportanceCode | TradeoffCode | "UNSURE" | "DECLINE";
    }>
  | Readonly<{ type: "TOGGLE_PICK"; questionId: QuestionId; item: ThemeId | "UNSURE" | "DECLINE" }>
  | Readonly<{ type: "CLEAR_ANSWER"; questionId: QuestionId }>
  | Readonly<{ type: "NEXT" }>
  | Readonly<{ type: "BACK" }>
  | Readonly<{ type: "OPEN_CARD"; cardId: string }>
  | Readonly<{ type: "CLOSE_CARD" }>
  | Readonly<{ type: "OPEN_ABOUT" }>
  | Readonly<{ type: "CLOSE_ABOUT" }>
  | Readonly<{ type: "FOCUS_THEME"; themeId: ThemeId | null }>
  | Readonly<{ type: "OPEN_EDIT"; scope: "ALL" | Readonly<{ themeId: ThemeId }> }>
  | Readonly<{ type: "CONFIRM_EDIT" }>
  | Readonly<{ type: "CANCEL_EDIT" }>
  | Readonly<{ type: "RESTART" }>;