import { Sha256Schema } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { aggregate, CSV_TABLE_REFUSALS, csvCellNumber, csvCellsOfLines, inspectCsvTable } from "./aggregate.js";
import type { ComputedMethod } from "./aggregate.js";

const SHA = Sha256Schema.parse("c".repeat(64));
const COUNT_ROWS: ComputedMethod = { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数" };

/** What `aggregate` says about the text when the survey date is fine: `true` when it refuses to read it as a table. */
function aggregateRefusesTable(text: string): boolean {
  const result = aggregate({ text, inputSha256: SHA, method: COUNT_ROWS, surveyDate: 2025 });
  return !result.ok && result.error === "INVALID_CSV";
}

describe("inspectCsvTable: a table that is taken in", () => {
  it("counts the columns, the rows, the lines, the blank cells and the repeated rows", () => {
    const text = ["名称,種別,件数", "あおば,A,12", "みなと,B,", "あおば,A,12", ""].join("\n");
    expect(inspectCsvTable(text)).toEqual({
      ok: true,
      value: {
        headers: ["名称", "種別", "件数"],
        columnCount: 3,
        rowCount: 3,
        recordCount: 4,
        headerLine: 1,
        firstDataLine: 2,
        lastDataLine: 4,
        blankCellCount: 1,
        duplicateRowCount: 1,
      },
    });
  });

  it("does not count a line with nothing on it, and still names the lines of the rows", () => {
    const text = ["", "a,b", "", "1,2", "", "", "3,4", ""].join("\n");
    const result = inspectCsvTable(text);
    expect(result).toMatchObject({ ok: true, value: { headerLine: 2, firstDataLine: 4, lastDataLine: 7, rowCount: 2, recordCount: 3 } });
  });

  it("reads a field in quotes with a comma, a quote and a line break as one cell, and counts the lines it takes", () => {
    const text = 'a,b\n"x, y","line1\nline2"\n"he said ""hi""",z\n';
    const result = inspectCsvTable(text);
    // The first row takes the lines 2 and 3; the second row is on the line 4.
    expect(result).toMatchObject({ ok: true, value: { rowCount: 2, firstDataLine: 2, lastDataLine: 4, columnCount: 2 } });
  });

  it("takes a text that begins with a byte order mark", () => {
    expect(inspectCsvTable("\uFEFFa,b\n1,2")).toMatchObject({ ok: true, value: { headers: ["a", "b"], rowCount: 1 } });
  });

  it("reads the names of the columns as aggregate does: NFKC, and without the spaces at both ends", () => {
    const result = inspectCsvTable(" Ａｂ ,名称\n1,2");
    expect(result).toMatchObject({ ok: true, value: { headers: ["Ab", "名称"] } });
  });

  it("counts a row of blank cells as a row (it is one row of the original) and its cells as blank", () => {
    const result = inspectCsvTable("a,b,c\n,,\n1,2,3");
    expect(result).toMatchObject({ ok: true, value: { rowCount: 2, blankCellCount: 3, duplicateRowCount: 0 } });
  });

  it("counts a row as the same row after NFKC, as aggregate does", () => {
    const text = "a,b\n1,x\n１,ｘ\n";
    expect(inspectCsvTable(text)).toMatchObject({ ok: true, value: { duplicateRowCount: 1 } });
    expect(aggregate({ text, inputSha256: SHA, method: COUNT_ROWS, surveyDate: 2025 })).toEqual({ ok: false, error: "DUPLICATE_ROWS" });
  });

  it("takes a text without a line feed at the end", () => {
    expect(inspectCsvTable("a,b\n1,2")).toMatchObject({ ok: true, value: { lastDataLine: 2 } });
  });
});

describe("inspectCsvTable: a text that is not taken in", () => {
  it.each([
    ["nothing", ""],
    ["blank lines only", "\n\n\n"],
    ["a byte order mark only", "\uFEFF"],
    ["a byte order mark and blank lines", "\uFEFF\n\n"],
  ])("says EMPTY_TEXT for %s", (_name, text) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "EMPTY_TEXT", line: null } });
  });

  it("reads a line of spaces as a row of one blank name, as aggregate does", () => {
    expect(inspectCsvTable("\n  \n\t\n")).toEqual({ ok: false, error: { code: "HEADER_BLANK", line: 2 } });
    expect(aggregateRefusesTable("\n  \n\t\n")).toBe(true);
  });

  it.each([
    ["a quote that is not closed", 'a,b\n"1,2\n'],
    ["a quote in the middle of a field", 'a,b\n1,x"y"\n'],
    ["something after the closing quote", 'a,b\n"1"x,2\n'],
    ["a carriage return (the text has to be LF)", "a,b\r\n1,2\r\n"],
  ])("says MALFORMED_CSV for %s", (_name, text) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "MALFORMED_CSV", line: null } });
  });

  it.each([
    ["an empty name", "a,,c\n1,2,3", 1],
    ["a name of spaces", "a, ,c\n1,2,3", 1],
    ["a name on the second line after a blank line", "\na,,c\n1,2,3", 2],
  ])("says HEADER_BLANK for %s", (_name, text, line) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "HEADER_BLANK", line } });
  });

  it.each([
    ["the same name twice", "a,b,a\n1,2,3"],
    ["names that are the same after NFKC", "ab,ａｂ\n1,2"],
    ["names that differ in the spaces only", "a, a\n1,2"],
  ])("says HEADER_DUPLICATE for %s", (_name, text) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "HEADER_DUPLICATE", line: 1 } });
  });

  it("does not take names that differ in case for the same name", () => {
    expect(inspectCsvTable("a,A\n1,2")).toMatchObject({ ok: true, value: { headers: ["a", "A"] } });
  });

  it.each([
    ["a row with fewer fields", "a,b\n1,2\n3\n4,5", 3],
    ["a row with more fields", "a,b\n1,2,3\n", 2],
    ["a row of blank cells that has one field too many", "a,b\n1,2\n,\n,,\n", 4],
  ])("says COLUMN_COUNT_MISMATCH with the line of the first row that does not fit for %s", (_name, text, line) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "COLUMN_COUNT_MISMATCH", line } });
  });

  it.each([
    ["a header only", "a,b"],
    ["a header and blank lines", "a,b\n\n\n"],
  ])("says NO_DATA_ROWS for %s", (_name, text) => {
    expect(inspectCsvTable(text)).toEqual({ ok: false, error: { code: "NO_DATA_ROWS", line: 1 } });
  });

  it("names the header before the rows when both are wrong", () => {
    expect(inspectCsvTable("a,,c\n1,2\n")).toMatchObject({ ok: false, error: { code: "HEADER_BLANK" } });
    expect(inspectCsvTable("a,a\n1\n")).toMatchObject({ ok: false, error: { code: "HEADER_DUPLICATE" } });
  });

  it("gives a fixed code and a line number, and never a value of the text", () => {
    const secret = "秘密の値-7731";
    const result = inspectCsvTable(`a,b\n${secret}\n`);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(CSV_TABLE_REFUSALS).toContain(result.ok ? "" : result.error.code);
  });
});

