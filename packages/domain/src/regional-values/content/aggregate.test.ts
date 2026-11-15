import { Sha256Schema } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../../serialization/canonicalJson.js";
import { sha256Hex } from "../../serialization/contentHash.js";
import { aggregate, AGGREGATE_REFUSALS } from "./aggregate.js";
import type { AggregateInput, ComputedMethod } from "./aggregate.js";

// Every table here is a small fictional one. No real data and no real name is used.

const SHA = Sha256Schema.parse("c".repeat(64));

const TABLE = ["地区,種別,件数", "あおば,A,12", "あおば,B,3", 'みなと,A,"1,200"', "ひなた,A,５"].join("\n");

function count(over: Record<string, unknown> = {}): ComputedMethod {
  return { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "データ行の数", ...over } as ComputedMethod;
}

function countWhere(column: string, equals: string, over: Record<string, unknown> = {}): ComputedMethod {
  return { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column, equals, description: "条件に合う行の数", ...over } as ComputedMethod;
}

function sum(column: string, where: { column: string; equals: string } | null = null, over: Record<string, unknown> = {}): ComputedMethod {
  return {
    kind: "COMPUTED",
    aggregation: "SUM_COLUMN",
    column,
    whereColumn: where === null ? null : where.column,
    equals: where === null ? null : where.equals,
    description: "列の合計",
    ...over,
  } as ComputedMethod;
}

function run(text: string, method: ComputedMethod, surveyDate: AggregateInput["surveyDate"] = "2025-04-01") {
  return aggregate({ text, inputSha256: SHA, method, surveyDate });
}

function value(text: string, method: ComputedMethod, surveyDate?: AggregateInput["surveyDate"]) {
  const result = run(text, method, surveyDate);
  if (!result.ok) {
    throw new Error(`Unexpected refusal ${result.error}`);
  }
  return result.value;
}

function refusal(text: string, method: ComputedMethod, surveyDate?: AggregateInput["surveyDate"]) {
  const result = run(text, method, surveyDate);
  return result.ok ? null : result.error;
}

describe("aggregate: the three methods", () => {
  it("COUNT_ROWS counts the data rows and points at the lines that they are on", () => {
    const result = value(TABLE, count());
    expect(result).toMatchObject({ amount: 4, unit: null, missingCount: 0, duplicatesRemoved: 0 });
    expect(result.locator).toEqual({ kind: "text-lines", startLine: 2, endLine: 5 });
  });

  it("COUNT_ROWS_WHERE counts the rows in which the column is the given value", () => {
    expect(value(TABLE, countWhere("種別", "A")).amount).toBe(3);
    expect(value(TABLE, countWhere("種別", "B")).amount).toBe(1);
    expect(value(TABLE, countWhere("種別", "C")).amount).toBe(0);
  });

  it("SUM_COLUMN adds a column, reading a full-width digit and the comma of a digit group", () => {
    const result = value(TABLE, sum("件数"));
    expect(result).toMatchObject({ amount: 1220, unit: null, missingCount: 0 });
  });

  it("SUM_COLUMN can be limited by a condition", () => {
    expect(value(TABLE, sum("件数", { column: "地区", equals: "あおば" })).amount).toBe(15);
    expect(value(TABLE, sum("件数", { column: "種別", equals: "A" })).amount).toBe(1217);
    expect(value(TABLE, sum("件数", { column: "種別", equals: "Z" })).amount).toBe(0);
  });

  it("adds decimals exactly", () => {
    expect(value(["名前,値", "a,0.1", "b,0.2"].join("\n"), sum("値")).amount).toBe(0.3);
    expect(value(["名前,値", "a,-1.5", "b,0.25"].join("\n"), sum("値")).amount).toBe(-1.25);
  });

  it("reads a unit after the number, and gives the unit that the column has in common", () => {
    const result = value(["名前,人数", "a,12人", "b,3人"].join("\n"), sum("人数"));
    expect(result).toMatchObject({ amount: 15, unit: "人" });
  });

  it("matches a column name and a value after NFKC and without the spaces at both ends", () => {
    const text = ["種別 , 件数", "Ａ, 5", "Ｂ,6"].join("\n");
    expect(value(text, countWhere("種別", "A")).amount).toBe(1);
    expect(value(text, sum("件数")).amount).toBe(11);
  });
});

