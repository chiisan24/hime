import { FactItemSchema, RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { FactItem, RealFact } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { effectiveVerification, PROVISIONAL_REASONS } from "./deriveFact.js";
import { checkFactComparison, COMPARISON_VIOLATIONS } from "./factComparison.js";
import type { ComparisonUse } from "./factComparison.js";

// Feature: regional-values-map, Property 58: 比較の条件と導出の有効な状態
//
// The expected judgment is computed from the generated attributes (unit, area, year, definition,
// what the sentence says) with the table of Req 7.26, not by reading the facts again.

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const UNITS = ["戸", "人", "世帯"] as const;
const AREAS = ["架空市", "架空町"] as const;
const YEARS = [2022, 2023, 2024] as const;
const DEFINITIONS = ["D1", "D2", "D3", "NONE"] as const;

type FactSpec = Readonly<{
  unit: (typeof UNITS)[number];
  area: (typeof AREAS)[number];
  year: (typeof YEARS)[number];
  dated: boolean;
  month: number;
  definition: (typeof DEFINITIONS)[number];
  derived: boolean;
}>;

const specArbitrary: fc.Arbitrary<FactSpec> = fc.record({
  unit: fc.constantFrom(...UNITS),
  area: fc.constantFrom(...AREAS),
  year: fc.constantFrom(...YEARS),
  dated: fc.boolean(),
  month: fc.integer({ min: 1, max: 12 }),
  definition: fc.constantFrom(...DEFINITIONS),
  derived: fc.boolean(),
});

function surveyDateOf(spec: FactSpec): string | number {
  return spec.dated ? `${spec.year}-${String(spec.month).padStart(2, "0")}-01` : spec.year;
}

function makeFact(spec: FactSpec, factId: string): FactItem {
  const common = {
    factId,
    sentence: "空き家の数です。",
    value: { amount: 10, unit: spec.unit },
    surveyDate: surveyDateOf(spec),
    area: spec.area,
  };
  if (!spec.derived && spec.definition === "NONE") {
    return FactItemSchema.parse({ dataKind: "FIXTURE", ...common, fictionalSourceId: "src-1" });
  }
  const method = spec.derived
    ? { kind: "DERIVED", operation: "DIFFERENCE", operandFactIds: ["x-1", "x-2"], description: "差" }
    : { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "種別", equals: spec.definition, description: "数える" };
  return FactItemSchema.parse({
    dataKind: "REAL_AI",
    ...common,
    publisher: "試験用の公開者",
    sourceUrl: "https://example.com/a.csv",
    datasetUrl: "https://example.com/data",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    retrievedAt: "2026-02-01T00:00:00Z",
    sha256: SHA_A,
    locator: { kind: "text-lines", startLine: 1, endLine: 2 },
    method,
    verification: { status: "PROVISIONAL" },
  });
}

type UseKind = "COMPARE" | "TIME_SERIES" | "RATIO" | "DIFFERENCE" | "PERCENT_CHANGE";
type PairKind = "NONE" | "RIGHT" | "SWAPPED" | "OTHER";

type SentenceSpec = Readonly<{
  written: boolean;
  namesFirst: boolean;
  namesSecond: boolean;
  yearsFirst: boolean;
  yearsSecond: boolean;
  superiority: boolean;
}>;

const caseArbitrary = fc.record({
  first: specArbitrary,
  second: specArbitrary,
  use: fc.constantFrom<UseKind>("COMPARE", "TIME_SERIES", "RATIO", "DIFFERENCE", "PERCENT_CHANGE"),
  pair: fc.constantFrom<PairKind>("NONE", "RIGHT", "SWAPPED", "OTHER"),
  sentence: fc.record({
    written: fc.boolean(),
    namesFirst: fc.boolean(),
    namesSecond: fc.boolean(),
    yearsFirst: fc.boolean(),
    yearsSecond: fc.boolean(),
    superiority: fc.boolean(),
  }),
  confirmed: fc.boolean(),
});

function sentenceOf(spec: SentenceSpec, first: FactSpec, second: FactSpec): string | null {
  if (!spec.written) {
    return null;
  }
  return [
    "比べた結果です。",
    spec.namesFirst ? `${first.area}の値、` : "",
    spec.namesSecond ? `${second.area}の値、` : "",
    spec.yearsFirst ? `${first.year}年、` : "",
    spec.yearsSecond ? `${second.year}年、` : "",
    spec.superiority ? "上回ります。" : "",
  ].join("");
}

/** The units of a unit pair, as the case says: the right pair, the pair the other way round, or another pair. */
function pairOf(kind: PairKind, first: FactSpec, second: FactSpec) {
  switch (kind) {
    case "NONE":
      return undefined;
    case "RIGHT":
      return { numerator: first.unit, denominator: second.unit };
    case "SWAPPED":
      return { numerator: second.unit, denominator: first.unit };
    case "OTHER":
      return { numerator: "円", denominator: "円" };
  }
}

/** The judgment that the table of Req 7.26 gives for the attributes. */
function expectedViolations(
  first: FactSpec,
  second: FactSpec,
  use: UseKind,
  pair: PairKind,
  sentence: SentenceSpec,
  confirmed: boolean,
): Set<string> {
  const found = new Set<string>();
  const ratio = use === "RATIO";
  const change = use === "DIFFERENCE" || use === "PERCENT_CHANGE";
  const derive = ratio || change;
  const overTime = use === "TIME_SERIES" || change;
  const said = sentence.written;

  if (ratio) {
    if (pair === "NONE") found.add("UNIT_PAIR_MISSING");
    else if (!(pair === "RIGHT" || (pair === "SWAPPED" && first.unit === second.unit))) {
      // The pair is the units of the two values: the right pair always, the swapped pair when the units are the same.
      found.add("UNIT_PAIR_MISMATCH");
    }
  } else if (first.unit !== second.unit) {
    found.add("UNIT_MISMATCH");
  }

  if (first.area !== second.area) {
    if (overTime) {
      found.add("AREA_MISMATCH");
    } else {
      if (!(said && sentence.namesFirst && sentence.namesSecond)) found.add("AREA_NOT_STATED");
      if (use === "COMPARE" && said && sentence.superiority) found.add("SUPERIORITY_STATED");
    }
  }

  if (first.year !== second.year && !(said && sentence.yearsFirst && sentence.yearsSecond)) {
    found.add("YEAR_NOT_STATED");
  }
  if (change) {
    const later =
      first.year !== second.year ? first.year > second.year : first.dated && second.dated && first.month > second.month;
    if (!later) found.add("TIME_ORDER_INVALID");
  }

  if (overTime && !confirmed && (first.definition === "NONE" || first.definition !== second.definition)) {
    found.add("DEFINITION_CHANGED");
  }
  if (derive && (first.derived || second.derived)) {
    found.add("DERIVED_OPERAND_NOT_ALLOWED");
  }
  return found;
}

describe("Property 58: the conditions of a comparison", () => {
  it("the judgment of checkFactComparison is the judgment of the table of Req 7.26", () => {
    fc.assert(
      fc.property(caseArbitrary, ({ first, second, use, pair, sentence, confirmed }) => {
        // A derived operand has no definition that this table knows, so it is only used where no definition is asked.
        fc.pre(!((first.derived || second.derived) && (use === "TIME_SERIES" || use === "DIFFERENCE" || use === "PERCENT_CHANGE")));
        // The units of a ratio are read from the facts: the pair "OTHER" is not the units of any fact (the units are 戸, 人, 世帯).
        const unitPair = pairOf(pair, first, second);
        const comparisonUse: ComparisonUse =
          use === "COMPARE" || use === "TIME_SERIES"
            ? { kind: use }
            : { kind: "DERIVE", operation: use, ...(unitPair === undefined ? {} : { unitPair }) };
        const result = checkFactComparison({
          operands: [makeFact(first, "fact-1"), makeFact(second, "fact-2")],
          use: comparisonUse,
          sentence: sentenceOf(sentence, first, second),
          superiorityWords: ["上回"],
          definitionChangeConfirmed: confirmed,
        });
        const expected = expectedViolations(first, second, use, pair, sentence, confirmed);
        if (expected.size === 0) {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result).toEqual({
            ok: false,
            code: "FACT_COMPARISON_INVALID",
            violations: COMPARISON_VIOLATIONS.filter((violation) => expected.has(violation)),
          });
        }
      }),
      { numRuns: 1500 },
    );
  });

  it("a pair that has one condition less than a passing pair is refused with the code", () => {
    // Start from a pair that passes, and break one condition at a time.
    const base: FactSpec = { unit: "戸", area: "架空市", year: 2024, dated: false, month: 1, definition: "D1", derived: false };
    const passes = (first: FactSpec, second: FactSpec, sentence: string | null) =>
      checkFactComparison({
        operands: [makeFact(first, "fact-1"), makeFact(second, "fact-2")],
        use: { kind: "TIME_SERIES" },
        sentence,
      }).ok;
    const older: FactSpec = { ...base, year: 2023 };
    expect(passes(base, older, "2023年と2024年の値です。")).toBe(true);
    expect(passes({ ...base, unit: "人" }, older, "2023年と2024年の値です。")).toBe(false);
    expect(passes({ ...base, area: "架空町" }, older, "2023年と2024年の値です。")).toBe(false);
    expect(passes(base, { ...older, definition: "D2" }, "2023年と2024年の値です。")).toBe(false);
    expect(passes(base, older, "2024年の値です。")).toBe(false);
  });
});

