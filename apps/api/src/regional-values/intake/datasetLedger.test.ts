import { DatasetRecordSchema } from "@ehime-vote-navigator/contracts";
import type { DatasetRecord } from "@ehime-vote-navigator/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { realSource } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { FICTIONAL_CATALOG, FICTIONAL_LICENSE, createIntakeWorld, failRenameTo, intakeRequest } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../../tests/harness/regional-values/intakeSupport.js";
import type { Override } from "../../../../../tests/harness/regional-values/override.js";
import { encodeShiftJis, encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { datasetKeyOf, fileFormatOfName, inspectLedger, readDatasetRecords, registerDataset, unreviewedUsage } from "./datasetLedger.js";
import type { DatasetRequest } from "./datasetLedger.js";
import { intakeCsv } from "./intake.js";
import type { IntakeRequest } from "./intake.js";
import { readRealSources } from "./sourceRecords.js";
import { isSafeRecordName } from "./storeLayout.js";

// Fictional data sets only. A person adopts a data set; these tests show that the intake never does.

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

const DATASET: DatasetRequest = {
  title: "架空の避難所一覧",
  sourceUrl: "https://example.org/dataset/shelters",
  surveyDate: "2026-07-27",
  updatedOn: "2026-07-27",
  coverageArea: "架空県",
  themeIds: ["TRANSPORT"],
};

const KEY = datasetKeyOf(FICTIONAL_CATALOG);
const LEDGER_FILE = `records/datasets/${KEY}.json`;

function request(over: Override<IntakeRequest> = {}): IntakeRequest {
  return intakeRequest({ dataset: DATASET, ...over });
}

function tableOf(count: number): Uint8Array {
  return encodeUtf8(`名称,件数\nあおば,${count}\n`);
}

/** A record of the ledger that a person has decided on: adopted, with the terms of use confirmed and the note checked. */
function adoptedRecord(over: Record<string, unknown> = {}): DatasetRecord {
  return DatasetRecordSchema.parse({
    datasetKey: KEY,
    catalog: FICTIONAL_CATALOG,
    title: "架空の避難所一覧",
    publisher: "架空県",
    sourceUrl: "https://example.org/dataset/shelters",
    surveyDate: "2026-07-27",
    updatedOn: null,
    coverageArea: "架空県",
    format: { fileFormat: "CSV", encoding: "UTF-8" },
    usage: { status: "CONFIRMED", checkedAt: "2026-11-05", checkedTarget: "利用条件のページ", evidence: "利用可と書かれている" },
    datasetNote: { hasSpecificNote: false, checkedBy: "analyst-1", checkedAt: "2026-11-05T00:00:00Z" },
    transmission: { status: "UNKNOWN" },
    license: FICTIONAL_LICENSE,
    adoption: { status: "ADOPTED", decidedBy: "owner-1", decidedAt: "2026-11-06T00:00:00Z", reason: "架空の理由" },
    themeIds: ["TRANSPORT"],
    sourceIds: [],
    ...over,
  });
}

describe("datasetKeyOf", () => {
  it("is the same for the same catalog and data set ID, and does not depend on the order of the keys", () => {
    expect(datasetKeyOf(FICTIONAL_CATALOG)).toBe(datasetKeyOf({ datasetId: FICTIONAL_CATALOG.datasetId, name: FICTIONAL_CATALOG.name }));
    expect(KEY).toMatch(/^ds-[0-9a-f]{24}$/u);
  });

  it("differs when the catalog or the data set ID differs, and is a name that a file can have", () => {
    const keys = [
      FICTIONAL_CATALOG,
      { ...FICTIONAL_CATALOG, datasetId: "fictional-pref-2" },
      { ...FICTIONAL_CATALOG, name: "別の架空カタログ" },
      { name: FICTIONAL_CATALOG.datasetId, datasetId: FICTIONAL_CATALOG.name },
    ].map(datasetKeyOf);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(isSafeRecordName(key)).toBe(true);
    }
  });
});

