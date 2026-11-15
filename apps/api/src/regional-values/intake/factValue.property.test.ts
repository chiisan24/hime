import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computedRequest, takeInTable } from "../../../../../tests/harness/regional-values/factSupport.js";
import { FAST_OPERATIONS, createIntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { createComputedFact, checkRealFact, readRealFacts, recomputeFact } from "./factValue.js";
import type { ComputedFactRequest } from "./factValue.js";
import { currentOriginalShas } from "./originals.js";
import { readRealSources } from "./sourceRecords.js";

// Feature: regional-values-map, Property 26: 事実の数値
// **Validates: Requirements 7.20, 12.14**
//
// A table of rows that is written as a CSV file, taken in, and made into a fact item by the intake. What the fact
// item has to say is computed from the model of the rows (a count, a count of a kind, a sum), apart from the code.
// The fact item that the code makes passes the check of its value; the same fact item with the number of its sentence
// changed to another value, or with its stored value changed, is refused as FACT_VALUE_MISMATCH, every time.

const PARAMETERS = { seed: 130_011, numRuns: 100 };
/** A run makes a temporary directory and many files; the limit is for a machine that is busy with other tests. */
const HEAVY = 120_000;

const AREAS = ["あおば", "みなと", "ひなた"] as const;
const KINDS = ["A", "B"] as const;

type Row = Readonly<{ area: (typeof AREAS)[number]; kind: (typeof KINDS)[number]; value: number | null }>;

const rowArbitrary: fc.Arbitrary<Row> = fc.record({
  area: fc.constantFrom(...AREAS),
  kind: fc.constantFrom(...KINDS),
  value: fc.option(fc.constantFrom(0, 3, 12, 99, 1200, 34_567), { nil: null }),
});

type Spec = Readonly<{
  aggregation: "COUNT_ROWS" | "COUNT_ROWS_WHERE" | "SUM_COLUMN";
  kind: (typeof KINDS)[number] | null;
  dedupe: boolean;
  /** The unit that the cells of the table have: nothing, or one. */
  unit: "" | "人";
}>;

const specArbitrary: fc.Arbitrary<Spec> = fc.record({
  aggregation: fc.constantFrom("COUNT_ROWS", "COUNT_ROWS_WHERE", "SUM_COLUMN"),
  kind: fc.option(fc.constantFrom(...KINDS), { nil: null }),
  dedupe: fc.boolean(),
  unit: fc.constantFrom("", "人"),
});

const caseArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, { minLength: 1, maxLength: 8, selector: (row) => JSON.stringify(row) }),
  spec: specArbitrary,
  surveyDate: fc.oneof(fc.constant<string | number>("2026-07-27"), fc.constant<string | number>(2025)),
  shift: fc.nat({ max: 99 }),
});

function csvOf(rows: readonly Row[], unit: string): string {
  const cell = (value: number | null): string => {
    if (value === null) {
      return "";
    }
    // A number with a comma is a field in quotes, as in a real file.
    return value >= 1000 ? `"${value.toLocaleString("en-US")}${unit}"` : `${String(value)}${unit}`;
  };
  return ["地区,種別,件数", ...rows.map((row) => `${row.area},${row.kind},${cell(row.value)}`)].join("\n") + "\n";
}

