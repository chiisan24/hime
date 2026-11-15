import { readFile, unlink } from "node:fs/promises";

import { RealSourceSchema } from "@ehime-vote-navigator/contracts";
import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import { FICTIONAL_CATALOG, FICTIONAL_LICENSE, FICTIONAL_TABLE, createIntakeWorld, failRenameTo, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import { realSource } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { encodeShiftJis, encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { createFileIssueInputs } from "../issues/inputs.js";
import { unreviewedUsage } from "./datasetLedger.js";
import { INTAKE_REFUSAL_CODES, intakeCsv } from "./intake.js";
import type { IntakeRequest } from "./intake.js";
import { createIntakeStore } from "./storeLayout.js";

// Every file, name and number here is fictional: the publisher, the URLs (example.org), the tables and the
// "original" of a conversion. The tests write below a temporary directory only.

const CLOCK = (): Date => new Date("2026-11-13T00:00:00Z");

let world: IntakeWorld | undefined;

async function newWorld(): Promise<IntakeWorld> {
  world = await createIntakeWorld();
  return world;
}

afterEach(async () => {
  await world?.remove();
  world = undefined;
});

const endsWith = (suffix: string) => (path: string) => path.endsWith(suffix);

const RAW_R1 = "raw/fictional-shelters/r1/shelters.csv";
const SOURCE_R1 = "records/sources/fictional-shelters/r1.json";

function tableOf(rows: readonly string[]): Uint8Array {
  return encodeUtf8(`名称,件数\n${rows.join("\n")}\n`);
}

const ORIGINAL_BYTES = encodeUtf8("fictional bytes of an xlsx file (not a real file)");
const PROCEDURE_BYTES = encodeUtf8("手順書: 1. 開く 2. UTF-8のCSVで保存 3. 行数を確かめる");

function conversionOf(over: Partial<NonNullable<IntakeRequest["conversion"]>> = {}): NonNullable<IntakeRequest["conversion"]> {
  return {
    originalFileName: "shelters.xlsx",
    originalBytes: ORIGINAL_BYTES,
    procedureId: "xlsx-to-csv-v1",
    procedureDocBytes: PROCEDURE_BYTES,
    convertedBy: "analyst-1",
    convertedAt: "2026-11-02T09:00:00Z",
    correspondence: "ROWS_PRESERVED",
    // The fictional table has a header and three rows.
    originalRowCount: 4,
    ...over,
  };
}

describe("intakeCsv: a new source", () => {
  it("places the original, records the source, and starts every decision of a person as not decided", async () => {
    const current = await newWorld();
    const request = intakeRequest();
    const result = await intakeCsv(current.store, request, CLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { value } = result;
    expect(value.status).toBe("CREATED");
    expect(value.rawPath).toBe("fictional-shelters/r1/shelters.csv");
    expect(value.ledger).toBe("NOT_REQUESTED");
    expect(value.source).toEqual({
      dataKind: "REAL_AI",
      sourceId: "fictional-shelters",
      revision: "r1",
      reference: { kind: "url", url: "https://example.org/dataset/shelters" },
      publisher: "架空県",
      publishedOn: "2026-07-27",
      retrievedAt: "2026-11-01T00:00:00Z",
      // The whole file: the line of the header to the last line of the last row.
      locator: { kind: "text-lines", startLine: 1, endLine: 4 },
      sha256: sha256Hex(request.bytes),
      usage: unreviewedUsage("2026-11-13"),
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      license: FICTIONAL_LICENSE,
      catalog: FICTIONAL_CATALOG,
    });
    // Nothing that a person has to decide was decided.
    expect(value.source.usage.status).toBe("UNKNOWN");
    expect(value.source.transmission.status).toBe("UNKNOWN");
    expect(value.source.datasetNote).toBeNull();
    expect(await current.files()).toEqual([RAW_R1, SOURCE_R1]);
    // The record on the disk is the record that was returned, and it is a record that the reader of the issues takes.
    expect(RealSourceSchema.parse(await current.readJson(current.recordPath("sources/fictional-shelters/r1.json")))).toEqual(value.source);
    const inputs = createFileIssueInputs(current.store.root, { rawRoot: current.store.rawRoot });
    expect(await inputs.readSources()).toEqual({ ok: true, value: [value.source] });
    expect(await inputs.originalHashes(value.source)).toEqual([value.source.sha256]);
  });

  it("places the bytes of the file as they are, and records their SHA-256, not those of the expanded text", async () => {
    const current = await newWorld();
    const bytes = encodeShiftJis(FICTIONAL_TABLE);
    const result = await intakeCsv(current.store, intakeRequest({ bytes }), CLOCK);
    expect(result.ok && result.value.source.sha256).toBe(sha256Hex(bytes));
    expect(new Uint8Array(await readFile(current.rawPath("fictional-shelters/r1/shelters.csv")))).toEqual(bytes);
    expect(sha256Hex(bytes)).not.toBe(sha256Hex(encodeUtf8(FICTIONAL_TABLE)));
  });

  it.each([
    ["UTF-8", encodeUtf8(FICTIONAL_TABLE)],
    ["UTF-8-BOM", encodeUtf8(FICTIONAL_TABLE, true)],
    ["SHIFT_JIS", encodeShiftJis(FICTIONAL_TABLE)],
  ] as const)("takes %s, tells the encoding and what the table is", async (encoding, bytes) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ bytes }), CLOCK);
    expect(result.ok && result.value.encoding).toBe(encoding);
    expect(result.ok && result.value.table).toEqual({
      headers: ["名称", "種別", "件数"],
      columnCount: 3,
      rowCount: 3,
      recordCount: 4,
      headerLine: 1,
      firstDataLine: 2,
      lastDataLine: 4,
      blankCellCount: 0,
      duplicateRowCount: 0,
    });
  });

  it("takes a table with blank cells and repeated rows, and tells their number (they are the business of aggregate, not a reason to refuse)", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ bytes: encodeUtf8("a,b\n1,\n1,\n,\n") }), CLOCK);
    expect(result.ok && result.value.table).toMatchObject({ rowCount: 3, blankCellCount: 4, duplicateRowCount: 1 });
  });

  it("names the lines of the whole file in the locator, also when there are blank lines around the rows", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ bytes: encodeUtf8("\na,b\n\n1,2\n\n3,4\n\n\n") }), CLOCK);
    expect(result.ok && result.value.source.locator).toEqual({ kind: "text-lines", startLine: 1, endLine: 6 });
  });

  it("has no catalog in the record when none is given", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ catalog: undefined }), CLOCK);
    expect(result.ok && "catalog" in result.value.source).toBe(false);
  });

  it("takes the date of the first value of the terms of use from the clock, and nowhere else", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest(), () => new Date("2027-01-02T23:59:59Z"));
    expect(result.ok && result.value.source.usage.checkedAt).toBe("2027-01-02");
  });

  it("takes a document ID as a reference, without a URL", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ reference: { kind: "document-id", documentId: "doc-0001" } }), CLOCK);
    expect(result.ok && result.value.source.reference).toEqual({ kind: "document-id", documentId: "doc-0001" });
  });
});

