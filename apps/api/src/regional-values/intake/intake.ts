import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { RealSourceSchema, Sha256Schema, isValidIngestSourceId, isValidOfficialUrl } from "@ehime-vote-navigator/contracts";
import type { CatalogRef, RealSource } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, inspectCsvTable, sha256Hex } from "@ehime-vote-navigator/domain";
import type { CsvTableSummary } from "@ehime-vote-navigator/domain";

import { AtomicFileError, atomicWriteImmutableFile } from "../../store/atomicFiles.js";
import { writeImmutableRecord } from "../draft/draftStore.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { buildConversion } from "./conversion.js";
import type { ConversionRequest } from "./conversion.js";
import { csvToText } from "./csvToText.js";
import type { CsvEncoding } from "./csvToText.js";
import {
  findDatasetByCatalog,
  formatOfCsv,
  formatOfOriginal,
  planLedger,
  readDatasetRecords,
  unreviewedUsage,
  writeLedger,
} from "./datasetLedger.js";
import type { DatasetRequest, LedgerPlan, LedgerState } from "./datasetLedger.js";
import { decideIntake, latestRevisionOf, otherHoldersOf, readRealSources } from "./sourceRecords.js";
import { isSafeRecordName, rawFileRelativePath, sourceRecordPath } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * The intake of a CSV file of real data (13.15, 13.10): the original is placed, its SHA-256 and its
 * revision are recorded, and the source record of real data is made, with the catalog and, for a file
 * that a person converted from another format, the record of the conversion.
 *
 * The rules are the ones of the existing `ingest` (the SHA-256 and the revision), kept in a module of
 * their own because `ingest` is bound to elections, candidates and PDF files, and it is not changed:
 *
 *  - The same SHA-256 as the latest revision of the source ID changes nothing (`UNCHANGED`). Any other
 *    SHA-256, also one that is the content of an earlier revision, is the next revision `r<n+1>`.
 *  - A SHA-256 that another source ID holds is refused (`DUPLICATE_CONTENT`): a fact item names its
 *    original by the SHA-256, and the source that it rests on has to be one.
 *  - The original is placed once. Nothing is overwritten.
 *  - What a person has to decide is not decided here. The terms of use start as `UNKNOWN`, the check of
 *    a note of the data set as not done (`null`), the sending to an external AI as `UNKNOWN`; the
 *    publisher, the URL, the license and the dates are given, never guessed. A person records the rest
 *    (`recordSourceReview`).
 *  - A file that is refused, and an intake that fails, leave nothing: every check is made before the
 *    first write, and what was written before a failed write is taken away again. If that fails, the
 *    refusal names the files that remain.
 *
 * It reads the bytes that it is given and writes below the two places of the store. It opens no network,
 * calls no AI, and makes no request to a server.
 */

export type IntakeRequest = Readonly<{
  /** 1 to 64 lowercase letters, digits or hyphens. */
  sourceId: string;
  /** The name of the placed file: ASCII, ending in `.csv`. */
  fileName: string;
  /** The bytes of the CSV file that is taken in (the converted file, for a conversion). */
  bytes: Uint8Array;
  /** Where the file is published, or the ID of a document. A URL is an https URL. */
  reference: Readonly<{ kind: "url"; url: string }> | Readonly<{ kind: "document-id"; documentId: string }>;
  publisher: string;
  /** The date that the publisher gives for the file (`YYYY-MM-DD`). */
  publishedOn: string;
  /** When the file was obtained (ISO 8601 with a time zone). It is given, not read from the clock. */
  retrievedAt: string;
  license: Readonly<{ name: string; url: string }>;
  /** The data set of a public data catalog that the file comes from. */
  catalog?: CatalogRef;
  /**
   * The SHA-256 and the size in bytes of the original, as the person was told them (Open Decisions (2)): of the file `bytes` when that file is
   * the original, and of the file that a person converted (`conversion.originalBytes`) when the CSV was made from another format. It is
   * required: a file of real data is taken in only when it is the file that was expected, and a file that is not is refused before
   * anything is written. The SHA-256 is 64 lowercase hexadecimal characters.
   */
  expectedOriginal: Readonly<{ sha256: string; byteLength: number }>;
  /** The record of a conversion by a person, for a file that was made from another format. */
  conversion?: ConversionRequest;
  /** The ledger of the data sets: the data set is recorded (a candidate) and the source is added to it. It needs `catalog`. */
  dataset?: DatasetRequest;
}>;

