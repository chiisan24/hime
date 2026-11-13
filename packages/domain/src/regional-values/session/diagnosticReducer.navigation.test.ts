import { describe, expect, it } from "vitest";

import { GOLDEN_VECTORS } from "../../../../../tests/harness/regional-values/goldenVectors.js";
import {
  V15_STEPS,
  answerAll,
  play,
  select,
  sessionOf,
  started,
} from "../../../../../tests/harness/regional-values/sessionDriver.js";
import { PICK_ID, TB_QUICK } from "../../../../../tests/harness/regional-values/testBanks.js";
import { FULL_BUNDLE, QUICK_BUNDLE, sessionBundleFor } from "../../../../../tests/harness/regional-values/testBundle.js";
import { generateValuesMap } from "../map/generateValuesMap.js";
import { diagnosticReducer, initialDiagnosticState } from "./diagnosticReducer.js";
import type { DiagnosticEvent, DiagnosticState } from "./sessionTypes.js";
import { toMapInput } from "./toMapInput.js";

const loaded = play(initialDiagnosticState, [{ type: "BUNDLE_LOADED", bundle: QUICK_BUNDLE }]);

describe("diagnosticReducer: loading", () => {
  it("starts in LOADING and goes to INTRO with no answer and no diagnostic set", () => {
    expect(initialDiagnosticState).toEqual({ phase: "LOADING" });
    expect(loaded.phase).toBe("INTRO");
    expect(sessionOf(loaded)).toEqual({
      bundle: QUICK_BUNDLE,
      setKind: null,
      answers: {},
      position: 0,
      current: null,
      previous: null,
    });
  });

  it("goes to LOAD_ERROR when the bundle fails, and ignores every event there", () => {
    const failed = diagnosticReducer(initialDiagnosticState, { type: "BUNDLE_FAILED", code: "FETCH_FAILED" });
    expect(failed).toEqual({ phase: "LOAD_ERROR", code: "FETCH_FAILED" });
    const events: DiagnosticEvent[] = [
      { type: "START" },
      { type: "BUNDLE_LOADED", bundle: QUICK_BUNDLE },
      { type: "NEXT" },
      { type: "RESTART" },
      { type: "OPEN_ABOUT" },
    ];
    for (const event of events) {
      expect(diagnosticReducer(failed, event)).toBe(failed);
    }
  });

  it("ignores an event that LOADING does not list", () => {
    expect(diagnosticReducer(initialDiagnosticState, { type: "START" })).toBe(initialDiagnosticState);
  });
});

describe("diagnosticReducer: choosing the diagnostic set (Req 2.15)", () => {
  it("does not ask for a set when the bundle has one", () => {
    const state = diagnosticReducer(loaded, { type: "START" });
    expect(state.phase).toBe("QUESTION");
    expect(sessionOf(state).setKind).toBe("QUICK");
    expect(sessionOf(state).position).toBe(0);
  });

  it("asks for a set when the bundle has two, and starts the chosen one", () => {
    const intro = play(initialDiagnosticState, [{ type: "BUNDLE_LOADED", bundle: FULL_BUNDLE }]);
    const choosing = diagnosticReducer(intro, { type: "START" });
    expect(choosing.phase).toBe("SET_SELECT");
    const full = diagnosticReducer(choosing, { type: "SELECT_SET", setKind: "FULL" });
    expect(full.phase).toBe("QUESTION");
    expect(sessionOf(full).setKind).toBe("FULL");
  });

  it("ignores SELECT_SET before START, and a set the bundle does not have", () => {
    expect(diagnosticReducer(loaded, { type: "SELECT_SET", setKind: "QUICK" })).toBe(loaded);
    const choosing = play(initialDiagnosticState, [{ type: "BUNDLE_LOADED", bundle: FULL_BUNDLE }, { type: "START" }]);
    const quickOnly = sessionBundleFor(TB_QUICK);
    const mismatched: DiagnosticState = { phase: "SET_SELECT", session: { ...sessionOf(choosing), bundle: quickOnly } };
    expect(diagnosticReducer(mismatched, { type: "SELECT_SET", setKind: "FULL" })).toBe(mismatched);
  });
});

