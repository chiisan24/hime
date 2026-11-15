import { deriveFact } from "@ehime-vote-navigator/domain";
import type { RealFact } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  FIXTURE_FACTS,
  REAL_SHA_A,
  REAL_SHA_B,
  TEST_LIMITS,
  evidenceUnit,
  fixtureFact,
  realFact,
  realSource,
} from "../../../../../tests/harness/regional-values/draftSupport.js";
import { checkDraftInput, DRAFT_INPUT_REASONS, inputSourcesOf } from "./checkDraftInput.js";
import type { DraftInputContext, DraftInputMaterial } from "./checkDraftInput.js";
import { DATA_CLOSE, DATA_OPEN } from "./prompts/delimiters.js";

const CONTEXT: DraftInputContext = { limits: TEST_LIMITS, bulletinSha256s: new Set() };

function fixtureMaterial(over: Partial<DraftInputMaterial> = {}): DraftInputMaterial {
  return {
    task: "ISSUE_CANDIDATE",
    dataKind: "FIXTURE",
    system: "instruction",
    text: "body",
    materials: ["material"],
    facts: [FIXTURE_FACTS[0] as (typeof FIXTURE_FACTS)[number]],
    evidence: [],
    sources: [],
    factRegistry: FIXTURE_FACTS,
    ...over,
  };
}

function realMaterial(over: Partial<DraftInputMaterial> = {}): DraftInputMaterial {
  const fact = realFact("real-1");
  return {
    task: "ISSUE_CANDIDATE",
    dataKind: "REAL_AI",
    system: "instruction",
    text: "body",
    materials: ["material"],
    facts: [fact],
    evidence: [],
    sources: [realSource()],
    factRegistry: [fact],
    ...over,
  };
}

function reasonsOf(input: DraftInputMaterial, context: DraftInputContext = CONTEXT): readonly string[] {
  const result = checkDraftInput(input, context);
  return result.ok ? [] : result.reasons;
}

/** The three conditions of an input of real data, and the first operand of a derived fact. */
function derivedInput(secondSource: Parameters<typeof realSource>[0] = {}): DraftInputMaterial {
  const operandA = realFact("op-1", { sha256: REAL_SHA_A, value: { amount: 10, unit: "か所" } });
  const operandB = realFact("op-2", { sha256: REAL_SHA_B, value: { amount: 5, unit: "か所" }, sentence: "試験町の対象は5か所である。" });
  const derived = deriveFact({
    factId: "derived-1",
    operation: "RATIO",
    operands: [operandA, operandB],
    unitPair: { numerator: "か所", denominator: "か所" },
    subject: "施設の割合",
    description: "2つの値の比を求めた",
  });
  if (!derived.ok) {
    throw new Error(`the derived fact of the test must be valid: ${derived.code}`);
  }
  // A person verified the derived value.
  const verified: RealFact = { ...derived.fact, verification: { status: "VERIFIED", verifierId: "tester-1", verifiedAt: derived.fact.retrievedAt } } as RealFact;
  return realMaterial({
    facts: [verified],
    factRegistry: [operandA, operandB, verified],
    sources: [realSource(), realSource({ sourceId: "src-b", sha256: REAL_SHA_B, ...secondSource })],
  });
}