function requestOf(spec: Spec, surveyDate: string | number): ComputedFactRequest {
  const dedupe = spec.dedupe ? { dedupeColumns: ["地区"] } : {};
  const subject = "件数の合計";
  if (spec.aggregation === "COUNT_ROWS") {
    return computedRequest({ method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数", ...dedupe }, subject: "記録の数", unit: "件", surveyDate });
  }
  if (spec.aggregation === "COUNT_ROWS_WHERE") {
    return computedRequest({
      method: { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "種別", equals: spec.kind ?? "A", description: "種別が一致する行の数", ...dedupe },
      // No kanji numeral in the subject (一致 has 一): such a word is a number to the check unless the settings exempt it.
      subject: "指定した種別の記録の数",
      unit: "件",
      surveyDate,
    });
  }
  return computedRequest({
    method: {
      kind: "COMPUTED",
      aggregation: "SUM_COLUMN",
      column: "件数",
      whereColumn: spec.kind === null ? null : "種別",
      equals: spec.kind,
      description: "件数の合計",
      ...dedupe,
    },
    subject,
    unit: spec.unit === "" ? "か所" : spec.unit,
    surveyDate,
  });
}

type Expected = Readonly<{ amount: number; unit: string; missingCount: number; duplicatesRemoved: number }>;

/** The rules of the computation, written from the model of the rows. */
function expectedOf(rows: readonly Row[], spec: Spec): Expected {
  let kept: readonly Row[] = rows;
  if (spec.dedupe) {
    const seen = new Set<string>();
    kept = rows.filter((row) => {
      if (seen.has(row.area)) {
        return false;
      }
      seen.add(row.area);
      return true;
    });
  }
  const duplicatesRemoved = rows.length - kept.length;
  if (spec.aggregation === "COUNT_ROWS") {
    return { amount: kept.length, unit: "件", missingCount: 0, duplicatesRemoved };
  }
  if (spec.aggregation === "COUNT_ROWS_WHERE") {
    return { amount: kept.filter((row) => row.kind === (spec.kind ?? "A")).length, unit: "件", missingCount: 0, duplicatesRemoved };
  }
  const included = kept.filter((row) => spec.kind === null || row.kind === spec.kind);
  return {
    amount: included.reduce((sum, row) => sum + (row.value ?? 0), 0),
    unit: spec.unit === "" ? "か所" : spec.unit,
    missingCount: included.filter((row) => row.value === null).length,
    duplicatesRemoved,
  };
}

describe("fact items of a computed value: Property 26", () => {
  it("makes a PROVISIONAL fact item that has the value of the rows, passes the check, and is refused when its number is changed to another value", async () => {
    await fc.assert(
      fc.asyncProperty(caseArbitrary, async ({ rows, spec, surveyDate, shift }) => {
        const world = await createIntakeWorld({ operations: FAST_OPERATIONS });
        try {
          await takeInTable(world, csvOf(rows, spec.unit));
          const made = await createComputedFact(world.store, requestOf(spec, surveyDate));
          expect(made.ok, JSON.stringify(made)).toBe(true);
          if (!made.ok) {
            return;
          }
          const { fact, aggregation } = made.value;
          const expected = expectedOf(rows, spec);

          // The value, the state and the record of the computation.
          expect(fact.verification).toEqual({ status: "PROVISIONAL" });
          expect(fact.value).toEqual({ amount: expected.amount, unit: expected.unit });
          expect(aggregation).toMatchObject({ missingCount: expected.missingCount, duplicatesRemoved: expected.duplicatesRemoved, inputSha256: fact.sha256 });

          // It passes the check of its value, its source and its original.
          const sources = await readRealSources(world.store);
          const facts = await readRealFacts(world.store);
          expect(sources.ok && facts.ok).toBe(true);
          if (!sources.ok || !facts.ok) {
            return;
          }
          const factsById = new Map(facts.value.map((item) => [item.factId, item] as const));
          const shas = await currentOriginalShas(world.store, sources.value);
          const recomputation = await recomputeFact(world.store, fact, { sources: sources.value, factsById });
          expect(recomputation.state).toBe("OK");
          const check = (candidate: typeof fact) => checkRealFact({ fact: candidate, sources: sources.value, currentSha256: () => shas.get(fact.sha256), recomputation }).map((finding) => finding.code);
          expect(check(fact)).toEqual([]);

          // The number of the sentence changed to another value: refused, every time.
          const written = `${String(fact.value.amount)}${fact.value.unit}`;
          expect(fact.sentence).toContain(written);
          const other = fact.value.amount + 1 + shift;
          expect(check({ ...fact, sentence: fact.sentence.replace(written, `${String(other)}${fact.value.unit}`) })).toContain("FACT_VALUE_MISMATCH");
          // The stored value changed (with or without its sentence): refused.
          expect(check({ ...fact, value: { amount: other, unit: fact.value.unit } })).toContain("FACT_VALUE_MISMATCH");
          expect(check({ ...fact, value: { amount: other, unit: fact.value.unit }, sentence: fact.sentence.replace(written, `${String(other)}${fact.value.unit}`) })).toContain("FACT_VALUE_MISMATCH");
          // The unit changed: refused.
          expect(check({ ...fact, value: { amount: fact.value.amount, unit: `${fact.value.unit}以外` } })).toContain("FACT_VALUE_MISMATCH");
          // A date of the sentence that is not the survey date: refused.
          if (typeof fact.surveyDate === "string") {
            expect(check({ ...fact, sentence: fact.sentence.replace("7月27日", "7月28日") })).toContain("FACT_VALUE_MISMATCH");
          } else {
            expect(check({ ...fact, sentence: fact.sentence.replace("2025年", "2024年") })).toContain("FACT_VALUE_MISMATCH");
          }
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  }, HEAVY);

  it("never makes a fact item that is verified, and writes it once", async () => {
    await fc.assert(
      fc.asyncProperty(caseArbitrary, async ({ rows, spec, surveyDate }) => {
        const world = await createIntakeWorld({ operations: FAST_OPERATIONS });
        try {
          await takeInTable(world, csvOf(rows, spec.unit));
          const request = requestOf(spec, surveyDate);
          const first = await createComputedFact(world.store, request);
          expect(first.ok && first.value.fact.verification.status).toBe("PROVISIONAL");
          const text = await world.readText(world.recordPath(`facts/${request.factId}.json`));
          const second = await createComputedFact(world.store, request);
          expect(second.ok && second.value.status).toBe("UNCHANGED");
          expect(await world.readText(world.recordPath(`facts/${request.factId}.json`))).toBe(text);
        } finally {
          await world.remove();
        }
      }),
      PARAMETERS,
    );
  }, HEAVY);
});
