import { unlink, writeFile } from "node:fs/promises";

import { AggregationRecordSchema, RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { RealFact, RealSource } from "@ehime-vote-navigator/contracts";
import { aggregate, sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLOCK,
  COUNT_FLOOD,
  COUNT_ROWS,
  FACT_TABLE,
  SUM_POPULATION,
  SUM_SHELTERS,
  computedRequest,
  createVerifiedFact,
  takeInTable,
} from "../../../../../tests/harness/regional-values/factSupport.js";
import { createIntakeWorld, failRenameTo, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeShiftJis, encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { createFileIssueInputs } from "../issues/inputs.js";
import { csvToText } from "./csvToText.js";
import { intakeCsv } from "./intake.js";
import { checkRealFact, createComputedFact, createDerivedFact, createQuotedFact, readAggregationRecords, readRealFacts, recomputeFact } from "./factValue.js";
import type { Recomputation } from "./factValue.js";
import { currentOriginalShas } from "./originals.js";
import { readRealSources } from "./sourceRecords.js";

// Every table, number and name here is fictional.

let world: IntakeWorld | undefined;

async function newWorld(): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  return world;
}

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

const FACT_FILE = (id: string): string => `records/facts/${id}.json`;
const AGGREGATION_FILE = (id: string): string => `records/aggregations/${id}.json`;
const RAW_FILE = "raw/fictional-shelters/r1/shelters.csv";
const SOURCE_FILE = "records/sources/fictional-shelters/r1.json";

async function created(current: IntakeWorld, over: Parameters<typeof computedRequest>[0] = {}) {
  const result = await createComputedFact(current.store, computedRequest(over));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("not created");
  }
  return result.value;
}

describe("createComputedFact: a count of rows", () => {
  it("makes a PROVISIONAL fact item whose value, sentence and place come from the original", async () => {
    const current = await newWorld();
    const source = await takeInTable(current);
    const { fact, aggregation, status } = await created(current);
    expect(status).toBe("CREATED");
    expect(fact).toEqual({
      dataKind: "REAL_AI",
      factId: "fact-rows",
      sentence: "架空県の避難所の記録の数は、2026年7月27日時点で4件です。",
      value: { amount: 4, unit: "件" },
      surveyDate: "2026-07-27",
      area: "架空県",
      publisher: source.publisher,
      sourceUrl: "https://example.org/dataset/shelters",
      datasetUrl: "https://example.org/dataset/shelters",
      license: source.license,
      retrievedAt: source.retrievedAt,
      sha256: source.sha256,
      // The data rows: from the first to the end of the last.
      locator: { kind: "text-lines", startLine: 2, endLine: 5 },
      method: { ...COUNT_ROWS, description: "データ行の数（テキスト展開: csv-lines-v1）" },
      verification: { status: "PROVISIONAL" },
    });
    expect(aggregation).not.toBeNull();
    expect(await current.files()).toEqual([AGGREGATION_FILE("fact-rows"), FACT_FILE("fact-rows"), RAW_FILE, SOURCE_FILE].sort());
    expect(RealFactSchema.parse(await current.readJson(current.recordPath("facts/fact-rows.json")))).toEqual(fact);
  });

  it("keeps the record of the computation with the numbers that aggregate gives for the same text and method", async () => {
    const current = await newWorld();
    const source = await takeInTable(current);
    const { fact, aggregation } = await created(current, { method: SUM_POPULATION, subject: "人口", unit: undefined });
    const text = csvToText(encodeUtf8(FACT_TABLE));
    expect(text.ok).toBe(true);
    const direct = aggregate({ text: text.ok ? text.value.text : "", inputSha256: source.sha256, method: fact.method.kind === "COMPUTED" ? fact.method : SUM_POPULATION, surveyDate: "2026-07-27" });
    expect(direct.ok).toBe(true);
    if (!direct.ok) {
      return;
    }
    expect(aggregation).toEqual({
      schemaVersion: 1,
      dataKind: "REAL_AI",
      factId: "fact-rows",
      inputSha256: direct.value.inputSha256,
      methodHash: direct.value.methodHash,
      surveyDate: direct.value.surveyDate,
      missingCount: direct.value.missingCount,
      duplicatesRemoved: direct.value.duplicatesRemoved,
      locator: direct.value.locator,
    });
    expect(aggregation?.missingCount).toBe(1);
    expect(AggregationRecordSchema.parse(await current.readJson(current.recordPath("aggregations/fact-rows.json")))).toEqual(aggregation);
    // The record is read back with the same reader that `verify-fact` uses.
    expect(await readAggregationRecords(current.store)).toEqual({ ok: true, value: [aggregation] });
    expect(fact.locator).toEqual(direct.value.locator);
  });

  it("counts the rows that the condition names, and writes the condition into the method", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current, { method: COUNT_FLOOD, subject: "洪水の記録の数" });
    expect(fact.value).toEqual({ amount: 2, unit: "件" });
    expect(fact.sentence).toBe("架空県の洪水の記録の数は、2026年7月27日時点で2件です。");
  });

  it("takes the year for the survey date", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current, { surveyDate: 2025 });
    expect(fact.surveyDate).toBe(2025);
    expect(fact.sentence).toBe("架空県の避難所の記録の数は、2025年時点で4件です。");
  });

  it("never makes a verified fact item: it is PROVISIONAL, with no record of a person", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current);
    expect(fact.verification).toEqual({ status: "PROVISIONAL" });
  });

  it("does not repeat the note of the procedure when the description has it", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current, { method: { ...COUNT_ROWS, description: "csv-lines-v1 の行の数" } });
    expect(fact.method).toMatchObject({ description: "csv-lines-v1 の行の数" });
  });

  it("takes the latest revision of the source, and the revision that is named", async () => {
    const current = await newWorld();
    const first = await takeInTable(current);
    const second = await takeInTable(current, `${FACT_TABLE}ひなた,洪水,1,\n`);
    expect(second.revision).toBe("r2");
    expect((await created(current, { factId: "latest" })).fact.sha256).toBe(second.sha256);
    expect((await created(current, { factId: "named", revision: "r1" })).fact.sha256).toBe(first.sha256);
    expect((await created(current, { factId: "latest-again" })).fact.value.amount).toBe(5);
  });

  it("reads a table of Shift_JIS by the names of its columns", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ bytes: encodeShiftJis(FACT_TABLE) }), CLOCK);
    const { fact } = await created(current, { method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" });
    expect(fact.value).toEqual({ amount: 27, unit: "か所" });
  });

  it("repeats a number of the definition in the sentence", async () => {
    const current = await newWorld();
    await takeInTable(current, "年齢区分,人数\n65歳以上,10\n15歳未満,5\n");
    const { fact } = await created(current, {
      method: { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "年齢区分", equals: "65歳以上", description: "65歳以上の行の数" },
      subject: "65歳以上の区分の数",
    });
    expect(fact.value.amount).toBe(1);
    expect(fact.sentence).toContain("65歳以上");
  });
});

