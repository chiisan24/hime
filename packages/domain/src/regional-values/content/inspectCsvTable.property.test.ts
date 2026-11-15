import { Sha256Schema } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { aggregate, inspectCsvTable } from "./aggregate.js";
import type { ComputedMethod } from "./aggregate.js";

// Feature: regional-values-map, Property 59 (入口側の補足): 取り込みが見る表の形と aggregate の読み方の一致
//
// The expected summary is computed from the model of the table that is rendered (the rows, the gaps
// of blank lines and the lines that a cell with a line break takes), not by reading the text again.

const SHA = Sha256Schema.parse("e".repeat(64));
const PARAMETERS = { seed: 130_015, numRuns: 300 };
const COUNT_ROWS: ComputedMethod = { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数" };

function aggregateRefusesTable(text: string): boolean {
  const result = aggregate({ text, inputSha256: SHA, method: COUNT_ROWS, surveyDate: 2025 });
  return !result.ok && result.error === "INVALID_CSV";
}

const TOKENS = ["a", "b", " ", ",", ",", '"', '"', "\n", "\n", "\r", "1", "\uFEFF", "ａ", "\t", "x,y"] as const;

const CELL_VALUES = ["", "x", "y", "1", "a,b", 'q"q', "l1\nl2", " "] as const;

type Rendered = Readonly<{
  text: string;
  rows: readonly (readonly string[])[];
  headerLine: number;
  rowStartLines: readonly number[];
  rowEndLines: readonly number[];
}>;

function renderField(value: string): string {
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function linesOf(record: string): number {
  return record.split("\n").length;
}

/** Renders a table with at least two columns, so that no row is a line with nothing on it. */
function render(columnCount: number, rows: readonly (readonly string[])[], gaps: readonly number[], leading: number, trailingLineFeed: boolean): Rendered {
  const lines: string[] = [];
  let lineNumber = 1;
  const push = (record: string): number => {
    const start = lineNumber;
    lines.push(record);
    lineNumber += linesOf(record);
    return start;
  };
  for (let blank = 0; blank < leading; blank += 1) {
    push("");
  }
  const headerLine = push(Array.from({ length: columnCount }, (_value, index) => `h${index}`).join(","));
  const rowStartLines: number[] = [];
  const rowEndLines: number[] = [];
  rows.forEach((row, index) => {
    for (let blank = 0; blank < (gaps[index % gaps.length] ?? 0); blank += 1) {
      push("");
    }
    const start = push(row.map(renderField).join(","));
    rowStartLines.push(start);
    rowEndLines.push(lineNumber - 1);
  });
  return { text: lines.join("\n") + (trailingLineFeed ? "\n" : ""), rows, headerLine, rowStartLines, rowEndLines };
}

const tableArbitrary = fc
  .integer({ min: 2, max: 4 })
  .chain((columnCount) =>
    fc.record({
      columnCount: fc.constant(columnCount),
      rows: fc.array(fc.array(fc.constantFrom(...CELL_VALUES), { minLength: columnCount, maxLength: columnCount }), { minLength: 1, maxLength: 8 }),
      gaps: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 4 }),
      leading: fc.integer({ min: 0, max: 2 }),
      trailing: fc.boolean(),
    }),
  );

describe("inspectCsvTable: properties", () => {
  /** **Validates: Requirements 7.5, 7.18, 7.27** */
  it("agrees with aggregate on whether a text is a table, for any text", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TOKENS), { maxLength: 40 }), (tokens) => {
        const text = tokens.join("");
        expect(inspectCsvTable(text).ok).toBe(!aggregateRefusesTable(text));
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.5, 7.18, 7.24, 7.27** */
  it("gives the rows, the lines, the blank cells and the repeated rows of the table that was rendered", () => {
    fc.assert(
      fc.property(tableArbitrary, ({ columnCount, rows, gaps, leading, trailing }) => {
        const rendered = render(columnCount, rows, gaps, leading, trailing);
        const result = inspectCsvTable(rendered.text);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        const keys = rows.map((row) => JSON.stringify(row.map((value) => value.trim())));
        expect(result.value).toEqual({
          headers: Array.from({ length: columnCount }, (_value, index) => `h${index}`),
          columnCount,
          rowCount: rows.length,
          recordCount: rows.length + 1,
          headerLine: rendered.headerLine,
          firstDataLine: rendered.rowStartLines[0],
          lastDataLine: rendered.rowEndLines[rows.length - 1],
          blankCellCount: rows.flat().filter((value) => value.trim() === "").length,
          duplicateRowCount: keys.length - new Set(keys).size,
        });
        // The same table is never refused by aggregate as INVALID_CSV.
        expect(aggregateRefusesTable(rendered.text)).toBe(false);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.5, 7.18** */
  it("names the first row that has another number of fields than the header", () => {
    fc.assert(
      fc.property(tableArbitrary, fc.nat(), fc.nat(), ({ columnCount, rows, gaps, leading, trailing }, pick, extra) => {
        const target = pick % rows.length;
        // One more field makes the row a row of its own length, whatever the cells are.
        const changed = rows.map((row, index) => (index === target || (index > target && extra % 2 === 0) ? [...row, "z"] : row));
        const rendered = render(columnCount, changed, gaps, leading, trailing);
        expect(inspectCsvTable(rendered.text)).toEqual({
          ok: false,
          error: { code: "COLUMN_COUNT_MISMATCH", line: rendered.rowStartLines[target] },
        });
        expect(aggregateRefusesTable(rendered.text)).toBe(true);
      }),
      PARAMETERS,
    );
  });
});
