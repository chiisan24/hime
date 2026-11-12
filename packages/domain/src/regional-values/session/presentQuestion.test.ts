import { QuestionSchema, type Question } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { FULL_VIEW_BUNDLE, QUICK_VIEW_BUNDLE } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { sessionOf, started } from "../../../../../tests/harness/regional-values/sessionDriver.js";
import type { RichText, ViewBundle } from "../view/viewTypes.js";
import { diagnosticReducer } from "./diagnosticReducer.js";
import { presentQuestion } from "./presentQuestion.js";
import type { Session } from "./sessionTypes.js";

const quick = QUICK_VIEW_BUNDLE;
const full = FULL_VIEW_BUNDLE;

function sessionAt(bundle: ViewBundle, setKind: "QUICK" | "FULL", position: number, answers: Session["answers"] = {}): Session {
  return { ...sessionOf(started(bundle, setKind)), position, answers };
}

const termsOf = (text: RichText): string[] => text.flatMap((part) => (part.t === "term" ? [part.v] : []));

describe("presentQuestion: the six questions of QUICK", () => {
  const expected = [
    ["q-ed-imp", "IMPORTANCE", "教育・子育て"],
    ["q-ed-tra", "TRADEOFF", "教育・子育て"],
    ["q-dp-imp", "IMPORTANCE", "防災"],
    ["q-dp-tra", "TRADEOFF", "防災"],
    ["q-pr-imp", "IMPORTANCE", "人口減少・地域活性化"],
    ["q-pr-tra", "TRADEOFF", "人口減少・地域活性化"],
  ] as const;

  it.each(expected.map((row, index) => [index, ...row] as const))("question %i is %s (%s, %s)", (index, questionId, kind, theme) => {
    const view = presentQuestion(quick, sessionAt(quick, "QUICK", index), "NONE");
    expect(view.questionId).toBe(questionId);
    expect(view.kind).toBe(kind);
    expect(view.themeLabel).toBe(theme);
    expect(view.position).toEqual({ current: index + 1, total: 6 });
    expect(view.text.map((part) => part.v).join("")).toBe(`質問:${questionId}`);
  });

  it("shows seven options for each: five opinions, then UNSURE and DECLINE, each with the event to send", () => {
    const view = presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE");
    expect(view.options.map((option) => [option.kind, option.id])).toEqual([
      ["OPINION", "VERY_IMPORTANT"],
      ["OPINION", "IMPORTANT"],
      ["OPINION", "NEUTRAL"],
      ["OPINION", "NOT_VERY_IMPORTANT"],
      ["OPINION", "NOT_IMPORTANT"],
      ["UNSURE", "UNSURE"],
      ["DECLINE", "DECLINE"],
    ]);
    expect(view.options[0]?.event).toEqual({ type: "SELECT_ANSWER", questionId: "q-ed-imp", value: "VERY_IMPORTANT" });
    expect(view.options[5]).toMatchObject({ label: "わからない", event: { type: "SELECT_ANSWER", questionId: "q-ed-imp", value: "UNSURE" } });
    expect(view.options[6]).toMatchObject({ label: "回答しない", event: { type: "SELECT_ANSWER", questionId: "q-ed-imp", value: "DECLINE" } });
    expect(view.options.map((option) => option.label).slice(0, 5)).toEqual(["とても大切", "大切", "どちらでもない", "あまり大切でない", "大切でない"]);
  });

  it("marks only the chosen option as selected", () => {
    const view = presentQuestion(quick, sessionAt(quick, "QUICK", 0, { "q-ed-imp": "IMPORTANT" }), "NONE");
    expect(view.options.filter((option) => option.selected).map((option) => option.id)).toEqual(["IMPORTANT"]);
    const declined = presentQuestion(quick, sessionAt(quick, "QUICK", 0, { "q-ed-imp": "DECLINE" }), "NONE");
    expect(declined.options.filter((option) => option.selected).map((option) => option.id)).toEqual(["DECLINE"]);
  });

  it("shows the premise and the two directions of a trade-off question, and none for an importance question", () => {
    const tradeoff = presentQuestion(quick, sessionAt(quick, "QUICK", 1), "NONE");
    expect(tradeoff.premise).toBe("限られた予算での選択を考えます。");
    expect(tradeoff.directions).toEqual([
      { side: "A", text: "方向Aの文" },
      { side: "B", text: "方向Bの文" },
    ]);
    const importance = presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE");
    expect(importance.premise).toBeNull();
    expect(importance.directions).toBeNull();
  });
});