describe("createComputedFact: the sum of a column", () => {
  it("takes the unit of the cells and the number of blank cells", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact, aggregation } = await created(current, { method: SUM_POPULATION, subject: "人口", unit: undefined });
    expect(fact.value).toEqual({ amount: 2300, unit: "人" });
    expect(fact.sentence).toBe("架空県の人口は、2026年7月27日時点で2300人です。");
    expect(aggregation).toMatchObject({ missingCount: 1, duplicatesRemoved: 0 });
  });

  it("takes the unit that a person gives for cells that have none, and refuses a sum without one", async () => {
    const current = await newWorld();
    await takeInTable(current);
    expect((await created(current, { method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" })).fact.value).toEqual({ amount: 27, unit: "か所" });
    expect(await createComputedFact(current.store, computedRequest({ factId: "no-unit", method: SUM_SHELTERS, subject: "避難所の数", unit: undefined }))).toEqual({
      ok: false,
      error: { code: "UNIT_REQUIRED" },
    });
    expect(await createComputedFact(current.store, computedRequest({ factId: "blank-unit", method: SUM_SHELTERS, subject: "避難所の数", unit: "  " }))).toEqual({
      ok: false,
      error: { code: "UNIT_REQUIRED" },
    });
  });

  it("refuses a unit that is not the unit of the cells", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createComputedFact(current.store, computedRequest({ method: SUM_POPULATION, subject: "人口", unit: "世帯" }));
    expect(result).toEqual({ ok: false, error: { code: "UNIT_MISMATCH" } });
  });

  it("sums the rows that a condition names", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const method = { ...SUM_SHELTERS, whereColumn: "種別", equals: "洪水", description: "洪水の避難所数の合計" };
    const { fact } = await created(current, { method, subject: "洪水の避難所の数", unit: "か所" });
    expect(fact.value.amount).toBe(19);
  });
});

