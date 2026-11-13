import type { Answers, ThemeId } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { PICK_ID, TR, ED, EC, HC, DP, PR, THEME_ORDER } from "../../../../../tests/harness/regional-values/testBanks.js";
import { FULL_BUNDLE } from "../../../../../tests/harness/regional-values/testBundle.js";
import { clearAnswer, isAnswered, matchesKind, selectAnswer, togglePick } from "./answerEditing.js";
import type { SessionQuestion } from "./sessionTypes.js";

function questionOf(questionId: string): SessionQuestion {
  const question = FULL_BUNDLE.questions.find((candidate) => candidate.questionId === questionId);
  if (question === undefined) {
    throw new Error(`no question ${questionId}`);
  }
  return question;
}

const importance = questionOf("q-tr-imp");
const tradeoff = questionOf("q-tr-tra");
const pick = questionOf(PICK_ID);

function toggle(answers: Answers, item: string): { answers: Answers; hint: string } {
  return togglePick(answers, pick, item, THEME_ORDER);
}

describe("selectAnswer and matchesKind", () => {
  it("replaces the answer and keeps only the latest one", () => {
    const first = selectAnswer({}, importance, "IMPORTANT");
    const second = selectAnswer(first, importance, "NOT_IMPORTANT");
    expect(first).toEqual({ "q-tr-imp": "IMPORTANT" });
    expect(second).toEqual({ "q-tr-imp": "NOT_IMPORTANT" });
  });

  it("accepts the codes of its own family and UNSURE or DECLINE", () => {
    for (const code of ["VERY_IMPORTANT", "IMPORTANT", "NEUTRAL", "NOT_VERY_IMPORTANT", "NOT_IMPORTANT", "UNSURE", "DECLINE"]) {
      expect(matchesKind(importance, code)).toBe(true);
    }
    for (const code of ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG", "UNSURE", "DECLINE"]) {
      expect(matchesKind(tradeoff, code)).toBe(true);
    }
  });

  it("ignores a code of the other family, UNANSWERED, an unknown word and any value for the priority question", () => {
    const answers: Answers = { "q-tr-imp": "IMPORTANT" };
    for (const [question, value] of [
      [importance, "A_STRONG"],
      [tradeoff, "VERY_IMPORTANT"],
      [importance, "UNANSWERED"],
      [importance, "MAYBE"],
      [pick, "IMPORTANT"],
      [pick, "UNSURE"],
    ] as const) {
      expect(matchesKind(question, value)).toBe(false);
      expect(selectAnswer(answers, question, value)).toBe(answers);
    }
  });

  it("does not change its input", () => {
    const answers: Answers = Object.freeze({ "q-tr-imp": "IMPORTANT" });
    expect(() => selectAnswer(answers, importance, "NEUTRAL")).not.toThrow();
    expect(answers).toEqual({ "q-tr-imp": "IMPORTANT" });
  });
});

describe("clearAnswer and isAnswered", () => {
  it("removes the key, and gives back the same object when there is no key", () => {
    const answers: Answers = { "q-tr-imp": "IMPORTANT", "q-tr-tra": "A_LEAN" };
    expect(isAnswered(answers, "q-tr-imp")).toBe(true);
    expect(clearAnswer(answers, "q-tr-imp")).toEqual({ "q-tr-tra": "A_LEAN" });
    expect(isAnswered(clearAnswer(answers, "q-tr-imp"), "q-tr-imp")).toBe(false);
    expect(clearAnswer(answers, "q-ed-imp")).toBe(answers);
    expect(answers).toEqual({ "q-tr-imp": "IMPORTANT", "q-tr-tra": "A_LEAN" });
  });

  it("counts UNSURE and DECLINE as answered", () => {
    expect(isAnswered({ "q-tr-imp": "UNSURE" }, "q-tr-imp")).toBe(true);
    expect(isAnswered({ "q-tr-imp": "DECLINE" }, "q-tr-imp")).toBe(true);
  });

  it("does not treat an inherited property as an answer", () => {
    expect(isAnswered({}, "toString")).toBe(false);
  });
});

