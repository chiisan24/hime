import { describe, expect, it } from "vitest";

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
import { diagnosticReducer } from "./diagnosticReducer.js";
import type { DiagnosticState } from "./sessionTypes.js";
import { toMapInput } from "./toMapInput.js";

const result = answerAll(started(QUICK_BUNDLE, "QUICK"));
const ALL_QUICK = V15_STEPS.map(([questionId]) => questionId);

function editing(state: DiagnosticState): DiagnosticState {
  return diagnosticReducer(state, { type: "OPEN_EDIT", scope: "ALL" });
}

describe("diagnosticReducer: editing all the answers (Req 6.2)", () => {
  it("opens the edit with a draft equal to the answers and every question of the set editable", () => {
    const edit = editing(result);
    expect(edit.phase).toBe("ANSWER_EDIT");
    if (edit.phase !== "ANSWER_EDIT") {
      return;
    }
    expect(edit.draft).toBe(sessionOf(result).answers);
    expect(edit.editable).toEqual(ALL_QUICK);
    expect(edit.hint).toBe("NONE");
  });

  it("changes only the draft while editing", () => {
    const edit = play(editing(result), [select("q-ed-imp", "VERY_IMPORTANT")]);
    expect(edit.phase).toBe("ANSWER_EDIT");
    if (edit.phase !== "ANSWER_EDIT") {
      return;
    }
    expect(edit.draft["q-ed-imp"]).toBe("VERY_IMPORTANT");
    expect(sessionOf(edit).answers["q-ed-imp"]).toBe("NOT_VERY_IMPORTANT");
    expect(sessionOf(edit).current).toBe(sessionOf(result).current);
  });

  it("confirms: the answers become the draft, the old map becomes the earlier result, a new map is made", () => {
    const edit = play(editing(result), [select("q-ed-imp", "VERY_IMPORTANT"), select("q-ed-tra", "A_STRONG")]);
    const confirmed = diagnosticReducer(edit, { type: "CONFIRM_EDIT" });
    expect(confirmed).toMatchObject({ phase: "RESULT", focusThemeId: null });
    const session = sessionOf(confirmed);
    const before = sessionOf(result).current;
    expect(before?.ok).toBe(true);
    expect(session.previous).toEqual(before?.ok ? before.value : null);
    expect(session.current).toEqual(generateValuesMap(toMapInput(QUICK_BUNDLE, "QUICK", session.answers)));
    expect(session.answers["q-ed-imp"]).toBe("VERY_IMPORTANT");
    expect(session.answers["q-ed-tra"]).toBe("A_STRONG");
  });

  it("cancels: the answers, the result and the earlier result are exactly as they were", () => {
    const edit = play(editing(result), [select("q-ed-imp", "VERY_IMPORTANT")]);
    const cancelled = diagnosticReducer(edit, { type: "CANCEL_EDIT" });
    expect(cancelled.phase).toBe("RESULT");
    expect(sessionOf(cancelled)).toBe(sessionOf(result));
  });

  it("ignores a question that is not editable, and an event the edit does not list", () => {
    const edit = editing(result);
    expect(diagnosticReducer(edit, select("q-not-there", "IMPORTANT"))).toBe(edit);
    expect(diagnosticReducer(edit, { type: "NEXT" })).toBe(edit);
    expect(diagnosticReducer(edit, { type: "FOCUS_THEME", themeId: null })).toBe(edit);
  });

  it("opens the issue card from the edit and comes back to the same edit", () => {
    const edit = play(editing(result), [select("q-ed-imp", "VERY_IMPORTANT")]);
    const card = diagnosticReducer(edit, { type: "OPEN_CARD", cardId: "card-1" });
    expect(card.phase).toBe("FACT_CARD");
    expect(diagnosticReducer(card, { type: "CLOSE_CARD" })).toBe(edit);
  });
});

