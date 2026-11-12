import type { SectionId } from "../../../packages/domain/src/regional-values/view/viewTypes.js";

/**
 * The golden result views of design examples 1 to 3 (V15, V16, V18) on the test
 * bundle, as plain facts. The texts are the synthetic texts of the test bundle
 * (the key in angle brackets); every value was worked out by hand from the expected
 * maps of `goldenVectors.ts`, not produced by the code under test.
 */

export type ViewSummary = Readonly<{
  sectionOrder: readonly SectionId[];
  priority: readonly [string, readonly string[]];
  groups: readonly (readonly string[])[];
  bands: readonly (readonly string[])[];
  tradeoff: readonly string[];
  hesitant: readonly string[];
  declined: readonly (readonly string[])[];
  undetermined: readonly string[];
  notAsked: readonly string[];
  counts: readonly [string, string];
  reflection: readonly string[];
  guidance: readonly string[];
}>;

const ORDER: readonly SectionId[] = [
  "notice",
  "explainer",
  "priority",
  "importance",
  "tradeoff",
  "hesitant",
  "declined",
  "undetermined",
  "notAsked",
  "counts",
  "reflection",
  "guidance",
];

const PR = "人口減少・地域活性化";

export const GOLDEN_V15: ViewSummary = {
  sectionOrder: ORDER,
  priority: ["NOT_ASKED", []],
  groups: [[PR], ["防災"], [], ["教育・子育て"], []],
  bands: [[PR], ["防災"], [], ["教育・子育て"], [], [], ["交通", "経済・雇用", "医療・福祉"]],
  tradeoff: [
    "教育・子育て|〈level.importance.-1〉|〈result:EDUCATION_CHILDCARE:TRADEOFF:0〉",
    "防災|〈level.importance.+1〉|〈result:DISASTER_PREVENTION:TRADEOFF:-2〉",
    `${PR}|〈level.importance.+2〉|〈result:POPULATION_REVITALIZATION:TRADEOFF:1〉`,
  ],
  hesitant: [],
  declined: [[], []],
  undetermined: [],
  notAsked: ["交通", "経済・雇用", "医療・福祉"],
  counts: ["〈counts.themes〉36", "〈counts.questions〉66"],
  reflection: [
    "1|教育・子育て|あまり大切でない",
    "2|教育・子育て|同程度",
    "3|防災|大切",
    "4|防災|Bを強く",
    `5|${PR}|とても大切`,
    `6|${PR}|Aをやや`,
  ],
  guidance: ["防災:3", `${PR}:3`],
};

export const GOLDEN_V16: ViewSummary = {
  sectionOrder: ORDER,
  priority: ["NOT_ASKED", []],
  groups: [[], ["防災"], [], [], []],
  bands: [[], ["防災"], [], [], [], ["教育・子育て[HESITANT]", PR], ["交通", "経済・雇用", "医療・福祉"]],
  tradeoff: [
    "教育・子育て|〈state.UNDETERMINED〉|〈result:EDUCATION_CHILDCARE:TRADEOFF:2〉",
    `${PR}|〈state.UNDETERMINED〉|〈result:POPULATION_REVITALIZATION:TRADEOFF:-1〉`,
  ],
  hesitant: ["教育・子育て|〈reason.UNSURE〉"],
  declined: [["防災"], [PR]],
  undetermined: ["教育・子育て|IMPORTANCE|UNSURE", "防災|TRADEOFF|DECLINE", `${PR}|IMPORTANCE|UNANSWERED`],
  notAsked: ["交通", "経済・雇用", "医療・福祉"],
  counts: ["〈counts.themes〉36", "〈counts.questions〉36"],
  reflection: [
    "1|教育・子育て|わからない",
    "2|教育・子育て|Aを強く",
    "3|防災|大切",
    "4|防災|回答しない",
    `5|${PR}|〈state.UNANSWERED〉`,
    `6|${PR}|Bをやや`,
  ],
  guidance: ["防災:3"],
};

export const GOLDEN_V18: ViewSummary = {
  sectionOrder: ORDER,
  priority: ["SELECTED", ["医療・福祉", "防災"]],
  groups: [["教育・子育て", "防災"], ["交通", PR], ["経済・雇用"], [], ["医療・福祉"]],
  bands: [
    ["教育・子育て", "防災[PRIORITY]"],
    ["交通", PR],
    ["経済・雇用"],
    [],
    ["医療・福祉[PRIORITY,HESITANT]"],
    [],
    [],
  ],
  tradeoff: [
    "交通|〈level.importance.+1〉|〈result:TRANSPORT:TRADEOFF:1〉",
    "教育・子育て|〈level.importance.+2〉|〈result:EDUCATION_CHILDCARE:TRADEOFF:0〉",
    "経済・雇用|〈level.importance.0〉|〈result:ECONOMY_EMPLOYMENT:TRADEOFF:-1〉",
    "医療・福祉|〈level.importance.-2〉|〈result:HEALTHCARE_WELFARE:TRADEOFF:2〉",
    "防災|〈level.importance.+2〉|〈result:DISASTER_PREVENTION:TRADEOFF:-2〉",
  ],
  hesitant: ["医療・福祉|〈reason.PICK_CONFLICT〉"],
  declined: [[PR], []],
  undetermined: [`${PR}|TRADEOFF|DECLINE`],
  notAsked: [],
  counts: ["〈counts.themes〉66", "〈counts.questions〉1213"],
  reflection: [
    "1|交通|大切",
    "2|交通|Aをやや",
    "3|教育・子育て|とても大切",
    "4|教育・子育て|同程度",
    "5|経済・雇用|どちらでもない",
    "6|経済・雇用|Bをやや",
    "7|医療・福祉|大切でない",
    "8|医療・福祉|Aを強く",
    "9|防災|とても大切",
    "10|防災|Bを強く",
    `11|${PR}|大切`,
    `12|${PR}|回答しない`,
    "13|〈reflection.crossTheme〉|医療・福祉、防災",
  ],
  guidance: ["教育・子育て:3", "医療・福祉:3", "防災:3"],
};