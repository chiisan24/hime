import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  ApprovalSchema,
  FIXED_TEXT_KEYS,
  FixedTextSchema,
  FixedTextsSchema,
  GUIDANCE_SCENES,
  GuidanceQuestionSchema,
  ResultTextSchema,
  allowedPlaceholders,
  isFixedTextKey,
  placeholdersIn,
  requiredFixedTextKeys,
} from "./content.js";
import type { FixedTextKey } from "./content.js";

const APPROVED = { status: "APPROVED", approverId: "reviewer-1", approvedAt: "2026-05-01T09:00:00Z" };

type Json = Record<string, unknown>;

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

/** A short text that satisfies the length rules and uses only the allowed placeholders of the key. */
function textFor(key: FixedTextKey): string {
  const placeholders = allowedPlaceholders(key).map((name) => `{${name}}`);
  return `〈${key}〉${placeholders.join("")}`.slice(0, 55);
}

function fixedTexts(dataKind: "REAL_AI" | "FIXTURE", overrides: Json = {}): Json {
  return {
    dataKind,
    items: requiredFixedTextKeys(dataKind).map((key) => ({ key, text: textFor(key), approval: APPROVED })),
    ...overrides,
  };
}

describe("FIXED_TEXT_KEYS", () => {
  it("has no repeated key", () => {
    expect(new Set(FIXED_TEXT_KEYS).size).toBe(FIXED_TEXT_KEYS.length);
  });

  it("holds a key for every error code, level and state that the result view shows", () => {
    for (const key of [
      "error.NO_OPINION_ANSWERS",
      "error.UNKNOWN_QUESTION",
      "error.INVALID_ANSWER",
      "error.INVALID_CONFIG",
      "error.UNEXPECTED",
      "error.UNEXPECTED.restartNote",
      "level.importance.+2",
      "level.importance.-2",
      "state.NOT_ASKED",
      "state.UNDETERMINED",
      "action.RESTART",
    ]) {
      expect(isFixedTextKey(key)).toBe(true);
    }
  });

  it("rejects a key that is not in the list", () => {
    expect(isFixedTextKey("error.SOMETHING_ELSE")).toBe(false);
    expect(isFixedTextKey("")).toBe(false);
  });
});

describe("requiredFixedTextKeys", () => {
  const fixture = requiredFixedTextKeys("FIXTURE");
  const real = requiredFixedTextKeys("REAL_AI");

  it("asks for the banner, the label and the About text of the own data kind only", () => {
    expect(fixture).toContain("banner.FIXTURE");
    expect(fixture).not.toContain("banner.REAL_AI");
    expect(fixture).toContain("about.dataKind.FIXTURE");
    expect(fixture).not.toContain("about.dataKind.REAL_AI");
    expect(real).toContain("banner.REAL_AI");
    expect(real).not.toContain("banner.FIXTURE");
    expect(real).toContain("label.dataKind.REAL_AI");
    expect(real).not.toContain("label.dataKind.FIXTURE");
  });

  it("asks for the license texts and the unofficial notice for REAL_AI only", () => {
    const realOnly = FIXED_TEXT_KEYS.filter((key) => key.startsWith("license.") || key === "about.unofficial");
    expect(realOnly.length).toBeGreaterThan(0);
    for (const key of realOnly) {
      expect(real).toContain(key);
      expect(fixture).not.toContain(key);
    }
  });

  it("asks for the same common keys for both data kinds", () => {
    const common = (keys: readonly string[]) =>
      keys.filter((key) => !/^(banner|label\.dataKind|about\.dataKind)\./u.test(key) && !key.startsWith("license."))
        .filter((key) => key !== "about.unofficial");
    expect(common(fixture)).toEqual(common(real));
  });

  it("only asks for keys of the closed list, once each", () => {
    for (const keys of [fixture, real]) {
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.every((key) => isFixedTextKey(key))).toBe(true);
    }
  });
});

describe("allowedPlaceholders", () => {
  it.each([
    ["counts.themes", ["n", "m"]],
    ["counts.questions", ["n", "m"]],
    ["about.thresholds", ["t1", "t2"]],
    ["license.ccby.attribution", ["publisher", "licenseName"]],
    ["about.coverage.totalQuestions", ["totalQuestions"]],
    ["error.UNEXPECTED", []],
    ["action.RESTART", []],
    ["ui.next", []],
  ] as const)("%s allows %j", (key, expected) => {
    expect(allowedPlaceholders(key)).toEqual(expected);
  });

  it("reads the names from a text", () => {
    expect(placeholdersIn("{n}件のうち{m}件")).toEqual(["n", "m"]);
    expect(placeholdersIn("名前はありません")).toEqual([]);
  });
});