describe("aggregate: missing values (Req 7.27 b)", () => {
  const text = ["地区,件数", "あおば,12", "みなと,", "ひなた,3"].join("\n");

  it("counts a blank value, leaves it out of a sum, and records the count", () => {
    expect(value(text, sum("件数"))).toMatchObject({ amount: 15, missingCount: 1 });
  });

  it("does not match a blank value in a condition, and records it", () => {
    expect(value(text, countWhere("件数", "12"))).toMatchObject({ amount: 1, missingCount: 1 });
  });

  it("COUNT_ROWS has no column to be missing", () => {
    expect(value(text, count())).toMatchObject({ amount: 3, missingCount: 0 });
  });

  it("counts only the rows of the condition for a limited sum", () => {
    expect(value(text, sum("件数", { column: "地区", equals: "みなと" }))).toMatchObject({ amount: 0, missingCount: 1 });
    expect(value(text, sum("件数", { column: "地区", equals: "あおば" }))).toMatchObject({ amount: 12, missingCount: 0 });
  });
});

describe("aggregate: the same rows (Req 7.27 c)", () => {
  const text = ["地区,種別,件数", "あおば,A,12", "あおば,A,12", "みなと,A,5", "あおば,B,7"].join("\n");

  it("refuses two identical rows when the method has no dedupeColumns, and never drops a row by itself", () => {
    expect(refusal(text, count())).toBe("DUPLICATE_ROWS");
    expect(refusal(text, sum("件数"))).toBe("DUPLICATE_ROWS");
    expect(refusal(text, countWhere("種別", "A"))).toBe("DUPLICATE_ROWS");
  });

  it("takes two rows that differ in a value as two rows, without dedupeColumns", () => {
    const different = ["地区,種別,件数", "あおば,A,12", "あおば,A,13"].join("\n");
    expect(value(different, count())).toMatchObject({ amount: 2, duplicatesRemoved: 0 });
  });

  it("with dedupeColumns uses the first row of each value and records how many it left out", () => {
    const result = value(text, count({ dedupeColumns: ["地区", "種別"] }));
    expect(result).toMatchObject({ amount: 3, duplicatesRemoved: 1 });
    expect(value(text, sum("件数", null, { dedupeColumns: ["地区", "種別"] }))).toMatchObject({ amount: 24, duplicatesRemoved: 1 });
  });

  it("with dedupeColumns takes the first of rows that differ outside those columns", () => {
    const another = ["地区,件数", "あおば,10", "あおば,99", "みなと,1"].join("\n");
    const result = value(another, sum("件数", null, { dedupeColumns: ["地区"] }));
    expect(result).toMatchObject({ amount: 11, duplicatesRemoved: 1 });
  });

  it("refuses a column that dedupeColumns names and that is not in the table", () => {
    expect(refusal(text, count({ dedupeColumns: ["市町"] }))).toBe("COLUMN_NOT_FOUND");
  });

  it("the locator still covers the rows that were left out", () => {
    expect(value(text, count({ dedupeColumns: ["地区", "種別"] })).locator).toEqual({ kind: "text-lines", startLine: 2, endLine: 5 });
  });
});