describe("intakeCsv: the revisions", () => {
  it("changes nothing for the same bytes as the latest revision", async () => {
    const current = await newWorld();
    const first = await intakeCsv(current.store, intakeRequest(), CLOCK);
    const before = await current.files();
    const second = await intakeCsv(current.store, intakeRequest(), () => new Date("2030-01-01T00:00:00Z"));
    expect(second.ok && second.value.status).toBe("UNCHANGED");
    // Nothing was placed this time, so there is no place to name.
    expect(second.ok && second.value.rawPath).toBeNull();
    expect(first.ok && second.ok ? second.value.source : null).toEqual(first.ok ? first.value.source : undefined);
    expect(await current.files()).toEqual(before);
  });

  it("makes the next revision for other bytes, and leaves the earlier revision as it was", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const firstText = await current.readText(current.recordPath("sources/fictional-shelters/r1.json"));
    const result = await intakeCsv(current.store, intakeRequest({ bytes: tableOf(["あおば,13"]), fileName: "shelters-2.csv" }), CLOCK);
    expect(result.ok && result.value.source.revision).toBe("r2");
    expect(await current.files()).toEqual([
      RAW_R1,
      "raw/fictional-shelters/r2/shelters-2.csv",
      SOURCE_R1,
      "records/sources/fictional-shelters/r2.json",
    ]);
    expect(await current.readText(current.recordPath("sources/fictional-shelters/r1.json"))).toBe(firstText);
  });

  it("makes a new revision, not UNCHANGED, when the content goes back to an earlier revision", async () => {
    const current = await newWorld();
    const original = intakeRequest();
    await intakeCsv(current.store, original, CLOCK);
    await intakeCsv(current.store, intakeRequest({ bytes: tableOf(["あおば,13"]) }), CLOCK);
    const back = await intakeCsv(current.store, original, CLOCK);
    expect(back.ok && back.value.status).toBe("CREATED");
    expect(back.ok && back.value.source.revision).toBe("r3");
    // The same content is held by two revisions of one source ID, which is not a duplicate.
    const again = await intakeCsv(current.store, original, CLOCK);
    expect(again.ok && again.value.status).toBe("UNCHANGED");
  });

  it("orders the revisions by their number, not by their text (r10 is after r9)", async () => {
    const current = await newWorld();
    for (let index = 1; index <= 12; index += 1) {
      const result = await intakeCsv(current.store, intakeRequest({ bytes: tableOf([`あおば,${index}`]) }), CLOCK);
      expect(result.ok && result.value.source.revision, `intake ${index}`).toBe(`r${index}`);
    }
    // The same bytes as the 12th are the latest revision; the same bytes as the 3rd are a new revision.
    const same = await intakeCsv(current.store, intakeRequest({ bytes: tableOf(["あおば,12"]) }), CLOCK);
    expect(same.ok && same.value.status).toBe("UNCHANGED");
    const old = await intakeCsv(current.store, intakeRequest({ bytes: tableOf(["あおば,3"]) }), CLOCK);
    expect(old.ok && old.value.source.revision).toBe("r13");
  });
});