describe("diagnosticReducer: answering and moving (Req 2.2, 2.8, 2.9, 2.10)", () => {
  const first = started(QUICK_BUNDLE, "QUICK");

  it("does not move on from an unanswered question and says so", () => {
    const blocked = diagnosticReducer(first, { type: "NEXT" });
    expect(blocked.phase).toBe("QUESTION");
    expect(blocked).toMatchObject({ hint: "SELECT_REQUIRED" });
    expect(sessionOf(blocked).position).toBe(0);
    expect(sessionOf(blocked).answers).toEqual({});
    expect(diagnosticReducer(blocked, { type: "NEXT" })).toBe(blocked);
  });

  it("clears the hint when an answer is chosen, then moves on and back with the answer kept", () => {
    const blocked = diagnosticReducer(first, { type: "NEXT" });
    const answered = diagnosticReducer(blocked, select("q-ed-imp", "IMPORTANT"));
    expect(answered).toMatchObject({ phase: "QUESTION", hint: "NONE" });
    const second = diagnosticReducer(answered, { type: "NEXT" });
    expect(sessionOf(second).position).toBe(1);
    const back = diagnosticReducer(second, { type: "BACK" });
    expect(sessionOf(back).position).toBe(0);
    expect(sessionOf(back).answers).toEqual({ "q-ed-imp": "IMPORTANT" });
  });

  it("ignores BACK at the first question", () => {
    expect(diagnosticReducer(first, { type: "BACK" })).toBe(first);
  });

  it("keeps only the latest answer, and counts UNSURE and DECLINE as answered", () => {
    const state = play(first, [select("q-ed-imp", "IMPORTANT"), select("q-ed-imp", "NOT_IMPORTANT")]);
    expect(sessionOf(state).answers).toEqual({ "q-ed-imp": "NOT_IMPORTANT" });
    for (const value of ["UNSURE", "DECLINE"] as const) {
      const moved = play(first, [select("q-ed-imp", value), { type: "NEXT" }]);
      expect(sessionOf(moved).position).toBe(1);
    }
  });

  it("removes the answer with CLEAR_ANSWER, so the question is unanswered again", () => {
    const cleared = play(first, [select("q-ed-imp", "IMPORTANT"), { type: "CLEAR_ANSWER", questionId: "q-ed-imp" }]);
    expect(sessionOf(cleared).answers).toEqual({});
    expect(diagnosticReducer(cleared, { type: "NEXT" })).toMatchObject({ hint: "SELECT_REQUIRED" });
  });

  it("ignores an answer for another question, a code of the wrong family and a pick on a themed question", () => {
    expect(diagnosticReducer(first, select("q-dp-imp", "IMPORTANT"))).toBe(first);
    expect(diagnosticReducer(first, select("q-ed-imp", "A_STRONG"))).toBe(first);
    expect(diagnosticReducer(first, { type: "TOGGLE_PICK", questionId: "q-ed-imp", item: "TRANSPORT" })).toBe(first);
    expect(diagnosticReducer(first, { type: "CLEAR_ANSWER", questionId: "q-dp-imp" })).toBe(first);
  });

  it("ignores events that QUESTION does not list", () => {
    for (const event of [{ type: "START" }, { type: "CLOSE_CARD" }, { type: "CONFIRM_EDIT" }, { type: "CLOSE_ABOUT" }] as const) {
      expect(diagnosticReducer(first, event)).toBe(first);
    }
  });
});

describe("diagnosticReducer: the priority-theme question", () => {
  it("answers the priority question with TOGGLE_PICK and gives PICK_LIMIT for a third theme", () => {
    let state = started(FULL_BUNDLE, "FULL");
    // answer the twelve themed questions first
    const themed = FULL_BUNDLE.questions.filter((question) => question.kind !== "PRIORITY_PICK");
    for (const question of themed) {
      state = play(state, [select(question.questionId, question.kind === "IMPORTANCE" ? "IMPORTANT" : "BALANCED"), { type: "NEXT" }]);
    }
    expect(sessionOf(state).position).toBe(12);
    const two = play(state, [
      { type: "TOGGLE_PICK", questionId: PICK_ID, item: "EDUCATION_CHILDCARE" },
      { type: "TOGGLE_PICK", questionId: PICK_ID, item: "TRANSPORT" },
    ]);
    expect(sessionOf(two).answers[PICK_ID]).toEqual({ pick: ["TRANSPORT", "EDUCATION_CHILDCARE"] });
    const third = diagnosticReducer(two, { type: "TOGGLE_PICK", questionId: PICK_ID, item: "ECONOMY_EMPLOYMENT" });
    expect(third).toMatchObject({ phase: "QUESTION", hint: "PICK_LIMIT" });
    expect(sessionOf(third).answers).toBe(sessionOf(two).answers);
  });
});

