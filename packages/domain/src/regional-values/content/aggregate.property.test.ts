import { Sha256Schema } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../../serialization/canonicalJson.js";
import { sha256Hex } from "../../serialization/contentHash.js";
import { aggregate } from "./aggregate.js";
import type { AggregateRefusal, ComputedMethod } from "./aggregate.js";

// Feature: regional-values-map, Property 59: 集計の規則と再現性
//
// The expected value is computed from the generated rows (the model), not by reading the text
// again: the model is a list of rows of a fictional table, and `reference` below is written from
// the rules of Req 7.27 alone. The table is rendered to CSV text in one of three styles and with
// blank lines between rows, and the line numbers of the rows are known from how it was rendered.

const SHA = Sha256Schema.parse("d".repeat(64));
const PARAMETERS = { seed: 590_059, numRuns: 200 };

const AREAS = ["あおば", "みなと", "ひなた"] as const;
const KINDS = ["A", "B"] as const;
const UNITS = ["", "人", "戸"] as const;

type Cell =
  | Readonly<{ type: "blank" }>
  | Readonly<{ type: "bad" }>
  | Readonly<{ type: "number"; amount: number; unit: (typeof UNITS)[number] }>;

type Row = Readonly<{ area: (typeof AREAS)[number]; kind: (typeof KINDS)[number]; cell: Cell }>;

type Style = "plain" | "comma" | "fullwidth";

const cellArbitrary: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<Cell>({ type: "blank" }) },
  { weight: 1, arbitrary: fc.constant<Cell>({ type: "bad" }) },
  {
    weight: 8,
    arbitrary: fc
      .tuple(fc.constantFrom(0, 5, 12, 1200, 34567), fc.constantFrom(...UNITS))
      .map(([amount, unit]): Cell => ({ type: "number", amount, unit })),
  },
);

const rowArbitrary: fc.Arbitrary<Row> = fc.record({
  area: fc.constantFrom(...AREAS),
  kind: fc.constantFrom(...KINDS),
  cell: cellArbitrary,
});

const rowsArbitrary: fc.Arbitrary<Row[]> = fc.oneof(
  fc.array(rowArbitrary, { minLength: 1, maxLength: 12 }),
  fc.uniqueArray(rowArbitrary, { minLength: 1, maxLength: 8, selector: (row) => JSON.stringify(row) }),
);

/** A table of rows whose cells have one unit at most, so that a sum is not refused for its units. */
const sameUnitRows: fc.Arbitrary<Row[]> = fc
  .tuple(fc.constantFrom(...UNITS), fc.uniqueArray(rowArbitrary, { minLength: 1, maxLength: 8, selector: (row) => JSON.stringify(row) }))
  .map(([unit, rows]) => rows.map((row): Row => (row.cell.type === "number" ? { ...row, cell: { ...row.cell, unit } } : row)));

type Spec = Readonly<{
  aggregation: "COUNT_ROWS" | "COUNT_ROWS_WHERE" | "SUM_COLUMN";
  kind: (typeof KINDS)[number] | null;
  dedupe: readonly string[] | null;
}>;

const specArbitrary: fc.Arbitrary<Spec> = fc.record({
  aggregation: fc.constantFrom("COUNT_ROWS", "COUNT_ROWS_WHERE", "SUM_COLUMN"),
  kind: fc.option(fc.constantFrom(...KINDS), { nil: null }),
  dedupe: fc.constantFrom(null, ["地区"], ["地区", "種別"]),
});

