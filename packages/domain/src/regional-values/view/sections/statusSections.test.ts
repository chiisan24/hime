import { describe, expect, it } from "vitest";

import { syntheticText } from "../../../../../../tests/harness/regional-values/testFixedTexts.js";
import {
  FULL_VIEW_BUNDLE,
  QUICK_VIEW_BUNDLE,
  explanationOf,
  syntheticResultText,
} from "../../../../../../tests/harness/regional-values/testViewBundle.js";
import {
  ANSWERS_V15,
  ANSWERS_V16,
  ANSWERS_V18,
  mapValue,
} from "../../../../../../tests/harness/regional-values/viewDriver.js";
import {
  buildCounts,
  buildDeclined,
  buildHesitant,
  buildNotAsked,
  buildTradeoff,
  buildUndetermined,
} from "./statusSections.js";

const quick = QUICK_VIEW_BUNDLE;
const full = FULL_VIEW_BUNDLE;

const v15 = mapValue(quick, "QUICK", ANSWERS_V15);
const v16 = mapValue(quick, "QUICK", ANSWERS_V16);
const v18 = mapValue(full, "FULL", ANSWERS_V18);

const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

describe("priority condition (trade-off)", () => {
  it("lists every theme whose trade-off is decided, with the importance level beside it", () => {
    const tradeoff = buildTradeoff(quick, v15);
    expect(tradeoff.heading).toBe("〈section.tradeoff〉");
    expect(tradeoff.lead).toBe("〈lead.tradeoff〉");
    expect(tradeoff.emptyText).toBeNull();
    expect(tradeoff.items.map((item) => [item.name, item.importanceLabel])).toEqual([
      ["教育・子育て", "〈level.importance.-1〉"],
      ["防災", "〈level.importance.+1〉"],
      ["人口減少・地域活性化", "〈level.importance.+2〉"],
    ]);
    expect(tradeoff.items[0]?.text).toEqual([
      { t: "text", v: syntheticResultText("EDUCATION_CHILDCARE", "TRADEOFF", 0) },
    ]);
    expect(tradeoff.items[1]?.text).toEqual([
      { t: "text", v: syntheticResultText("DISASTER_PREVENTION", "TRADEOFF", -2) },
    ]);
  });

  it("still shows the priority condition of a theme whose importance cannot be decided (V14)", () => {
    const tradeoff = buildTradeoff(quick, v16);
    expect(tradeoff.items.map((item) => [item.name, item.importanceLabel])).toEqual([
      ["教育・子育て", "〈state.UNDETERMINED〉"],
      ["人口減少・地域活性化", "〈state.UNDETERMINED〉"],
    ]);
  });

  it("shows a low importance level together with a strong priority condition, without joining them", () => {
    const hc = buildTradeoff(full, v18).items.find((item) => item.name === "医療・福祉");
    expect(hc?.importanceLabel).toBe("〈level.importance.-2〉");
    expect(hc?.text).toEqual([{ t: "text", v: syntheticResultText("HEALTHCARE_WELFARE", "TRADEOFF", 2) }]);
  });

  it("says that none applies when no trade-off is decided", () => {
    const tradeoff = buildTradeoff(quick, mapValue(quick, "QUICK", { "q-ed-imp": "IMPORTANT" }));
    expect(tradeoff.items).toEqual([]);
    expect(tradeoff.emptyText).toBe("〈empty.tradeoff〉");
  });
});

describe("hesitant themes", () => {
  it("lists a theme answered UNSURE with its reason and a drill-down", () => {
    const hesitant = buildHesitant(quick, v16);
    expect(hesitant.heading).toBe("〈section.hesitant〉");
    expect(hesitant.emptyText).toBeNull();
    expect(hesitant.items).toHaveLength(1);
    const item = hesitant.items[0];
    expect(item?.name).toBe("教育・子育て");
    expect(item?.reasons).toEqual([{ code: "UNSURE", text: "〈reason.UNSURE〉" }]);
    expect(item?.drilldown).toEqual({
      explanations: [
        { questionId: "q-ed-imp", text: [{ t: "text", v: explanationOf("q-ed-imp") }] },
        { questionId: "q-ed-tra", text: [{ t: "text", v: explanationOf("q-ed-tra") }] },
      ],
      cardLinks: [{ cardId: "card-1", title: "〈card-1〉" }],
      edit: {
        label: "〈ui.changeAnswer〉",
        event: { type: "OPEN_EDIT", scope: { themeId: "EDUCATION_CHILDCARE" } },
      },
    });
  });

  it("lists a theme whose level and priority pick conflict, with its own reason", () => {
    const hesitant = buildHesitant(full, v18);
    expect(hesitant.items.map((item) => [item.name, item.reasons.map((reason) => reason.text)])).toEqual([
      ["医療・福祉", ["〈reason.PICK_CONFLICT〉"]],
    ]);
    expect(hesitant.items[0]?.drilldown?.cardLinks).toEqual([]);
    expect(hesitant.items[0]?.drilldown?.explanations.map((entry) => entry.questionId)).toEqual(["q-hc-imp", "q-hc-tra"]);
  });

  it("says that none applies when no theme is hesitant", () => {
    const hesitant = buildHesitant(quick, v15);
    expect(hesitant.items).toEqual([]);
    expect(hesitant.emptyText).toBe("〈empty.hesitant〉");
  });
});

