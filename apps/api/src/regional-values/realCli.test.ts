import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256Hex } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createBuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import type { BuildWorkspace } from "../../../../tests/harness/regional-values/buildWorkspace.js";
import { COUNT_ROWS, SUM_SHELTERS, computedRequest, createVerifiedFact, takeInTable } from "../../../../tests/harness/regional-values/factSupport.js";
import {
  FAST_OPERATIONS,
  FICTIONAL_CATALOG,
  FICTIONAL_LICENSE,
  FICTIONAL_TABLE,
  createIntakeWorld,
} from "../../../../tests/harness/regional-values/intakeSupport.js";
import type { IntakeWorld } from "../../../../tests/harness/regional-values/intakeSupport.js";
import { encodeShiftJis, encodeUtf8 } from "../../../../tests/harness/regional-values/shiftJis.js";
import { runRegionalValuesCli } from "./cli.js";
import type { RegionalValuesCliOptions } from "./cli.js";
import { datasetKeyOf } from "./intake/datasetLedger.js";
import { createComputedFact } from "./intake/factValue.js";
import { REAL_USAGE_LINES } from "./realCli.js";

// Every file, name and number is fictional: the publisher, the URLs (example.org), the data set and the tables. The files are made in a
// temporary workspace, where the command looks for the records of real data (`data/real/...`), and nothing else is read or written.

const FIXED_NOW = new Date("2026-11-20T01:00:00.000Z");
const KEY = datasetKeyOf(FICTIONAL_CATALOG);
const TABLE = encodeUtf8(FICTIONAL_TABLE);
const TABLE_SHA = sha256Hex(TABLE);

let workspace: BuildWorkspace | undefined;
let world: IntakeWorld | undefined;

afterEach(async () => {
  await world?.remove();
  await workspace?.remove();
  workspace = undefined;
  world = undefined;
});

async function prepare(): Promise<IntakeWorld> {
  workspace = await createBuildWorkspace();
  world = await createIntakeWorld({ base: workspace.root });
  return world;
}

type Run = Readonly<{ exitCode: number; lines: string[] }>;

async function run(argv: readonly string[], seams: RegionalValuesCliOptions["real"] = { operations: FAST_OPERATIONS }): Promise<Run> {
  if (workspace === undefined) {
    throw new Error("prepare the workspace first");
  }
  const lines: string[] = [];
  const exitCode = await runRegionalValuesCli(["real", ...argv], {
    workspaceRoot: workspace.root,
    io: { write: (line) => lines.push(line) },
    now: () => FIXED_NOW,
    logWriter: () => undefined,
    real: seams,
  });
  return { exitCode, lines };
}

/** A file in the workspace, given to the command by a path from the root of the repository. */
async function put(path: string, content: unknown): Promise<void> {
  if (workspace === undefined) {
    throw new Error("prepare the workspace first");
  }
  const absolute = join(workspace.root, ...path.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content instanceof Uint8Array || typeof content === "string" ? content : JSON.stringify(content));
}