describe("fileFormatOfName", () => {
  it.each([
    ["shelters.xlsx", "XLSX"],
    ["SHELTERS.XLSX", "XLSX"],
    ["shelters.csv", "CSV"],
    ["report.pdf", "PDF"],
    ["page.html", "HTML"],
    ["page.htm", "HTML"],
    ["old.xls", "OTHER"],
    ["archive.zip", "OTHER"],
    ["noextension", "OTHER"],
  ])("reads the format of %s as %s", (name, format) => {
    expect(fileFormatOfName(name)).toBe(format);
  });
});

describe("intakeCsv: the ledger of the data sets (13.10)", () => {
  it("makes the record of the data set as a candidate, with every decision of a person not made", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, request(), CLOCK);
    expect(result.ok && result.value.ledger).toBe("CREATED");
    const stored = DatasetRecordSchema.parse(await current.readJson(current.recordPath(`datasets/${KEY}.json`)));
    expect(stored).toEqual({
      datasetKey: KEY,
      catalog: FICTIONAL_CATALOG,
      title: "架空の避難所一覧",
      // The publisher of the source, because the request names none.
      publisher: "架空県",
      sourceUrl: "https://example.org/dataset/shelters",
      surveyDate: "2026-07-27",
      updatedOn: "2026-07-27",
      coverageArea: "架空県",
      format: { fileFormat: "CSV", encoding: "UTF-8" },
      usage: unreviewedUsage("2026-11-13"),
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      license: FICTIONAL_LICENSE,
      adoption: { status: "CANDIDATE" },
      themeIds: ["TRANSPORT"],
      sourceIds: ["fictional-shelters"],
    });
    expect(await current.files()).toEqual(["raw/fictional-shelters/r1/shelters.csv", LEDGER_FILE, "records/sources/fictional-shelters/r1.json"].sort());
    expect(await readDatasetRecords(current.store)).toEqual({ ok: true, value: [stored] });
  });

  it("takes the publisher of the data set when it is given, and the year as a survey date", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, request({ dataset: { ...DATASET, publisher: "架空県の防災課", surveyDate: 2025, updatedOn: null } }), CLOCK);
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ publisher: "架空県の防災課", surveyDate: 2025, updatedOn: null });
  });

  it.each([
    ["UTF-8", encodeUtf8("名称,件数\nあおば,1\n"), "UTF-8"],
    ["UTF-8 with a mark", encodeUtf8("名称,件数\nあおば,1\n", true), "UTF-8-BOM"],
    ["Shift_JIS", encodeShiftJis("名称,件数\nあおば,1\n"), "SHIFT_JIS"],
  ])("records the encoding of the file that was taken in: %s", async (_name, bytes, encoding) => {
    const current = await newWorld();
    await intakeCsv(current.store, request({ bytes }), CLOCK);
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ format: { fileFormat: "CSV", encoding } });
  });

  it("records the format of the original for a file that a person converted, whose encoding is not a matter", async () => {
    const current = await newWorld();
    const conversion = {
      originalFileName: "shelters.xlsx",
      originalBytes: encodeUtf8("fictional xlsx"),
      procedureId: "xlsx-to-csv-v1",
      procedureDocBytes: encodeUtf8("手順書"),
      convertedBy: "analyst-1",
      convertedAt: "2026-11-02T09:00:00Z",
      correspondence: "ROWS_PRESERVED",
      originalRowCount: 2,
    } as const;
    const result = await intakeCsv(current.store, request({ bytes: tableOf(1), conversion }), CLOCK);
    expect(result.ok).toBe(true);
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ format: { fileFormat: "XLSX", encoding: "NOT_APPLICABLE" } });
  });

  it("does not rewrite the record for a new revision of a source that it lists", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, request(), CLOCK);
    const before = await current.readText(current.recordPath(`datasets/${KEY}.json`));
    const second = await intakeCsv(current.store, request({ bytes: tableOf(2) }), CLOCK);
    expect(second.ok && second.value.source.revision).toBe("r2");
    expect(second.ok && second.value.ledger).toBe("UNCHANGED");
    expect(await current.readText(current.recordPath(`datasets/${KEY}.json`))).toBe(before);
  });

  it("adds another source of the same data set, and changes nothing else in the record", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, request(), CLOCK);
    const before = DatasetRecordSchema.parse(await current.readJson(current.recordPath(`datasets/${KEY}.json`)));
    const second = await intakeCsv(current.store, request({ sourceId: "fictional-shelters-b", fileName: "b.csv", bytes: tableOf(9), dataset: { ...DATASET, title: "別の題名" } }), CLOCK);
    expect(second.ok && second.value.ledger).toBe("UPDATED");
    const after = DatasetRecordSchema.parse(await current.readJson(current.recordPath(`datasets/${KEY}.json`)));
    expect(after).toEqual({ ...before, sourceIds: ["fictional-shelters", "fictional-shelters-b"] });
    expect((await current.files()).filter((path) => path.startsWith("records/datasets/"))).toEqual([LEDGER_FILE]);
  });

  it("makes the ledger list a source that it did not list, when the same file is taken in again (UNCHANGED)", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, intakeRequest(), CLOCK);
    const again = await intakeCsv(current.store, request(), CLOCK);
    expect(again.ok && again.value.status).toBe("UNCHANGED");
    expect(again.ok && again.value.ledger).toBe("CREATED");
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ sourceIds: ["fictional-shelters"] });
  });

  it("never adopts a data set and never changes the decision of a person: an adopted data set stays adopted", async () => {
    const current = await newWorld();
    const adopted = adoptedRecord();
    await current.putRecord(`datasets/${KEY}.json`, adopted);
    const result = await intakeCsv(current.store, request(), CLOCK);
    expect(result.ok && result.value.ledger).toBe("UPDATED");
    const stored = DatasetRecordSchema.parse(await current.readJson(current.recordPath(`datasets/${KEY}.json`)));
    expect(stored).toEqual({ ...adopted, sourceIds: ["fictional-shelters"] });
    // The source that was taken in does not take the terms of use of the ledger: it starts as not decided.
    expect(result.ok && result.value.source.usage.status).toBe("UNKNOWN");
  });

  it("finds the record of a data set by its catalog, whatever its key is, and does not make a second one", async () => {
    const current = await newWorld();
    await current.putRecord("datasets/my-own-key.json", adoptedRecord({ datasetKey: "my-own-key" }));
    const result = await intakeCsv(current.store, request(), CLOCK);
    expect(result.ok && result.value.ledger).toBe("UPDATED");
    expect((await current.files()).filter((path) => path.startsWith("records/datasets/"))).toEqual(["records/datasets/my-own-key.json"]);
    expect(await current.readJson(current.recordPath("datasets/my-own-key.json"))).toMatchObject({ sourceIds: ["fictional-shelters"] });
  });

  it("refuses when two records have the same catalog, and writes nothing", async () => {
    const current = await newWorld();
    await current.putRecord("datasets/first.json", adoptedRecord({ datasetKey: "first" }));
    await current.putRecord("datasets/second.json", adoptedRecord({ datasetKey: "second" }));
    const before = await current.files();
    const result = await intakeCsv(current.store, request(), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "LEDGER_AMBIGUOUS", fields: ["catalog"] } });
    expect(await current.files()).toEqual(before);
  });

  it("refuses when the license of the source is not the license of the data set, and writes nothing", async () => {
    const current = await newWorld();
    await current.putRecord(`datasets/${KEY}.json`, adoptedRecord());
    const before = await current.files();
    const result = await intakeCsv(current.store, request({ license: { name: "別のライセンス", url: "https://example.org/other-license" } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "LEDGER_CONFLICT", fields: ["license"] } });
    expect(await current.files()).toEqual(before);
  });

  it("refuses a data set without a catalog", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, request({ catalog: undefined }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "CATALOG_REQUIRED" } });
    expect(await current.files()).toEqual([]);
  });

  it.each([
    ["a theme that does not exist", { themeIds: ["NO_SUCH_THEME"] }, ["themeIds"]],
    ["a theme twice", { themeIds: ["TRANSPORT", "TRANSPORT"] }, ["themeIds"]],
    ["a blank title", { title: " " }, ["title"]],
    ["a blank area", { coverageArea: "" }, ["coverageArea"]],
    ["a survey date that does not exist", { surveyDate: "2026-02-30" }, ["surveyDate"]],
    ["a survey year out of range", { surveyDate: 1899 }, ["surveyDate"]],
    ["a date of update that does not exist", { updatedOn: "2026-13-01" }, ["updatedOn"]],
  ] satisfies readonly (readonly [string, Partial<DatasetRequest>, readonly string[]])[])("refuses a data set with %s before anything is written", async (_name, over, fields) => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, request({ dataset: { ...DATASET, ...over } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "LEDGER_INVALID", fields } });
    expect(await current.files()).toEqual([]);
  });

  it("refuses a page of the data set that is not an https URL", async () => {
    const current = await newWorld();
    const result = await intakeCsv(current.store, request({ dataset: { ...DATASET, sourceUrl: "http://example.org/x" } }), CLOCK);
    expect(result).toEqual({ ok: false, error: { code: "SUPPLY_INCOMPLETE", fields: ["dataset"] } });
    expect(await current.files()).toEqual([]);
  });

  it("refuses, and writes nothing, when a record of the ledger cannot be read or is not at the path of its key", async () => {
    const broken = await newWorld();
    await broken.putRecordText("datasets/broken.json", "{ not json");
    expect(await intakeCsv(broken.store, request(), CLOCK)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "RECORD_INVALID" } });
    expect(await broken.files()).toEqual(["records/datasets/broken.json"]);
    await broken.remove();

    const moved = await newWorld();
    await moved.putRecord("datasets/another-name.json", adoptedRecord({ datasetKey: "not-the-name" }));
    expect(await intakeCsv(moved.store, request(), CLOCK)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "PATH_MISMATCH" } });
  });
});