describe("aggregate: refusals", () => {
  it("refuses a value that is not a number in a summed column", () => {
    for (const bad of ["あ", "12.5.3", "-", ".5", "12-3", "十二", "+-3"]) {
      expect(refusal(["名前,値", `a,${bad}`].join("\n"), sum("値")), bad).toBe("NON_NUMERIC_VALUE");
    }
  });

  it("refuses two units in one column, a unit and none included", () => {
    expect(refusal(["名前,値", "a,12人", "b,3戸"].join("\n"), sum("値"))).toBe("MIXED_UNITS");
    expect(refusal(["名前,値", "a,12人", "b,3"].join("\n"), sum("値"))).toBe("MIXED_UNITS");
  });

  it("refuses a column that is not in the table, for each method", () => {
    expect(refusal(TABLE, countWhere("市町", "A"))).toBe("COLUMN_NOT_FOUND");
    expect(refusal(TABLE, sum("人数"))).toBe("COLUMN_NOT_FOUND");
    expect(refusal(TABLE, sum("件数", { column: "市町", equals: "A" }))).toBe("COLUMN_NOT_FOUND");
  });

  it("refuses a survey date or a year that cannot be read", () => {
    for (const bad of [null, "", "2025", "2025-13-01", "2025-02-30", "令和7年", 1899, 2201, 2025.5]) {
      expect(refusal(TABLE, count(), bad), String(bad)).toBe("SURVEY_DATE_UNREADABLE");
    }
  });

  it("accepts a date and a year", () => {
    expect(value(TABLE, count(), "2025-04-01").surveyDate).toBe("2025-04-01");
    expect(value(TABLE, count(), 2025).surveyDate).toBe(2025);
  });

  it("refuses a text that is not a table of the range that is read", () => {
    const cases: Record<string, string> = {
      empty: "",
      "only blank lines": "\n\n",
      "header only": "地区,件数",
      "quote that is not closed": '地区,件数\n"あおば,1',
      "quote inside a field": '地区,件数\nあ"お,1',
      "text after a closing quote": '地区,件数\n"あ"お,1',
      "carriage return": "地区,件数\r\nあおば,1",
      "fewer fields": "地区,件数\nあおば",
      "more fields": "地区,件数\nあおば,1,2",
      "two columns of one name": "地区,地区\nあおば,1",
      "column without a name": "地区,\nあおば,1",
    };
    for (const [name, text] of Object.entries(cases)) {
      expect(refusal(text, count()), name).toBe("INVALID_CSV");
    }
  });

  it("returns a fixed code only, from a closed list, and never a value of the table", () => {
    const text = ["名前,値", "秘密の名前,あ"].join("\n");
    const result = run(text, sum("値"));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("秘密");
    expect(AGGREGATE_REFUSALS).toContain(result.ok ? "" : result.error);
  });
});

describe("aggregate: reading CSV", () => {
  it("reads quotes, a comma and a quote inside quotes, and a line feed inside quotes with its lines", () => {
    const text = ['名前,メモ,件数', '"あおば, 北","a ""b"" c",1', '"みなと","line1', 'line2",2', "ひなた,,3"].join("\n");
    const result = value(text, sum("件数"));
    expect(result).toMatchObject({ amount: 6 });
    // The second record is on lines 3 and 4, and the last one on line 5.
    expect(result.locator).toEqual({ kind: "text-lines", startLine: 2, endLine: 5 });
    expect(value(text, countWhere("メモ", 'a "b" c')).amount).toBe(1);
  });

  it("skips a line with nothing on it, and reads a last line without a line feed", () => {
    const text = "地区,件数\n\nあおば,1\n\nみなと,2\n";
    expect(value(text, count())).toMatchObject({ amount: 2 });
    expect(value("地区,件数\nあおば,1", count()).locator).toEqual({ kind: "text-lines", startLine: 2, endLine: 2 });
    expect(value(text, count()).locator).toEqual({ kind: "text-lines", startLine: 3, endLine: 5 });
  });

  it("drops a byte order mark before the header", () => {
    expect(value("\uFEFF地区,件数\nあおば,1", sum("件数")).amount).toBe(1);
  });

  it("keeps a row of commas as a row of missing values", () => {
    expect(value("地区,件数\n,\nあおば,2", count()).amount).toBe(2);
    expect(value("地区,件数\n,\nあおば,2", sum("件数"))).toMatchObject({ amount: 2, missingCount: 1 });
  });
});

describe("aggregate: what is recorded", () => {
  it("records the SHA-256 of the input as it was given, the hash of the method, and the survey date", () => {
    const method = count();
    const result = value(TABLE, method);
    expect(result.inputSha256).toBe(SHA);
    expect(result.methodHash).toBe(sha256Hex(encodeCanonicalJson(method)));
    expect(result.surveyDate).toBe("2025-04-01");
  });

  it("gives another method hash for another method, and the same one for the same method and another text", () => {
    const first = value(TABLE, count());
    expect(value(TABLE, countWhere("種別", "A")).methodHash).not.toBe(first.methodHash);
    expect(value(`${TABLE}\nくじら,A,1`, count()).methodHash).toBe(first.methodHash);
  });

  it("gives the same result for the same input", () => {
    expect(run(TABLE, sum("件数"))).toEqual(run(TABLE, sum("件数")));
  });

  it("does not change its input", () => {
    const method = sum("件数", null, { dedupeColumns: ["地区"] });
    const copy = structuredClone(method);
    run(TABLE, method);
    expect(method).toEqual(copy);
  });
});