describe("intakeCsv: the same content under another source ID", () => {
  it("refuses it as DUPLICATE_CONTENT, names the source ID that holds it, and writes nothing", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ sourceId: "first-source", fileName: "a.csv" }), CLOCK);
    const before = await current.files();
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "second-source", fileName: "b.csv" }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "DUPLICATE_CONTENT", existingSourceId: "first-source" } });
    expect(await current.files()).toEqual(before);
  });

  it("refuses it also when the other source holds the content in an earlier revision", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ sourceId: "first-source", fileName: "a.csv" }), CLOCK);
    await intakeCsv(current.store, intakeRequest({ sourceId: "first-source", fileName: "a.csv", bytes: tableOf(["あおば,1"]) }), CLOCK);
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "second-source", fileName: "b.csv" }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "DUPLICATE_CONTENT", existingSourceId: "first-source" } });
  });

  it("takes other bytes under another source ID", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ sourceId: "first-source", fileName: "a.csv" }), CLOCK);
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "second-source", fileName: "b.csv", bytes: tableOf(["みなと,5"]) }), CLOCK);
    expect(result.ok && result.value.source.revision).toBe("r1");
  });

  it("does not take the same bytes in another encoding for the same content: the SHA-256 is of the bytes of the file", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ sourceId: "first-source", fileName: "a.csv" }), CLOCK);
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "second-source", fileName: "b.csv", bytes: encodeShiftJis(FICTIONAL_TABLE) }), CLOCK);
    expect(result.ok).toBe(true);
  });
});