describe("inspectLedger: the ledger and the source records agree", () => {
  const source = (sourceId: string, over: Record<string, unknown> = {}) => realSource({ sourceId, revision: "r1", catalog: FICTIONAL_CATALOG, license: FICTIONAL_LICENSE, ...over });

  it("finds nothing when every source is listed by the data set of its catalog, with the same license", () => {
    const dataset = adoptedRecord({ sourceIds: ["a", "b"] });
    expect(inspectLedger([dataset], [source("a"), source("b"), source("b", { revision: "r2" })])).toEqual([]);
  });

  it("finds nothing for no data set and no source, and for a source that has no catalog", () => {
    expect(inspectLedger([], [])).toEqual([]);
    expect(inspectLedger([], [realSource({ sourceId: "no-catalog", revision: "r1" })])).toEqual([]);
  });

  it("finds a source that the ledger lists and that has no record", () => {
    const dataset = adoptedRecord({ sourceIds: ["a", "missing"] });
    expect(inspectLedger([dataset], [source("a")])).toEqual([{ code: "LEDGER_SOURCE_MISSING", datasetKey: KEY, sourceId: "missing" }]);
  });

  it("finds a source of a catalog that no data set lists, with the key of the data set of that catalog when there is one", () => {
    const dataset = adoptedRecord({ sourceIds: ["a"] });
    expect(inspectLedger([dataset], [source("a"), source("unlisted")])).toEqual([{ code: "SOURCE_NOT_IN_LEDGER", datasetKey: KEY, sourceId: "unlisted" }]);
    expect(inspectLedger([], [source("unlisted")])).toEqual([{ code: "SOURCE_NOT_IN_LEDGER", datasetKey: null, sourceId: "unlisted" }]);
  });

  it("finds a source that the ledger lists under another catalog, or with no catalog", () => {
    const dataset = adoptedRecord({ sourceIds: ["a", "b"] });
    const other = { name: "別のカタログ", datasetId: "other-1" };
    expect(inspectLedger([dataset], [source("a", { catalog: other }), realSource({ sourceId: "b", revision: "r1" })])).toEqual([
      { code: "CATALOG_MISMATCH", datasetKey: KEY, sourceId: "a" },
      { code: "CATALOG_MISMATCH", datasetKey: KEY, sourceId: "b" },
    ]);
  });

  it("finds a source whose license is not the license of the data set", () => {
    const dataset = adoptedRecord({ sourceIds: ["a"] });
    expect(inspectLedger([dataset], [source("a", { license: { name: "別のライセンス", url: "https://example.org/other" } })])).toEqual([
      { code: "LICENSE_MISMATCH", datasetKey: KEY, sourceId: "a" },
    ]);
  });

  it("gives the same findings for the same records in any order", () => {
    const first = adoptedRecord({ datasetKey: "first", catalog: { name: "A", datasetId: "1" }, sourceIds: ["x", "gone-1"] });
    const second = adoptedRecord({ datasetKey: "second", catalog: { name: "B", datasetId: "2" }, sourceIds: ["gone-2"] });
    const sources = [source("x", { catalog: { name: "A", datasetId: "1" } }), source("y", { catalog: { name: "B", datasetId: "2" } })];
    const forward = inspectLedger([first, second], sources);
    expect(inspectLedger([second, first], [...sources].reverse())).toEqual(forward);
    expect(forward.map((finding) => `${finding.code}:${finding.sourceId}`)).toEqual(["LEDGER_SOURCE_MISSING:gone-1", "LEDGER_SOURCE_MISSING:gone-2", "SOURCE_NOT_IN_LEDGER:y"]);
  });

  it("is quiet about the ledger and the sources that the intake made", async () => {
    const current = await newWorld();
    await intakeCsv(current.store, request(), CLOCK);
    await intakeCsv(current.store, request({ sourceId: "fictional-shelters-b", fileName: "b.csv", bytes: tableOf(5) }), CLOCK);
    await intakeCsv(current.store, request({ bytes: tableOf(7) }), CLOCK);
    const sources = await readRealSources(current.store);
    const datasets = await readDatasetRecords(current.store);
    expect(sources.ok && datasets.ok && sources.value.length).toBe(3);
    expect(sources.ok && datasets.ok && inspectLedger(datasets.value, sources.value)).toEqual([]);
  });
});

