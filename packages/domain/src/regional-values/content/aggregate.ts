import { RegionalSurveyDateSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type { FactMethod, Sha256 } from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { encodeCanonicalJson } from "../../serialization/canonicalJson.js";
import { sha256Hex } from "../../serialization/contentHash.js";

/**
 * The computation of a value from the rows of a CSV table (Req 7.25, 7.27). It is a pure function:
 * it reads no file, does not detect the character code of a file (that is `csv-lines-v1`, 13.15), does
 * not make or save a fact item (13.11), and uses no clock and no random number. The same text,
 * SHA-256, method and survey date always give the same result, so a person can compute it again and
 * compare. An AI computes nothing.
 *
 * This file is for the build and the intake, not for the browser.
 *
 * The rules of Req 7.27, fixed in the program:
 *  (a) A value is read after NFKC (full-width characters become half-width), the commas of digit
 *      groups are removed, and it is split into a number and a unit (the rest of the text). A value
 *      that is neither a number nor a number with a unit makes a column that is summed fail.
 *  (b) A blank value is a missing value. It is counted in `missingCount`, left out of a sum, and it
 *      does not match a condition.
 *  (c) Two rows that are the same row are refused (`DUPLICATE_ROWS`) unless the method says which
 *      columns decide that two rows are the same (`dedupeColumns`). The function never supplies such
 *      columns itself. With `dedupeColumns`, the first row of each value is used and the others are
 *      counted in `duplicatesRemoved`.
 *  (d) A column that is summed has one unit. Two units make it fail (`MIXED_UNITS`).
 *  (e) A survey date or a year that cannot be read makes it fail.
 */

export type ComputedMethod = Extract<FactMethod, { kind: "COMPUTED" }>;

/** Why a computation is refused. A fixed code only: no value and no text of a row. */
export const AGGREGATE_REFUSALS = [
  "NON_NUMERIC_VALUE",
  "DUPLICATE_ROWS",
  "MIXED_UNITS",
  "SURVEY_DATE_UNREADABLE",
  "COLUMN_NOT_FOUND",
  "INVALID_CSV",
] as const;

export type AggregateRefusal = (typeof AGGREGATE_REFUSALS)[number];

export type AggregateInput = Readonly<{
  /** UTF-8 and LF. The first line is the header. Fields in quotes, `""` for a quote, and commas (RFC 4180) are read. */
  text: string;
  /** The SHA-256 of the file that `text` comes from. It is recorded, not computed. */
  inputSha256: Sha256;
  method: ComputedMethod;
  /** The survey date (YYYY-MM-DD) or the year. The caller gives it; one that cannot be read is refused. */
  surveyDate: string | number | null;
}>;

export type AggregateResult = Readonly<{
  amount: number;
  /** The unit that the summed column has in common. A count has none (`null`). */
  unit: string | null;
  /** The number of rows (after the rows of `dedupeColumns`) in which the counted or summed column is blank. */
  missingCount: number;
  /** The number of rows that `dedupeColumns` left out. 0 when the method has no `dedupeColumns`. */
  duplicatesRemoved: number;
  /** The lines of the text that the data rows are on, first to last. */
  locator: Readonly<{ kind: "text-lines"; startLine: number; endLine: number }>;
  inputSha256: Sha256;
  /** The SHA-256 of the canonical JSON of the method. */
  methodHash: Sha256;
  surveyDate: string | number;
}>;

type CsvRecord = Readonly<{ fields: readonly string[]; startLine: number; endLine: number }>;

const NO_DATA: unique symbol = Symbol("no-data");

/**
 * Reads the text as CSV. `null` when the text is not CSV in the range that is read: a quote that
 * is not closed, a quote in the middle of a field that is not in quotes, a carriage return outside
 * a quoted field (the text is LF), or a text with no record. A line with nothing on it is skipped.
 */
function parseCsv(text: string): CsvRecord[] | null {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStartedWithQuote = false;
  let lineNumber = 1;
  let recordStart = 1;
  let recordHasContent = false;

  const endField = (): void => {
    fields.push(field);
    field = "";
    fieldStartedWithQuote = false;
  };
  const endRecord = (endLine: number): void => {
    endField();
    const blank = fields.length === 1 && fields[0] === "" && !recordHasContent;
    if (!blank) {
      records.push({ fields, startLine: recordStart, endLine });
    }
    fields = [];
    recordHasContent = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quoted) {
      if (char === '"') {
        if (source.charAt(index + 1) === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") {
          lineNumber += 1;
        }
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field !== "" || fieldStartedWithQuote) {
        return null;
      }
      quoted = true;
      fieldStartedWithQuote = true;
      recordHasContent = true;
    } else if (char === ",") {
      endField();
      recordHasContent = true;
    } else if (char === "\n") {
      endRecord(lineNumber);
      lineNumber += 1;
      recordStart = lineNumber;
    } else if (char === "\r") {
      return null;
    } else {
      if (fieldStartedWithQuote) {
        // Something after the closing quote of a field.
        return null;
      }
      field += char;
      recordHasContent = true;
    }
  }
  if (quoted) {
    return null;
  }
  if (field !== "" || fields.length > 0 || recordHasContent) {
    // The last record has no line feed.
    endRecord(lineNumber);
  }
  return records.length === 0 ? null : records;
}

