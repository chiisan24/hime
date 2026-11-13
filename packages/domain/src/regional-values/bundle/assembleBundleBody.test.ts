import { RegionalBundleSchema, type GateFinding, type Question } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { fixtureAssemblyInput, fullAssemblyInput, TEST_IDENTITY } from "../../../../../tests/harness/regional-values/bundleInput.js";
import { assembleBundleBody, type AssemblyInput } from "./assembleBundleBody.js";
import { finalizeBundle } from "./finalizeBundle.js";
import { portableCanonicalJson } from "./portableCanonicalJson.js";
import { verifyBundleText } from "./verifyBundleText.js";

const EXPECTED = { schemaVersion: 1, dataVersion: TEST_IDENTITY.dataVersion, buildKind: TEST_IDENTITY.buildKind } as const;

function codes(findings: readonly GateFinding[]): string[] {
  return findings.map((finding) => `${finding.code}:${finding.targetKind}:${finding.targetId}`);
}

function refusal(input: AssemblyInput): string[] {
  const result = assembleBundleBody(input);
  if (result.ok) {
    throw new Error("The assembly was expected to refuse");
  }
  return codes(result.error.findings);
}

function body(input: AssemblyInput) {
  const result = assembleBundleBody(input);
  if (!result.ok) {
    throw new Error(`The assembly refused: ${codes(result.error.findings).join(", ")}`);
  }
  return result.value;
}

function withQuestion(input: AssemblyInput, questionId: string, change: (question: Question) => Question): AssemblyInput {
  return {
    ...input,
    bank: { ...input.bank, questions: input.bank.questions.map((q) => (q.questionId === questionId ? change(q) : q)) },
  };
}

const PENDING = { status: "PENDING" } as const;

describe("assembleBundleBody: the fictional data of the repository (QUICK only)", () => {
  it("keeps every record, with no finding, and no FULL set", () => {
    const input = fixtureAssemblyInput();
    const { body: assembled, excluded } = body(input);
    expect(excluded).toEqual([]);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(assembled.questions).toHaveLength(6);
    expect(assembled.cards).toHaveLength(3);
    expect(assembled.resultTexts).toHaveLength(30);
    expect(assembled.guidance).toHaveLength(9);
    expect(assembled.fixedTexts).toEqual(input.fixedTexts);
  });

  it("describes the bundle by the identity: five meta items now, and the hash later", () => {
    const { body: assembled } = body(fixtureAssemblyInput());
    expect(assembled.meta).toEqual({
      schemaVersion: 1,
      generatedAt: TEST_IDENTITY.generatedAt,
      dataVersion: TEST_IDENTITY.dataVersion,
      buildKind: "DEMO",
      dataKind: "FIXTURE",
      dataModeRequested: "FIXTURE",
      dataModeResolved: "FIXTURE",
      switched: false,
      switchReasonCodes: [],
    });
    expect("contentHash" in assembled.meta).toBe(false);
  });

  it("leaves the input as it was", () => {
    const input = fixtureAssemblyInput();
    const before = structuredClone(input);
    body(input);
    expect(input).toEqual(before);
  });
});