describe("Property 58: the verification state that counts for a derived fact", () => {
  const operand = (factId: string, amount: number, year: number, sha: string, overrides: Record<string, unknown> = {}): RealFact =>
    RealFactSchema.parse({
      dataKind: "REAL_AI",
      factId,
      sentence: "空き家の数です。",
      value: { amount, unit: "戸" },
      surveyDate: year,
      area: "架空市",
      publisher: "試験用の公開者",
      sourceUrl: "https://example.com/a.csv",
      datasetUrl: "https://example.com/data",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      retrievedAt: "2026-02-01T00:00:00Z",
      sha256: sha,
      locator: { kind: "text-lines", startLine: 1, endLine: 2 },
      method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "数える" },
      verification: { status: "VERIFIED", verifierId: "v-1", verifiedAt: "2026-02-02T09:00:00Z" },
      ...overrides,
    });

  const flags = fc.record({
    ownVerified: fc.boolean(),
    tampered: fc.boolean(),
    firstMissing: fc.boolean(),
    secondMissing: fc.boolean(),
    firstVerified: fc.boolean(),
    secondVerified: fc.boolean(),
    firstSourceChanged: fc.boolean(),
    secondSourceChanged: fc.boolean(),
    firstDerived: fc.boolean(),
    firstValueChanged: fc.boolean(),
  });

  it("is PROVISIONAL, with exactly the reasons that hold, whenever a condition of Req 7.25 is not met, and VERIFIED otherwise", () => {
    fc.assert(
      fc.property(flags, (flag) => {
        const originalFirst = operand("fact-after", 480, 2024, SHA_A);
        const originalSecond = operand("fact-before", 420, 2023, SHA_B);
        const stored = RealFactSchema.parse({
          ...originalFirst,
          factId: "fact-derived",
          value: { amount: flag.tampered ? 61 : 60, unit: "戸" },
          method: { kind: "DERIVED", operation: "DIFFERENCE", operandFactIds: ["fact-after", "fact-before"], description: "差" },
          verification: flag.ownVerified
            ? { status: "VERIFIED", verifierId: "v-2", verifiedAt: "2026-02-03T09:00:00Z" }
            : { status: "PROVISIONAL" },
        });
        const factsById = new Map<string, RealFact>();
        if (!flag.firstMissing) {
          factsById.set(
            "fact-after",
            operand("fact-after", flag.firstValueChanged ? 500 : 480, 2024, SHA_A, {
              verification: flag.firstVerified ? originalFirst.verification : { status: "PROVISIONAL" },
              ...(flag.firstDerived
                ? { method: { kind: "DERIVED", operation: "DIFFERENCE", operandFactIds: ["p", "q"], description: "差" } }
                : {}),
            }),
          );
        }
        if (!flag.secondMissing) {
          factsById.set(
            "fact-before",
            operand("fact-before", 420, 2023, SHA_B, {
              verification: flag.secondVerified ? originalSecond.verification : { status: "PROVISIONAL" },
            }),
          );
        }
        const currentSha256 = (fact: RealFact): string =>
          (fact.sha256 === SHA_A && flag.firstSourceChanged) || (fact.sha256 === SHA_B && flag.secondSourceChanged)
            ? "f".repeat(64)
            : fact.sha256;

        const expected = new Set<string>();
        if (!flag.ownVerified) expected.add("NOT_VERIFIED");
        // The derived fact has the SHA-256 of the first operand.
        if (flag.firstSourceChanged) expected.add("SOURCE_CHANGED");
        if (flag.firstMissing || flag.secondMissing) expected.add("OPERAND_MISSING");
        if (!flag.firstMissing && flag.firstDerived) expected.add("OPERAND_IS_DERIVED");
        if (
          (!flag.firstMissing && (!flag.firstVerified || flag.firstSourceChanged)) ||
          (!flag.secondMissing && (!flag.secondVerified || flag.secondSourceChanged))
        ) {
          expected.add("OPERAND_NOT_VERIFIED");
        }
        if (!flag.firstMissing && !flag.secondMissing && (flag.tampered || flag.firstValueChanged)) {
          expected.add("VALUE_MISMATCH");
        }

        const result = effectiveVerification(stored, { factsById, currentSha256 });
        if (expected.size === 0) {
          expect(result).toEqual({ status: "VERIFIED" });
        } else {
          expect(result).toEqual({ status: "PROVISIONAL", reasons: PROVISIONAL_REASONS.filter((reason) => expected.has(reason)) });
        }
      }),
      { numRuns: 1000 },
    );
  });
});