describe("presentQuestion: swapped directions", () => {
  const swapped: ViewBundle = {
    ...quick,
    questions: quick.questions.map((question): Question =>
      question.questionId === "q-ed-tra" ? QuestionSchema.parse({ ...question, swapDirections: true }) : question,
    ),
  };

  it("shows the directions and the five options in the other order, and keeps the answer value of each option", () => {
    const plain = presentQuestion(quick, sessionAt(quick, "QUICK", 1), "NONE");
    const flipped = presentQuestion(swapped, sessionAt(swapped, "QUICK", 1), "NONE");
    expect(flipped.directions?.map((direction) => direction.side)).toEqual(["B", "A"]);
    expect(flipped.options.map((option) => option.id)).toEqual([
      "B_STRONG",
      "B_LEAN",
      "BALANCED",
      "A_LEAN",
      "A_STRONG",
      "UNSURE",
      "DECLINE",
    ]);
    for (const option of flipped.options) {
      expect(option.event).toEqual(plain.options.find((candidate) => candidate.id === option.id)?.event);
      expect(option.label).toBe(plain.options.find((candidate) => candidate.id === option.id)?.label);
    }
  });
});

describe("presentQuestion: the priority-theme question of FULL", () => {
  const pick = sessionAt(full, "FULL", 12, { "q-pick": { pick: ["HEALTHCARE_WELFARE", "DISASTER_PREVENTION"] } });
  const view = presentQuestion(full, pick, "NONE");

  it("is a cross-theme question with the six themes, then UNSURE and DECLINE", () => {
    expect(view.kind).toBe("PRIORITY_PICK");
    expect(view.themeLabel).toBe("〈reflection.crossTheme〉");
    expect(view.position).toEqual({ current: 13, total: 13 });
    expect(view.options.map((option) => option.kind)).toEqual(["THEME", "THEME", "THEME", "THEME", "THEME", "THEME", "UNSURE", "DECLINE"]);
    expect(view.options.slice(0, 6).map((option) => option.label)).toEqual([
      "交通",
      "教育・子育て",
      "経済・雇用",
      "医療・福祉",
      "防災",
      "人口減少・地域活性化",
    ]);
    expect(view.premise).toBeNull();
    expect(view.directions).toBeNull();
    expect(view.cardLinks).toEqual([]);
  });

  it("sends TOGGLE_PICK for a theme and for UNSURE and DECLINE, and marks the chosen themes", () => {
    expect(view.options[0]?.event).toEqual({ type: "TOGGLE_PICK", questionId: "q-pick", item: "TRANSPORT" });
    expect(view.options[6]?.event).toEqual({ type: "TOGGLE_PICK", questionId: "q-pick", item: "UNSURE" });
    expect(view.options[7]?.event).toEqual({ type: "TOGGLE_PICK", questionId: "q-pick", item: "DECLINE" });
    expect(view.options.filter((option) => option.selected).map((option) => option.label)).toEqual(["医療・福祉", "防災"]);
  });

  it("shows the next label for the last question as 'show the result'", () => {
    expect(view.nav.nextLabel).toBe("〈ui.showResult〉");
    expect(view.nav.nextEnabled).toBe(true);
  });
});