function methodOf(spec: Spec): ComputedMethod {
  const dedupe = spec.dedupe === null ? {} : { dedupeColumns: [...spec.dedupe] };
  if (spec.aggregation === "COUNT_ROWS") {
    return { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数", ...dedupe };
  }
  if (spec.aggregation === "COUNT_ROWS_WHERE") {
    return { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "種別", equals: spec.kind ?? "A", description: "種別の件数", ...dedupe };
  }
  return {
    kind: "COMPUTED",
    aggregation: "SUM_COLUMN",
    column: "件数",
    whereColumn: spec.kind === null ? null : "種別",
    equals: spec.kind,
    description: "件数の合計",
    ...dedupe,
  };
}

const FULL_WIDTH = "０１２３４５６７８９";

function render(cell: Cell, style: Style): string {
  if (cell.type === "blank") {
    return "";
  }
  if (cell.type === "bad") {
    return "あ";
  }
  const digits = style === "comma" ? cell.amount.toLocaleString("en-US") : String(cell.amount);
  const written = style === "fullwidth" ? [...digits].map((char) => (/\d/u.test(char) ? (FULL_WIDTH[Number(char)] ?? char) : char)).join("") : digits;
  // A number with a comma is a field in quotes, as in a real file.
  const field = `${written}${cell.unit}`;
  return field.includes(",") ? `"${field}"` : field;
}

type Rendered = Readonly<{ text: string; firstLine: number; lastLine: number }>;

function renderTable(rows: readonly Row[], style: Style, gaps: readonly number[], trailingLineFeed: boolean): Rendered {
  const lines = ["地区,種別,件数"];
  let firstLine = 0;
  let lastLine = 0;
  rows.forEach((row, index) => {
    for (let blank = 0; blank < (gaps[index % gaps.length] ?? 0); blank += 1) {
      lines.push("");
    }
    lines.push(`${row.area},${row.kind},${render(row.cell, style)}`);
    if (index === 0) {
      firstLine = lines.length;
    }
    lastLine = lines.length;
  });
  return { text: lines.join("\n") + (trailingLineFeed ? "\n" : ""), firstLine, lastLine };
}

type Expected =
  | Readonly<{ ok: true; amount: number; unit: string | null; missingCount: number; duplicatesRemoved: number }>
  | Readonly<{ ok: false; error: AggregateRefusal }>;

/** The rules of Req 7.27 on the model of the rows. */
function reference(rows: readonly Row[], spec: Spec): Expected {
  const same = (first: Row, second: Row): boolean => JSON.stringify(first) === JSON.stringify(second);
  let kept: readonly Row[] = rows;
  let duplicatesRemoved = 0;
  if (spec.dedupe === null) {
    for (let index = 0; index < rows.length; index += 1) {
      for (let other = index + 1; other < rows.length; other += 1) {
        const first = rows[index];
        const second = rows[other];
        if (first !== undefined && second !== undefined && same(first, second)) {
          return { ok: false, error: "DUPLICATE_ROWS" };
        }
      }
    }
  } else {
    const keyOf = (row: Row): string => JSON.stringify(spec.dedupe?.map((column) => (column === "地区" ? row.area : row.kind)));
    const first = new Map<string, Row>();
    for (const row of rows) {
      if (!first.has(keyOf(row))) {
        first.set(keyOf(row), row);
      }
    }
    kept = [...first.values()];
    duplicatesRemoved = rows.length - kept.length;
  }

  if (spec.aggregation === "COUNT_ROWS") {
    return { ok: true, amount: kept.length, unit: null, missingCount: 0, duplicatesRemoved };
  }
  if (spec.aggregation === "COUNT_ROWS_WHERE") {
    const wanted = spec.kind ?? "A";
    return { ok: true, amount: kept.filter((row) => row.kind === wanted).length, unit: null, missingCount: 0, duplicatesRemoved };
  }
  const included = kept.filter((row) => spec.kind === null || row.kind === spec.kind);
  const missingCount = included.filter((row) => row.cell.type === "blank").length;
  if (included.some((row) => row.cell.type === "bad")) {
    return { ok: false, error: "NON_NUMERIC_VALUE" };
  }
  let amount = 0;
  const units = new Set<string>();
  for (const row of included) {
    if (row.cell.type === "number") {
      amount += row.cell.amount;
      units.add(row.cell.unit);
    }
  }
  if (units.size > 1) {
    return { ok: false, error: "MIXED_UNITS" };
  }
  const [only = ""] = units;
  return { ok: true, amount, unit: only === "" ? null : only, missingCount, duplicatesRemoved };
}

const styleArbitrary = fc.constantFrom<Style>("plain", "comma", "fullwidth");
const gapsArbitrary = fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 4 });