describe("createComputedFact: the rows that are the same", () => {
  const DUPLICATED = "地区,件数\nあおば,1\nあおば,1\nみなと,2\n";

  it("refuses the same rows, and leaves no row out, unless the method says which columns decide that rows are the same", async () => {
    const current = await newWorld();
    await takeInTable(current, DUPLICATED);
    const result = await createComputedFact(current.store, computedRequest());
    expect(result).toEqual({ ok: false, error: { code: "AGGREGATE_REFUSED", reason: "DUPLICATE_ROWS" } });
    expect(await current.files()).toEqual([RAW_FILE, SOURCE_FILE]);
  });

  it("leaves the later rows out when the method names the columns, and records how many", async () => {
    const current = await newWorld();
    await takeInTable(current, DUPLICATED);
    const method = { ...COUNT_ROWS, dedupeColumns: ["地区"] };
    const { fact, aggregation } = await created(current, { method });
    expect(fact.value.amount).toBe(2);
    expect(aggregation).toMatchObject({ duplicatesRemoved: 1, missingCount: 0 });
    expect(fact.method).toMatchObject({ dedupeColumns: ["地区"] });
  });
});

describe("createComputedFact: what is refused", () => {
  it.each([
    ["a name with a path", "a/b"],
    ["a name with a parent directory", ".."],
    ["a name that begins with a dot", ".hidden"],
    ["a name that ends with a dot", "fact."],
    ["a reserved device name", "con"],
    ["a name that is not ASCII", "事実1"],
    ["a name with a space", "fact 1"],
    ["nothing", ""],
    ["a name of 65 characters", "f".repeat(65)],
  ])("refuses a fact ID that is %s and writes nothing", async (_name, factId) => {
    const current = await newWorld();
    await takeInTable(current);
    const before = await current.files();
    expect(await createComputedFact(current.store, computedRequest({ factId }))).toEqual({ ok: false, error: { code: "FACT_ID_INVALID" } });
    expect(await current.files()).toEqual(before);
  });

  it("refuses a source that has no record, and a revision that has none", async () => {
    const current = await newWorld();
    await takeInTable(current);
    expect(await createComputedFact(current.store, computedRequest({ sourceId: "no-such-source" }))).toEqual({ ok: false, error: { code: "SOURCE_NOT_FOUND" } });
    expect(await createComputedFact(current.store, computedRequest({ revision: "r9" }))).toEqual({ ok: false, error: { code: "SOURCE_NOT_FOUND" } });
  });

  it("refuses an original that is not there, and an original that is not the file that was taken in", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const before = await current.files();
    await unlink(current.rawPath("fictional-shelters/r1/shelters.csv"));
    expect(await createComputedFact(current.store, computedRequest())).toEqual({ ok: false, error: { code: "ORIGINAL_MISSING", reason: "ORIGINAL_MISSING" } });
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    expect(await createComputedFact(current.store, computedRequest())).toEqual({ ok: false, error: { code: "ORIGINAL_CHANGED", reason: "ORIGINAL_CHANGED" } });
    expect((await current.files()).filter((path) => path.startsWith("records/facts/") || path.startsWith("records/aggregations/"))).toEqual([]);
    expect(before.length).toBe(2);
  });

  it.each([
    ["text that is not a number in a column that is summed", { method: { ...SUM_SHELTERS, column: "地区" }, unit: "件" }, "NON_NUMERIC_VALUE"],
    ["a column that is not there", { method: { ...SUM_SHELTERS, column: "存在しない列" }, unit: "件" }, "COLUMN_NOT_FOUND"],
    ["a condition on a column that is not there", { method: { ...COUNT_FLOOD, column: "存在しない列" } }, "COLUMN_NOT_FOUND"],
    ["a survey date that cannot be read", { surveyDate: "令和8年7月27日" }, "SURVEY_DATE_UNREADABLE"],
    ["a year out of range", { surveyDate: 1899 }, "SURVEY_DATE_UNREADABLE"],
  ])("refuses %s as the refusal of aggregate, and writes nothing", async (_name, over, reason) => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createComputedFact(current.store, computedRequest(over));
    expect(result).toEqual({ ok: false, error: { code: "AGGREGATE_REFUSED", reason } });
    expect((await current.files()).filter((path) => path.startsWith("records/facts/") || path.startsWith("records/aggregations/"))).toEqual([]);
  });

  it("refuses cells of two units", async () => {
    const current = await newWorld();
    await takeInTable(current, "地区,人口\nあおば,10人\nみなと,5世帯\n");
    const result = await createComputedFact(current.store, computedRequest({ method: { ...SUM_POPULATION }, subject: "人口" }));
    expect(result).toEqual({ ok: false, error: { code: "AGGREGATE_REFUSED", reason: "MIXED_UNITS" } });
  });

  it.each([
    ["a number in the subject", { subject: "2025年度の避難所の数" }, ["NUMBER_NOT_GROUNDED"]],
    ["a kanji numeral in the subject", { subject: "一時避難所の数" }, ["NUMBER_NOT_GROUNDED"]],
    ["a proper noun of the list that the area does not have", { subject: "松山市の避難所の数" }, ["PROPER_NOUN_NOT_GROUNDED"]],
  ])("refuses a sentence with %s", async (_name, over, violations) => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createComputedFact(current.store, computedRequest(over), { properNouns: ["松山市"] });
    expect(result).toEqual({ ok: false, error: { code: "SENTENCE_REJECTED", violations } });
    expect(await current.files()).toEqual([RAW_FILE, SOURCE_FILE]);
  });

  it("takes a kanji numeral of a word that the settings exempt", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createComputedFact(current.store, computedRequest({ subject: "一時避難所の数" }), { numeralExemptWords: ["一時避難所"] });
    expect(result.ok).toBe(true);
  });

  it("refuses a sentence that is not one sentence (the contract of the fact item)", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createComputedFact(current.store, computedRequest({ subject: "避難所の数。そして別の文" }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("FACT_INVALID");
  });

  it("refuses a source with no URL, and takes the URLs that a person gives", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ reference: { kind: "document-id", documentId: "doc-0001" } }), CLOCK);
    expect(await createComputedFact(current.store, computedRequest())).toEqual({ ok: false, error: { code: "SOURCE_URL_REQUIRED" } });
    const result = await createComputedFact(current.store, computedRequest({ sourceUrl: "https://example.org/page", datasetUrl: "https://example.org/file.csv" }));
    expect(result.ok && result.value.fact).toMatchObject({ sourceUrl: "https://example.org/page", datasetUrl: "https://example.org/file.csv" });
  });
});