describe("assembleBundleBody: the complete input (QUICK and FULL)", () => {
  it("keeps both sets and everything they need", () => {
    const { body: assembled, excluded } = body(fullAssemblyInput());
    expect(excluded).toEqual([]);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK", "FULL"]);
    expect(assembled.questions).toHaveLength(13);
    expect(assembled.cards).toHaveLength(6);
    expect(assembled.resultTexts).toHaveLength(60);
    expect(assembled.guidance).toHaveLength(18);
  });

  it("leaves FULL out, without an error and without a finding for the set, when a question of FULL only is not approved", () => {
    const input = withQuestion(fullAssemblyInput(), "test-transport-importance-v1", (q) => ({ ...q, approval: null }));
    const { body: assembled, excluded } = body(input);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(assembled.questions.map((q) => q.questionId)).not.toContain("test-transport-importance-v1");
    expect(assembled.questions).toHaveLength(6);
    expect(codes(excluded)).toEqual(["QUESTION_NOT_APPROVED:QUESTION:test-transport-importance-v1"]);
    expect(excluded.some((finding) => finding.targetKind === "DIAGNOSTIC_SET")).toBe(false);
  });

  it("leaves FULL out, and the records that only it needed, when a card of a theme of FULL only is not approved", () => {
    const input = fullAssemblyInput();
    const changed: AssemblyInput = {
      ...input,
      cards: input.cards.map((card) => (card.themeId === "TRANSPORT" ? { ...card, approval: PENDING } : card)),
    };
    const { body: assembled, excluded } = body(changed);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(assembled.cards.map((card) => card.themeId).sort()).toEqual(["DISASTER_PREVENTION", "EDUCATION_CHILDCARE", "POPULATION_REVITALIZATION"]);
    expect(assembled.resultTexts).toHaveLength(30);
    expect(assembled.guidance).toHaveLength(9);
    expect(codes(excluded)).toEqual(["CARD_NOT_APPROVED:ISSUE_CARD:test-card-transport"]);
  });

  it("leaves FULL out when it is not defined, and reports nothing", () => {
    const input = fullAssemblyInput();
    const quickOnly: AssemblyInput = {
      ...input,
      bank: { ...input.bank, diagnosticSets: input.bank.diagnosticSets.filter((set) => set.setKind === "QUICK") },
    };
    const { body: assembled, excluded } = body(quickOnly);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(assembled.questions).toHaveLength(6);
    expect(excluded).toEqual([]);
  });

  it("leaves a result text that is not approved out of the bundle, with a finding, when its theme is not needed", () => {
    const input = fullAssemblyInput();
    const changed: AssemblyInput = {
      ...input,
      resultTexts: input.resultTexts.map((item) =>
        item.themeId === "HEALTHCARE_WELFARE" && item.axis === "IMPORTANCE" && item.level === 2 ? { ...item, approval: PENDING } : item,
      ),
    };
    const { body: assembled, excluded } = body(changed);
    expect(assembled.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(codes(excluded)).toEqual(["RESULT_TEXT_NOT_APPROVED:RESULT_TEXT:HEALTHCARE_WELFARE/IMPORTANCE/2"]);
  });
});

describe("assembleBundleBody: what refuses the bundle", () => {
  it("refuses a record of another data kind", () => {
    const input = fixtureAssemblyInput();
    expect(refusal({ ...input, identity: { ...TEST_IDENTITY, dataKind: "REAL_AI" } })).toEqual(["DATA_KIND_MIXED:BUNDLE:null"]);
    const [question] = input.bank.questions;
    if (question === undefined) {
      throw new Error("The fixture has a question");
    }
    expect(refusal(withQuestion(input, question.questionId, (q) => ({ ...q, dataKind: "REAL_AI" })))).toEqual(["DATA_KIND_MIXED:BUNDLE:null"]);
  });

  it("refuses a bank without a QUICK set, with REAL_DATA_ABSENT", () => {
    const input = fixtureAssemblyInput();
    expect(refusal({ ...input, bank: { ...input.bank, diagnosticSets: [] } })).toEqual(["REAL_DATA_ABSENT:DIAGNOSTIC_SET:QUICK"]);
  });

  it("refuses when a question of QUICK has no current approval", () => {
    const input = withQuestion(fixtureAssemblyInput(), "fixture-disaster-importance-v1", (q) => ({ ...q, version: q.version + 1 }));
    expect(refusal(input)).toEqual(["QUESTION_NOT_APPROVED:QUESTION:fixture-disaster-importance-v1"]);
  });

  it("refuses when QUICK lacks a result text, a guidance question or a card", () => {
    const input = fixtureAssemblyInput();
    expect(refusal({ ...input, resultTexts: input.resultTexts.slice(1) })).toEqual([
      "RESULT_TEXT_NOT_APPROVED:RESULT_TEXT:POPULATION_REVITALIZATION/IMPORTANCE/2",
    ]);
    expect(refusal({ ...input, guidance: input.guidance.slice(1) })).toEqual([
      "FIXED_TEXT_NOT_APPROVED:GUIDANCE_QUESTION:POPULATION_REVITALIZATION/ELECTION",
    ]);
    expect(refusal({ ...input, cards: input.cards.filter((card) => card.themeId !== "DISASTER_PREVENTION") })).toEqual([
      "CARD_COVERAGE_MISSING:ISSUE_CARD:DISASTER_PREVENTION",
    ]);
    expect(refusal({ ...input, cards: input.cards.map((card) => ({ ...card, approval: PENDING })) })).toEqual([
      "CARD_COVERAGE_MISSING:ISSUE_CARD:POPULATION_REVITALIZATION",
      "CARD_COVERAGE_MISSING:ISSUE_CARD:DISASTER_PREVENTION",
      "CARD_COVERAGE_MISSING:ISSUE_CARD:EDUCATION_CHILDCARE",
    ]);
  });

  it("refuses when a fixed text is not approved", () => {
    const input = fixtureAssemblyInput();
    const [first] = input.fixedTexts.items;
    if (first === undefined) {
      throw new Error("The fixture has a fixed text");
    }
    const changed: AssemblyInput = {
      ...input,
      fixedTexts: { ...input.fixedTexts, items: input.fixedTexts.items.map((item) => (item === first ? { ...item, approval: PENDING } : item)) },
    };
    expect(refusal(changed)).toEqual([`FIXED_TEXT_NOT_APPROVED:FIXED_TEXT:${first.key}`]);
  });

  it("refuses a set that breaks its composition, whatever its kind, and does not hide it as a missing approval", () => {
    const input = fullAssemblyInput();
    const brokenFull: AssemblyInput = {
      ...input,
      bank: {
        ...input.bank,
        diagnosticSets: input.bank.diagnosticSets.map((set) =>
          set.setKind === "FULL" ? { ...set, questionIds: set.questionIds.slice(1) } : set,
        ),
      },
    };
    expect(refusal(brokenFull)).toEqual(["SET_COMPOSITION_INVALID:DIAGNOSTIC_SET:FULL"]);
    const brokenQuick: AssemblyInput = {
      ...input,
      bank: {
        ...input.bank,
        diagnosticSets: input.bank.diagnosticSets.map((set) =>
          set.setKind === "QUICK" ? { ...set, questionIds: set.questionIds.slice(1) } : set,
        ),
      },
    };
    expect(refusal(brokenQuick)).toEqual(["SET_COMPOSITION_INVALID:DIAGNOSTIC_SET:QUICK"]);
  });

  it("refuses a set that lists a question that the bank does not have", () => {
    const input = fixtureAssemblyInput();
    const unknown: AssemblyInput = {
      ...input,
      bank: {
        ...input.bank,
        diagnosticSets: input.bank.diagnosticSets.map((set) => ({ ...set, questionIds: [...set.questionIds.slice(1), "not-a-question"] })),
      },
    };
    expect(refusal(unknown)).toContain("SET_COMPOSITION_INVALID:DIAGNOSTIC_SET:QUICK");
  });
});

describe("finalizeBundle and the browser verification", () => {
  it("makes a bundle that satisfies the contract and carries its content hash", async () => {
    const { body: assembled } = body(fullAssemblyInput());
    const result = await finalizeBundle(assembled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(RegionalBundleSchema.safeParse(result.value).success).toBe(true);
      expect(result.value.meta.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("makes a bundle that the browser verification accepts, for the fixture data and for the complete data", async () => {
    for (const input of [fixtureAssemblyInput(), fullAssemblyInput()]) {
      const finalized = await finalizeBundle(body(input).body);
      if (!finalized.ok) {
        throw new Error(`finalize failed: ${finalized.error}`);
      }
      const verified = await verifyBundleText(portableCanonicalJson(finalized.value), EXPECTED);
      expect(verified.ok, input.bank.questions.length.toString()).toBe(true);
    }
  });

  it("gives the same hash for the same body, and another hash when only the time of generation differs", async () => {
    const input = fixtureAssemblyInput();
    const first = await finalizeBundle(body(input).body);
    const second = await finalizeBundle(body(input).body);
    const later = await finalizeBundle(body({ ...input, identity: { ...TEST_IDENTITY, generatedAt: "2026-01-05T09:00:00Z" } }).body);
    if (!first.ok || !second.ok || !later.ok) {
      throw new Error("finalize failed");
    }
    expect(second.value.meta.contentHash).toBe(first.value.meta.contentHash);
    expect(later.value.meta.contentHash).not.toBe(first.value.meta.contentHash);
  });

  it("refuses a body that breaks the contract of the bundle, and returns no bundle", async () => {
    const { body: assembled } = body(fixtureAssemblyInput());
    const missingKey = { ...assembled, fixedTexts: { ...assembled.fixedTexts, items: assembled.fixedTexts.items.slice(1) } };
    const result = await finalizeBundle(missingKey);
    expect(result).toEqual({ ok: false, error: "CONTRACT_VIOLATION" });
    const wrongKind = await finalizeBundle({ ...assembled, meta: { ...assembled.meta, dataKind: "REAL_AI" } });
    expect(wrongKind).toEqual({ ok: false, error: "CONTRACT_VIOLATION" });
  });

  it("refuses when the hash that is written does not come back from the bundle", async () => {
    const { body: assembled } = body(fixtureAssemblyInput());
    let calls = 0;
    // A digest function whose result differs from call to call, as if the bundle changed in between.
    const unstable = async (): Promise<ArrayBuffer> => {
      calls += 1;
      return new Uint8Array(32).fill(calls).buffer;
    };
    expect(await finalizeBundle(assembled, unstable)).toEqual({ ok: false, error: "HASH_MISMATCH" });
  });

  it("does not change the body", async () => {
    const { body: assembled } = body(fixtureAssemblyInput());
    const before = structuredClone(assembled);
    await finalizeBundle(assembled);
    expect(assembled).toEqual(before);
  });
});