function expectedOf(bytes: Uint8Array): { sha256: string; byteLength: number } {
  return { sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
}

const DATASET = {
  title: "架空の避難所一覧",
  sourceUrl: "https://example.org/dataset/shelters",
  surveyDate: "2026-07-27",
  updatedOn: "2026-07-27",
  coverageArea: "架空県",
  themeIds: ["TRANSPORT"],
};

function intakeJson(over: Record<string, unknown> = {}, bytes: Uint8Array = TABLE): Record<string, unknown> {
  return {
    sourceId: "fictional-shelters",
    file: "inbox/shelters.csv",
    reference: { kind: "url", url: "https://example.org/dataset/shelters" },
    publisher: "架空県",
    publishedOn: "2026-07-27",
    retrievedAt: "2026-11-01T00:00:00Z",
    license: FICTIONAL_LICENSE,
    catalog: FICTIONAL_CATALOG,
    expectedOriginal: expectedOf(bytes),
    ...over,
  };
}

const INTAKE = ["intake", "csv", "--request", "inbox/intake.json"] as const;

async function intake(over: Record<string, unknown> = {}, bytes: Uint8Array = TABLE, run0: typeof run = run): Promise<Run> {
  await put("inbox/shelters.csv", bytes);
  await put("inbox/intake.json", intakeJson(over, bytes));
  return run0(INTAKE);
}

// ---------------------------------------------------------------------------

describe("real: the entry", () => {
  it.each([[[]], [["dataset"]], [["dataset", "unknown"]], [["unknown", "list"]], [["original"]], [["fact", "verify"]], [["intake"]]] as const)(
    "prints the usage and a code for %j, and writes nothing",
    async (argv) => {
      const current = await prepare();
      const result = await run(argv);
      expect(result.exitCode).toBe(1);
      expect(result.lines.slice(0, REAL_USAGE_LINES.length)).toEqual(REAL_USAGE_LINES);
      expect(result.lines.at(-1)).toBe("code=ARGUMENT_INVALID");
      expect(await current.files()).toEqual([]);
    },
  );

  it("is listed in the usage of the command line", async () => {
    await prepare();
    const lines: string[] = [];
    await runRegionalValuesCli(["nothing"], { workspaceRoot: workspace?.root ?? "", io: { write: (line) => lines.push(line) } });
    expect(lines.some((line) => line.includes("-- real dataset|intake|original|fact"))).toBe(true);
  });

  it("opens no network", async () => {
    await prepare();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("network is not used"));
    }) as typeof fetch;
    try {
      await intake();
      await run(["dataset", "list"]);
      await run(["original", "verify-stored"]);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

describe("real dataset", () => {
  const REGISTER = ["dataset", "register", "--request", "inbox/dataset.json"] as const;
  const registration = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    catalog: FICTIONAL_CATALOG,
    ...DATASET,
    publisher: "架空県",
    license: FICTIONAL_LICENSE,
    ...over,
  });

  it("registers a data set as a candidate, with every review not made, and registers it again without changing it", async () => {
    const current = await prepare();
    await put("inbox/dataset.json", registration());
    expect(await run(REGISTER)).toEqual({ exitCode: 0, lines: [`code=DATASET_REGISTERED state=CREATED datasetKey=${KEY} adoption=CANDIDATE`] });
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({
      adoption: { status: "CANDIDATE" },
      usage: { status: "UNKNOWN" },
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      sourceIds: [],
    });
    const before = await current.readText(current.recordPath(`datasets/${KEY}.json`));
    expect(await run(REGISTER)).toEqual({ exitCode: 0, lines: [`code=DATASET_REGISTERED state=UNCHANGED datasetKey=${KEY} adoption=CANDIDATE`] });
    expect(await current.readText(current.recordPath(`datasets/${KEY}.json`))).toBe(before);
  });

  it("takes the format that the publisher offers", async () => {
    const current = await prepare();
    await put("inbox/dataset.json", registration({ fileFormat: "XLSX" }));
    await run(REGISTER);
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ format: { fileFormat: "XLSX", encoding: "NOT_APPLICABLE" } });
  });

  it.each([
    ["a license that is not the one of the record", { license: { name: "別のライセンス", url: "https://example.org/other" } }, "code=DATASET_REGISTER_FAILED reason=LEDGER_CONFLICT fields=license"],
    ["a page that is not an https URL", { sourceUrl: "http://example.org/x" }, "code=DATASET_REGISTER_FAILED reason=LEDGER_INVALID fields=sourceUrl"],
  ])("refuses %s, with a code and the names of the items", async (_name, over, line) => {
    const current = await prepare();
    await put("inbox/dataset.json", registration());
    await run(REGISTER);
    const before = await current.files();
    await put("inbox/dataset.json", registration(over));
    const result = await run(REGISTER);
    expect(result).toEqual({ exitCode: 1, lines: [line] });
    expect(await current.files()).toEqual(before);
  });

  it("refuses a theme that is not one, for a data set that is not registered yet, and writes nothing (a registered data set is not changed by a second request)", async () => {
    const current = await prepare();
    await put("inbox/dataset.json", registration({ themeIds: ["NOT_A_THEME"] }));
    expect(await run(REGISTER)).toEqual({ exitCode: 1, lines: ["code=DATASET_REGISTER_FAILED reason=LEDGER_INVALID fields=themeIds"] });
    expect(await current.files()).toEqual([]);
  });

  it.each([
    ["a key that is not in the shape", { unknownKey: 1 }, "code=REQUEST_INVALID fields=unknownKey"],
    ["a title that is not a text", { title: 5 }, "code=REQUEST_INVALID fields=title"],
    ["no catalog", { catalog: undefined }, "code=REQUEST_INVALID fields=catalog"],
  ])("refuses a request with %s, and names only the item", async (_name, over, line) => {
    const current = await prepare();
    await put("inbox/dataset.json", registration(over));
    expect(await run(REGISTER)).toEqual({ exitCode: 1, lines: [line] });
    expect(await current.files()).toEqual([]);
  });

  it("refuses a request that is not there, that is not JSON, and arguments that are not right", async () => {
    await prepare();
    expect(await run(REGISTER)).toEqual({ exitCode: 1, lines: ["code=REQUEST_UNREADABLE"] });
    await put("inbox/dataset.json", "{ not json");
    expect(await run(REGISTER)).toEqual({ exitCode: 1, lines: ["code=REQUEST_UNREADABLE"] });
    for (const argv of [["dataset", "register"], ["dataset", "register", "--request"], [...REGISTER, "extra"], [...REGISTER, "--request", "inbox/dataset.json"]]) {
      expect((await run(argv)).lines.at(-1), argv.join(" ")).toBe("code=ARGUMENT_INVALID");
    }
  });

  it("lists the data sets with what has been decided about each, and the title as a quoted text", async () => {
    await prepare();
    expect(await run(["dataset", "list"])).toEqual({ exitCode: 0, lines: ["code=DATASET_LIST count=0"] });
    await put("inbox/dataset.json", registration());
    await run(REGISTER);
    const listed = await run(["dataset", "list"]);
    expect(listed).toEqual({
      exitCode: 0,
      lines: [`dataset datasetKey=${KEY} adoption=CANDIDATE usage=UNKNOWN note=UNCHECKED transmission=UNKNOWN format=OTHER/NOT_APPLICABLE sources=0 title="架空の避難所一覧"`, "code=DATASET_LIST count=1"],
    });
  });

  it("checks the ledger against the source records, and finds a data set that lists a source that has no record", async () => {
    const current = await prepare();
    expect(await run(["dataset", "check"])).toEqual({ exitCode: 0, lines: ["code=DATASET_CHECK_OK datasets=0 sources=0"] });
    await intake({ dataset: DATASET });
    expect(await run(["dataset", "check"])).toEqual({ exitCode: 0, lines: ["code=DATASET_CHECK_OK datasets=1 sources=1"] });

    const record = (await current.readJson(current.recordPath(`datasets/${KEY}.json`))) as { sourceIds: string[] };
    await current.putRecord(`datasets/${KEY}.json`, { ...record, sourceIds: [...record.sourceIds, "ghost-source"] });
    expect(await run(["dataset", "check"])).toEqual({
      exitCode: 1,
      lines: [`finding code=LEDGER_SOURCE_MISSING datasetKey=${KEY} sourceId=ghost-source`, "code=DATASET_CHECK_FAILED findings=1"],
    });
  });

  it("fails with a code when the ledger cannot be read", async () => {
    const current = await prepare();
    await current.putRecordText("datasets/broken.json", "{ not json");
    expect(await run(["dataset", "list"])).toEqual({ exitCode: 1, lines: ["code=DATASET_LIST_FAILED reason=STORE_READ_FAILED cause=RECORD_INVALID"] });
    expect(await run(["dataset", "check"])).toEqual({ exitCode: 1, lines: ["code=DATASET_CHECK_FAILED reason=STORE_READ_FAILED cause=RECORD_INVALID"] });
    expect((await run(["dataset", "list", "extra"])).lines.at(-1)).toBe("code=ARGUMENT_INVALID");
  });
});