/** A cell as it is compared: NFKC, without the spaces at both ends. */
function normalize(value: string): string {
  return value.normalize("NFKC").trim();
}

type Decimal = Readonly<{ digits: bigint; scale: number }>;
type Parsed = Readonly<{ decimal: Decimal; unit: string }>;

// The unit is the rest of the text. It does not start with a digit, a point or a sign, so "12.5.3" and "12-3" are not numbers.
const NUMBER_WITH_UNIT = /^([+-]?)(\d+)(?:\.(\d+))?((?![\d.+-]).*)$/u;

/** A number with an optional unit (the rest of the text). Digit groups are written with commas. */
function readNumber(cell: string): Parsed | null {
  const text = cell.normalize("NFKC").replaceAll(",", "").trim();
  const match = NUMBER_WITH_UNIT.exec(text);
  if (match === null) {
    return null;
  }
  const [, sign = "", whole = "0", fraction = "", unit = ""] = match;
  const digits = BigInt(`${whole}${fraction}`);
  return { decimal: { digits: sign === "-" ? -digits : digits, scale: fraction.length }, unit: unit.trim() };
}

function sumOf(values: readonly Decimal[]): number | null {
  const scale = values.reduce((largest, value) => Math.max(largest, value.scale), 0);
  const total = values.reduce((sum, value) => sum + value.digits * 10n ** BigInt(scale - value.scale), 0n);
  const amount = Number(`${total.toString()}e-${scale}`);
  return Number.isFinite(amount) ? amount : null;
}

function refuse(error: AggregateRefusal): Result<never, AggregateRefusal> {
  return { ok: false, error };
}

type Table = Readonly<{ columns: ReadonlyMap<string, number>; rows: readonly CsvRecord[] }>;

function readTable(text: string): Table | typeof NO_DATA | null {
  const records = parseCsv(text);
  const [header, ...rows] = records ?? [];
  if (header === undefined) {
    return null;
  }
  const columns = new Map<string, number>();
  for (const [position, name] of header.fields.entries()) {
    const key = normalize(name);
    if (key === "" || columns.has(key)) {
      // A column without a name, or two columns of one name, cannot be pointed at.
      return null;
    }
    columns.set(key, position);
  }
  if (rows.some((row) => row.fields.length !== header.fields.length)) {
    return null;
  }
  return rows.length === 0 ? NO_DATA : { columns, rows };
}

function columnOf(table: Table, name: string | null | undefined): number | null {
  if (name === null || name === undefined) {
    return null;
  }
  return table.columns.get(normalize(name)) ?? null;
}

function cell(row: CsvRecord, position: number): string {
  return row.fields[position] ?? "";
}