describe("presentQuestion: navigation, hints and labels", () => {
  it("disables 'back' on the first question and 'next' while the question is unanswered", () => {
    const first = presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE");
    expect(first.nav).toEqual({ backEnabled: false, nextEnabled: false, nextLabel: "〈ui.next〉" });
    const second = presentQuestion(quick, sessionAt(quick, "QUICK", 1, { "q-ed-tra": "BALANCED" }), "NONE");
    expect(second.nav).toEqual({ backEnabled: true, nextEnabled: true, nextLabel: "〈ui.next〉" });
  });

  it("uses 'show the result' for the last question of QUICK only", () => {
    expect(presentQuestion(quick, sessionAt(quick, "QUICK", 5), "NONE").nav.nextLabel).toBe("〈ui.showResult〉");
    expect(presentQuestion(quick, sessionAt(quick, "QUICK", 4), "NONE").nav.nextLabel).toBe("〈ui.next〉");
  });

  it("turns a hint into its fixed text", () => {
    const session = sessionAt(quick, "QUICK", 0);
    expect(presentQuestion(quick, session, "NONE").hintText).toBeNull();
    expect(presentQuestion(quick, session, "SELECT_REQUIRED").hintText).toBe("〈ui.hint.SELECT_REQUIRED〉");
    expect(presentQuestion(quick, session, "PICK_LIMIT").hintText).toBe("〈ui.hint.PICK_LIMIT〉");
  });

  it("links to the issue cards of the theme, and to none for a theme without a card", () => {
    expect(presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE").cardLinks).toEqual([{ cardId: "card-1", title: "〈card-1〉" }]);
    expect(presentQuestion(quick, sessionAt(quick, "QUICK", 2), "NONE").cardLinks).toEqual([{ cardId: "card-2", title: "〈card-2〉" }]);
    expect(presentQuestion(quick, sessionAt(quick, "QUICK", 4), "NONE").cardLinks).toEqual([]);
  });

  it("always shows the data kind, and the AI label only for a question drafted by AI", () => {
    const view = presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE");
    expect(view.dataKindLabel).toEqual({ code: "FIXTURE", text: "〈label.dataKind.FIXTURE〉" });
    expect(view.aiLabel).toBeNull();
    const drafted: ViewBundle = {
      ...quick,
      questions: quick.questions.map((question): Question =>
        question.questionId === "q-ed-imp" ? QuestionSchema.parse({ ...question, author: "AI_DRAFT" }) : question,
      ),
    };
    expect(presentQuestion(drafted, sessionAt(drafted, "QUICK", 0), "NONE").aiLabel).toEqual({ code: "AI_DRAFT", text: "〈label.ai〉" });
  });

  it("notes a registered term once on the screen: the first occurrence in the question text and the explanation", () => {
    const view = presentQuestion(quick, sessionAt(quick, "QUICK", 0), "NONE");
    expect(termsOf(view.text)).toEqual([]);
    expect(termsOf(view.explanation)).toEqual(["試験用"]);
    expect(view.explanation.find((part) => part.t === "term")).toMatchObject({ description: "〈glossary:card-1〉" });
  });

  it("throws, naming no answer, when the position is out of the set", () => {
    expect(() => presentQuestion(quick, sessionAt(quick, "QUICK", 99), "NONE")).toThrow("no question to present");
  });
});

describe("presentQuestion: the events are accepted by the state machine", () => {
  it("every option of the first question of QUICK leads to a QUESTION state that holds the answer", () => {
    const state = started(quick, "QUICK");
    const view = presentQuestion(quick, sessionOf(state), "NONE");
    for (const option of view.options) {
      const next = diagnosticReducer(state, option.event);
      expect(next.phase).toBe("QUESTION");
      expect(sessionOf(next).answers["q-ed-imp"]).toBe(option.id);
    }
  });

  it("pressing two theme options of the priority question gives a pick of both, in the theme definition order", () => {
    let state = started(full, "FULL");
    for (let step = 0; step < 12; step += 1) {
      const view = presentQuestion(full, sessionOf(state), "NONE");
      const first = view.options[0];
      if (first === undefined) {
        throw new Error("no option");
      }
      state = diagnosticReducer(diagnosticReducer(state, first.event), { type: "NEXT" });
    }
    const view = presentQuestion(full, sessionOf(state), "NONE");
    const dp = view.options.find((option) => option.id === "DISASTER_PREVENTION");
    const hc = view.options.find((option) => option.id === "HEALTHCARE_WELFARE");
    if (dp === undefined || hc === undefined) {
      throw new Error("no theme option");
    }
    const after = diagnosticReducer(diagnosticReducer(state, dp.event), hc.event);
    expect(sessionOf(after).answers["q-pick"]).toEqual({ pick: ["HEALTHCARE_WELFARE", "DISASTER_PREVENTION"] });
  });
});