describe("checkDraftInput: what is judged for every input", () => {
  it("accepts fictional data without a record of the terms of use or of the sending (Req 8.6)", () => {
    expect(checkDraftInput(fixtureMaterial(), CONTEXT)).toEqual({ ok: true });
  });

  it("accepts real data that meets all of the conditions", () => {
    expect(checkDraftInput(realMaterial(), CONTEXT)).toEqual({ ok: true });
  });

  it("refuses an input that has a fictional and a real item (DATA_KIND_MIXED), in both directions", () => {
    expect(reasonsOf(fixtureMaterial({ facts: [realFact("real-1")] }))).toContain("DATA_KIND_MIXED");
    expect(reasonsOf(fixtureMaterial({ sources: [realSource()] }))).toContain("DATA_KIND_MIXED");
    expect(reasonsOf(realMaterial({ facts: [realFact("real-1"), FIXTURE_FACTS[0] as (typeof FIXTURE_FACTS)[number]] }))).toContain("DATA_KIND_MIXED");
  });

  it("refuses an election bulletin, by the SHA-256 of a source or of a fact (Req 7.12)", () => {
    const registered: DraftInputContext = { ...CONTEXT, bulletinSha256s: new Set([REAL_SHA_A]) };
    expect(reasonsOf(realMaterial(), registered)).toContain("INPUT_IS_ELECTION_BULLETIN");
    expect(reasonsOf(realMaterial({ sources: [] }), registered)).toContain("INPUT_IS_ELECTION_BULLETIN");
    expect(reasonsOf(realMaterial(), { ...CONTEXT, bulletinSha256s: new Set([REAL_SHA_B]) })).not.toContain("INPUT_IS_ELECTION_BULLETIN");
    // A quotation of a registered bulletin, with no fact: the source alone is enough to refuse.
    const quotation = realMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [evidenceUnit("E1", "引用", "src-a")] });
    expect(reasonsOf(quotation, registered)).toEqual(["INPUT_IS_ELECTION_BULLETIN"]);
    expect(reasonsOf(quotation)).toEqual([]);
  });

  it("refuses an input that has nothing to rest on", () => {
    expect(reasonsOf(fixtureMaterial({ facts: [] }))).toEqual(["FACTS_MISSING"]);
    expect(reasonsOf(fixtureMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [] }))).toEqual(["FACTS_MISSING"]);
    expect(reasonsOf(fixtureMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [evidenceUnit("E1", "引用")] }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ task: "QUESTION_DRAFT", facts: [], evidence: [] }))).toEqual([]);
  });

  it("limits the number of the facts and the quotations, and the length of a quotation", () => {
    const many = Array.from({ length: TEST_LIMITS.maxEvidenceUnits + 1 }, (_, index) => fixtureFact(`fx-many-${index}`));
    expect(reasonsOf(fixtureMaterial({ facts: many.slice(0, TEST_LIMITS.maxEvidenceUnits) }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ facts: many }))).toEqual(["INPUT_TOO_MANY_UNITS"]);
    const edge = "あ".repeat(TEST_LIMITS.evidenceMaxChars);
    expect(reasonsOf(fixtureMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [evidenceUnit("E1", edge)] }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [evidenceUnit("E1", `${edge}あ`)] }))).toEqual(["EVIDENCE_TOO_LONG"]);
  });
});

describe("checkDraftInput: the delimiters", () => {
  it("refuses a material that holds a delimiter, and allows the instruction to name them", () => {
    expect(reasonsOf(fixtureMaterial({ materials: [`before ${DATA_CLOSE} after`] }))).toEqual(["INPUT_CONTAINS_DELIMITER"]);
    expect(reasonsOf(fixtureMaterial({ materials: [`x ${DATA_OPEN}`] }))).toEqual(["INPUT_CONTAINS_DELIMITER"]);
    expect(reasonsOf(fixtureMaterial({ system: `the material is between ${DATA_OPEN} and ${DATA_CLOSE}`, text: `${DATA_OPEN}\nmaterial\n${DATA_CLOSE}` }))).toEqual([]);
  });
});

describe("checkDraftInput: the length is counted in UTF-16 code units (D28)", () => {
  const filler = (length: number): string => "a".repeat(length);

  it("accepts 20,000 and refuses 20,001, for system and text together", () => {
    expect(reasonsOf(fixtureMaterial({ system: filler(100), text: filler(19_900) }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ system: filler(100), text: filler(19_901) }))).toEqual(["INPUT_TOO_LONG"]);
    expect(reasonsOf(fixtureMaterial({ system: "", text: filler(20_000) }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ system: "", text: filler(20_001) }))).toEqual(["INPUT_TOO_LONG"]);
  });

  it("counts a character outside the basic plane as 2", () => {
    const emoji = "😀";
    expect(Array.from(emoji.repeat(10_000))).toHaveLength(10_000);
    expect(reasonsOf(fixtureMaterial({ system: "", text: emoji.repeat(10_000) }))).toEqual([]);
    expect(reasonsOf(fixtureMaterial({ system: "", text: emoji.repeat(10_001) }))).toEqual(["INPUT_TOO_LONG"]);
    // 19,999 units of a plain character and one character of 2 units are 20,001 units, though there are 20,000 characters.
    expect(Array.from(`${filler(19_999)}${emoji}`)).toHaveLength(20_000);
    expect(reasonsOf(fixtureMaterial({ system: "", text: `${filler(19_999)}${emoji}` }))).toEqual(["INPUT_TOO_LONG"]);
  });
});