export const INTAKE_REFUSAL_CODES = [
  "ROOT_NOT_REAL",
  "SOURCE_ID_INVALID",
  "FILE_NAME_INVALID",
  "SUPPLY_INCOMPLETE",
  "CSV_TEXT_REFUSED",
  "CSV_TABLE_REFUSED",
  "CONVERSION_INVALID",
  "ORIGINAL_MISMATCH",
  "ROW_COUNT_MISMATCH",
  "CATALOG_REQUIRED",
  "DUPLICATE_CONTENT",
  "CONVERSION_CONFLICT",
  "LEDGER_INVALID",
  "LEDGER_CONFLICT",
  "LEDGER_AMBIGUOUS",
  "STORE_READ_FAILED",
  "STORE_WRITE_FAILED",
  "RAW_FILE_CONFLICT",
] as const;

export type IntakeRefusalCode = (typeof INTAKE_REFUSAL_CODES)[number];

/** Why a file was not taken in: a fixed code and, at most, the names of the items, a code of the check, a line and numbers. Never a value of a file. */
export type IntakeRefusal = Readonly<{
  code: IntakeRefusalCode;
  /** The names of the items that are wrong. */
  fields?: readonly string[];
  /** The fixed code of the check that refused the file, or of the store that failed. */
  reason?: string;
  /** The line of a table that does not fit. */
  line?: number | null;
  existingSourceId?: string;
  originalRowCount?: number;
  convertedRowCount?: number;
  /** The files that a failed write left, when taking them away failed too. */
  leftovers?: readonly string[];
}>;

export type IntakeSuccess = Readonly<{
  /** `CREATED`: a new revision. `UNCHANGED`: the same bytes were the latest revision, and no source record was written. */
  status: "CREATED" | "UNCHANGED";
  source: RealSource;
  encoding: CsvEncoding;
  /** What the table is: its rows, columns, blank cells and repeated rows. They are told to the person; a blank cell and a repeated row do not stop the intake. */
  table: CsvTableSummary;
  /** The place of the file that was placed below the originals (`<sourceId>/<revision>/<file>`). `null` when nothing was placed (`UNCHANGED`). */
  rawPath: string | null;
  ledger: "NOT_REQUESTED" | LedgerState;
}>;

function refuse(code: IntakeRefusalCode, extra: Omit<IntakeRefusal, "code"> = {}): Outcome<never, IntakeRefusal> {
  return fail({ code, ...extra });
}