describe("inspectCsvTable: agreement with aggregate", () => {
  const samples = [
    "a,b\n1,2\n",
    "a,b\n1,2\n1,2\n",
    "",
    "a,b\n",
    "a,,c\n1,2,3\n",
    "a,b,a\n1,2,3\n",
    "a,b\n1\n",
    'a,b\n"1,2\n',
    "a,b\r\n1,2\r\n",
    "\uFEFFa,b\n1,2",
    "a\n\n\n1\n\n2\n",
    '"a","b"\n"x""y",z\n',
  ];

  it.each(samples.map((text) => [JSON.stringify(text), text] as const))("takes in %s exactly when aggregate does not refuse it as INVALID_CSV", (_name, text) => {
    expect(inspectCsvTable(text).ok).toBe(!aggregateRefusesTable(text));
  });
});

describe("csvCellsOfLines", () => {
  // Line 1 is the header; line 2 is a row; lines 3 and 4 are one row (a cell has a line break); line 5 is a row.
  const text = 'a,b\n1,x\n"2,5","y\nz"\n3,w\n';

  it.each([
    ["one row on one line", 2, 2, ["1", "x"]],
    ["a row of two lines, by its first line", 3, 3, ["2,5", "y\nz"]],
    ["a row of two lines, by its last line", 4, 4, ["2,5", "y\nz"]],
    ["two rows", 2, 3, ["1", "x", "2,5", "y\nz"]],
    ["the last row and lines after it", 5, 9, ["3", "w"]],
    ["the header and the first row", 1, 2, ["1", "x"]],
  ])("gives the cells of %s", (_name, startLine, endLine, cells) => {
    expect(csvCellsOfLines(text, startLine, endLine)).toEqual(cells);
  });

  it.each([
    ["the header only", 1, 1],
    ["lines after the last row", 6, 9],
    ["lines in the wrong order", 3, 2],
  ])("gives nothing for %s", (_name, startLine, endLine) => {
    expect(csvCellsOfLines(text, startLine, endLine)).toBeNull();
  });

  it("gives nothing for a text that is not a table", () => {
    expect(csvCellsOfLines('a,b\n"1,2\n', 1, 2)).toBeNull();
    expect(csvCellsOfLines("a,a\n1,2\n", 2, 2)).toBeNull();
    expect(csvCellsOfLines("", 1, 1)).toBeNull();
  });
});

describe("csvCellNumber", () => {
  it.each([
    ["12", 12, null],
    ["1,200", 1200, null],
    ["１,２００人", 1200, "人"],
    [" -3.5% ", -3.5, "%"],
    ["+7", 7, null],
    ["0", 0, null],
    ["12.50", 12.5, null],
    ["3戸", 3, "戸"],
  ])("reads %j as %d with the unit %j", (cell, amount, unit) => {
    expect(csvCellNumber(cell)).toEqual({ amount, unit });
  });

  it.each([[""], ["  "], ["abc"], ["12.5.3"], ["12-3"], ["--1"], ["人12"]])("does not read %j as a number", (cell) => {
    expect(csvCellNumber(cell)).toBeNull();
  });

  it("reads a cell as the sum of a column does: the same amount and the same unit", () => {
    // The cell is in quotes: a comma that is not in quotes is the end of a cell.
    const text = 'n\n"１,２００人"\n';
    const summed = aggregate({
      text,
      inputSha256: SHA,
      method: { kind: "COMPUTED", aggregation: "SUM_COLUMN", column: "n", whereColumn: null, equals: null, description: "n" },
      surveyDate: 2025,
    });
    expect(summed.ok && { amount: summed.value.amount, unit: summed.value.unit }).toEqual(csvCellNumber("１,２００人"));
  });
});
