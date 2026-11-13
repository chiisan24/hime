import { describe, expect, it } from "vitest";

import { BuildConfigSchema, NeutralityConfigSchema, WORD_CATEGORIES } from "./config.js";

function neutrality(overrides: Record<string, unknown> = {}) {
  return {
    candidateAndPartyNames: [],
    incumbencyWords: ["現職"],
    doubleQuestionWords: ["かつ"],
    loadedWords: ["優劣語", "推奨語", "投票語"],
    labelLengthDiffMax: 6,
    directionLengthDiffMax: 20,
    policyNames: [],
    budgetStanceWords: ["予算"],
    importanceTemplate: "{テーマ名}は、あなたの暮らしにとってどのくらい大切ですか",
    premiseTemplates: ["限られた条件で、どちらかを先に進める場面を考えてください"],
    negationWords: ["しない"],
    exclusiveWords: ["だけ"],
    disparagingWords: ["軽視"],
    bannedWords: ["優劣語", "推奨語", "投票語"],
    numeralExemptWords: ["一方"],
    wordCategories: { SUPERIORITY: ["優劣語"], RECOMMENDATION: ["推奨語"], VOTE_URGING: ["投票語"] },
    guidanceNames: [],
    choiceEncouragingWords: [],
    userClaimPatterns: ["あなたは"],
    ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return { dataVersion: "2026-01-01.1", quoteMaxChars: 200, realNames: [], properNouns: [], requiredApprovers: 1, ...overrides };
}

describe("NeutralityConfigSchema", () => {
  it("accepts a complete test-only configuration with all word categories", () => {
    expect(NeutralityConfigSchema.safeParse(neutrality()).success).toBe(true);
    expect(WORD_CATEGORIES).toEqual(["SUPERIORITY", "RECOMMENDATION", "VOTE_URGING"]);
  });

  it("rejects a missing category, an empty loaded word list and extra fields", () => {
    expect(NeutralityConfigSchema.safeParse(neutrality({ wordCategories: { SUPERIORITY: ["a"], RECOMMENDATION: ["b"] } })).success).toBe(false);
    expect(NeutralityConfigSchema.safeParse(neutrality({ loadedWords: [] })).success).toBe(false);
    expect(NeutralityConfigSchema.safeParse(neutrality({ extra: true })).success).toBe(false);
  });

  it("accepts the initial user-claim patterns, which are regular expressions", () => {
    expect(
      NeutralityConfigSchema.safeParse(neutrality({ userClaimPatterns: ["あなたは.+な人です", ".+派です", ".+主義です"] })).success,
    ).toBe(true);
  });

  it("rejects a user-claim pattern that is not a valid regular expression", () => {
    for (const pattern of ["(", "[a-", "*派", "a{2,1}"]) {
      expect(NeutralityConfigSchema.safeParse(neutrality({ userClaimPatterns: [pattern] })).success, pattern).toBe(false);
    }
  });

  it("rejects blank check text and negative length limits", () => {
    expect(NeutralityConfigSchema.safeParse(neutrality({ incumbentWords: [" "] })).success).toBe(false);
    expect(NeutralityConfigSchema.safeParse(neutrality({ labelLengthDiffMax: -1 })).success).toBe(false);
    expect(NeutralityConfigSchema.safeParse(neutrality({ directionLengthDiffMax: 1.5 })).success).toBe(false);
  });
});

describe("BuildConfigSchema", () => {
  it("accepts the data version format and positive limits", () => {
    expect(BuildConfigSchema.safeParse(build()).success).toBe(true);
  });

  it.each(["2026-1-1.1", "2026-01-01", "v1", ""])("rejects dataVersion %j", (dataVersion) => {
    expect(BuildConfigSchema.safeParse(build({ dataVersion })).success).toBe(false);
  });

  it("rejects a zero approver, zero quote limit and extra field", () => {
    expect(BuildConfigSchema.safeParse(build({ requiredApprovers: 0 })).success).toBe(false);
    expect(BuildConfigSchema.safeParse(build({ quoteMaxChars: 0 })).success).toBe(false);
    expect(BuildConfigSchema.safeParse(build({ note: "x" })).success).toBe(false);
  });
});

export { build, neutrality };