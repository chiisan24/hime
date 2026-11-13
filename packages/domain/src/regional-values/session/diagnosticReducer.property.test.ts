import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateValuesMap } from "../map/generateValuesMap.js";
import {
  select,
  sessionOf,
  started,
  type Reducer,
  type SelectValue,
} from "../../../../../tests/harness/regional-values/sessionDriver.js";
import { PICK_ID, THEME_ORDER, type ThemeValue } from "../../../../../tests/harness/regional-values/testBanks.js";
import { FULL_BUNDLE, QUICK_BUNDLE } from "../../../../../tests/harness/regional-values/testBundle.js";
import { createDiagnosticReducer, diagnosticReducer, initialDiagnosticState } from "./diagnosticReducer.js";
import type { DiagnosticEvent, DiagnosticState, Session, SessionBundle, SessionQuestion } from "./sessionTypes.js";
import { toMapInput } from "./toMapInput.js";

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_006, numRuns: 120 };

const IMPORTANCE_CODES: SelectValue[] = ["VERY_IMPORTANT", "IMPORTANT", "NEUTRAL", "NOT_VERY_IMPORTANT", "NOT_IMPORTANT"];
const TRADEOFF_CODES: SelectValue[] = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG"];

const bundleArb = fc.constantFrom(QUICK_BUNDLE, FULL_BUNDLE);
const traceArb = fc.array(fc.nat(100_000), { minLength: 5, maxLength: 70 });

function setOf(session: Session) {
  return session.bundle.diagnosticSets.find((candidate) => candidate.setKind === session.setKind);
}

function questionAtPosition(session: Session): SessionQuestion | undefined {
  const questionId = setOf(session)?.questionIds[session.position];
  return session.bundle.questions.find((candidate) => candidate.questionId === questionId);
}

function answerEvents(question: SessionQuestion): DiagnosticEvent[] {
  const questionId = question.questionId;
  const clear: DiagnosticEvent = { type: "CLEAR_ANSWER", questionId };
  if (question.kind === "PRIORITY_PICK") {
    return [
      ...THEME_ORDER.map((item): DiagnosticEvent => ({ type: "TOGGLE_PICK", questionId, item })),
      { type: "TOGGLE_PICK", questionId, item: "UNSURE" },
      { type: "TOGGLE_PICK", questionId, item: "DECLINE" },
      clear,
    ];
  }
  const own = question.kind === "IMPORTANCE" ? IMPORTANCE_CODES : TRADEOFF_CODES;
  const other = question.kind === "IMPORTANCE" ? TRADEOFF_CODES : IMPORTANCE_CODES;
  return [
    ...own.map((value) => select(questionId, value)),
    select(questionId, "UNSURE"),
    select(questionId, "DECLINE"),
    select(questionId, other[0] ?? "UNSURE"),
    clear,
  ];
}

/** The events worth trying in a state: the valid ones, and a few that must be ignored. */
function candidates(state: DiagnosticState): DiagnosticEvent[] {
  switch (state.phase) {
    case "LOADING":
      return [{ type: "START" }];
    case "LOAD_ERROR":
      return [{ type: "START" }, { type: "RESTART" }];
    case "UNEXPECTED_ERROR":
      return [{ type: "RESTART" }, { type: "NEXT" }];
    case "INTRO":
      return [{ type: "START" }, { type: "OPEN_ABOUT" }, { type: "NEXT" }];
    case "SET_SELECT":
      return [
        ...state.session.bundle.diagnosticSets.map((set): DiagnosticEvent => ({ type: "SELECT_SET", setKind: set.setKind })),
        { type: "OPEN_ABOUT" },
        { type: "NEXT" },
      ];
    case "QUESTION": {
      const question = questionAtPosition(state.session);
      return [
        ...(question === undefined ? [] : answerEvents(question)),
        { type: "NEXT" },
        { type: "NEXT" },
        { type: "NEXT" },
        { type: "BACK" },
        { type: "OPEN_CARD", cardId: "card-1" },
        { type: "OPEN_ABOUT" },
        { type: "RESTART" },
      ];
    }
    case "FACT_CARD":
      return [{ type: "CLOSE_CARD" }, { type: "CLOSE_CARD" }, { type: "OPEN_ABOUT" }];
    case "ABOUT":
      return [{ type: "CLOSE_ABOUT" }, { type: "CLOSE_ABOUT" }];
    case "RESULT":
      return [
        { type: "FOCUS_THEME", themeId: null },
        ...THEME_ORDER.map((themeId): DiagnosticEvent => ({ type: "FOCUS_THEME", themeId })),
        { type: "OPEN_EDIT", scope: "ALL" },
        { type: "OPEN_EDIT", scope: "ALL" },
        ...THEME_ORDER.map((themeId): DiagnosticEvent => ({ type: "OPEN_EDIT", scope: { themeId } })),
        { type: "OPEN_CARD", cardId: "card-2" },
        { type: "OPEN_ABOUT" },
        { type: "RESTART" },
        { type: "BACK" },
      ];
    case "ANSWER_EDIT": {
      const questions = state.editable.flatMap((questionId) => {
        const question = state.session.bundle.questions.find((candidate) => candidate.questionId === questionId);
        return question === undefined ? [] : answerEvents(question);
      });
      return [
        ...questions,
        { type: "CONFIRM_EDIT" },
        { type: "CONFIRM_EDIT" },
        { type: "CANCEL_EDIT" },
        { type: "OPEN_CARD", cardId: "card-1" },
        { type: "OPEN_ABOUT" },
        { type: "RESTART" },
      ];
    }
  }
}