describe("FixedTextsSchema: accepted values", () => {
  it.each(["FIXTURE", "REAL_AI"] as const)("accepts one text for every required key (%s)", (dataKind) => {
    const result = FixedTextsSchema.safeParse(fixedTexts(dataKind));
    expect(result.success).toBe(true);
  });

  it("accepts a text of exactly 60 code points in one sentence", () => {
    const item = { key: "ui.next", text: "あ".repeat(60), approval: APPROVED };
    expect(FixedTextSchema.safeParse(item).success).toBe(true);
  });

  it("counts code points, not UTF-16 units", () => {
    const item = { key: "ui.next", text: "😀".repeat(60), approval: APPROVED };
    expect(FixedTextSchema.safeParse(item).success).toBe(true);
  });

  it("accepts an allowed placeholder", () => {
    const item = { key: "counts.themes", text: "{n}件のテーマのうち{m}件", approval: { status: "PENDING" } };
    expect(FixedTextSchema.safeParse(item).success).toBe(true);
  });
});

describe("FixedTextsSchema: rejected values", () => {
  it("rejects a missing required key and names it", () => {
    const value = fixedTexts("FIXTURE");
    const items = (value.items as Json[]).filter((item) => item.key !== "error.UNEXPECTED");
    const result = FixedTextsSchema.safeParse({ ...value, items });
    expect(result.success).toBe(false);
    expect(result.success ? "" : JSON.stringify(result.error.issues)).toContain("error.UNEXPECTED");
  });

  it("rejects a key that is repeated", () => {
    const value = fixedTexts("FIXTURE");
    const items = value.items as Json[];
    const paths = rejectedPaths(FixedTextsSchema, { ...value, items: [...items, items[0]] });
    expect(paths).toContain(`items.${items.length}.key`);
  });

  it("rejects a key that is not in the closed list", () => {
    const value = fixedTexts("FIXTURE");
    const items = [...(value.items as Json[]), { key: "ui.unknown", text: "あ", approval: APPROVED }];
    expect(rejectedPaths(FixedTextsSchema, { ...value, items })).toContain(`items.${items.length - 1}.key`);
  });

  it("requires the license texts for REAL_AI", () => {
    const value = fixedTexts("REAL_AI");
    const items = (value.items as Json[]).filter((item) => item.key !== "license.ccby.license");
    expect(FixedTextsSchema.safeParse({ ...value, items }).success).toBe(false);
  });

  it("rejects a text of 61 code points", () => {
    const item = { key: "ui.next", text: "あ".repeat(61), approval: APPROVED };
    expect(rejectedPaths(FixedTextSchema, item)).toContain("text");
  });

  it("rejects a second sentence that is longer than 60 code points", () => {
    const item = { key: "ui.next", text: `短い。${"あ".repeat(61)}`, approval: APPROVED };
    expect(rejectedPaths(FixedTextSchema, item)).toContain("text");
  });

  it("rejects a text of more than 300 code points", () => {
    const text = Array.from({ length: 7 }, () => `${"あ".repeat(50)}。`).join("");
    const item = { key: "ui.next", text, approval: APPROVED };
    expect(rejectedPaths(FixedTextSchema, item)).toContain("text");
  });

  it("rejects an empty text", () => {
    expect(rejectedPaths(FixedTextSchema, { key: "ui.next", text: "", approval: APPROVED })).toContain("text");
  });

  it("rejects a placeholder that the key does not allow", () => {
    const item = { key: "ui.next", text: "{themeName}へ", approval: APPROVED };
    expect(rejectedPaths(FixedTextSchema, item)).toContain("text");
    const counts = { key: "counts.themes", text: "{x}件", approval: APPROVED };
    expect(rejectedPaths(FixedTextSchema, counts)).toContain("text");
  });

  it("rejects an extra property", () => {
    const item = { key: "ui.next", text: "次へ", approval: APPROVED, note: "x" };
    expect(FixedTextSchema.safeParse(item).success).toBe(false);
    expect(FixedTextsSchema.safeParse({ ...fixedTexts("FIXTURE"), extra: 1 }).success).toBe(false);
  });
});

describe("ApprovalSchema", () => {
  it("accepts PENDING without a record and APPROVED with the approver and the time", () => {
    expect(ApprovalSchema.safeParse({ status: "PENDING" }).success).toBe(true);
    expect(ApprovalSchema.safeParse(APPROVED).success).toBe(true);
  });

  it("rejects an APPROVED record without the approver or the time, and a PENDING record with one", () => {
    expect(ApprovalSchema.safeParse({ status: "APPROVED" }).success).toBe(false);
    expect(ApprovalSchema.safeParse({ status: "APPROVED", approverId: "a" }).success).toBe(false);
    expect(ApprovalSchema.safeParse({ status: "PENDING", approverId: "a" }).success).toBe(false);
    expect(ApprovalSchema.safeParse({ status: "APPROVED", approverId: "a", approvedAt: "yesterday" }).success).toBe(false);
  });
});