describe("createComputedFact: a fact item is made once", () => {
  it("changes nothing when the same fact item is made again", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await created(current);
    const before = await current.files();
    const again = await createComputedFact(current.store, computedRequest());
    expect(again.ok && again.value.status).toBe("UNCHANGED");
    expect(await current.files()).toEqual(before);
  });

  it("never overwrites a fact item that is there, also one that a person verified, and does not touch its record", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const verified = await createVerifiedFact(current, computedRequest());
    const factText = await current.readText(current.recordPath("facts/fact-rows.json"));
    const recordText = await current.readText(current.recordPath("aggregations/fact-rows.json"));
    const other = await createComputedFact(current.store, computedRequest({ method: COUNT_FLOOD, subject: "洪水の記録の数" }));
    expect(other).toEqual({ ok: false, error: { code: "FACT_EXISTS" } });
    expect(await current.readText(current.recordPath("facts/fact-rows.json"))).toBe(factText);
    expect(await current.readText(current.recordPath("aggregations/fact-rows.json"))).toBe(recordText);
    expect(verified.verification.status).toBe("VERIFIED");
    // The same fact item that was verified is not made again as a new one.
    const same = await createComputedFact(current.store, computedRequest());
    expect(same).toEqual({ ok: false, error: { code: "FACT_EXISTS" } });
  });

  it("takes the record of the computation away again when the fact item cannot be written, and leaves one that was there", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const store = current.storeWith(failRenameTo((path) => path.replaceAll("\\", "/").includes("/facts/")));
    const result = await createComputedFact(store, computedRequest());
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED", reason: "STORE_WRITE_FAILED" } });
    expect(await current.files()).toEqual([RAW_FILE, SOURCE_FILE]);
    const later = await createComputedFact(current.store, computedRequest());
    expect(later.ok && later.value.status).toBe("CREATED");
  });

  it("makes no fact item when the record of the computation cannot be written", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const store = current.storeWith(failRenameTo((path) => path.replaceAll("\\", "/").includes("/aggregations/")));
    const result = await createComputedFact(store, computedRequest());
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED", reason: "AGGREGATION_RECORD" } });
    expect(await current.files()).toEqual([RAW_FILE, SOURCE_FILE]);
  });

  it("refuses when the fact items cannot be read", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await current.putRecordText("facts/broken.json", "{ not json");
    const result = await createComputedFact(current.store, computedRequest());
    expect(result).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "RECORD_INVALID" } });
  });

  it("makes no network request", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((): never => {
      calls += 1;
      throw new Error("no network for a fact item");
    }) as unknown as typeof fetch;
    try {
      await createComputedFact(current.store, computedRequest());
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

describe("createQuotedFact", () => {
  // Line 1 is the header; the rows are on the lines 2 to 5 of FACT_TABLE.
  const quoted = (over: Partial<Parameters<typeof createQuotedFact>[1]> = {}): Parameters<typeof createQuotedFact>[1] => ({
    factId: "fact-quoted",
    sourceId: "fictional-shelters",
    description: "表の2行目の避難所数の値をそのまま引用した",
    startLine: 2,
    endLine: 2,
    amount: 12,
    unit: "か所",
    surveyDate: "2026-07-27",
    area: "架空県",
    subject: "あおば地区の洪水の避難所の数",
    ...over,
  });

  it("quotes a number that stands on the lines that a person names, and keeps no record of a computation", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createQuotedFact(current.store, quoted());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.aggregation).toBeNull();
    expect(result.value.fact).toMatchObject({
      method: { kind: "QUOTED", description: "表の2行目の避難所数の値をそのまま引用した（テキスト展開: csv-lines-v1）" },
      locator: { kind: "text-lines", startLine: 2, endLine: 2 },
      value: { amount: 12, unit: "か所" },
      verification: { status: "PROVISIONAL" },
    });
    expect(await current.files()).toContain(FACT_FILE("fact-quoted"));
    expect(await current.files()).not.toContain(AGGREGATION_FILE("fact-quoted"));
  });

  it("takes a number with a unit in the cell when the unit is the unit of the fact", async () => {
    const current = await newWorld();
    await takeInTable(current);
    expect((await createQuotedFact(current.store, quoted({ factId: "with-unit", amount: 1200, unit: "人", subject: "あおば地区の洪水の人口" }))).ok).toBe(true);
    expect(await createQuotedFact(current.store, quoted({ factId: "wrong-unit", amount: 1200, unit: "世帯", subject: "あおば地区の洪水の世帯数" }))).toEqual({
      ok: false,
      error: { code: "QUOTED_VALUE_NOT_FOUND" },
    });
  });

  it.each([
    ["a value that is not on the lines", { amount: 13 }],
    ["a value that is on another row", { amount: 7 }],
    ["lines of the header only", { startLine: 1, endLine: 1, amount: 12 }],
    ["lines after the last row", { startLine: 6, endLine: 9 }],
  ])("refuses %s", async (_name, over) => {
    const current = await newWorld();
    await takeInTable(current);
    expect(await createQuotedFact(current.store, quoted(over))).toEqual({ ok: false, error: { code: "QUOTED_VALUE_NOT_FOUND" } });
    expect((await current.files()).filter((path) => path.startsWith("records/facts/"))).toEqual([]);
  });

  it("takes a value on any of the lines of a range", async () => {
    const current = await newWorld();
    await takeInTable(current);
    expect((await createQuotedFact(current.store, quoted({ startLine: 2, endLine: 3, amount: 7 }))).ok).toBe(true);
  });

  it.each([
    ["lines in the wrong order", { startLine: 3, endLine: 2 }],
    ["a line before the first", { startLine: 0, endLine: 2 }],
    ["lines that are not whole numbers", { startLine: 1.5, endLine: 2 }],
  ])("refuses %s as a location that is not one", async (_name, over) => {
    const current = await newWorld();
    await takeInTable(current);
    expect(await createQuotedFact(current.store, quoted(over))).toEqual({ ok: false, error: { code: "LOCATOR_INVALID" } });
  });

  it("refuses a sentence with a number that is not the value", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const result = await createQuotedFact(current.store, quoted({ subject: "2025年度の避難所の数" }));
    expect(result).toEqual({ ok: false, error: { code: "SENTENCE_REJECTED", violations: ["NUMBER_NOT_GROUNDED"] } });
  });
});