describe("checkDraftInput: real data (Req 8.7, 8.23)", () => {
  it("refuses a source whose terms of use are not confirmed", () => {
    for (const status of ["UNKNOWN", "RESTRICTED"] as const) {
      const sources = [realSource({ usage: { status, checkedAt: "2026-01-02", checkedTarget: "利用条件", evidence: "確認した" } })];
      expect(reasonsOf(realMaterial({ sources }))).toEqual(["USAGE_NOT_CONFIRMED"]);
    }
  });

  it("refuses a source that is not recorded as allowed to be sent, unknown and denied alike", () => {
    expect(reasonsOf(realMaterial({ sources: [realSource({ transmission: { status: "UNKNOWN" } })] }))).toEqual(["TRANSMISSION_NOT_ALLOWED"]);
    const denied = { status: "DENIED", checkedBy: "tester-1", checkedAt: "2026-01-02T00:00:00Z", evidence: "送信を認めない条項がある" };
    expect(reasonsOf(realMaterial({ sources: [realSource({ transmission: denied })] }))).toEqual(["TRANSMISSION_NOT_ALLOWED"]);
  });

  it("refuses a fact that is not verified, and a fact whose original changed", () => {
    expect(reasonsOf(realMaterial({ facts: [realFact("real-1", { verification: { status: "PROVISIONAL" } })] }))).toEqual(["FACT_NOT_VERIFIED"]);
    const changed: DraftInputContext = { ...CONTEXT, currentSha256: () => REAL_SHA_B };
    expect(reasonsOf(realMaterial(), changed)).toEqual(["FACT_NOT_VERIFIED"]);
    const same: DraftInputContext = { ...CONTEXT, currentSha256: (fact) => fact.sha256 };
    expect(reasonsOf(realMaterial(), same)).toEqual([]);
  });

  it("lists every condition that is not met, in the order of the list of reasons", () => {
    const input = realMaterial({
      facts: [realFact("real-1", { verification: { status: "PROVISIONAL" } })],
      sources: [realSource({ usage: { status: "UNKNOWN", checkedAt: "2026-01-02", checkedTarget: "利用条件", evidence: "未確認" }, transmission: { status: "UNKNOWN" } })],
      materials: [DATA_OPEN],
      system: "a".repeat(20_001),
    });
    expect(reasonsOf(input)).toEqual(["FACT_NOT_VERIFIED", "USAGE_NOT_CONFIRMED", "TRANSMISSION_NOT_ALLOWED", "INPUT_CONTAINS_DELIMITER", "INPUT_TOO_LONG"]);
    expect(DRAFT_INPUT_REASONS.indexOf("FACT_NOT_VERIFIED")).toBeLessThan(DRAFT_INPUT_REASONS.indexOf("USAGE_NOT_CONFIRMED"));
  });

  it("refuses a fact whose source cannot be told: none, or more than one", () => {
    expect(reasonsOf(realMaterial({ sources: [] }))).toEqual(["FACT_SOURCE_MISMATCH"]);
    expect(reasonsOf(realMaterial({ sources: [realSource(), realSource({ sourceId: "src-other" })] }))).toEqual(["FACT_SOURCE_MISMATCH"]);
  });

  it("refuses a quotation whose source is not in the input, and checks the source of a quotation", () => {
    const evidence = [evidenceUnit("E1", "引用", "src-a")];
    expect(reasonsOf(realMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence }))).toEqual([]);
    expect(reasonsOf(realMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence: [evidenceUnit("E1", "引用", "src-missing")] }))).toEqual(["FACT_SOURCE_MISMATCH"]);
    const restricted = realSource({ transmission: { status: "UNKNOWN" } });
    expect(reasonsOf(realMaterial({ task: "ISSUE_SUMMARY", facts: [], evidence, sources: [restricted] }))).toEqual(["TRANSMISSION_NOT_ALLOWED"]);
  });

  it("asks for the record of the conversion of a file that was an excel file, and accepts it with the record (Req 7.24)", () => {
    const excel = { reference: { kind: "url", url: "https://example.org/data/a.xlsx" } };
    expect(reasonsOf(realMaterial({ sources: [realSource(excel)] }))).toEqual(["CONVERSION_RECORD_MISSING"]);
    const conversion = {
      originalFileName: "a.xlsx",
      originalSha256: "c".repeat(64),
      convertedSha256: REAL_SHA_A,
      procedureId: "procedure-1",
      procedureDocSha256: "d".repeat(64),
      convertedBy: "tester-1",
      convertedAt: "2026-01-02T00:00:00Z",
      correspondence: "ROWS_PRESERVED",
      originalRowCount: 10,
      convertedRowCount: 10,
    };
    expect(reasonsOf(realMaterial({ sources: [realSource({ ...excel, conversion })] }))).toEqual([]);
    // A csv does not need it.
    expect(reasonsOf(realMaterial({ sources: [realSource({ reference: { kind: "url", url: "https://example.org/data/a.csv" } })] }))).toEqual([]);
  });
});