describe("ResultTextSchema", () => {
  const resultText = (overrides: Json = {}): Json => ({
    dataKind: "FIXTURE",
    themeId: "EDUCATION_CHILDCARE",
    axis: "IMPORTANCE",
    level: 2,
    text: "子育てと教育を、特に大切にしています。",
    approval: APPROVED,
    ...overrides,
  });

  it("accepts a text for a theme, an axis and a level", () => {
    expect(ResultTextSchema.safeParse(resultText()).success).toBe(true);
    expect(ResultTextSchema.safeParse(resultText({ axis: "TRADEOFF", level: -2 })).success).toBe(true);
  });

  it("rejects a level outside -2 to 2, an unknown axis, and an unknown theme", () => {
    expect(rejectedPaths(ResultTextSchema, resultText({ level: 3 }))).toContain("level");
    expect(rejectedPaths(ResultTextSchema, resultText({ axis: "OTHER" }))).toContain("axis");
    expect(rejectedPaths(ResultTextSchema, resultText({ themeId: "SPORTS" }))).toContain("themeId");
  });

  it("rejects a text of more than 200 code points and an empty text", () => {
    const long = Array.from({ length: 5 }, () => `${"あ".repeat(50)}。`).join("");
    expect(rejectedPaths(ResultTextSchema, resultText({ text: long }))).toContain("text");
    expect(rejectedPaths(ResultTextSchema, resultText({ text: "" }))).toContain("text");
  });
});

describe("GuidanceQuestionSchema", () => {
  const guidance = (overrides: Json = {}): Json => ({
    themeId: "EDUCATION_CHILDCARE",
    scene: "ELECTION",
    text: "選挙で、子育て支援の公約を見ますか？",
    linkSourceId: null,
    approval: APPROVED,
    ...overrides,
  });

  it("accepts one question sentence that ends with the question particle", () => {
    expect(GuidanceQuestionSchema.safeParse(guidance()).success).toBe(true);
    expect(GuidanceQuestionSchema.safeParse(guidance({ text: "選挙で、子育て支援の公約を見ますか" })).success).toBe(true);
    expect(GuidanceQuestionSchema.safeParse(guidance({ linkSourceId: "source-1" })).success).toBe(true);
  });

  it("holds the three scenes", () => {
    expect(GUIDANCE_SCENES).toEqual(["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"]);
  });

  it("rejects a text that does not end with the question particle", () => {
    expect(rejectedPaths(GuidanceQuestionSchema, guidance({ text: "子育て支援を見ましょう。" }))).toContain("text");
  });

  it("rejects two sentences and a text of 61 code points", () => {
    expect(rejectedPaths(GuidanceQuestionSchema, guidance({ text: "見ますか？調べますか？" }))).toContain("text");
    expect(rejectedPaths(GuidanceQuestionSchema, guidance({ text: `${"あ".repeat(60)}か` }))).toContain("text");
  });

  it("rejects an unknown scene and an empty source id", () => {
    expect(rejectedPaths(GuidanceQuestionSchema, guidance({ scene: "OTHER" }))).toContain("scene");
    expect(rejectedPaths(GuidanceQuestionSchema, guidance({ linkSourceId: "" }))).toContain("linkSourceId");
  });
});

describe("ResultTextSchema: data kind", () => {
  const base = {
    themeId: "EDUCATION_CHILDCARE",
    axis: "IMPORTANCE",
    level: 2,
    text: "子育てと教育を、特に大切にしています。",
    approval: APPROVED,
  };

  it("accepts FIXTURE and REAL_AI", () => {
    expect(ResultTextSchema.safeParse({ ...base, dataKind: "FIXTURE" }).success).toBe(true);
    expect(ResultTextSchema.safeParse({ ...base, dataKind: "REAL_AI" }).success).toBe(true);
  });

  it("keeps the text of one data kind apart from the text of the other (the same words, two records)", () => {
    const fixture = ResultTextSchema.parse({ ...base, dataKind: "FIXTURE" });
    const real = ResultTextSchema.parse({ ...base, dataKind: "REAL_AI" });
    expect(fixture.text).toBe(real.text);
    expect(fixture.dataKind).not.toBe(real.dataKind);
  });

  it("rejects a missing data kind and an unknown one", () => {
    expect(rejectedPaths(ResultTextSchema, base)).toContain("dataKind");
    expect(rejectedPaths(ResultTextSchema, { ...base, dataKind: "DEMO" })).toContain("dataKind");
  });
});
