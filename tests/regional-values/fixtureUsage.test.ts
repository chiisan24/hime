import { describe, expect, it } from "vitest";

import { diagnosticReducer, initialDiagnosticState } from "../../packages/domain/src/regional-values/session/diagnosticReducer.js";
import { buildResultViewModel } from "../../packages/domain/src/regional-values/view/buildResultViewModel.js";
import { loadFixtureBundle } from "../harness/regional-values/loadFixtureBundle.js";

const V15_STEPS = [
  ["fixture-population-importance-v1", "VERY_IMPORTANT"],
  ["fixture-population-tradeoff-v1", "A_LEAN"],
  ["fixture-disaster-importance-v1", "IMPORTANT"],
  ["fixture-disaster-tradeoff-v1", "B_STRONG"],
  ["fixture-education-importance-v1", "NOT_VERY_IMPORTANT"],
  ["fixture-education-tradeoff-v1", "BALANCED"],
] as const;

function completeV15() {
  const bundle = loadFixtureBundle();
  let state = diagnosticReducer(initialDiagnosticState, { type: "BUNDLE_LOADED", bundle });
  state = diagnosticReducer(state, { type: "START" });
  for (const [questionId, value] of V15_STEPS) {
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId, value });
    state = diagnosticReducer(state, { type: "NEXT" });
  }
  if (state.phase !== "RESULT") {
    throw new Error("Fixture V15 must reach the result");
  }
  return { bundle, state };
}

function mapView(bundle: ReturnType<typeof loadFixtureBundle>, state: ReturnType<typeof completeV15>["state"]) {
  const current = state.session.current;
  if (state.session.setKind === null || current === null) {
    throw new Error("The result needs a set and map result");
  }
  const view = buildResultViewModel({
    bundle,
    setKind: state.session.setKind,
    answers: state.session.answers,
    current,
    previous: state.session.previous,
    focusThemeId: state.focusThemeId,
  });
  if (view.kind !== "MAP") {
    throw new Error("The fixture answers must make a map view");
  }
  return view;
}

describe("FIXTURE bundle usage", () => {
  it("starts the only QUICK set and reaches a six-question result from the fixture data", () => {
    const { bundle, state } = completeV15();
    expect(state.session.answers).toEqual(Object.fromEntries(V15_STEPS));
    const view = mapView(bundle, state);
    expect(view.frame.dataKind).toBe("FIXTURE");
    expect(view.frame.banner.text).toBe("これはデモ用の架空データです。");
    expect(view.counts).toEqual({ themes: "出題テーマは3件、全テーマは6件です。", questions: "意見回答は6件、出題質問は6件です。" });
    expect(view.priority).toMatchObject({ state: "NOT_ASKED", text: "この診断では最優先テーマを聞いていません。", themes: [] });
    expect(view.importance.groups.map((group) => group.themes.map((theme) => theme.themeId))).toEqual([
      ["POPULATION_REVITALIZATION"],
      ["DISASTER_PREVENTION"],
      [],
      ["EDUCATION_CHILDCARE"],
      [],
    ]);
  });

  it("changes answers through ANSWER_EDIT and keeps unsure, decline, unanswered and not asked in separate views", () => {
    const { bundle, state: firstResult } = completeV15();
    let state = diagnosticReducer(firstResult, { type: "OPEN_EDIT", scope: "ALL" });
    if (state.phase !== "ANSWER_EDIT") {
      throw new Error("The result must open editing");
    }
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId: "fixture-education-importance-v1", value: "UNSURE" });
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId: "fixture-education-tradeoff-v1", value: "A_STRONG" });
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId: "fixture-disaster-importance-v1", value: "IMPORTANT" });
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId: "fixture-disaster-tradeoff-v1", value: "DECLINE" });
    state = diagnosticReducer(state, { type: "CLEAR_ANSWER", questionId: "fixture-population-importance-v1" });
    state = diagnosticReducer(state, { type: "SELECT_ANSWER", questionId: "fixture-population-tradeoff-v1", value: "B_LEAN" });
    state = diagnosticReducer(state, { type: "CONFIRM_EDIT" });
    if (state.phase !== "RESULT") {
      throw new Error("Editing must return to the result");
    }
    const view = mapView(bundle, state);
    expect(view.hesitant.items.map((item) => item.themeId)).toEqual(["EDUCATION_CHILDCARE"]);
    expect(view.declined.columns.find((column) => column.code === "DECLINE")?.themes.map((item) => item.themeId)).toEqual(["DISASTER_PREVENTION"]);
    expect(view.declined.columns.find((column) => column.code === "UNANSWERED")?.themes.map((item) => item.themeId)).toEqual(["POPULATION_REVITALIZATION"]);
    expect(view.notAsked.items.map((item) => item.themeId)).toEqual(["TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"]);
    expect(view.importance.groups.flatMap((group) => group.themes).map((item) => item.themeId)).not.toContain("EDUCATION_CHILDCARE");
    expect(view.diff).not.toBeNull();
  });

  it("restarts the fixture diagnosis at the first question with no answer and no result", () => {
    const { state } = completeV15();
    const restarted = diagnosticReducer(state, { type: "RESTART" });
    expect(restarted.phase).toBe("QUESTION");
    if (restarted.phase === "QUESTION") {
      expect(restarted.session.position).toBe(0);
      expect(restarted.session.answers).toEqual({});
      expect(restarted.session.current).toBeNull();
      expect(restarted.session.previous).toBeNull();
      expect(restarted.session.bundle.meta.dataKind).toBe("FIXTURE");
    }
  });
});