describe("real intake csv", () => {
  it("takes a CSV in, places the original, records the source, and tells what the file is, and nothing of what is in it", async () => {
    const current = await prepare();
    const result = await intake();
    expect(result).toEqual({
      exitCode: 0,
      lines: [`code=INTAKE_OK status=CREATED sourceId=fictional-shelters revision=r1 sha256=${TABLE_SHA} encoding=UTF-8 rows=3 columns=3 blankCells=0 duplicateRows=0 ledger=NOT_REQUESTED rawPath=fictional-shelters/r1/shelters.csv`],
    });
    expect(await current.files()).toEqual(["raw/fictional-shelters/r1/shelters.csv", "records/sources/fictional-shelters/r1.json"]);
    expect(await current.readJson(current.recordPath("sources/fictional-shelters/r1.json"))).toMatchObject({
      sha256: TABLE_SHA,
      usage: { status: "UNKNOWN" },
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      catalog: FICTIONAL_CATALOG,
    });
    const text = result.lines.join("\n");
    expect(text).not.toContain("あおば");
    expect(text).not.toContain(workspace?.root ?? "never");
  });

  it("takes a Shift_JIS file in, and records the ledger of the data set with it", async () => {
    const current = await prepare();
    const bytes = encodeShiftJis(FICTIONAL_TABLE);
    const result = await intake({ dataset: DATASET }, bytes);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain("encoding=SHIFT_JIS");
    expect(result.lines[0]).toContain("ledger=CREATED");
    expect(await current.readJson(current.recordPath(`datasets/${KEY}.json`))).toMatchObject({ sourceIds: ["fictional-shelters"], adoption: { status: "CANDIDATE" }, format: { fileFormat: "CSV", encoding: "SHIFT_JIS" } });
  });

  it("tells the blank cells and the rows that are the same, and does not stop for them", async () => {
    await prepare();
    const bytes = encodeUtf8("名称,件数\nあおば,\nあおば,\nみなと,3\n");
    const result = await intake({}, bytes);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain("rows=3 columns=2 blankCells=2 duplicateRows=1");
  });

  it("does nothing for the same file again (UNCHANGED), and makes the next revision for another content", async () => {
    const current = await prepare();
    await intake();
    const before = await current.files();
    expect((await intake()).lines[0]).toContain("status=UNCHANGED");
    expect(await current.files()).toEqual(before);
    const other = encodeUtf8("名称,件数\nあおば,1\n");
    const second = await intake({}, other);
    expect(second.lines[0]).toContain("status=CREATED sourceId=fictional-shelters revision=r2");
  });

  it("refuses a file that holds the same content under another source ID, and names that source ID", async () => {
    const current = await prepare();
    await intake();
    const before = await current.files();
    const result = await intake({ sourceId: "second-source" });
    expect(result).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=DUPLICATE_CONTENT existingSourceId=fictional-shelters"] });
    expect(await current.files()).toEqual(before);
  });

  describe("the expected original is required", () => {
    it.each([
      ["the SHA-256", { sha256: "4".repeat(64), byteLength: TABLE.byteLength }, "fields=sha256"],
      ["the size", { sha256: TABLE_SHA, byteLength: TABLE.byteLength + 1 }, "fields=byteLength"],
      ["the SHA-256 and the size", { sha256: "4".repeat(64), byteLength: 1 }, "fields=sha256,byteLength"],
    ])("takes in nothing when the file has another %s than the one that was told, and writes nothing", async (_name, expectedOriginal, fields) => {
      const current = await prepare();
      const result = await intake({ expectedOriginal });
      expect(result).toEqual({ exitCode: 1, lines: [`code=INTAKE_FAILED reason=ORIGINAL_MISMATCH ${fields}`] });
      expect(await current.files()).toEqual([]);
    });

    it.each([
      ["no expected original", { expectedOriginal: undefined }],
      ["an expected original with no size", { expectedOriginal: { sha256: TABLE_SHA } }],
      ["an expected original with no SHA-256", { expectedOriginal: { byteLength: TABLE.byteLength } }],
      ["a SHA-256 of capital letters", { expectedOriginal: { sha256: TABLE_SHA.toUpperCase(), byteLength: TABLE.byteLength } }],
      ["a SHA-256 that is too short", { expectedOriginal: { sha256: TABLE_SHA.slice(2), byteLength: TABLE.byteLength } }],
      ["a negative size", { expectedOriginal: { sha256: TABLE_SHA, byteLength: -1 } }],
      ["a size that is not an integer", { expectedOriginal: { sha256: TABLE_SHA, byteLength: 1.5 } }],
    ])("refuses a request with %s, and reads no file", async (_name, over) => {
      const current = await prepare();
      const result = await intake(over);
      expect(result.exitCode).toBe(1);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatch(/^code=REQUEST_INVALID fields=expectedOriginal$/u);
      expect(await current.files()).toEqual([]);
    });
  });

  describe("a CSV that a person converted from another file", () => {
    const ORIGINAL = encodeUtf8("fictional bytes of an xlsx file (not a real file)");
    const PROCEDURE = encodeUtf8("手順書: 1. 開く 2. UTF-8のCSVで保存 3. 行数を確かめる");
    const conversion = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      originalFile: "inbox/shelters.xlsx",
      procedureId: "xlsx-to-csv-by-hand-v1",
      procedureFile: "inbox/procedure.md",
      convertedBy: "analyst-1",
      convertedAt: "2026-11-02T09:00:00Z",
      correspondence: "ROWS_PRESERVED",
      originalRowCount: 4,
      ...over,
    });

    async function converted(over: Record<string, unknown> = {}, original: Uint8Array = ORIGINAL): Promise<Run> {
      await put("inbox/shelters.xlsx", original);
      await put("inbox/procedure.md", PROCEDURE);
      return intake({ expectedOriginal: expectedOf(ORIGINAL), conversion: conversion(), ...over });
    }

    it("records the conversion from the files, and compares the original that was converted with the expected one", async () => {
      const current = await prepare();
      const result = await converted();
      expect(result.exitCode).toBe(0);
      expect(await current.readJson(current.recordPath("sources/fictional-shelters/r1.json"))).toMatchObject({
        conversion: {
          originalFileName: "shelters.xlsx",
          originalSha256: sha256Hex(ORIGINAL),
          convertedSha256: TABLE_SHA,
          procedureId: "xlsx-to-csv-by-hand-v1",
          procedureDocSha256: sha256Hex(PROCEDURE),
          convertedBy: "analyst-1",
          originalRowCount: 4,
          convertedRowCount: 4,
        },
      });
      // The original that was converted and the procedure are not kept by the intake.
      expect(await current.files()).toEqual(["raw/fictional-shelters/r1/shelters.csv", "records/sources/fictional-shelters/r1.json"]);
    });

    it("takes in nothing when the original that was converted is not the one that was told (the CSV is not taken for it)", async () => {
      const current = await prepare();
      const result = await converted({ expectedOriginal: expectedOf(TABLE) });
      expect(result).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=ORIGINAL_MISMATCH fields=sha256,byteLength"] });
      expect(await current.files()).toEqual([]);
    });

    it("refuses a conversion that does not keep the rows, and tells the two numbers", async () => {
      const current = await prepare();
      const result = await converted({ conversion: conversion({ originalRowCount: 7 }) });
      expect(result).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=ROW_COUNT_MISMATCH originalRows=7 convertedRows=4"] });
      expect(await current.files()).toEqual([]);
    });

    it("says which file of the conversion cannot be read, and not where it is", async () => {
      await prepare();
      await put("inbox/procedure.md", PROCEDURE);
      await put("inbox/shelters.csv", TABLE);
      await put("inbox/intake.json", intakeJson({ expectedOriginal: expectedOf(ORIGINAL), conversion: conversion() }));
      expect(await run(INTAKE)).toEqual({ exitCode: 1, lines: ["code=FILE_UNREADABLE field=conversion.originalFile"] });
      await put("inbox/shelters.xlsx", ORIGINAL);
      await unlink(join(workspace?.root ?? "", "inbox", "procedure.md"));
      expect(await run(INTAKE)).toEqual({ exitCode: 1, lines: ["code=FILE_UNREADABLE field=conversion.procedureFile"] });
    });
  });

  it("refuses a file that is not a table, an encoding that is not known, and a name that is not safe, with a code and no content", async () => {
    const current = await prepare();
    expect(await intake({}, new Uint8Array([0x82, 0xa0, 0x82]))).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=CSV_TEXT_REFUSED cause=ENCODING_UNSUPPORTED"] });
    expect(await intake({}, encodeUtf8("名称,件数\n"))).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=CSV_TABLE_REFUSED cause=NO_DATA_ROWS line=1"] });
    expect(await intake({ sourceId: "Not Safe" })).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=SOURCE_ID_INVALID"] });
    expect(await intake({ fileName: "../shelters.csv" })).toEqual({ exitCode: 1, lines: ["code=INTAKE_FAILED reason=FILE_NAME_INVALID"] });
    expect(await current.files()).toEqual([]);
  });

  it("says that a file cannot be read, and refuses a request that is not right, with no path", async () => {
    const current = await prepare();
    await put("inbox/intake.json", intakeJson());
    expect(await run(INTAKE)).toEqual({ exitCode: 1, lines: ["code=FILE_UNREADABLE field=file"] });
    await put("inbox/intake.json", intakeJson({ sourceUrl: "x" }));
    expect(await run(INTAKE)).toEqual({ exitCode: 1, lines: ["code=REQUEST_INVALID fields=sourceUrl"] });
    for (const argv of [["intake", "csv"], ["intake", "csv", "--request"], [...INTAKE, "extra"]]) {
      expect((await run(argv)).lines.at(-1), argv.join(" ")).toBe("code=ARGUMENT_INVALID");
    }
    expect(await current.files()).toEqual([]);
  });

  it("leaves nothing when a write fails, and the same request then works", async () => {
    const current = await prepare();
    const failing = { operations: { rename: (): Promise<void> => Promise.reject(new Error("injected fault")) } };
    const failed = await intake({}, TABLE, (argv) => run(argv, failing));
    expect(failed.exitCode).toBe(1);
    expect(failed.lines[0]).toMatch(/^code=INTAKE_FAILED reason=STORE_WRITE_FAILED /u);
    expect(await current.files()).toEqual([]);
    expect((await run(INTAKE)).exitCode).toBe(0);
  });
});