/**
 * Computes the value of a method from the rows of a CSV text. `COUNT_ROWS` counts the data rows,
 * `COUNT_ROWS_WHERE` counts the rows whose column is the given value, and `SUM_COLUMN` adds a
 * column (the rows can be limited by a condition). The rows are the rows that remain after the rule
 * of the same rows (`dedupeColumns`, Req 7.27 c).
 */
export function aggregate(input: AggregateInput): Result<AggregateResult, AggregateRefusal> {
  const surveyDate = RegionalSurveyDateSchema.safeParse(input.surveyDate);
  if (!surveyDate.success) {
    return refuse("SURVEY_DATE_UNREADABLE");
  }
  const table = readTable(input.text);
  if (table === null || table === NO_DATA) {
    return refuse("INVALID_CSV");
  }
  const { method } = input;

  // (c) The same rows.
  let rows = table.rows;
  let duplicatesRemoved = 0;
  if (method.dedupeColumns === undefined) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify(row.fields.map(normalize));
      if (seen.has(key)) {
        return refuse("DUPLICATE_ROWS");
      }
      seen.add(key);
    }
  } else {
    const positions: number[] = [];
    for (const name of method.dedupeColumns) {
      const position = columnOf(table, name);
      if (position === null) {
        return refuse("COLUMN_NOT_FOUND");
      }
      positions.push(position);
    }
    const seen = new Set<string>();
    const kept: CsvRecord[] = [];
    for (const row of rows) {
      const key = JSON.stringify(positions.map((position) => normalize(cell(row, position))));
      if (seen.has(key)) {
        duplicatesRemoved += 1;
      } else {
        seen.add(key);
        kept.push(row);
      }
    }
    rows = kept;
  }

  let amount = 0;
  let unit: string | null = null;
  let missingCount = 0;

  if (method.aggregation === "COUNT_ROWS") {
    amount = rows.length;
  } else if (method.aggregation === "COUNT_ROWS_WHERE") {
    const position = columnOf(table, method.column);
    if (position === null || method.equals === null) {
      return refuse("COLUMN_NOT_FOUND");
    }
    const expected = normalize(method.equals);
    for (const row of rows) {
      const value = normalize(cell(row, position));
      if (value === "") {
        missingCount += 1;
      } else if (value === expected) {
        amount += 1;
      }
    }
  } else {
    const position = columnOf(table, method.column);
    if (position === null) {
      return refuse("COLUMN_NOT_FOUND");
    }
    const wherePosition = method.whereColumn === null || method.whereColumn === undefined ? null : columnOf(table, method.whereColumn);
    if (method.whereColumn !== null && method.whereColumn !== undefined && wherePosition === null) {
      return refuse("COLUMN_NOT_FOUND");
    }
    const expected = method.equals === null ? null : normalize(method.equals);
    const numbers: Decimal[] = [];
    const units = new Set<string>();
    for (const row of rows) {
      if (wherePosition !== null && normalize(cell(row, wherePosition)) !== expected) {
        continue;
      }
      const value = cell(row, position);
      if (normalize(value) === "") {
        missingCount += 1;
        continue;
      }
      const parsed = readNumber(value);
      if (parsed === null) {
        return refuse("NON_NUMERIC_VALUE");
      }
      numbers.push(parsed.decimal);
      units.add(parsed.unit);
    }
    if (units.size > 1) {
      return refuse("MIXED_UNITS");
    }
    const total = sumOf(numbers);
    if (total === null) {
      return refuse("NON_NUMERIC_VALUE");
    }
    amount = total;
    const [only = ""] = units;
    unit = only === "" ? null : only;
  }

  const first = table.rows[0];
  const last = table.rows[table.rows.length - 1];
  if (first === undefined || last === undefined) {
    return refuse("INVALID_CSV");
  }
  return {
    ok: true,
    value: {
      amount,
      unit,
      missingCount,
      duplicatesRemoved,
      locator: { kind: "text-lines", startLine: first.startLine, endLine: last.endLine },
      inputSha256: input.inputSha256,
      methodHash: Sha256Schema.parse(sha256Hex(encodeCanonicalJson(method))),
      surveyDate: surveyDate.data,
    },
  };
}
