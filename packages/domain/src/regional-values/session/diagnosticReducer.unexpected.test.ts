import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerAll,
  play,
  select,
  sessionOf,
  started,
} from "../../../../../tests/harness/regional-values/sessionDriver.js";
import { QUICK_BUNDLE } from "../../../../../tests/harness/regional-values/testBundle.js";
import { createDiagnosticReducer, diagnosticReducer } from "./diagnosticReducer.js";
import type { DiagnosticEvent, DiagnosticState } from "./sessionTypes.js";

const SECRET = "SECRET-ERROR-MESSAGE-7f3a";

const throwing = createDiagnosticReducer({
  generateValuesMap: () => {
    throw new RangeError(SECRET);
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnosticReducer: an unexpected exception (Req 5.19)", () => {
  const last = answerAllButLast();

  function answerAllButLast(): DiagnosticState {
    return play(
      started(QUICK_BUNDLE, "QUICK", throwing),
      [
        select("q-ed-imp", "NOT_VERY_IMPORTANT"),
        { type: "NEXT" },
        select("q-ed-tra", "BALANCED"),
        { type: "NEXT" },
        select("q-dp-imp", "IMPORTANT"),
        { type: "NEXT" },
        select("q-dp-tra", "B_STRONG"),
        { type: "NEXT" },
        select("q-pr-imp", "VERY_IMPORTANT"),
        { type: "NEXT" },
        select("q-pr-tra", "A_LEAN"),
      ],
      throwing,
    );
  }

  it("does not throw, and goes to UNEXPECTED_ERROR with only the bundle and the diagnostic set", () => {
    expect(() => throwing(last, { type: "NEXT" })).not.toThrow();
    const state = throwing(last, { type: "NEXT" });
    expect(state.phase).toBe("UNEXPECTED_ERROR");
    expect(Object.keys(state).sort()).toEqual(["bundle", "phase", "setKind"]);
    expect(state).toMatchObject({ bundle: QUICK_BUNDLE, setKind: "QUICK" });
  });

  it("keeps no answer, no result and no part of the exception in the state", () => {
    const text = JSON.stringify(throwing(last, { type: "NEXT" }));
    expect(text).not.toContain(SECRET);
    for (const code of ["NOT_VERY_IMPORTANT", "BALANCED", "B_STRONG", "VERY_IMPORTANT", "A_LEAN", "DETERMINED"]) {
      expect(text).not.toContain(code);
    }
  });

  it("writes nothing to the console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    throwing(last, { type: "NEXT" });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("catches an exception while confirming an edit as well", () => {
    const edit = play(answerAll(started(QUICK_BUNDLE, "QUICK")), [
      { type: "OPEN_EDIT", scope: "ALL" },
      select("q-ed-imp", "IMPORTANT"),
    ]);
    expect(throwing(edit, { type: "CONFIRM_EDIT" }).phase).toBe("UNEXPECTED_ERROR");
  });

  it("leaves a MapError as an ordinary result", () => {
    const unsure = answerAll(
      started(QUICK_BUNDLE, "QUICK"),
      ["q-ed-imp", "q-ed-tra", "q-dp-imp", "q-dp-tra", "q-pr-imp", "q-pr-tra"].map((questionId) => [questionId, "DECLINE"] as const),
    );
    expect(unsure.phase).toBe("RESULT");
    const returnsError = createDiagnosticReducer({
      generateValuesMap: () => ({ ok: false, error: { code: "UNKNOWN_QUESTION", questionIds: ["x"] } }),
    });
    const state = returnsError(last, { type: "NEXT" });
    expect(state.phase).toBe("RESULT");
  });

  it("turns an inconsistent bundle into UNEXPECTED_ERROR instead of throwing", () => {
    const inconsistent = { ...QUICK_BUNDLE, questions: [] };
    const question = started(inconsistent, "QUICK");
    expect(question.phase).toBe("QUESTION");
    expect(() => diagnosticReducer(question, select("q-ed-imp", "IMPORTANT"))).not.toThrow();
    expect(diagnosticReducer(question, select("q-ed-imp", "IMPORTANT")).phase).toBe("UNEXPECTED_ERROR");
  });
});

describe("diagnosticReducer: leaving UNEXPECTED_ERROR with RESTART (Req 5.19, 6.5)", () => {
  const last = play(
    started(QUICK_BUNDLE, "QUICK", throwing),
    [
      select("q-ed-imp", "NOT_VERY_IMPORTANT"),
      { type: "NEXT" },
      select("q-ed-tra", "BALANCED"),
    ],
    throwing,
  );
  const error = throwing(
    play(last, [
      { type: "NEXT" },
      select("q-dp-imp", "IMPORTANT"),
      { type: "NEXT" },
      select("q-dp-tra", "B_STRONG"),
      { type: "NEXT" },
      select("q-pr-imp", "VERY_IMPORTANT"),
      { type: "NEXT" },
      select("q-pr-tra", "A_LEAN"),
    ], throwing),
    { type: "NEXT" },
  );

  it("starts the same diagnostic set again with no answer", () => {
    expect(error.phase).toBe("UNEXPECTED_ERROR");
    const restarted = diagnosticReducer(error, { type: "RESTART" });
    expect(restarted).toMatchObject({ phase: "QUESTION", hint: "NONE" });
    expect(sessionOf(restarted).answers).toEqual({});
    expect(sessionOf(restarted).position).toBe(0);
    expect(sessionOf(restarted).setKind).toBe("QUICK");
    expect(sessionOf(restarted).bundle).toBe(QUICK_BUNDLE);
  });

  it("goes to INTRO when no diagnostic set had been chosen, and stays when there is no bundle", () => {
    const noSet: DiagnosticState = { phase: "UNEXPECTED_ERROR", bundle: QUICK_BUNDLE, setKind: null };
    expect(diagnosticReducer(noSet, { type: "RESTART" }).phase).toBe("INTRO");
    const noBundle: DiagnosticState = { phase: "UNEXPECTED_ERROR", bundle: null, setKind: null };
    expect(diagnosticReducer(noBundle, { type: "RESTART" })).toBe(noBundle);
  });

  it("ignores every other event", () => {
    const events: DiagnosticEvent[] = [
      { type: "START" },
      { type: "NEXT" },
      { type: "BACK" },
      { type: "OPEN_ABOUT" },
      { type: "OPEN_CARD", cardId: "card-1" },
      { type: "OPEN_EDIT", scope: "ALL" },
      { type: "CONFIRM_EDIT" },
      { type: "BUNDLE_LOADED", bundle: QUICK_BUNDLE },
      select("q-ed-imp", "IMPORTANT"),
    ];
    for (const event of events) {
      expect(diagnosticReducer(error, event)).toBe(error);
    }
  });
});