describe("real original", () => {
  const FILE = ["original", "verify-file", "--file", "inbox/shelters.csv"] as const;

  it("says MATCH for a file that is the expected one, and tells its SHA-256 and its size", async () => {
    await prepare();
    await put("inbox/shelters.csv", TABLE);
    expect(await run([...FILE, "--expected-sha256", TABLE_SHA, "--expected-bytes", String(TABLE.byteLength)])).toEqual({
      exitCode: 0,
      lines: [`file sha256=${TABLE_SHA} bytes=${TABLE.byteLength}`, "code=ORIGINAL_MATCH"],
    });
  });

  it.each([
    ["the SHA-256", "5".repeat(64), String(TABLE.byteLength), "fields=sha256"],
    ["the size", TABLE_SHA, String(TABLE.byteLength + 1), "fields=byteLength"],
    ["both", "5".repeat(64), "0", "fields=sha256,byteLength"],
  ])("says ORIGINAL_MISMATCH and which item differs: %s", async (_name, sha, size, fields) => {
    await prepare();
    await put("inbox/shelters.csv", TABLE);
    expect(await run([...FILE, "--expected-sha256", sha, "--expected-bytes", size])).toEqual({
      exitCode: 1,
      lines: [`file sha256=${TABLE_SHA} bytes=${TABLE.byteLength}`, `code=ORIGINAL_MISMATCH ${fields}`],
    });
  });

  it.each([
    ["no expected SHA-256", [...FILE, "--expected-bytes", "1"]],
    ["no expected size", [...FILE, "--expected-sha256", "6".repeat(64)]],
    ["a SHA-256 of capital letters", [...FILE, "--expected-sha256", "A".repeat(64), "--expected-bytes", "1"]],
    ["a size that is not a number", [...FILE, "--expected-sha256", "6".repeat(64), "--expected-bytes", "many"]],
    ["a size that is negative", [...FILE, "--expected-sha256", "6".repeat(64), "--expected-bytes", "-1"]],
    ["a size with a leading zero", [...FILE, "--expected-sha256", "6".repeat(64), "--expected-bytes", "01"]],
    ["no file", ["original", "verify-file", "--expected-sha256", "6".repeat(64), "--expected-bytes", "1"]],
  ])("refuses %s", async (_name, argv) => {
    await prepare();
    expect((await run(argv)).lines.at(-1)).toBe("code=ARGUMENT_INVALID");
  });

  it("says that a file cannot be read, with no path", async () => {
    await prepare();
    expect(await run([...FILE, "--expected-sha256", TABLE_SHA, "--expected-bytes", "1"])).toEqual({ exitCode: 1, lines: ["code=FILE_UNREADABLE field=file"] });
  });

  it("looks at the originals that were taken in: MATCH, then CHANGED and MISSING when a file is not the one that was taken in", async () => {
    const current = await prepare();
    expect(await run(["original", "verify-stored"])).toEqual({ exitCode: 0, lines: ["code=ORIGINALS_OK count=0"] });
    await intake();
    expect(await run(["original", "verify-stored"])).toEqual({
      exitCode: 0,
      lines: [`original sourceId=fictional-shelters revision=r1 state=MATCH recorded=${TABLE_SHA} current=${TABLE_SHA} bytes=${TABLE.byteLength}`, "code=ORIGINALS_OK count=1"],
    });

    const other = encodeUtf8("名称,件数\nあおば,999\n");
    await current.putRaw("fictional-shelters/r1/shelters.csv", other);
    expect(await run(["original", "verify-stored"])).toEqual({
      exitCode: 1,
      lines: [`original sourceId=fictional-shelters revision=r1 state=CHANGED recorded=${TABLE_SHA} current=${sha256Hex(other)} bytes=${other.byteLength}`, "code=ORIGINALS_NOT_MATCHING changed=1 missing=0"],
    });

    await unlink(current.rawPath("fictional-shelters/r1/shelters.csv"));
    expect(await run(["original", "verify-stored"])).toEqual({
      exitCode: 1,
      lines: [`original sourceId=fictional-shelters revision=r1 state=MISSING recorded=${TABLE_SHA} current=none bytes=none`, "code=ORIGINALS_NOT_MATCHING changed=0 missing=1"],
    });
  });

  it("looks at one source when it is named, and says so when there is no such source", async () => {
    await prepare();
    await intake();
    await intake({ sourceId: "second-source" }, encodeUtf8("名称,件数\nみなと,5\n"));
    const second = await run(["original", "verify-stored", "--source", "second-source"]);
    expect(second.exitCode).toBe(0);
    expect(second.lines.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["original sourceId=second-source", "code=ORIGINALS_OK count=1"]);
    expect(await run(["original", "verify-stored", "--source", "no-such-source"])).toEqual({ exitCode: 1, lines: ["code=SOURCE_NOT_FOUND"] });
    expect((await run(["original", "verify-stored", "extra"])).lines.at(-1)).toBe("code=ARGUMENT_INVALID");
  });

  it("changes nothing", async () => {
    const current = await prepare();
    await intake();
    const before = await Promise.all((await current.files()).map(async (path) => `${path}\u0000${path.startsWith("raw/") ? await current.readText(current.rawPath(path.slice(4))) : await current.readText(current.recordPath(path.slice(8)))}`));
    await run(["original", "verify-stored"]);
    await run([...FILE, "--expected-sha256", TABLE_SHA, "--expected-bytes", "1"]);
    const after = await Promise.all((await current.files()).map(async (path) => `${path}\u0000${path.startsWith("raw/") ? await current.readText(current.rawPath(path.slice(4))) : await current.readText(current.recordPath(path.slice(8)))}`));
    expect(after).toEqual(before);
  });
});