describe("registerDataset: a data set that has no file yet", () => {
  const REGISTRATION = {
    catalog: FICTIONAL_CATALOG,
    dataset: DATASET,
    publisher: "架空県",
    license: FICTIONAL_LICENSE,
    today: "2026-11-13",
  } as const;

  it("makes the record of the candidate with no source, and starts every decision of a person as not made", async () => {
    const current = await newWorld();
    const result = await registerDataset(current.store, REGISTRATION);
    expect(result.ok && result.value.state).toBe("CREATED");
    const record = DatasetRecordSchema.parse(await current.readJson(current.recordPath(`datasets/${KEY}.json`)));
    expect(record).toMatchObject({
      datasetKey: KEY,
      catalog: FICTIONAL_CATALOG,
      adoption: { status: "CANDIDATE" },
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      usage: unreviewedUsage("2026-11-13"),
      sourceIds: [],
      format: { fileFormat: "OTHER", encoding: "NOT_APPLICABLE" },
    });
    expect(record.usage.status).toBe("UNKNOWN");
    expect(await current.files()).toEqual([LEDGER_FILE]);
  });

  it("takes the format that the publisher offers, and does not know the encoding of a CSV that it has not seen", async () => {
    const current = await newWorld();
    await registerDataset(current.store, { ...REGISTRATION, fileFormat: "CSV" });
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ format: { fileFormat: "CSV", encoding: "UNKNOWN" } });
  });

  it("changes nothing when the data set is registered again, and never touches what a person decided", async () => {
    const current = await newWorld();
    await current.putRecord(`datasets/${KEY}.json`, adoptedRecord());
    const before = await current.readText(current.recordPath(`datasets/${KEY}.json`));
    const result = await registerDataset(current.store, REGISTRATION);
    expect(result.ok && result.value.state).toBe("UNCHANGED");
    expect(await current.readText(current.recordPath(`datasets/${KEY}.json`))).toBe(before);
    expect(result.ok && result.value.record.adoption.status).toBe("ADOPTED");
  });

  it("is taken up by the intake of a file later: the same record, with the source added", async () => {
    const current = await newWorld();
    await registerDataset(current.store, REGISTRATION);
    const intake = await intakeCsv(current.store, request(), CLOCK);
    expect(intake.ok && intake.value.ledger).toBe("UPDATED");
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ sourceIds: ["fictional-shelters"], adoption: { status: "CANDIDATE" } });
    expect((await current.files()).filter((path) => path.startsWith("records/datasets/"))).toEqual([LEDGER_FILE]);
  });

  it("refuses another license for a data set that is registered, and a record that two data sets share, and writes nothing", async () => {
    const current = await newWorld();
    await registerDataset(current.store, REGISTRATION);
    const before = await current.readText(current.recordPath(`datasets/${KEY}.json`));
    expect(await registerDataset(current.store, { ...REGISTRATION, license: { name: "別のライセンス", url: "https://example.org/other" } })).toEqual({ ok: false, error: { code: "LEDGER_CONFLICT", fields: ["license"] } });
    expect(await current.readText(current.recordPath(`datasets/${KEY}.json`))).toBe(before);

    await current.putRecord("datasets/second.json", adoptedRecord({ datasetKey: "second" }));
    expect(await registerDataset(current.store, REGISTRATION)).toEqual({ ok: false, error: { code: "LEDGER_AMBIGUOUS", fields: ["catalog"] } });
  });

  it.each([
    ["no title", { title: "" }, ["title"]],
    ["a page that is not an https URL", { sourceUrl: "http://example.org/x" }, ["sourceUrl"]],
    ["a theme that is not one", { themeIds: ["NOT_A_THEME"] }, ["themeIds"]],
    ["a theme listed twice", { themeIds: ["TRANSPORT", "TRANSPORT"] }, ["themeIds"]],
    ["a survey date that does not exist", { surveyDate: "2026-02-30" }, ["surveyDate"]],
  ] satisfies readonly (readonly [string, Partial<DatasetRequest>, readonly string[]])[])("refuses a data set with %s, and writes nothing", async (_name, over, fields) => {
    const current = await newWorld();
    const result = await registerDataset(current.store, { ...REGISTRATION, dataset: { ...DATASET, ...over } });
    expect(result).toEqual({ ok: false, error: { code: "LEDGER_INVALID", fields } });
    expect(await current.files()).toEqual([]);
  });

  it("fails with a code, and leaves nothing, when the ledger cannot be read or the record cannot be written", async () => {
    const broken = await newWorld();
    await broken.putRecordText("datasets/broken.json", "{ not json");
    expect(await registerDataset(broken.store, REGISTRATION)).toEqual({ ok: false, error: { code: "STORE_READ_FAILED", reason: "RECORD_INVALID" } });
    await broken.remove();

    const current = await newWorld();
    const store = current.storeWith(failRenameTo((finalPath) => finalPath.endsWith(".json")));
    expect(await registerDataset(store, REGISTRATION)).toEqual({ ok: false, error: { code: "STORE_WRITE_FAILED" } });
    expect((await current.files()).filter((path) => path.endsWith(".tmp"))).toEqual([]);
    expect(await current.files()).toEqual([]);
  });
});