describe("diagnosticReducer: the result (Req 1.1)", () => {
  it("builds the result from the answers after the last question, with no earlier result", () => {
    const result = answerAll(started(QUICK_BUNDLE, "QUICK"));
    expect(result).toMatchObject({ phase: "RESULT", focusThemeId: null });
    const session = sessionOf(result);
    expect(session.previous).toBeNull();
    expect(session.current).toEqual(generateValuesMap(toMapInput(QUICK_BUNDLE, "QUICK", session.answers)));
    const golden = GOLDEN_VECTORS.find((vector) => vector.id === "V15");
    expect(session.current).toEqual(golden?.expected);
  });

  it("keeps a MapError as the result (not an unexpected error), with the answers kept", () => {
    const steps = V15_STEPS.map(([questionId]) => [questionId, "UNSURE"] as const);
    const result = answerAll(started(QUICK_BUNDLE, "QUICK"), steps);
    expect(result.phase).toBe("RESULT");
    expect(sessionOf(result).current).toEqual({ ok: false, error: { code: "NO_OPINION_ANSWERS" } });
    expect(Object.keys(sessionOf(result).answers)).toHaveLength(6);
  });

  it("ignores the question events in RESULT", () => {
    const result = answerAll(started(QUICK_BUNDLE, "QUICK"));
    for (const event of [{ type: "NEXT" }, { type: "BACK" }, select("q-ed-imp", "IMPORTANT"), { type: "START" }] as const) {
      expect(diagnosticReducer(result, event)).toBe(result);
    }
  });

  it("allows FOCUS_THEME only for a theme that is unsure (or null)", () => {
    const steps = V15_STEPS.map(([questionId, value]): [string, typeof value] => [
      questionId,
      questionId === "q-ed-imp" ? "UNSURE" : value,
    ]);
    const result = answerAll(started(QUICK_BUNDLE, "QUICK"), steps);
    const focused = diagnosticReducer(result, { type: "FOCUS_THEME", themeId: "EDUCATION_CHILDCARE" });
    expect(focused).toMatchObject({ phase: "RESULT", focusThemeId: "EDUCATION_CHILDCARE" });
    expect(diagnosticReducer(focused, { type: "FOCUS_THEME", themeId: null })).toMatchObject({ focusThemeId: null });
    expect(diagnosticReducer(result, { type: "FOCUS_THEME", themeId: "DISASTER_PREVENTION" })).toBe(result);
    expect(diagnosticReducer(result, { type: "FOCUS_THEME", themeId: null })).toBe(result);
  });
});

describe("diagnosticReducer: the issue card and the About screen (Req 2.13, 5.13)", () => {
  const question = started(QUICK_BUNDLE, "QUICK");
  const answered = play(question, [select("q-ed-imp", "IMPORTANT")]);

  it("opens a known card and returns to exactly the state it was opened from", () => {
    const card = diagnosticReducer(answered, { type: "OPEN_CARD", cardId: "card-1" });
    expect(card).toMatchObject({ phase: "FACT_CARD", cardId: "card-1" });
    expect(sessionOf(card)).toBe(sessionOf(answered));
    expect(diagnosticReducer(card, { type: "CLOSE_CARD" })).toBe(answered);
  });

  it("ignores a card the bundle does not have, and a card outside a question or a result", () => {
    expect(diagnosticReducer(answered, { type: "OPEN_CARD", cardId: "nope" })).toBe(answered);
    expect(diagnosticReducer(loaded, { type: "OPEN_CARD", cardId: "card-1" })).toBe(loaded);
  });

  it("opens the About screen from INTRO, SET_SELECT, QUESTION, a card and RESULT, and returns", () => {
    const choosing = play(initialDiagnosticState, [{ type: "BUNDLE_LOADED", bundle: FULL_BUNDLE }, { type: "START" }]);
    const result = answerAll(question);
    const card = diagnosticReducer(answered, { type: "OPEN_CARD", cardId: "card-2" });
    for (const state of [loaded, choosing, answered, card, result]) {
      const about = diagnosticReducer(state, { type: "OPEN_ABOUT" });
      expect(about.phase).toBe("ABOUT");
      expect(diagnosticReducer(about, { type: "CLOSE_ABOUT" })).toBe(state);
    }
  });

  it("returns through the nested screens in order", () => {
    const card = diagnosticReducer(answered, { type: "OPEN_CARD", cardId: "card-1" });
    const about = diagnosticReducer(card, { type: "OPEN_ABOUT" });
    const backToCard = diagnosticReducer(about, { type: "CLOSE_ABOUT" });
    expect(backToCard).toBe(card);
    expect(diagnosticReducer(backToCard, { type: "CLOSE_CARD" })).toBe(answered);
  });

  it("ignores an event the card and About screens do not list", () => {
    const card = diagnosticReducer(answered, { type: "OPEN_CARD", cardId: "card-1" });
    const about = diagnosticReducer(answered, { type: "OPEN_ABOUT" });
    expect(diagnosticReducer(card, { type: "NEXT" })).toBe(card);
    expect(diagnosticReducer(about, { type: "RESTART" })).toBe(about);
    expect(diagnosticReducer(about, { type: "CLOSE_CARD" })).toBe(about);
  });
});