describe("declined themes", () => {
  it("has two small columns; DECLINE and UNANSWERED are in different columns", () => {
    const declined = buildDeclined(quick, v16);
    expect(declined.heading).toBe("〈section.declined〉");
    expect(declined.columns.map((column) => [column.code, column.heading, names(column.themes), column.emptyText])).toEqual([
      ["DECLINE", "〈section.declined.DECLINE〉", ["防災"], null],
      ["UNANSWERED", "〈section.declined.UNANSWERED〉", ["人口減少・地域活性化"], null],
    ]);
  });

  it("keeps both columns, each with the text that none applies, when nothing was declined", () => {
    const declined = buildDeclined(quick, v15);
    expect(declined.columns.map((column) => [names(column.themes), column.emptyText])).toEqual([
      [[], "〈empty.declined.DECLINE〉"],
      [[], "〈empty.declined.UNANSWERED〉"],
    ]);
  });

  it("puts a theme in both columns when it has both kinds of answer", () => {
    const both = mapValue(quick, "QUICK", {
      "q-ed-imp": "DECLINE",
      "q-dp-imp": "IMPORTANT",
      "q-dp-tra": "BALANCED",
    });
    const declined = buildDeclined(quick, both);
    expect(names(declined.columns[0]?.themes ?? [])).toContain("教育・子育て");
    expect(names(declined.columns[1]?.themes ?? [])).toContain("教育・子育て");
    expect(names(declined.columns[1]?.themes ?? [])).toContain("人口減少・地域活性化");
  });
});

describe("axes that cannot be decided", () => {
  it("lists each axis with the reason and without a score or a level", () => {
    const undetermined = buildUndetermined(quick, v16);
    expect(undetermined.heading).toBe("〈section.undetermined〉");
    expect(
      undetermined.items.map((item) => [item.name, item.axis, item.axisName, item.statement, item.reasons.map((reason) => reason.code)]),
    ).toEqual([
      ["教育・子育て", "IMPORTANCE", "〈section.importance〉", "〈state.UNDETERMINED〉", ["UNSURE"]],
      ["防災", "TRADEOFF", "〈section.tradeoff〉", "〈state.UNDETERMINED〉", ["DECLINE"]],
      ["人口減少・地域活性化", "IMPORTANCE", "〈section.importance〉", "〈state.UNDETERMINED〉", ["UNANSWERED"]],
    ]);
    expect(Object.keys(undetermined.items[0] ?? {}).sort()).toEqual([
      "axis",
      "axisName",
      "name",
      "reasons",
      "statement",
      "themeId",
    ]);
  });

  it("is empty when every asked axis is decided", () => {
    expect(buildUndetermined(quick, v15).items).toEqual([]);
  });
});

describe("themes not asked", () => {
  it("lists them with the words 'not asked', apart from 'cannot be decided'", () => {
    const notAsked = buildNotAsked(quick, v16);
    expect(notAsked.heading).toBe("〈section.notAsked〉");
    expect(notAsked.emptyText).toBeNull();
    expect(notAsked.items.map((item) => [item.name, item.text])).toEqual([
      ["交通", "〈state.NOT_ASKED〉"],
      ["経済・雇用", "〈state.NOT_ASKED〉"],
      ["医療・福祉", "〈state.NOT_ASKED〉"],
    ]);
  });

  it("still shows the section, with the text that none applies, when every theme was asked", () => {
    const notAsked = buildNotAsked(full, v18);
    expect(notAsked.items).toEqual([]);
    expect(notAsked.emptyText).toBe("〈empty.notAsked〉");
  });
});

describe("the four states are told apart", () => {
  it("uses four different texts, each in its own place", () => {
    const texts = ["state.NOT_ASKED", "state.UNSURE", "state.DECLINE", "state.UNANSWERED"].map((key) =>
      syntheticText(key as Parameters<typeof syntheticText>[0]),
    );
    expect(new Set(texts).size).toBe(4);
    const hesitantNames = names(buildHesitant(quick, v16).items);
    const declinedNames = buildDeclined(quick, v16).columns.flatMap((column) => names(column.themes));
    const notAskedNames = names(buildNotAsked(quick, v16).items);
    for (const name of notAskedNames) {
      expect(hesitantNames).not.toContain(name);
      expect(declinedNames).not.toContain(name);
    }
    expect(declinedNames).not.toContain("教育・子育て");
  });
});

describe("counts", () => {
  it("shows the themes and the questions as 'n of m'", () => {
    expect(buildCounts(quick, v16)).toEqual({
      themes: "〈counts.themes〉36",
      questions: "〈counts.questions〉36",
    });
    expect(buildCounts(quick, v15)).toEqual({
      themes: "〈counts.themes〉36",
      questions: "〈counts.questions〉66",
    });
  });
});