describe("intakeCsv: a request that is not complete", () => {
  it.each([
    ["an uppercase letter", "Source"],
    ["an underscore", "a_b"],
    ["a slash", "a/b"],
    ["a dot segment", ".."],
    ["a reserved device name", "con"],
    ["nothing", ""],
    ["65 characters", "a".repeat(65)],
    ["a character that is not ASCII", "あおば"],
  ])("refuses a source ID with %s", async (_name, sourceId) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ sourceId }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "SOURCE_ID_INVALID" } });
    expect(await current.files()).toEqual([]);
  });

  it("takes a source ID of 64 characters", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "a".repeat(64) }), CLOCK);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a path", "dir/shelters.csv"],
    ["a path with a back slash", "dir\\shelters.csv"],
    ["a parent directory", "../shelters.csv"],
    ["another extension", "shelters.xlsx"],
    ["no extension", "shelters"],
    ["a reserved device name", "con.csv"],
    ["a character that is not ASCII", "避難所.csv"],
    ["a space", "my shelters.csv"],
    ["a name that begins with a dot", ".hidden.csv"],
    ["a name that ends with a dot", "shelters.csv."],
    ["nothing", ""],
  ])("refuses a file name that is %s", async (_name, fileName) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ fileName }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "FILE_NAME_INVALID" } });
    expect(await current.files()).toEqual([]);
  });

  it("takes an extension in capital letters", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ fileName: "SHELTERS.CSV" }), CLOCK);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a URL that is not https (reference)", { reference: { kind: "url", url: "http://example.org/x" } }, ["reference"]],
    ["a URL with a user name (reference)", { reference: { kind: "url", url: "https://user:pass@example.org/x" } }, ["reference"]],
    ["a file URL (license)", { license: { name: "x", url: "file:///etc/passwd" } }, ["license"]],
    ["a blank publisher", { publisher: "  " }, ["publisher"]],
    ["a date that does not exist", { publishedOn: "2026-02-30" }, ["publishedOn"]],
    ["a time without a time zone", { retrievedAt: "2026-11-01T00:00:00" }, ["retrievedAt"]],
    ["a date for a time", { retrievedAt: "2026-11-01" }, ["retrievedAt"]],
    ["a document ID of no characters", { reference: { kind: "document-id", documentId: "" } }, ["reference"]],
    ["a blank name of the license", { license: { name: " ", url: "https://example.org/l" } }, ["license"]],
    ["a catalog without a data set ID", { catalog: { name: "架空カタログ", datasetId: "" } }, ["catalog"]],
  ] satisfies readonly (readonly [string, Partial<IntakeRequest>, readonly string[]])[])("refuses %s, and names the item", async (_name, over, fields) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest(over), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "SUPPLY_INCOMPLETE", fields } });
    expect(await current.files()).toEqual([]);
  });

  it("names every item that is wrong, never a value", async () => {
    const current = await newWorld();
    const secret = "秘密の公開者-8841";
    const result = await intakeCsv(current.store, intakeRequest({ publisher: " ", publishedOn: "2026-13-01", license: { name: secret, url: "http://example.org/l" } }), CLOCK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect([...(result.error.fields ?? [])].sort()).toEqual(["license"]);
    }
    const second = await intakeCsv(current.store, intakeRequest({ publisher: " ", publishedOn: "2026-13-01" }), CLOCK);
    expect(second.ok ? [] : [...(second.error.fields ?? [])].sort()).toEqual(["publishedOn", "publisher"]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("refuses a record root that is not the root of real data", async () => {
    const current = await newWorld();
    const store = createIntakeStore({ ...current.store.root, dataKind: "FIXTURE" }, { rawRoot: current.store.rawRoot });
    expect(await intakeCsv(store, intakeRequest(), CLOCK)).toEqual({ ok: false, error: { code: "ROOT_NOT_REAL" } });
    expect(await current.files()).toEqual([]);
  });

  it("takes the same fixed codes as a list", () => {
    expect(new Set(INTAKE_REFUSAL_CODES).size).toBe(INTAKE_REFUSAL_CODES.length);
  });
});

describe("intakeCsv: a file that is refused", () => {
  type Case = Readonly<{ name: string; bytes: Uint8Array; code: string; reason: string; line?: number | null }>;

  const cases: readonly Case[] = [
    { name: "an empty file", bytes: new Uint8Array(0), code: "CSV_TEXT_REFUSED", reason: "EMPTY_FILE" },
    { name: "UTF-16 text", bytes: Uint8Array.of(0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00), code: "CSV_TEXT_REFUSED", reason: "ENCODING_UNSUPPORTED" },
    { name: "a control character", bytes: encodeUtf8("a,b\n1,\u0007\n"), code: "CSV_TEXT_REFUSED", reason: "INVALID_CHARACTER" },
    { name: "a text of blank lines", bytes: encodeUtf8("\n\n\n"), code: "CSV_TABLE_REFUSED", reason: "EMPTY_TEXT", line: null },
    { name: "a quote that is not closed", bytes: encodeUtf8('a,b\n"1,2\n'), code: "CSV_TABLE_REFUSED", reason: "MALFORMED_CSV", line: null },
    { name: "a column without a name", bytes: encodeUtf8("a,,c\n1,2,3\n"), code: "CSV_TABLE_REFUSED", reason: "HEADER_BLANK", line: 1 },
    { name: "two columns of one name", bytes: encodeUtf8("a,b,a\n1,2,3\n"), code: "CSV_TABLE_REFUSED", reason: "HEADER_DUPLICATE", line: 1 },
    { name: "a row with fewer fields", bytes: encodeUtf8("a,b\n1,2\n3\n4,5\n"), code: "CSV_TABLE_REFUSED", reason: "COLUMN_COUNT_MISMATCH", line: 3 },
    { name: "a row with more fields", bytes: encodeUtf8("a,b\n1,2,3\n"), code: "CSV_TABLE_REFUSED", reason: "COLUMN_COUNT_MISMATCH", line: 2 },
    { name: "a header only", bytes: encodeUtf8("a,b\n"), code: "CSV_TABLE_REFUSED", reason: "NO_DATA_ROWS", line: 1 },
  ];

  it.each(cases)("refuses $name and writes nothing", async (refused) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ bytes: refused.bytes }), CLOCK);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(refused.code);
    expect(result.error.reason).toBe(refused.reason);
    if (refused.line !== undefined) {
      expect(result.error.line).toBe(refused.line);
    }
    expect(await current.files()).toEqual([]);
  });

  it("does not put a value of the file in the refusal", async () => {
    const current = await newWorld();
    const secret = "秘密の値-7731";
    const result = await intakeCsv(current.store, intakeRequest({ bytes: encodeUtf8(`a,b\n${secret}\n`) }), CLOCK);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not change the bytes that it is given", async () => {
    const current = await newWorld();
    const request = intakeRequest({ bytes: encodeShiftJis(FICTIONAL_TABLE) });
    const copy = Uint8Array.from(request.bytes);
    await intakeCsv(current.store, request, CLOCK);
    expect(request.bytes).toEqual(copy);
  });
});