describe("diagnosticReducer: editing the answers of one unsure theme (Req 6.4)", () => {
  const unsure = answerAll(
    started(QUICK_BUNDLE, "QUICK"),
    V15_STEPS.map(([questionId, value]): [string, typeof value] => [questionId, questionId === "q-ed-imp" ? "UNSURE" : value]),
  );

  it("makes only the questions of that theme editable", () => {
    const edit = diagnosticReducer(unsure, { type: "OPEN_EDIT", scope: { themeId: "EDUCATION_CHILDCARE" } });
    expect(edit.phase).toBe("ANSWER_EDIT");
    if (edit.phase === "ANSWER_EDIT") {
      expect(edit.editable).toEqual(["q-ed-imp", "q-ed-tra"]);
    }
  });

  it("ignores a theme that is not unsure", () => {
    expect(diagnosticReducer(unsure, { type: "OPEN_EDIT", scope: { themeId: "DISASTER_PREVENTION" } })).toBe(unsure);
    expect(diagnosticReducer(result, { type: "OPEN_EDIT", scope: { themeId: "EDUCATION_CHILDCARE" } })).toBe(result);
  });

  it("adds the priority question when the theme is in conflict with the priority themes", () => {
    let state = started(FULL_BUNDLE, "FULL");
    for (const question of FULL_BUNDLE.questions.filter((candidate) => candidate.kind !== "PRIORITY_PICK")) {
      const value = question.questionId === "q-hc-imp" ? "NOT_IMPORTANT" : question.kind === "IMPORTANCE" ? "IMPORTANT" : "BALANCED";
      state = play(state, [select(question.questionId, value), { type: "NEXT" }]);
    }
    state = play(state, [{ type: "TOGGLE_PICK", questionId: PICK_ID, item: "HEALTHCARE_WELFARE" }, { type: "NEXT" }]);
    expect(state.phase).toBe("RESULT");
    const edit = diagnosticReducer(state, { type: "OPEN_EDIT", scope: { themeId: "HEALTHCARE_WELFARE" } });
    expect(edit.phase).toBe("ANSWER_EDIT");
    if (edit.phase === "ANSWER_EDIT") {
      expect(edit.editable).toEqual(["q-hc-imp", "q-hc-tra", PICK_ID]);
    }
  });
});

describe("diagnosticReducer: a change that leaves no opinion answer (Req 6.11)", () => {
  const allUnsure = play(
    editing(result),
    ALL_QUICK.map((questionId) => select(questionId, "UNSURE")),
  );

  it("keeps the new answers and the old map, and shows the error as the current result", () => {
    const confirmed = diagnosticReducer(allUnsure, { type: "CONFIRM_EDIT" });
    expect(confirmed.phase).toBe("RESULT");
    const session = sessionOf(confirmed);
    expect(session.current).toEqual({ ok: false, error: { code: "NO_OPINION_ANSWERS" } });
    expect(Object.values(session.answers)).toEqual(Array(6).fill("UNSURE"));
    const before = sessionOf(result).current;
    expect(session.previous).toEqual(before?.ok ? before.value : null);
  });

  it("lets the user review the answers again, and keeps the first map as the earlier result after a failed change", () => {
    const failed = diagnosticReducer(allUnsure, { type: "CONFIRM_EDIT" });
    const again = play(failed, [{ type: "OPEN_EDIT", scope: "ALL" }, select("q-ed-imp", "IMPORTANT"), { type: "CONFIRM_EDIT" }]);
    const session = sessionOf(again);
    expect(session.current?.ok).toBe(true);
    const first = sessionOf(result).current;
    expect(session.previous).toEqual(first?.ok ? first.value : null);
  });
});

describe("diagnosticReducer: starting again (Req 6.5)", () => {
  const middle = play(started(QUICK_BUNDLE, "QUICK"), [select("q-ed-imp", "IMPORTANT"), { type: "NEXT" }]);
  const states: [string, DiagnosticState][] = [
    ["QUESTION", middle],
    ["RESULT", result],
    ["ANSWER_EDIT", editing(result)],
  ];

  it.each(states)("goes from %s to the first question, drops the answers and both results, and keeps the bundle", (_name, state) => {
    const restarted = diagnosticReducer(state, { type: "RESTART" });
    expect(restarted).toMatchObject({ phase: "QUESTION", hint: "NONE" });
    const session = sessionOf(restarted);
    expect(session.answers).toEqual({});
    expect(session.position).toBe(0);
    expect(session.current).toBeNull();
    expect(session.previous).toBeNull();
    expect(session.setKind).toBe("QUICK");
    expect(session.bundle).toBe(QUICK_BUNDLE);
  });

  it("does not offer another diagnostic set", () => {
    const full = started(FULL_BUNDLE, "FULL");
    expect(sessionOf(diagnosticReducer(full, { type: "RESTART" })).setKind).toBe("FULL");
  });
});

describe("diagnosticReducer: a configuration error (Req 5.14 c)", () => {
  const broken = sessionBundleFor(TB_QUICK, { t1: 0, t2: 150 });
  const state = answerAll(started(broken, "QUICK"));

  it("shows INVALID_CONFIG and then ignores OPEN_EDIT and RESTART", () => {
    expect(state.phase).toBe("RESULT");
    expect(sessionOf(state).current).toEqual({ ok: false, error: { code: "INVALID_CONFIG" } });
    expect(diagnosticReducer(state, { type: "OPEN_EDIT", scope: "ALL" })).toBe(state);
    expect(diagnosticReducer(state, { type: "RESTART" })).toBe(state);
  });

  it("still opens the About screen", () => {
    expect(diagnosticReducer(state, { type: "OPEN_ABOUT" }).phase).toBe("ABOUT");
  });
});