/** The items that the contract of the source would not name: the URLs have to be https URLs. */
function unsuitableUrls(request: IntakeRequest): string[] {
  const names: string[] = [];
  if (request.reference.kind === "url" && !isValidOfficialUrl(request.reference.url)) {
    names.push("reference");
  }
  if (!isValidOfficialUrl(request.license.url)) {
    names.push("license");
  }
  if (request.dataset !== undefined && !isValidOfficialUrl(request.dataset.sourceUrl)) {
    names.push("dataset");
  }
  return names;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

type Created = Readonly<{ path: string; label: string }>;

/** Takes away the files that this run made, last first. Returns the names of those that could not be taken away. */
async function takeAway(store: IntakeStore, created: readonly Created[]): Promise<readonly string[]> {
  const remove = store.operations?.unlink ?? ((path: string) => unlink(path));
  const leftovers: string[] = [];
  for (const file of [...created].reverse()) {
    try {
      await remove(file.path);
    } catch (error) {
      if (!isNotFound(error)) {
        leftovers.push(file.label);
      }
    }
  }
  return leftovers;
}

async function writeFailed(store: IntakeStore, created: readonly Created[], reason: string, code: IntakeRefusalCode = "STORE_WRITE_FAILED"): Promise<Outcome<never, IntakeRefusal>> {
  const leftovers = await takeAway(store, created);
  return refuse(code, { reason, ...(leftovers.length === 0 ? {} : { leftovers }) });
}

function samePlainJson(first: unknown, second: unknown): boolean {
  return sha256Hex(encodeCanonicalJson(first)) === sha256Hex(encodeCanonicalJson(second));
}

/**
 * Takes in one CSV file. Returns the source record and what the file is, or the reason that it was
 * not taken in. `clock` gives the date of the first value of the terms of use; nothing else reads it.
 */
export async function intakeCsv(store: IntakeStore, request: IntakeRequest, clock: () => Date = () => new Date()): Promise<Outcome<IntakeSuccess, IntakeRefusal>> {
  // 1. What a request must be, before anything is read.
  if (store.root.dataKind !== "REAL_AI") {
    return refuse("ROOT_NOT_REAL");
  }
  if (typeof request.sourceId !== "string" || !isValidIngestSourceId(request.sourceId)) {
    return refuse("SOURCE_ID_INVALID");
  }
  if (typeof request.fileName !== "string" || !isSafeRecordName(request.fileName, 200) || !/\.csv$/iu.test(request.fileName)) {
    return refuse("FILE_NAME_INVALID");
  }
  if (!(request.bytes instanceof Uint8Array)) {
    return refuse("SUPPLY_INCOMPLETE", { fields: ["bytes"] });
  }
  const urls = typeof request.license === "object" && request.license !== null && typeof request.reference === "object" && request.reference !== null ? unsuitableUrls(request) : [];
  if (urls.length > 0) {
    return refuse("SUPPLY_INCOMPLETE", { fields: urls });
  }
  if (request.dataset !== undefined && request.catalog === undefined) {
    return refuse("CATALOG_REQUIRED");
  }

  // 1b. The file that the person expects: the SHA-256 and the size of the original. This is the first thing that is read of the file, and a file
  // that is not the expected one is not looked at any further.
  const expected = request.expectedOriginal as IntakeRequest["expectedOriginal"] | undefined;
  if (
    typeof expected !== "object" ||
    expected === null ||
    typeof expected.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(expected.sha256) ||
    !Number.isSafeInteger(expected.byteLength) ||
    expected.byteLength < 0
  ) {
    return refuse("SUPPLY_INCOMPLETE", { fields: ["expectedOriginal"] });
  }
  const original: unknown = request.conversion === undefined ? request.bytes : request.conversion.originalBytes;
  if (original instanceof Uint8Array) {
    const mismatched = [...(sha256Hex(original) === expected.sha256 ? [] : ["sha256"]), ...(original.byteLength === expected.byteLength ? [] : ["byteLength"])];
    if (mismatched.length > 0) {
      return refuse("ORIGINAL_MISMATCH", { fields: mismatched });
    }
  }

  // 2. What the file is: its text, its table, its SHA-256.
  const expanded = csvToText(request.bytes);
  if (!expanded.ok) {
    return refuse("CSV_TEXT_REFUSED", { reason: expanded.error.code });
  }
  const inspected = inspectCsvTable(expanded.value.text);
  if (!inspected.ok) {
    return refuse("CSV_TABLE_REFUSED", { reason: inspected.error.code, line: inspected.error.line });
  }
  const table = inspected.value;
  const { encoding } = expanded.value;
  const sha256 = Sha256Schema.parse(sha256Hex(request.bytes));

  // 3. The record of the conversion, from the files.
  let conversion: RealSource["conversion"];
  if (request.conversion !== undefined) {
    const built = buildConversion(request.conversion, { sha256, recordCount: table.recordCount });
    if (!built.ok) {
      const { code, ...rest } = built.error;
      return refuse(code, rest);
    }
    conversion = built.value;
  }

  // 4. What the store has: the revisions of this source and the holders of this SHA-256.
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return refuse("STORE_READ_FAILED", { reason: sources.error.cause });
  }
  const latest = latestRevisionOf(sources.value, request.sourceId);
  if (!latest.ok) {
    return refuse("STORE_READ_FAILED", { reason: latest.error.cause });
  }
  const decision = decideIntake(latest.value, sha256);
  if (decision.kind === "CREATE") {
    const holders = otherHoldersOf(sources.value, request.sourceId, sha256);
    const [existingSourceId] = holders;
    if (existingSourceId !== undefined) {
      return refuse("DUPLICATE_CONTENT", { existingSourceId });
    }
  } else if (conversion !== undefined && !samePlainJson(decision.source.conversion ?? null, conversion)) {
    // The same file again, with another record of a conversion: nothing is taken in, and the record that was made is not changed.
    return refuse("CONVERSION_CONFLICT");
  }

  // 5. The source record, as it will be written. A revision that is not new is the record that exists.
  const today = clock().toISOString().slice(0, 10);
  let source: RealSource;
  if (decision.kind === "UNCHANGED") {
    source = decision.source;
  } else {
    const parsed = RealSourceSchema.safeParse({
      dataKind: "REAL_AI",
      sourceId: request.sourceId,
      revision: decision.revision,
      reference: request.reference,
      publisher: request.publisher,
      publishedOn: request.publishedOn,
      retrievedAt: request.retrievedAt,
      locator: { kind: "text-lines", startLine: 1, endLine: table.lastDataLine },
      sha256,
      usage: unreviewedUsage(today),
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      license: request.license,
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      ...(conversion === undefined ? {} : { conversion }),
    });
    if (!parsed.success) {
      return refuse("SUPPLY_INCOMPLETE", { fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "source")))] });
    }
    source = parsed.data;
  }

  // 6. The ledger of the data sets, as it will be written. It is planned now so that a plan that cannot be made stops the intake before the first write.
  let plan: LedgerPlan | null = null;
  if (request.dataset !== undefined && request.catalog !== undefined) {
    const datasets = await readDatasetRecords(store);
    if (!datasets.ok) {
      return refuse("STORE_READ_FAILED", { reason: datasets.error.cause });
    }
    const existing = findDatasetByCatalog(datasets.value, request.catalog);
    if (!existing.ok) {
      const { code, fields } = existing.error;
      return refuse(code, fields === undefined ? {} : { fields });
    }
    const planned = planLedger(existing.value, {
      dataset: request.dataset,
      catalog: request.catalog,
      license: source.license,
      publisher: source.publisher,
      sourceId: source.sourceId,
      format: request.conversion === undefined ? formatOfCsv(encoding) : formatOfOriginal(request.conversion.originalFileName),
      today,
    });
    if (!planned.ok) {
      const { code, fields } = planned.error;
      return refuse(code, fields === undefined ? {} : { fields });
    }
    plan = planned.value;
  }

  const rawPath = rawFileRelativePath(source.sourceId, source.revision, request.fileName);
  const ledger: IntakeSuccess["ledger"] = plan === null ? "NOT_REQUESTED" : plan.state;

  // 7. The writes. The placed file first, the source record next (the record is what makes a revision), the ledger last.
  const created: Created[] = [];
  if (decision.kind === "CREATE") {
    try {
      await mkdir(store.rawRoot, { recursive: true });
      const placed = await atomicWriteImmutableFile({
        allowedRoot: store.rawRoot,
        relativePath: rawPath,
        bytes: request.bytes,
        ...(store.operations === undefined ? {} : { operations: store.operations }),
      });
      if (placed.state === "created") {
        created.push({ path: placed.absolutePath, label: `raw/${rawPath}` });
      }
    } catch (error) {
      return writeFailed(store, created, error instanceof AtomicFileError ? error.code : "FILESYSTEM_ERROR", error instanceof AtomicFileError && error.code === "IMMUTABLE_CONFLICT" ? "RAW_FILE_CONFLICT" : "STORE_WRITE_FAILED");
    }
    const recordPath = sourceRecordPath(source.sourceId, source.revision);
    const written = await writeImmutableRecord(store.root, recordPath, source, store.operations);
    if (!written.ok) {
      return writeFailed(store, created, written.error.code);
    }
    if (written.value === "created") {
      created.push({ path: join(store.root.rootDir, ...recordPath.split("/")), label: `sources/${source.sourceId}/${source.revision}.json` });
    }
  }
  if (plan !== null) {
    const saved = await writeLedger(store, plan);
    if (!saved.ok) {
      return writeFailed(store, created, saved.error.code);
    }
  }

  return succeed({ status: decision.kind === "CREATE" ? "CREATED" : "UNCHANGED", source, encoding, table, rawPath: decision.kind === "CREATE" ? rawPath : null, ledger });
}