describe("togglePick: the five forms of the selection", () => {
  it("selects one theme, then a second theme, stored in theme definition order", () => {
    const one = toggle({}, PR);
    expect(one).toEqual({ answers: { [PICK_ID]: { pick: [PR] } }, hint: "NONE" });
    const two = toggle(one.answers, TR);
    expect(two.answers).toEqual({ [PICK_ID]: { pick: [TR, PR] } });
  });

  it("gives PICK_LIMIT for a third theme and leaves the selection as it is", () => {
    const two = toggle(toggle({}, ED).answers, EC).answers;
    const third = toggle(two, HC);
    expect(third.hint).toBe("PICK_LIMIT");
    expect(third.answers).toBe(two);
  });

  it("clears a chosen theme when it is chosen again, and removes the key with the last theme", () => {
    const two = toggle(toggle({}, ED).answers, EC).answers;
    const one = toggle(two, ED);
    expect(one.answers).toEqual({ [PICK_ID]: { pick: [EC] } });
    const none = toggle(one.answers, EC);
    expect(none.answers).toEqual({});
    expect(isAnswered(none.answers, PICK_ID)).toBe(false);
  });

  it("lets UNSURE or DECLINE clear the themes, and a theme clear UNSURE or DECLINE", () => {
    const themes = toggle(toggle({}, ED).answers, EC).answers;
    expect(toggle(themes, "UNSURE").answers).toEqual({ [PICK_ID]: "UNSURE" });
    expect(toggle(themes, "DECLINE").answers).toEqual({ [PICK_ID]: "DECLINE" });
    expect(toggle({ [PICK_ID]: "UNSURE" }, DP).answers).toEqual({ [PICK_ID]: { pick: [DP] } });
    expect(toggle({ [PICK_ID]: "DECLINE" }, DP).answers).toEqual({ [PICK_ID]: { pick: [DP] } });
    expect(toggle({ [PICK_ID]: "UNSURE" }, "DECLINE").answers).toEqual({ [PICK_ID]: "DECLINE" });
  });

  it("clears UNSURE or DECLINE when it is chosen again", () => {
    expect(toggle({ [PICK_ID]: "UNSURE" }, "UNSURE").answers).toEqual({});
    expect(toggle({ [PICK_ID]: "DECLINE" }, "DECLINE").answers).toEqual({});
  });

  it("ignores an item that is not a theme, and any other kind of question", () => {
    expect(toggle({}, "NOT_A_THEME")).toEqual({ answers: {}, hint: "NONE" });
    expect(togglePick({}, importance, ED, THEME_ORDER)).toEqual({ answers: {}, hint: "NONE" });
  });

  it("always leaves one of the five forms, for every sequence of two to four toggles", () => {
    const items: string[] = [...THEME_ORDER, "UNSURE", "DECLINE"];
    const forms = new Set<string>();
    const walk = (answers: Answers, depth: number): void => {
      const value = answers[PICK_ID];
      const form =
        value === undefined
          ? "none"
          : typeof value === "string"
            ? value
            : value.pick.length === 1
              ? "one"
              : "two";
      forms.add(form);
      expect(["none", "UNSURE", "DECLINE", "one", "two"]).toContain(form);
      if (depth < 4) {
        for (const item of items) {
          walk(toggle(answers, item).answers, depth + 1);
        }
      }
    };
    walk({}, 0);
    expect(forms.size).toBe(5);
  });

  it("does not change its input", () => {
    const picked: ThemeId[] = [ED];
    const answers: Answers = Object.freeze({ [PICK_ID]: Object.freeze({ pick: picked }) });
    expect(() => toggle(answers, EC)).not.toThrow();
    expect(answers).toEqual({ [PICK_ID]: { pick: [ED] } });
  });
});