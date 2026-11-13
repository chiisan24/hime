import { describe, expect, it } from "vitest";

import { syntheticFixedTexts } from "../../../../../tests/harness/regional-values/testFixedTexts.js";
import { FULL_VIEW_BUNDLE, QUICK_VIEW_BUNDLE } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { buildAboutView } from "./aboutView.js";
import type { ViewBundle } from "./viewTypes.js";

const contribution = { DRAFTED: 12, REJECTED_BY_CHECKS: 3, HUMAN_EDITED: 5, HUMAN_REJECTED: 1 };
const bundle: ViewBundle = { ...QUICK_VIEW_BUNDLE, aiContribution: contribution };

describe("buildAboutView", () => {
  const view = buildAboutView(bundle);

  it("keeps the banner and its own way back", () => {
    expect(view.frame.banner.text).toBe("〈banner.FIXTURE〉");
  });

  it("lists each question with its theme, who wrote it and who approved it", () => {
    expect(view.questions).toHaveLength(6);
    expect(view.questions[0]).toEqual({
      questionId: "q-ed-imp",
      themeLabel: "教育・子育て",
      author: "〈about.author.HUMAN〉",
      approverId: "approver-1",
    });
  });

  it("shows the cross-theme label for the priority-theme question", () => {
    const pick = buildAboutView(FULL_VIEW_BUNDLE).questions.find((question) => question.questionId === "q-pick");
    expect(pick?.themeLabel).toBe("〈reflection.crossTheme〉");
  });

  it("gives the four rules, each with its heading and body", () => {
    expect(view.rules.map((rule) => rule.code)).toEqual(["MAPPING", "WEIGHT", "NON_OPINION", "GROUPING"]);
    expect(view.rules[0]).toEqual({
      code: "MAPPING",
      heading: "〈about.rules.MAPPING.heading〉",
      body: "〈about.rules.MAPPING.body〉",
    });
  });

  it("shows the thresholds of the bundle", () => {
    expect(view.thresholds).toEqual({ t1: 50, t2: 150, text: "〈about.thresholds〉50150" });
  });

  it("says what kind of data this is, and what AI is used for", () => {
    expect(view.dataKind).toEqual({
      kind: "FIXTURE",
      label: "〈label.dataKind.FIXTURE〉",
      description: "〈about.dataKind.FIXTURE〉",
    });
    expect(view.aiScope).toEqual(["〈about.aiScope〉"]);
  });

  it("gives the number of questions and of themes, and the note that the result rests on a limited range", () => {
    expect(view.coverage).toEqual({
      totalQuestions: "〈about.coverage.totalQuestions〉6",
      totalThemes: "〈about.coverage.totalThemes〉6",
      limitNote: "〈about.coverage.limitNote〉66",
    });
    expect(buildAboutView(FULL_VIEW_BUNDLE).coverage.totalQuestions).toBe("〈about.coverage.totalQuestions〉13");
  });

  it("gives the four numbers of how much AI took part, each a whole number of 0 or more", () => {
    expect(view.aiContribution.map((entry) => [entry.code, entry.value])).toEqual([
      ["DRAFTED", 12],
      ["REJECTED_BY_CHECKS", 3],
      ["HUMAN_EDITED", 5],
      ["HUMAN_REJECTED", 1],
    ]);
    expect(view.aiContribution.map((entry) => entry.label)).toEqual([
      "〈about.aiContribution.DRAFTED〉",
      "〈about.aiContribution.REJECTED_BY_CHECKS〉",
      "〈about.aiContribution.HUMAN_EDITED〉",
      "〈about.aiContribution.HUMAN_REJECTED〉",
    ]);
    expect(view.aiContribution.every((entry) => Number.isInteger(entry.value) && entry.value >= 0)).toBe(true);
  });

  it("leaves the unofficial notice empty until the real-data task, for both data kinds", () => {
    expect(view.unofficial).toBeNull();
    const real: ViewBundle = { ...bundle, meta: { dataKind: "REAL_AI" }, fixedTexts: syntheticFixedTexts("REAL_AI") };
    const realView = buildAboutView(real);
    expect(realView.unofficial).toBeNull();
    expect(realView.dataKind.kind).toBe("REAL_AI");
    expect(realView.dataKind.description).toBe("〈about.dataKind.REAL_AI〉");
  });

  it("throws for a question without an approval record, which a published bundle cannot hold", () => {
    const first = bundle.questions[0];
    if (first === undefined) {
      throw new Error("no question");
    }
    const broken: ViewBundle = { ...bundle, questions: [{ ...first, approval: null }, ...bundle.questions.slice(1)] };
    expect(() => buildAboutView(broken)).toThrow("approval");
  });
});