describe("intakeCsv: a conversion by a person (Req 7.24)", () => {
  it("records the original, the converted file, the procedure and the rows, from the files", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf() }), CLOCK);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.source.conversion).toEqual({
      originalFileName: "shelters.xlsx",
      originalSha256: sha256Hex(ORIGINAL_BYTES),
      convertedSha256: result.value.source.sha256,
      procedureId: "xlsx-to-csv-v1",
      procedureDocSha256: sha256Hex(PROCEDURE_BYTES),
      convertedBy: "analyst-1",
      convertedAt: "2026-11-02T09:00:00Z",
      correspondence: "ROWS_PRESERVED",
      originalRowCount: 4,
      convertedRowCount: 4,
    });
    // The converted file is the source: its SHA-256 is the one of the record and of the conversion.
    expect(result.value.source.sha256).toBe(sha256Hex(intakeRequest().bytes));
    // The original and the procedure are not stored: the converted file and the record are.
    expect(await current.files()).toEqual([RAW_R1, SOURCE_R1]);
    // The reader of the issues takes a record with a conversion.
    expect(await createFileIssueInputs(current.store.root, { rawRoot: current.store.rawRoot }).readSources()).toEqual({ ok: true, value: [result.value.source] });
  });

  it("counts the rows as the header and the data rows, without a line that has nothing on it", async () => {
    const current = await newWorld();
    const bytes = encodeUtf8("a,b\n\n1,2\n\n3,4\n");
    const counted = await intakeCsv(current.store, intakeRequest({ bytes, conversion: conversionOf({ originalRowCount: 3 }) }), CLOCK);
    expect(counted.ok && counted.value.source.conversion?.convertedRowCount).toBe(3);
    const second = await newWorld();
    const lines = await intakeCsv(second.store, intakeRequest({ bytes, conversion: conversionOf({ originalRowCount: 5 }) }), CLOCK);
    expect(lines).toEqual({ ok: false, error: { code: "ROW_COUNT_MISMATCH", originalRowCount: 5, convertedRowCount: 3 } });
  });

  it.each([3, 5, 0])("refuses a conversion that does not keep the rows (the original has %i rows) and writes nothing", async (originalRowCount) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf({ originalRowCount }) }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ROW_COUNT_MISMATCH", originalRowCount, convertedRowCount: 4 } });
    expect(await current.files()).toEqual([]);
  });

  it.each([
    ["no person who converted", { convertedBy: "" }, ["convertedBy"]],
    ["a person of blank characters", { convertedBy: "   " }, ["convertedBy"]],
    ["no time of the conversion", { convertedAt: "" }, ["convertedAt"]],
    ["a time without a time zone", { convertedAt: "2026-11-02T09:00:00" }, ["convertedAt"]],
    ["no identifier of the procedure", { procedureId: "" }, ["procedureId"]],
    ["an identifier of the procedure that is too long", { procedureId: "p".repeat(65) }, ["procedureId"]],
    ["a file name of the original with a path", { originalFileName: "dir/shelters.xlsx" }, ["originalFileName"]],
    ["no file name of the original", { originalFileName: "" }, ["originalFileName"]],
    ["an original of no bytes", { originalBytes: new Uint8Array(0) }, ["originalBytes"]],
    ["a procedure of no bytes", { procedureDocBytes: new Uint8Array(0) }, ["procedureDocBytes"]],
    ["a correspondence that is not ROWS_PRESERVED", { correspondence: "ROWS_MERGED" as unknown as "ROWS_PRESERVED" }, ["correspondence"]],
    ["a number of rows that is not an integer", { originalRowCount: 4.5 }, ["originalRowCount"]],
    ["a number of rows that is negative", { originalRowCount: -1 }, ["originalRowCount"]],
  ] satisfies readonly (readonly [string, Partial<NonNullable<IntakeRequest["conversion"]>>, readonly string[]])[])(
    "refuses a conversion with %s, and writes nothing",
    async (_name, over, fields) => {
      const current = await newWorld();
      const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf(over) }), CLOCK);
      expect(result).toEqual({ ok: false, error: { code: "CONVERSION_INVALID", fields } });
      expect(await current.files()).toEqual([]);
    },
  );

  it("takes in the CSV of a conversion when the original that was converted is the file that the person was told about (the SHA-256 and the size)", async () => {
    const current = await newWorld();
    const expectedOriginal = { sha256: sha256Hex(ORIGINAL_BYTES), byteLength: ORIGINAL_BYTES.byteLength };
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf(), expectedOriginal }), CLOCK);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["the SHA-256", { sha256: "0".repeat(64), byteLength: ORIGINAL_BYTES.byteLength }, ["sha256"]],
    ["the size", { sha256: sha256Hex(ORIGINAL_BYTES), byteLength: ORIGINAL_BYTES.byteLength + 1 }, ["byteLength"]],
    ["the SHA-256 and the size", { sha256: "0".repeat(64), byteLength: 1 }, ["sha256", "byteLength"]],
  ])("takes in nothing when the original that was converted has another %s than the one that the person was told about", async (_name, expectedOriginal, fields) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf(), expectedOriginal }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ORIGINAL_MISMATCH", fields } });
    expect(await current.files()).toEqual([]);
  });

  it("does not take the SHA-256 and the size of the converted CSV for the ones of the original that was converted", async () => {
    const current = await newWorld();
    const csv = intakeRequest().bytes;
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf(), expectedOriginal: { sha256: sha256Hex(csv), byteLength: csv.byteLength } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ORIGINAL_MISMATCH", fields: ["sha256", "byteLength"] } });
    expect(await current.files()).toEqual([]);
  });

  it("changes nothing for the same file with the same conversion, and refuses the same file with another conversion", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest({ conversion: conversionOf() }), CLOCK);
    const before = await current.files();
    const same = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf() }), CLOCK);
    expect(same.ok && same.value.status).toBe("UNCHANGED");
    const without = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(without.ok && without.value.status).toBe("UNCHANGED");
    const other = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf({ convertedBy: "analyst-2" }) }), CLOCK);
    expect(other).toEqual({ ok: false, error: { code: "CONVERSION_CONFLICT" } });
    expect(await current.files()).toEqual(before);
  });

  it("refuses a conversion for a file that was taken in without one", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf() }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "CONVERSION_CONFLICT" } });
  });

  it("does not put a value of the files in the refusal", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ conversion: conversionOf({ convertedBy: "", procedureId: "秘密の手順-5521" }) }), CLOCK);
    expect(JSON.stringify(result)).not.toContain("秘密の手順-5521");
  });
});