type Step = Readonly<{ before: DiagnosticState; event: DiagnosticEvent; after: DiagnosticState }>;

function runTrace(bundle: SessionBundle, choices: readonly number[], reducer: Reducer = diagnosticReducer): Step[] {
  const loadedEvent: DiagnosticEvent = { type: "BUNDLE_LOADED", bundle };
  let state = reducer(initialDiagnosticState, loadedEvent);
  const steps: Step[] = [{ before: initialDiagnosticState, event: loadedEvent, after: state }];
  for (const choice of choices) {
    const options = candidates(state);
    const event = options[choice % options.length];
    if (event === undefined) {
      continue;
    }
    const after = reducer(state, event);
    steps.push({ before: state, event, after });
    state = after;
  }
  return steps;
}

function answerForm(value: Session["answers"][string] | undefined): string {
  if (value === undefined) {
    return "none";
  }
  if (typeof value === "string") {
    return value;
  }
  const themes = value.pick;
  const ordered = THEME_ORDER.filter((theme) => themes.includes(theme));
  expect(themes).toEqual(ordered);
  expect(new Set(themes).size).toBe(themes.length);
  return themes.length === 1 ? "one" : "two";
}

/** A valid answer for the question, chosen by the number: a code, UNSURE, DECLINE, or a theme or UNSURE or DECLINE for the priority question. */
function validAnswerEvent(question: SessionQuestion, n: number): DiagnosticEvent {
  const questionId = question.questionId;
  if (question.kind === "PRIORITY_PICK") {
    const items: (ThemeValue | "UNSURE" | "DECLINE")[] = [...THEME_ORDER, "UNSURE", "DECLINE"];
    return { type: "TOGGLE_PICK", questionId, item: items[n % items.length] ?? "UNSURE" };
  }
  const codes: SelectValue[] = [...(question.kind === "IMPORTANCE" ? IMPORTANCE_CODES : TRADEOFF_CODES), "UNSURE", "DECLINE"];
  return select(questionId, codes[n % codes.length] ?? "UNSURE");
}