describe("aggregate: properties (Property 59)", () => {
  /** **Validates: Requirements 7.25, 7.27, 12.14** */
  it("gives the value or the refusal that the rules of Req 7.27 give, and the lines of the rows", () => {
    fc.assert(
      fc.property(rowsArbitrary, specArbitrary, styleArbitrary, gapsArbitrary, fc.boolean(), (rows, spec, style, gaps, trailing) => {
        const rendered = renderTable(rows, style, gaps, trailing);
        const result = aggregate({ text: rendered.text, inputSha256: SHA, method: methodOf(spec), surveyDate: "2025-04-01" });
        const expected = reference(rows, spec);
        if (!expected.ok) {
          expect(result).toEqual({ ok: false, error: expected.error });
          return;
        }
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(result.value).toMatchObject({
          amount: expected.amount,
          unit: expected.unit,
          missingCount: expected.missingCount,
          duplicatesRemoved: expected.duplicatesRemoved,
          locator: { kind: "text-lines", startLine: rendered.firstLine, endLine: rendered.lastLine },
          inputSha256: SHA,
          surveyDate: "2025-04-01",
        });
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.27** */
  it("never leaves a row out when the method has no dedupeColumns: it counts every row or refuses", () => {
    fc.assert(
      fc.property(rowsArbitrary, styleArbitrary, (rows, style) => {
        const method = methodOf({ aggregation: "COUNT_ROWS", kind: null, dedupe: null });
        const result = aggregate({ text: renderTable(rows, style, [0], true).text, inputSha256: SHA, method, surveyDate: 2025 });
        if (result.ok) {
          expect(result.value.amount).toBe(rows.length);
          expect(result.value.duplicatesRemoved).toBe(0);
        } else {
          expect(result.error).toBe("DUPLICATE_ROWS");
          const texts = rows.map((row) => JSON.stringify(row));
          expect(new Set(texts).size).toBeLessThan(texts.length);
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.27** */
  it("records as many left-out rows as dedupeColumns leaves out, and the sum is of the rows that are kept", () => {
    fc.assert(
      fc.property(sameUnitRows, styleArbitrary, (rows, style) => {
        const dedupe = ["地区", "種別"];
        const spec: Spec = { aggregation: "SUM_COLUMN", kind: null, dedupe };
        const result = aggregate({ text: renderTable(rows, style, [0], false).text, inputSha256: SHA, method: methodOf(spec), surveyDate: 2025 });
        const expected = reference(rows, spec);
        expect(result.ok).toBe(expected.ok);
        if (result.ok && expected.ok) {
          expect(result.value.duplicatesRemoved).toBe(expected.duplicatesRemoved);
          expect(result.value.amount).toBe(expected.amount);
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.25, 12.14** */
  it("gives the same result for the same input, and a method hash that depends on the method only", () => {
    fc.assert(
      fc.property(rowsArbitrary, specArbitrary, styleArbitrary, (rows, spec, style) => {
        const method = methodOf(spec);
        const text = renderTable(rows, style, [1], true).text;
        const first = aggregate({ text, inputSha256: SHA, method, surveyDate: 2024 });
        expect(aggregate({ text, inputSha256: SHA, method, surveyDate: 2024 })).toEqual(first);
        if (first.ok) {
          expect(first.value.methodHash).toBe(sha256Hex(encodeCanonicalJson(method)));
        }
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.27** */
  it("refuses a survey date that cannot be read, whatever the rows are", () => {
    fc.assert(
      fc.property(
        rowsArbitrary,
        specArbitrary,
        fc.constantFrom<string | number | null>(null, "", "2025", "2025-13-01", "令和7年4月1日", 1899, 2201, 12.5),
        (rows, spec, surveyDate) => {
          const result = aggregate({ text: renderTable(rows, "plain", [0], true).text, inputSha256: SHA, method: methodOf(spec), surveyDate });
          expect(result).toEqual({ ok: false, error: "SURVEY_DATE_UNREADABLE" });
        },
      ),
      PARAMETERS,
    );
  });
});