describe("intakeCsv: a store that cannot be read or written", () => {
  it("refuses, and writes nothing, when a record of the sources is not valid", async () => {
    const current = await newWorld();
    await current.putRecordText("sources/other-source/r1.json", "{ not json");
    const result = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "RECORD_INVALID" } });
    expect(await current.files()).toEqual(["records/sources/other-source/r1.json"]);
  });

  it("refuses when a record is not at the path of its own source ID and revision", async () => {
    const current = await newWorld();
    await current.putRecord("sources/other-source/r1.json", realSource({ sourceId: "fictional-shelters", revision: "r1" }));
    const result = await intakeCsv(current.store, intakeRequest({ sourceId: "other-source" }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "PATH_MISMATCH" } });
  });

  it("refuses when the revision of a record of the source is not r<n>, because the next revision cannot be told", async () => {
    const current = await newWorld();
    await current.putRecord("sources/fictional-shelters/rev-1.json", realSource({ sourceId: "fictional-shelters", revision: "rev-1" }));
    const result = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "REVISION_INVALID" } });
  });

  it("refuses a file that is there with other bytes at the place of the original, and leaves that file as it is", async () => {
    const current = await newWorld();
    const other = encodeUtf8("someone else's file");
    await current.putRaw("fictional-shelters/r1/shelters.csv", other);
    const result = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "RAW_FILE_CONFLICT", reason: "IMMUTABLE_CONFLICT" } });
    expect(await current.files()).toEqual([RAW_R1]);
    expect(new Uint8Array(await readFile(current.rawPath("fictional-shelters/r1/shelters.csv")))).toEqual(other);
  });

  it("takes the file that is there with the same bytes (a run that stopped after the placement) and makes the record", async () => {
    const current = await newWorld();
    await current.putRaw("fictional-shelters/r1/shelters.csv", intakeRequest().bytes);
    const result = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(result.ok && result.value.status).toBe("CREATED");
    expect(await current.files()).toEqual([RAW_R1, SOURCE_R1]);
  });

  it("leaves nothing when the placement of the original fails", async () => {
    const current = await newWorld();
    const store = current.storeWith(failRenameTo(endsWith("shelters.csv")));
    const result = await intakeCsv(store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED", reason: "ATOMIC_RENAME_FAILED" } });
    expect(await current.files()).toEqual([]);
  });

  it("takes the placed original away again when the source record cannot be written, and a later intake works", async () => {
    const current = await newWorld();
    const store = current.storeWith(failRenameTo(endsWith("r1.json")));
    const result = await intakeCsv(store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED", reason: "STORE_WRITE_FAILED" } });
    expect(await current.files()).toEqual([]);
    const later = await intakeCsv(current.store, intakeRequest(), CLOCK);
    expect(later.ok && later.value.source.revision).toBe("r1");
    expect(await current.files()).toEqual([RAW_R1, SOURCE_R1]);
  });

  it("does not take away a file that was there before, when the source record cannot be written", async () => {
    const current = await newWorld();
    await current.putRaw("fictional-shelters/r1/shelters.csv", intakeRequest().bytes);
    const result = await intakeCsv(current.storeWith(failRenameTo(endsWith("r1.json"))), intakeRequest(), CLOCK);
    expect(result.ok).toBe(false);
    expect(await current.files()).toEqual([RAW_R1]);
  });

  it("names the files that remain when they cannot be taken away", async () => {
    const current = await newWorld();
    const store = current.storeWith({
      ...failRenameTo(endsWith("r1.json")),
      unlink: async () => {
        throw new Error("injected fault");
      },
    });
    const result = await intakeCsv(store, intakeRequest(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED", reason: "STORE_WRITE_FAILED", leftovers: [RAW_R1] } });
    // The file is there, and the refusal says so; the record is not.
    expect((await current.files()).filter((path) => path === RAW_R1)).toEqual([RAW_R1]);
    expect(await current.files()).not.toContain(SOURCE_R1);
  });

  it("does not take away the original of an earlier revision when a new revision fails", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const before = await current.files();
    const store = current.storeWith(failRenameTo(endsWith("r2.json")));
    const result = await intakeCsv(store, intakeRequest({ bytes: tableOf(["あおば,1"]), fileName: "shelters-2.csv" }), CLOCK);
    expect(result.ok).toBe(false);
    expect(await current.files()).toEqual(before);
  });

  it("makes no network request and calls no AI: it reads and writes files only", async () => {
    const current = await newWorld();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((): never => {
      calls += 1;
      throw new Error("no network in the intake");
    }) as unknown as typeof fetch;
    try {
      await intakeCsv(current.store, intakeRequest(), CLOCK);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });

  it("uses the unlink of the operations for what it takes away, and the real one by default", async () => {
    const current = await newWorld();
    const removed: string[] = [];
    const store = current.storeWith({
      ...failRenameTo(endsWith("r1.json")),
      unlink: async (path) => {
        removed.push(path);
        await unlink(path);
      },
    });
    await intakeCsv(store, intakeRequest(), CLOCK);
    expect(removed.some((path) => path.replaceAll("\\", "/").endsWith("/fictional-shelters/r1/shelters.csv"))).toBe(true);
  });
});

describe("intakeCsv: the original that the person expects (the SHA-256 and the size are required)", () => {
  const TABLE = intakeRequest().bytes;

  it("takes in a file that is the expected one", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ expectedOriginal: { sha256: sha256Hex(TABLE), byteLength: TABLE.byteLength } }), CLOCK);
    expect(result.ok && result.value.status).toBe("CREATED");
  });

  it.each([
    ["the SHA-256", { sha256: "1".repeat(64), byteLength: TABLE.byteLength }, ["sha256"]],
    ["the size", { sha256: sha256Hex(TABLE), byteLength: TABLE.byteLength - 1 }, ["byteLength"]],
    ["the SHA-256 and the size", { sha256: "1".repeat(64), byteLength: 0 }, ["sha256", "byteLength"]],
  ])("refuses a file that has another %s than the expected one, and writes nothing", async (_name, expectedOriginal, fields) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, intakeRequest({ expectedOriginal }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ORIGINAL_MISMATCH", fields } });
    expect(await current.files()).toEqual([]);
  });

  it.each([
    ["no expected original", undefined],
    ["an expected original that is null", null],
    ["a SHA-256 of capital letters", { sha256: sha256Hex(TABLE).toUpperCase(), byteLength: TABLE.byteLength }],
    ["a SHA-256 that is too short", { sha256: sha256Hex(TABLE).slice(1), byteLength: TABLE.byteLength }],
    ["a SHA-256 that is not hexadecimal", { sha256: "g".repeat(64), byteLength: TABLE.byteLength }],
    ["no SHA-256", { byteLength: TABLE.byteLength }],
    ["a size that is negative", { sha256: sha256Hex(TABLE), byteLength: -1 }],
    ["a size that is not an integer", { sha256: sha256Hex(TABLE), byteLength: 1.5 }],
    ["a size that is a text", { sha256: sha256Hex(TABLE), byteLength: String(TABLE.byteLength) }],
    ["no size", { sha256: sha256Hex(TABLE) }],
  ])("refuses a request with %s, and writes nothing", async (_name, expectedOriginal) => {
    const current = await newWorld();
    const request = (expectedOriginal === undefined ? intakeRequest({ expectedOriginal: undefined }) : { ...intakeRequest(), expectedOriginal }) as IntakeRequest;
    const result = await intakeCsv(current.store, request, CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "SUPPLY_INCOMPLETE", fields: ["expectedOriginal"] } });
    expect(await current.files()).toEqual([]);
  });

  it("compares before it reads the file: a file that is not the expected one is refused for that, whatever else is wrong with it", async () => {
    const current = await newWorld();
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
    const result = await intakeCsv(current.store, intakeRequest({ bytes: garbage, expectedOriginal: { sha256: sha256Hex(TABLE), byteLength: TABLE.byteLength } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ORIGINAL_MISMATCH", fields: ["sha256", "byteLength"] } });
  });

  it("is checked on every intake, also for a file that is taken in again, and the refusal names no value of the file", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const before = await current.files();
    const result = await intakeCsv(current.store, intakeRequest({ expectedOriginal: { sha256: "2".repeat(64), byteLength: TABLE.byteLength } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "ORIGINAL_MISMATCH", fields: ["sha256"] } });
    expect(JSON.stringify(result)).not.toContain(sha256Hex(TABLE));
    expect(await current.files()).toEqual(before);
  });
});