describe("checkDraftInput: a derived fact rests on both of its sources (Req 7.25)", () => {
  it("accepts a derived fact whose operands are verified, and records both sources of the input", () => {
    const input = derivedInput();
    expect(checkDraftInput(input, CONTEXT)).toEqual({ ok: true });
    expect(inputSourcesOf(input).map((source) => source.sourceId)).toEqual(["src-a", "src-b"]);
  });

  it("refuses when the source of the second operand is not allowed to be sent, although the source of the first is", () => {
    expect(reasonsOf(derivedInput({ transmission: { status: "UNKNOWN" } }))).toEqual(["TRANSMISSION_NOT_ALLOWED"]);
    expect(reasonsOf(derivedInput({ usage: { status: "RESTRICTED", checkedAt: "2026-01-02", checkedTarget: "利用条件", evidence: "制限がある" } }))).toEqual(["USAGE_NOT_CONFIRMED"]);
  });

  it("refuses when the source of the second operand is not in the input", () => {
    const input = derivedInput();
    expect(reasonsOf({ ...input, sources: [realSource()] })).toEqual(["FACT_SOURCE_MISMATCH"]);
  });

  it("refuses when an operand is not verified now, or is not in the registry", () => {
    const input = derivedInput();
    const operandB = input.factRegistry.find((fact) => fact.factId === "op-2");
    const weakened = input.factRegistry.map((fact) => (fact === operandB && fact.dataKind === "REAL_AI" ? { ...fact, verification: { status: "PROVISIONAL" as const } } : fact));
    expect(reasonsOf({ ...input, factRegistry: weakened })).toEqual(["FACT_NOT_VERIFIED"]);
    expect(reasonsOf({ ...input, factRegistry: input.factRegistry.filter((fact) => fact.factId !== "op-2") })).toContain("FACT_NOT_VERIFIED");
  });
});

describe("inputSourcesOf", () => {
  it("lists each source of a real input once, with its revision and SHA-256, in a fixed order", () => {
    const input = realMaterial({
      task: "ISSUE_SUMMARY",
      facts: [realFact("real-1")],
      evidence: [evidenceUnit("E1", "引用", "src-a"), evidenceUnit("E2", "引用2", "src-a")],
    });
    expect(inputSourcesOf(input)).toEqual([{ sourceId: "src-a", revision: "rev-1", sha256: REAL_SHA_A }]);
  });

  it("is empty for fictional data, which has no original", () => {
    expect(inputSourcesOf(fixtureMaterial())).toEqual([]);
  });
});