describe("diagnosticReducer: state machine properties", () => {  // Feature: regional-values-map, Property 41: replacing answers
  // **Validates: Requirements 2.10**
  it("keeps only keys of the diagnostic set in the answers and in the draft, along any event sequence", () => {
    fc.assert(
      fc.property(bundleArb, traceArb, (bundle, choices) => {
        for (const { after } of runTrace(bundle, choices)) {
          expect(after.phase).not.toBe("UNEXPECTED_ERROR");
          if ("session" in after && after.session.setKind !== null) {
            const ids = setOf(after.session)?.questionIds ?? [];
            for (const key of Object.keys(after.session.answers)) {
              expect(ids).toContain(key);
            }
            if (after.phase === "ANSWER_EDIT") {
              for (const key of Object.keys(after.draft)) {
                expect(ids).toContain(key);
              }
            }
          }
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 41: replacing answers (latest value)
  // **Validates: Requirements 2.10**
  it("holds the last chosen value of the current question and no earlier one", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(11), { minLength: 1, maxLength: 12 }), (choices) => {
        let state = diagnosticReducer(diagnosticReducer(initialDiagnosticState, { type: "BUNDLE_LOADED", bundle: QUICK_BUNDLE }), {
          type: "START",
        });
        let expected: string | undefined;
        const codes: SelectValue[] = [...IMPORTANCE_CODES, "UNSURE", "DECLINE"];
        for (const choice of choices) {
          const value = codes[choice % codes.length] ?? "UNSURE";
          state = diagnosticReducer(state, select("q-ed-imp", value));
          expected = value;
        }
        expect(sessionOf(state).answers["q-ed-imp"]).toBe(expected);
        expect(Object.keys(sessionOf(state).answers)).toEqual(["q-ed-imp"]);
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 42: moving back and the issue card round trip
  // **Validates: Requirements 2.9, 2.13**
  it("returns to the same position and answers after NEXT and BACK, and to the same state after a card", () => {
    fc.assert(
      fc.property(bundleArb, traceArb, (bundle, choices) => {
        for (const { before, event, after } of runTrace(bundle, choices)) {
          if (before.phase === "QUESTION" && event.type === "NEXT" && after.phase === "QUESTION" && sessionOf(after).position === sessionOf(before).position + 1) {
            const back = diagnosticReducer(after, { type: "BACK" });
            expect(sessionOf(back).position).toBe(sessionOf(before).position);
            expect(sessionOf(back).answers).toEqual(sessionOf(before).answers);
          }
          if (["QUESTION", "RESULT", "ANSWER_EDIT"].includes(before.phase)) {
            const card = diagnosticReducer(before, { type: "OPEN_CARD", cardId: "card-1" });
            expect(card.phase).toBe("FACT_CARD");
            expect(diagnosticReducer(card, { type: "CLOSE_CARD" })).toBe(before);
          }
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 43: the priority themes
  // **Validates: Requirements 2.5, 2.12**
  it("keeps the priority answer in one of five forms, and a third theme gives PICK_LIMIT without a change", () => {
    fc.assert(
      fc.property(traceArb, (choices) => {
        for (const { before, event, after } of runTrace(FULL_BUNDLE, choices)) {
          if ("session" in after) {
            expect(["none", "UNSURE", "DECLINE", "one", "two"]).toContain(
              answerForm(Object.hasOwn(after.session.answers, PICK_ID) ? after.session.answers[PICK_ID] : undefined),
            );
          }
          if (before.phase === "QUESTION" && event.type === "TOGGLE_PICK") {
            const value = Object.hasOwn(sessionOf(before).answers, PICK_ID) ? sessionOf(before).answers[PICK_ID] : undefined;
            const chosen = typeof value === "object" && value !== null ? value.pick : [];
            if (chosen.length === 2 && !chosen.some((theme) => theme === event.item) && event.item !== "UNSURE" && event.item !== "DECLINE") {
              expect(after).toMatchObject({ phase: "QUESTION", hint: "PICK_LIMIT" });
              expect(sessionOf(after).answers).toBe(sessionOf(before).answers);
            }
          }
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 44: no moving on without an answer
  // **Validates: Requirements 2.8**
  it("does not move or change the answers on NEXT from an unanswered question, and sets SELECT_REQUIRED", () => {
    fc.assert(
      fc.property(bundleArb, traceArb, (bundle, choices) => {
        for (const { before } of runTrace(bundle, choices)) {
          if (before.phase !== "QUESTION") {
            continue;
          }
          const question = questionAtPosition(before.session);
          if (question === undefined || Object.hasOwn(before.session.answers, question.questionId)) {
            continue;
          }
          const after = diagnosticReducer(before, { type: "NEXT" });
          expect(after).toMatchObject({ phase: "QUESTION", hint: "SELECT_REQUIRED" });
          expect(sessionOf(after).position).toBe(before.session.position);
          expect(sessionOf(after).answers).toBe(before.session.answers);
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 45: starting again
  // **Validates: Requirements 6.5**
  it("goes back to the first question with no answer and no result, keeping the bundle", () => {
    fc.assert(
      fc.property(bundleArb, traceArb, (bundle, choices) => {
        for (const { before } of runTrace(bundle, choices)) {
          if (!["QUESTION", "RESULT", "ANSWER_EDIT"].includes(before.phase)) {
            continue;
          }
          const after = diagnosticReducer(before, { type: "RESTART" });
          expect(after).toMatchObject({ phase: "QUESTION", hint: "NONE" });
          const session = sessionOf(after);
          expect(session.answers).toEqual({});
          expect(session.position).toBe(0);
          expect(session.current).toBeNull();
          expect(session.previous).toBeNull();
          expect(session.bundle).toBe(sessionOf(before).bundle);
          expect(session.setKind).toBe(sessionOf(before).setKind);
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 46: changing answers
  // **Validates: Requirements 6.2, 6.11**
  it("makes the new result from the new answers alone, and keeps the last good map as the earlier result", () => {
    fc.assert(
      fc.property(traceArb, (choices) => {
        for (const { before, event, after } of runTrace(FULL_BUNDLE, choices)) {
          if (before.phase !== "ANSWER_EDIT" || event.type !== "CONFIRM_EDIT") {
            continue;
          }
          expect(after.phase).toBe("RESULT");
          const session = sessionOf(after);
          const old = before.session.current;
          expect(session.answers).toBe(before.draft);
          expect(session.previous).toEqual(old !== null && old.ok ? old.value : before.session.previous);
          expect(session.current).toEqual(generateValuesMap(toMapInput(FULL_BUNDLE, "FULL", before.draft)));
        }
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 47: skipping the choice of the diagnostic set
  // **Validates: Requirements 2.15**
  it("starts at once when the bundle has one diagnostic set and asks when it has two", () => {
    fc.assert(
      fc.property(bundleArb, (bundle) => {
        const intro = diagnosticReducer(initialDiagnosticState, { type: "BUNDLE_LOADED", bundle });
        const after = diagnosticReducer(intro, { type: "START" });
        expect(after.phase).toBe(bundle.diagnosticSets.length === 1 ? "QUESTION" : "SET_SELECT");
      }),
      PARAMETERS,
    );
  });

  // Feature: regional-values-map, Property 56: catching an unexpected exception
  // **Validates: Requirements 5.19, 6.5**
  it("never throws when the map generation throws, and an UNEXPECTED_ERROR holds only the bundle and the diagnostic set", () => {
    const secret = "SECRET-ERROR-MESSAGE-91c2";
    const throwing = createDiagnosticReducer({
      generateValuesMap: () => {
        throw new RangeError(secret);
      },
    });
    let seen = 0;
    const checkError = (after: DiagnosticState): void => {
      expect(after.phase).toBe("UNEXPECTED_ERROR");
      expect(Object.keys(after).sort()).toEqual(["bundle", "phase", "setKind"]);
      const text = JSON.stringify(after);
      expect(text).not.toContain(secret);
      for (const code of ["IMPORTANT", "A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG", "UNSURE", "DECLINE"]) {
        expect(text).not.toContain(code);
      }
      const restarted = throwing(after, { type: "RESTART" });
      expect(["QUESTION", "INTRO"]).toContain(restarted.phase);
      expect(sessionOf(restarted).answers).toEqual({});
      expect(throwing(after, { type: "NEXT" })).toBe(after);
      seen += 1;
    };
    fc.assert(
      fc.property(bundleArb, fc.array(fc.nat(100), { minLength: 13, maxLength: 13 }), traceArb, (bundle, picks, choices) => {
        const first = bundle.diagnosticSets[0];
        if (first === undefined) {
          return;
        }
        // (1) Answer every question; the NEXT of the last question calls the map generation.
        let state = started(bundle, first.setKind);
        first.questionIds.forEach((questionId, index) => {
          const question = bundle.questions.find((candidate) => candidate.questionId === questionId);
          if (question !== undefined) {
            state = diagnosticReducer(state, validAnswerEvent(question, picks[index] ?? 0));
          }
          if (index < first.questionIds.length - 1) {
            state = diagnosticReducer(state, { type: "NEXT" });
          }
        });
        checkError(throwing(state, { type: "NEXT" }));

        // (2) Confirming an edit calls it again.
        const result = diagnosticReducer(state, { type: "NEXT" });
        const edit = diagnosticReducer(result, { type: "OPEN_EDIT", scope: "ALL" });
        if (edit.phase === "ANSWER_EDIT") {
          checkError(throwing(edit, { type: "CONFIRM_EDIT" }));
        }

        // (3) No event sequence makes the reducer throw.
        for (const { after } of runTrace(bundle, choices, throwing)) {
          if (after.phase === "UNEXPECTED_ERROR") {
            checkError(after);
          }
        }
      }),
      PARAMETERS,
    );
    expect(seen).toBeGreaterThan(0);
  });
});