describe("createDerivedFact", () => {
  async function twoVerifiedFacts(current: IntakeWorld): Promise<void> {
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
  }

  it("makes a ratio of two verified fact items, PROVISIONAL, with no record of a computation", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    const result = await createDerivedFact(current.store, {
      factId: "ratio",
      operation: "RATIO",
      operandFactIds: ["shelters", "areas"],
      unitPair: { numerator: "か所", denominator: "か所" },
      subject: "避難所の記録に対する割合",
      description: "避難所の数を記録の数で割った割合",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.aggregation).toBeNull();
    expect(result.value.fact.verification).toEqual({ status: "PROVISIONAL" });
    expect(result.value.fact.value).toEqual({ amount: 675, unit: "%" });
    expect(result.value.fact.method).toMatchObject({ kind: "DERIVED", operation: "RATIO", operandFactIds: ["shelters", "areas"] });
    expect(await current.files()).toContain(FACT_FILE("ratio"));
  });

  it("refuses an operand that is not there", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    const result = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "no-such-fact"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(result).toEqual({ ok: false, error: { code: "OPERAND_NOT_FOUND" } });
  });

  it("refuses an operand that a person has not verified", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    await created(current, { factId: "provisional", method: COUNT_FLOOD, subject: "洪水の記録の数", unit: "か所" });
    const result = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "provisional"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(result).toEqual({ ok: false, error: { code: "DERIVE_REFUSED", reason: "FACT_NOT_VERIFIED" } });
    expect((await current.files()).filter((path) => path.includes("facts/ratio"))).toEqual([]);
  });

  it("refuses an operand whose original is not the file that it was verified against, although its record says VERIFIED", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    const result = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(result).toEqual({ ok: false, error: { code: "DERIVE_REFUSED", reason: "FACT_NOT_VERIFIED" } });
  });

  it("refuses a comparison that is not allowed, and names the conditions", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "people", method: SUM_POPULATION, subject: "人口", unit: undefined }));
    const result = await createDerivedFact(current.store, { factId: "gap", operation: "DIFFERENCE", operandFactIds: ["shelters", "people"], subject: "差", description: "d" });
    expect(result).toEqual({ ok: false, error: { code: "DERIVE_REFUSED", reason: "FACT_COMPARISON_INVALID", violations: expect.arrayContaining(["UNIT_MISMATCH"]) as unknown as string[] } });
  });

  it("refuses a derived fact as an operand", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    await current.putRecord("facts/derived-verified.json", {
      ...(await current.readJson(current.recordPath("facts/shelters.json")) as RealFact),
      factId: "derived-verified",
      method: { kind: "DERIVED", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, description: "d" },
    });
    const result = await createDerivedFact(current.store, { factId: "again", operation: "RATIO", operandFactIds: ["derived-verified", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(result).toEqual({ ok: false, error: { code: "DERIVE_REFUSED", reason: "DERIVED_OPERAND_NOT_ALLOWED" } });
  });

  it("makes a derived fact item once, as any other", async () => {
    const current = await newWorld();
    await twoVerifiedFacts(current);
    const request = { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" } as const;
    expect((await createDerivedFact(current.store, request)).ok).toBe(true);
    const again = await createDerivedFact(current.store, request);
    expect(again.ok && again.value.status).toBe("UNCHANGED");
    expect(await createDerivedFact(current.store, { ...request, subject: "別の割合" })).toEqual({ ok: false, error: { code: "FACT_EXISTS" } });
  });
});

describe("recomputeFact and checkRealFact: the findings of 8.7", () => {
  async function prepared(over: Parameters<typeof computedRequest>[0] = {}) {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current, over);
    const sources = await readRealSources(current.store);
    const facts = await readRealFacts(current.store);
    if (!sources.ok || !facts.ok) {
      throw new Error("not read");
    }
    const factsById = new Map(facts.value.map((item) => [item.factId, item] as const));
    const shas = await currentOriginalShas(current.store, sources.value);
    return { current, fact, sources: sources.value, factsById, shas };
  }

  function findings(input: Readonly<{ fact: RealFact; sources: readonly RealSource[]; currentSha256: (fact: RealFact) => string | undefined; recomputation: Recomputation }>): readonly string[] {
    return checkRealFact(input).map((finding) => finding.code);
  }

  /** The SHA-256 of the original as it is now, by what the record of a fact says. */
  const lookup =
    (shas: ReadonlyMap<string, string | undefined>) =>
    (candidate: RealFact): string | undefined =>
      shas.get(candidate.sha256);

  it("finds nothing for a fact item that was just made, and the findings carry the class and the ID of the fact", async () => {
    const { current, fact, sources, factsById, shas } = await prepared();
    const recomputation = await recomputeFact(current.store, fact, { sources, factsById });
    expect(recomputation.state).toBe("OK");
    expect(checkRealFact({ fact, sources, currentSha256: lookup(shas), recomputation })).toEqual([]);
    const wrong = { ...fact, sentence: "架空県の避難所の記録の数は、2026年7月27日時点で5件です。" };
    expect(checkRealFact({ fact: wrong, sources, currentSha256: lookup(shas), recomputation })).toEqual([
      { code: "FACT_VALUE_MISMATCH", class: "DEFECT", targetKind: "FACT_ITEM", targetId: "fact-rows" },
    ]);
  });

  it("finds FACT_VALUE_MISMATCH for a stored value that is not the value of the original, and for a number of the sentence that is not", async () => {
    const { current, fact, sources, factsById, shas } = await prepared();
    const recomputation = await recomputeFact(current.store, fact, { sources, factsById });
    const currentSha256 = lookup(shas);
    expect(findings({ fact: { ...fact, value: { amount: 5, unit: "件" } }, sources, currentSha256, recomputation })).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(findings({ fact: { ...fact, value: { amount: 4, unit: "人" } }, sources, currentSha256, recomputation })).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(findings({ fact: { ...fact, sentence: fact.sentence.replace("4件", "5件") }, sources, currentSha256, recomputation })).toEqual(["FACT_VALUE_MISMATCH"]);
    expect(findings({ fact: { ...fact, sentence: fact.sentence.replace("7月27日", "7月28日") }, sources, currentSha256, recomputation })).toEqual(["FACT_VALUE_MISMATCH"]);
  });

  it("finds FACT_VALUE_MISMATCH when the method does not give a value now (the column is gone)", async () => {
    const { current, fact, sources, factsById, shas } = await prepared({ method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" });
    const changed: RealFact = { ...fact, method: { ...(fact.method.kind === "COMPUTED" ? fact.method : SUM_SHELTERS), column: "存在しない列" } };
    const recomputation = await recomputeFact(current.store, changed, { sources, factsById });
    expect(recomputation).toEqual({ state: "REFUSED", reason: "COLUMN_NOT_FOUND" });
    expect(findings({ fact: changed, sources, currentSha256: lookup(shas), recomputation })).toEqual(["FACT_VALUE_MISMATCH"]);
  });

  it("finds FACT_SOURCE_MISMATCH for a fact whose SHA-256 no source has, and for a fact with the license of another source", async () => {
    const { current, fact, sources, factsById } = await prepared();
    const recomputation = await recomputeFact(current.store, fact, { sources, factsById });
    const other = { ...fact, sha256: sha256Hex(encodeUtf8("some other file")) };
    expect(findings({ fact: other, sources, currentSha256: () => other.sha256, recomputation })).toContain("FACT_SOURCE_MISMATCH");
    const license = { ...fact, license: { name: "別のライセンス", url: "https://example.org/other" } };
    expect(findings({ fact: license, sources, currentSha256: () => fact.sha256, recomputation })).toEqual(["FACT_SOURCE_MISMATCH"]);
    const url = { ...fact, license: { ...fact.license, url: "https://example.org/other" } };
    expect(findings({ fact: url, sources, currentSha256: () => fact.sha256, recomputation })).toEqual(["FACT_SOURCE_MISMATCH"]);
  });

  it("finds SOURCE_CHANGED when the original is not the file of the fact, or cannot be looked at, and says nothing of the value then", async () => {
    const { current, fact, sources, factsById } = await prepared();
    const recomputation = await recomputeFact(current.store, fact, { sources, factsById });
    expect(findings({ fact, sources, currentSha256: () => sha256Hex(encodeUtf8("changed")), recomputation })).toEqual(["SOURCE_CHANGED"]);
    expect(findings({ fact, sources, currentSha256: () => undefined, recomputation })).toEqual(["SOURCE_CHANGED"]);
    expect(findings({ fact, sources, currentSha256: () => undefined, recomputation: { state: "UNAVAILABLE", reason: "ORIGINAL_MISSING" } })).toEqual(["SOURCE_CHANGED"]);
  });

  it("gives the three findings in the order of the list, and each once", async () => {
    const { current, fact, sources, factsById } = await prepared();
    const recomputation = await recomputeFact(current.store, fact, { sources, factsById });
    const bad: RealFact = { ...fact, value: { amount: 1, unit: "件" }, sha256: sha256Hex(encodeUtf8("nothing has this")) };
    expect(findings({ fact: bad, sources, currentSha256: () => undefined, recomputation })).toEqual(["FACT_VALUE_MISMATCH", "FACT_SOURCE_MISMATCH", "SOURCE_CHANGED"]);
  });

  it("recomputes from the original as it is now: it is not available when the original is gone or is another file, or the source has no record", async () => {
    const { current, fact, sources, factsById } = await prepared();
    expect(await recomputeFact(current.store, fact, { sources: [], factsById })).toEqual({ state: "UNAVAILABLE", reason: "SOURCE_MISSING" });
    await writeFile(current.rawPath("fictional-shelters/r1/shelters.csv"), encodeUtf8("地区,件数\nあおば,1\n"));
    expect(await recomputeFact(current.store, fact, { sources, factsById })).toEqual({ state: "UNAVAILABLE", reason: "ORIGINAL_CHANGED" });
    await unlink(current.rawPath("fictional-shelters/r1/shelters.csv"));
    expect(await recomputeFact(current.store, fact, { sources, factsById })).toEqual({ state: "UNAVAILABLE", reason: "ORIGINAL_MISSING" });
  });

  it("recomputes a derived fact item from the values of its operands, and is not available without them", async () => {
    const current = await newWorld();
    await takeInTable(current);
    await createVerifiedFact(current, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    const derived = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["shelters", "areas"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(derived.ok).toBe(true);
    if (!derived.ok) {
      return;
    }
    const sources = await readRealSources(current.store);
    const facts = await readRealFacts(current.store);
    if (!sources.ok || !facts.ok) {
      throw new Error("not read");
    }
    const factsById = new Map(facts.value.map((item) => [item.factId, item] as const));
    const recomputation = await recomputeFact(current.store, derived.value.fact, { sources: sources.value, factsById });
    expect(recomputation).toMatchObject({ state: "OK", recomputed: { value: { amount: 675, unit: "%" } } });
    expect(checkRealFact({ fact: derived.value.fact, sources: sources.value, currentSha256: (candidate) => candidate.sha256, recomputation })).toEqual([]);
    const without = new Map([...factsById].filter(([id]) => id !== "areas"));
    expect(await recomputeFact(current.store, derived.value.fact, { sources: sources.value, factsById: without })).toEqual({ state: "UNAVAILABLE", reason: "OPERAND_MISSING" });
  });

  it("finds SOURCE_CHANGED for a derived fact item when the original of the second operand changed, although its own SHA-256 is the first operand's", async () => {
    const current = await newWorld();
    await takeInTable(current);
    // A second source, with its own file, for the second operand.
    await intakeCsv(current.store, intakeRequest({ sourceId: "second-shelters", fileName: "second.csv", bytes: encodeUtf8("地区,件数\nあおば,1\nみなと,2\n") }), CLOCK);
    await createVerifiedFact(current, computedRequest({ factId: "first", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "second", sourceId: "second-shelters", method: COUNT_ROWS, subject: "別の表の記録の数", unit: "か所" }));
    const derived = await createDerivedFact(current.store, { factId: "ratio", operation: "RATIO", operandFactIds: ["first", "second"], unitPair: { numerator: "か所", denominator: "か所" }, subject: "割合", description: "d" });
    expect(derived.ok).toBe(true);
    if (!derived.ok) {
      return;
    }
    const read = async () => {
      const sources = await readRealSources(current.store);
      const facts = await readRealFacts(current.store);
      if (!sources.ok || !facts.ok) {
        throw new Error("not read");
      }
      const factsById = new Map(facts.value.map((item) => [item.factId, item] as const));
      const shas = await currentOriginalShas(current.store, sources.value);
      const recomputation = await recomputeFact(current.store, derived.value.fact, { sources: sources.value, factsById });
      return findings({ fact: derived.value.fact, sources: sources.value, currentSha256: lookup(shas), recomputation });
    };
    expect(await read()).toEqual([]);
    await writeFile(current.rawPath("second-shelters/r1/second.csv"), encodeUtf8("地区,件数\nあおば,9\n"));
    expect(await read()).toEqual(["SOURCE_CHANGED"]);
  });

  it("reads the fact items with the same reader as the issues", async () => {
    const current = await newWorld();
    await takeInTable(current);
    const { fact } = await created(current);
    const inputs = createFileIssueInputs(current.store.root, { rawRoot: current.store.rawRoot });
    expect(await inputs.readFacts()).toEqual({ ok: true, value: [fact] });
    expect(await readRealFacts(current.store)).toEqual({ ok: true, value: [fact] });
  });
});