describe("real fact", () => {
  const CREATE = ["fact", "create", "--request", "inbox/fact.json"] as const;
  const computed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: "COMPUTED",
    factId: "fact-rows",
    sourceId: "fictional-shelters",
    method: COUNT_ROWS,
    surveyDate: "2026-07-27",
    area: "架空県",
    subject: "避難所の記録の数",
    unit: "件",
    ...over,
  });

  async function prepareWithSource(): Promise<IntakeWorld> {
    const current = await prepare();
    await takeInTable(current);
    return current;
  }

  it("makes a fact item PROVISIONAL from the original of a source, and tells the value and the rows that were left out", async () => {
    const current = await prepareWithSource();
    await put("inbox/fact.json", computed());
    expect(await run(CREATE)).toEqual({
      exitCode: 0,
      lines: ['code=FACT_CREATED status=CREATED factId=fact-rows method=COMPUTED verification=PROVISIONAL amount=4 missingCount=0 duplicatesRemoved=0 unit="件"'],
    });
    expect(await current.readJson(current.recordPath("facts/fact-rows.json"))).toMatchObject({ verification: { status: "PROVISIONAL" }, value: { amount: 4, unit: "件" }, method: { kind: "COMPUTED", aggregation: "COUNT_ROWS" } });
    expect(await current.files()).toContain("records/aggregations/fact-rows.json");
  });

  it("makes the same fact item again without changing it (UNCHANGED), and refuses another one under the same ID", async () => {
    const current = await prepareWithSource();
    await put("inbox/fact.json", computed());
    await run(CREATE);
    const before = await current.readText(current.recordPath("facts/fact-rows.json"));
    expect((await run(CREATE)).lines[0]).toContain("status=UNCHANGED");
    await put("inbox/fact.json", computed({ subject: "別の記録の数" }));
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=FACT_CREATE_FAILED reason=FACT_EXISTS"] });
    expect(await current.readText(current.recordPath("facts/fact-rows.json"))).toBe(before);
  });

  it("sums a column, with the unit of its cells", async () => {
    await prepareWithSource();
    await put("inbox/fact.json", computed({ factId: "fact-people", method: { ...SUM_SHELTERS, column: "人口", description: "人口の合計" }, subject: "人口", unit: undefined }));
    const result = await run(CREATE);
    expect(result.exitCode, result.lines.join("|")).toBe(0);
    expect(result.lines[0]).toContain("amount=2300");
    expect(result.lines[0]).toContain("missingCount=1");
    expect(result.lines[0]).toContain('unit="人"');
  });

  it("makes a quoted fact item, and refuses a value that is not in the lines that it names", async () => {
    await prepareWithSource();
    const quoted = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      kind: "QUOTED",
      factId: "fact-quoted",
      sourceId: "fictional-shelters",
      description: "表の2行目の避難所数",
      startLine: 2,
      endLine: 2,
      amount: 12,
      unit: "か所",
      surveyDate: "2026-07-27",
      area: "架空県",
      subject: "あおば地区の避難所の数",
      ...over,
    });
    await put("inbox/fact.json", quoted({ amount: 13 }));
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=FACT_CREATE_FAILED reason=QUOTED_VALUE_NOT_FOUND"] });
    await put("inbox/fact.json", quoted());
    const result = await run(CREATE);
    expect(result.exitCode, result.lines.join("|")).toBe(0);
    expect(result.lines[0]).toContain("method=QUOTED verification=PROVISIONAL amount=12");
  });

  it("makes a derived fact item from two fact items that a person verified, and refuses one whose operand is not verified", async () => {
    const current = await prepareWithSource();
    const derived = (): Record<string, unknown> => ({
      kind: "DERIVED",
      factId: "ratio",
      operation: "RATIO",
      operandFactIds: ["shelters", "areas"],
      unitPair: { numerator: "か所", denominator: "か所" },
      subject: "割合",
      description: "d",
    });
    await createComputedFact(current.store, computedRequest({ factId: "shelters", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await createVerifiedFact(current, computedRequest({ factId: "areas", method: COUNT_ROWS, subject: "記録の数", unit: "か所" }));
    await put("inbox/fact.json", derived());
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=FACT_CREATE_FAILED reason=DERIVE_REFUSED cause=FACT_NOT_VERIFIED"] });
    await createVerifiedFact(current, computedRequest({ factId: "shelters-2", method: SUM_SHELTERS, subject: "避難所の数", unit: "か所" }));
    await put("inbox/fact.json", { ...derived(), operandFactIds: ["shelters-2", "areas"] });
    const result = await run(CREATE);
    expect(result.exitCode, result.lines.join("|")).toBe(0);
    expect(result.lines[0]).toContain("method=DERIVED verification=PROVISIONAL");
  });

  it("refuses a request that is not in the shape, a method that is not the kind that it says, and settings that cannot be read", async () => {
    await prepareWithSource();
    await put("inbox/fact.json", computed({ method: { kind: "QUOTED", description: "d" } }));
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=REQUEST_INVALID fields=method"] });
    await put("inbox/fact.json", computed({ kind: "TYPED" }));
    expect((await run(CREATE)).lines[0]).toMatch(/^code=REQUEST_INVALID fields=/u);
    await put("inbox/fact.json", computed({ verification: { status: "VERIFIED" } }));
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=REQUEST_INVALID fields=verification"] });
    await put("inbox/fact.json", computed());
    expect(await run([...CREATE, "--config-dir", "no-such-directory"])).toEqual({ exitCode: 1, lines: ["code=CONFIG_UNREADABLE"] });
    expect(world === undefined ? [] : await world.files()).not.toContain("records/facts/fact-rows.json");
  });

  it("fails with a code, and no fact item, when the source is not there or its original is not the file that was taken in", async () => {
    const current = await prepareWithSource();
    await put("inbox/fact.json", computed({ sourceId: "no-such-source" }));
    expect(await run(CREATE)).toEqual({ exitCode: 1, lines: ["code=FACT_CREATE_FAILED reason=SOURCE_NOT_FOUND"] });
    await put("inbox/fact.json", computed());
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("地区,件数\nあおば,1\n"));
    const result = await run(CREATE);
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^code=FACT_CREATE_FAILED reason=ORIGINAL_CHANGED/u);
    expect(await current.files()).not.toContain("records/facts/fact-rows.json");
  });

  it("shows the state of the fact items: PROVISIONAL and ready, then VERIFIED once a person verified it (verify-fact), and is silent about nothing that is wrong", async () => {
    const current = await prepareWithSource();
    expect(await run(["fact", "status"])).toEqual({ exitCode: 0, lines: ["code=FACT_STATUS_OK count=0"] });
    await createComputedFact(current.store, computedRequest());
    expect(await run(["fact", "status"])).toEqual({
      exitCode: 1,
      lines: ["fact factId=fact-rows method=COMPUTED stored=PROVISIONAL effective=PROVISIONAL verifiable=true recomputation=OK", "code=FACT_STATUS_NOT_VERIFIED count=1 notVerified=1"],
    });
    await unlink(current.recordPath("facts/fact-rows.json"));
    await unlink(current.recordPath("aggregations/fact-rows.json"));
    await createVerifiedFact(current, computedRequest());
    expect(await run(["fact", "status", "fact-rows"])).toEqual({
      exitCode: 0,
      lines: ["fact factId=fact-rows method=COMPUTED stored=VERIFIED effective=VERIFIED verifiable=false recomputation=OK verifier=verifier-1 verifiedAt=2026-11-13T00:00:00.000Z", "code=FACT_STATUS_OK count=1"],
    });
  });

  it("shows the findings and the reasons for a fact item that does not count as verified, and not the value of any row", async () => {
    const current = await prepareWithSource();
    await createVerifiedFact(current, computedRequest());
    await current.putRaw("fictional-shelters/r1/shelters.csv", encodeUtf8("地区,種別,避難所数,人口\nあおば,洪水,99,1200人\n"));
    const result = await run(["fact", "status"]);
    expect(result).toEqual({
      exitCode: 1,
      lines: [
        "fact factId=fact-rows method=COMPUTED stored=VERIFIED effective=PROVISIONAL verifiable=false recomputation=UNAVAILABLE reason=ORIGINAL_CHANGED findings=SOURCE_CHANGED verifier=verifier-1 verifiedAt=2026-11-13T00:00:00.000Z",
        "code=FACT_STATUS_NOT_VERIFIED count=1 notVerified=1",
      ],
    });
    expect(result.lines.join("\n")).not.toContain("あおば");
  });

  it("says when the fact item is not there, when the settings cannot be read, when the records cannot be read, and for arguments that are not right", async () => {
    const current = await prepareWithSource();
    expect(await run(["fact", "status", "no-such-fact"])).toEqual({ exitCode: 1, lines: ["code=FACT_NOT_FOUND"] });
    expect(await run(["fact", "status", "--config-dir", "no-such-directory"])).toEqual({ exitCode: 1, lines: ["code=CONFIG_UNREADABLE"] });
    expect((await run(["fact", "status", "a", "b"])).lines.at(-1)).toBe("code=ARGUMENT_INVALID");
    expect((await run(["fact", "create"])).lines.at(-1)).toBe("code=ARGUMENT_INVALID");
    await current.putRecordText("facts/broken.json", "{ not json");
    expect(await run(["fact", "status"])).toEqual({ exitCode: 1, lines: ["code=FACT_STATUS_FAILED reason=STORE_READ_FAILED cause=RECORD_INVALID"] });
  });
});
