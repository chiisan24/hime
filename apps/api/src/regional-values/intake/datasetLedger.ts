import { mkdir } from "node:fs/promises";

import { DatasetRecordSchema, isValidOfficialUrl } from "@ehime-vote-navigator/contracts";
import type { CatalogRef, DatasetRecord, RealSource } from "@ehime-vote-navigator/contracts";
import { encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";

import { atomicReplaceFile } from "../../store/atomicReplaceFile.js";
import { readRecords } from "../draft/recordReader.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import type { CsvEncoding } from "./csvToText.js";
import { DATASETS_DIRECTORY, datasetRecordPath } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";
import type { ReadFailure } from "./sourceRecords.js";

/**
 * The ledger of the data sets (`DatasetRecord`, 16.1), for the intake (13.10). A data set of a public
 * data catalog is one record: what it is, what its terms of use are, whether a person adopted it, and
 * the sources (the files that were taken in) that it has. That a data set exists is one thing; that
 * it may be published and sent to an external AI is another, so each has its own fields, and the
 * intake writes the first only.
 *
 * What the intake writes: a new record begins as a candidate (`adoption: CANDIDATE`), with the terms
 * of use `UNKNOWN`, no check of a note of its own (`datasetNote: null`) and the sending `UNKNOWN`.
 * A record that exists is changed in one way: the source ID is added to `sourceIds`. Everything else in
 * it is what a person decided, and the intake does not touch it. A person adopts a data set; the
 * intake never does.
 */

export type DatasetRequest = Readonly<{
  title: string;
  /** The publisher of the data set. The publisher of the source is used when it is not given. */
  publisher?: string;
  /** The page of the data set in the catalog (an https URL). */
  sourceUrl: string;
  /** The survey date or the year that the data set is of (a person says; it is not read from the file). */
  surveyDate: string | number;
  updatedOn: string | null;
  coverageArea: string;
  themeIds: readonly string[];
}>;

export const LEDGER_REFUSAL_CODES = ["LEDGER_INVALID", "LEDGER_CONFLICT", "LEDGER_AMBIGUOUS"] as const;

export type LedgerRefusalCode = (typeof LEDGER_REFUSAL_CODES)[number];

/** The names of the items that are wrong or that disagree. Never a value. */
export type LedgerRefusal = Readonly<{ code: LedgerRefusalCode; fields?: readonly string[] }>;

export type LedgerState = "CREATED" | "UPDATED" | "UNCHANGED";

export type LedgerPlan = Readonly<{ state: LedgerState; record: DatasetRecord }>;

/** The key of a data set: the same catalog and data set ID give the same key. A name in Japanese cannot be a file name, so the key is made of the SHA-256. */
export function datasetKeyOf(catalog: CatalogRef): string {
  return `ds-${sha256Hex(encodeCanonicalJson({ datasetId: catalog.datasetId, name: catalog.name })).slice(0, 24)}`;
}

/** The format that a publisher offers, by the name of the original file. A name that is not known is `OTHER`. */
export function fileFormatOfName(fileName: string): DatasetRecord["format"]["fileFormat"] {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  switch (extension) {
    case "csv":
      return "CSV";
    case "xlsx":
      return "XLSX";
    case "pdf":
      return "PDF";
    case "html":
    case "htm":
      return "HTML";
    default:
      return "OTHER";
  }
}

/** The format of the data set, as the intake knows it: a CSV that was taken in as it is, or the format that was converted (whose encoding is not a matter, or is not known). */
export type DatasetFormat = DatasetRecord["format"];

export function formatOfCsv(encoding: CsvEncoding): DatasetFormat {
  return { fileFormat: "CSV", encoding };
}

export function formatOfOriginal(originalFileName: string): DatasetFormat {
  const fileFormat = fileFormatOfName(originalFileName);
  return { fileFormat, encoding: fileFormat === "CSV" ? "UNKNOWN" : "NOT_APPLICABLE" };
}

/**
 * The terms of use before a person has looked at them. The status says it; the other items are fixed
 * words that say the same, because the contract wants a date, a target and an evidence even for `UNKNOWN`.
 * It is a plain value for a contract to parse: it is never `CONFIRMED`.
 */
export function unreviewedUsage(checkedAt: string): Readonly<{ status: "UNKNOWN"; checkedAt: string; checkedTarget: string; evidence: string }> {
  return {
    status: "UNKNOWN",
    checkedAt,
    checkedTarget: "未確認",
    evidence: "取り込み時の初期値。人が利用条件を確認して記録する",
  };
}

export type LedgerInput = Readonly<{
  dataset: DatasetRequest;
  catalog: CatalogRef;
  license: RealSource["license"];
  /** The publisher of the source, for a data set that does not name its own. */
  publisher: string;
  /** The source that is added to the data set. `null` for the registration of a data set that has no file yet. */
  sourceId: string | null;
  format: DatasetFormat;
  /** The date (UTC) of the intake, for the first value of the terms of use. */
  today: string;
}>;

function sameCatalog(first: CatalogRef, second: CatalogRef): boolean {
  return first.name === second.name && first.datasetId === second.datasetId;
}

/** The record of the data set of a catalog: at most one. */
export function findDatasetByCatalog(records: readonly DatasetRecord[], catalog: CatalogRef): Outcome<DatasetRecord | null, LedgerRefusal> {
  const found = records.filter((record) => sameCatalog(record.catalog, catalog));
  if (found.length > 1) {
    return fail({ code: "LEDGER_AMBIGUOUS", fields: ["catalog"] });
  }
  return succeed(found[0] ?? null);
}

function invalidFields(error: { issues: readonly { path: readonly PropertyKey[] }[] }): readonly string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "record")))];
}

/**
 * What the ledger will be after a source is taken in, and the state of the change. Nothing is written.
 * A record that exists has to agree with the catalog and the license of the source, or the plan is a
 * conflict that a person resolves (a license can change, and then the person says so in the ledger first).
 */
export function planLedger(existing: DatasetRecord | null, input: LedgerInput): Outcome<LedgerPlan, LedgerRefusal> {
  if (existing === null) {
    const created = DatasetRecordSchema.safeParse({
      datasetKey: datasetKeyOf(input.catalog),
      catalog: input.catalog,
      title: input.dataset.title,
      publisher: input.dataset.publisher ?? input.publisher,
      sourceUrl: input.dataset.sourceUrl,
      surveyDate: input.dataset.surveyDate,
      updatedOn: input.dataset.updatedOn,
      coverageArea: input.dataset.coverageArea,
      format: input.format,
      usage: unreviewedUsage(input.today),
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      license: input.license,
      adoption: { status: "CANDIDATE" },
      themeIds: [...input.dataset.themeIds],
      sourceIds: input.sourceId === null ? [] : [input.sourceId],
    });
    return created.success ? succeed({ state: "CREATED", record: created.data }) : fail({ code: "LEDGER_INVALID", fields: invalidFields(created.error) });
  }

  if (existing.license.name !== input.license.name || existing.license.url !== input.license.url) {
    return fail({ code: "LEDGER_CONFLICT", fields: ["license"] });
  }
  if (input.sourceId === null || existing.sourceIds.includes(input.sourceId)) {
    return succeed({ state: "UNCHANGED", record: existing });
  }
  const updated = DatasetRecordSchema.safeParse({ ...existing, sourceIds: [...existing.sourceIds, input.sourceId] });
  return updated.success ? succeed({ state: "UPDATED", record: updated.data }) : fail({ code: "LEDGER_INVALID", fields: invalidFields(updated.error) });
}

/** Every record of the ledger, in the order of the paths. A record that is not at the path of its own key fails the read. */
export async function readDatasetRecords(store: IntakeStore): Promise<Outcome<readonly DatasetRecord[], ReadFailure>> {
  // A record of the ledger has no `dataKind`: it is of the data kind of the place that it is read from.
  const read = await readRecords(store.root, DATASETS_DIRECTORY, DatasetRecordSchema, { declaresDataKind: false });
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  for (const stored of read.value) {
    if (stored.relativePath !== datasetRecordPath(stored.record.datasetKey)) {
      return fail({ code: "STORE_READ_FAILED", cause: "PATH_MISMATCH" });
    }
  }
  return succeed(read.value.map((stored) => stored.record));
}

export type LedgerWriteFailure = Readonly<{ code: "STORE_WRITE_FAILED" }>;

/** Writes the record of the ledger (the file is replaced as a whole or not at all). A plan that changes nothing writes nothing. */
export async function writeLedger(store: IntakeStore, plan: LedgerPlan): Promise<Outcome<void, LedgerWriteFailure>> {
  if (plan.state === "UNCHANGED") {
    return succeed(undefined);
  }
  try {
    await mkdir(store.root.rootDir, { recursive: true });
    await atomicReplaceFile({
      allowedRoot: store.root.rootDir,
      relativePath: datasetRecordPath(plan.record.datasetKey),
      bytes: encodeCanonicalJson(plan.record),
      ...(store.operations === undefined ? {} : { operations: store.operations }),
    });
    return succeed(undefined);
  } catch {
    return fail({ code: "STORE_WRITE_FAILED" });
  }
}

export const LEDGER_FINDING_CODES = ["LEDGER_SOURCE_MISSING", "SOURCE_NOT_IN_LEDGER", "CATALOG_MISMATCH", "LICENSE_MISMATCH"] as const;

export type LedgerFindingCode = (typeof LEDGER_FINDING_CODES)[number];

/** A disagreement between the ledger and the source records: a code and the stable IDs, never a value. */
export type LedgerFinding = Readonly<{ code: LedgerFindingCode; datasetKey: string | null; sourceId: string }>;

/**
 * Whether the ledger and the source records agree (13.10). Every source of a data set in the ledger has a record; every
 * source record that names a catalog is listed by the data set of that catalog; and the two say the same catalog and the same
 * license. It reads only. The findings are in the order of the data sets, then of the source IDs.
 */
export function inspectLedger(datasets: readonly DatasetRecord[], sources: readonly RealSource[]): readonly LedgerFinding[] {
  const findings: LedgerFinding[] = [];
  const sourceIdsWithRecords = new Set<string>(sources.map((source) => source.sourceId));
  const byKey = [...datasets].sort((first, second) => (first.datasetKey < second.datasetKey ? -1 : first.datasetKey > second.datasetKey ? 1 : 0));

  for (const dataset of byKey) {
    for (const sourceId of [...dataset.sourceIds].sort()) {
      if (!sourceIdsWithRecords.has(sourceId)) {
        findings.push({ code: "LEDGER_SOURCE_MISSING", datasetKey: dataset.datasetKey, sourceId });
        continue;
      }
      for (const source of sources.filter((candidate) => candidate.sourceId === sourceId)) {
        if (source.catalog === undefined || !sameCatalog(source.catalog, dataset.catalog)) {
          findings.push({ code: "CATALOG_MISMATCH", datasetKey: dataset.datasetKey, sourceId });
          break;
        }
        if (source.license.name !== dataset.license.name || source.license.url !== dataset.license.url) {
          findings.push({ code: "LICENSE_MISMATCH", datasetKey: dataset.datasetKey, sourceId });
          break;
        }
      }
    }
  }

  // A source of a catalog that no data set lists. (A source that a data set lists with another catalog is a `CATALOG_MISMATCH` above.)
  const listedIds = new Set(datasets.flatMap((dataset) => dataset.sourceIds));
  for (const sourceId of [...new Set(sources.filter((source) => source.catalog !== undefined).map((source) => source.sourceId))].sort()) {
    if (listedIds.has(sourceId)) {
      continue;
    }
    const catalogs = sources.filter((source) => source.sourceId === sourceId).flatMap((source) => (source.catalog === undefined ? [] : [source.catalog]));
    const owner = byKey.find((dataset) => catalogs.some((catalog) => sameCatalog(catalog, dataset.catalog)));
    findings.push({ code: "SOURCE_NOT_IN_LEDGER", datasetKey: owner?.datasetKey ?? null, sourceId });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The registration of a data set that has no file yet
// ---------------------------------------------------------------------------

export type DatasetRegistration = Readonly<{
  catalog: CatalogRef;
  dataset: DatasetRequest;
  /** The publisher of the data set. */
  publisher: string;
  license: RealSource["license"];
  /** The format that the publisher offers (`CSV`, `XLSX`, ...). `OTHER` when it is not given. */
  fileFormat?: DatasetFormat["fileFormat"];
  /** The date (UTC) of the registration, for the first value of the terms of use. */
  today: string;
}>;

export type RegistrationRefusal = Readonly<{
  code: LedgerRefusalCode | "STORE_READ_FAILED" | "STORE_WRITE_FAILED";
  fields?: readonly string[];
  /** The fixed code of the reader, for `STORE_READ_FAILED`. */
  reason?: string;
}>;

export type RegisteredDataset = Readonly<{ state: LedgerState; record: DatasetRecord }>;

/**
 * Registers a data set of a public data catalog in the ledger before any file of it is taken in (13.10): a person lists the data sets that
 * may be used, with their terms, and takes the files in later. It makes the same record that the intake of a file makes: a candidate,
 * the terms of use `UNKNOWN`, no check of a note, the sending `UNKNOWN`, and no source. A data set that is registered already is not
 * changed (what a person decided about it stays), and the same license is required of a second registration. Nothing is adopted here.
 */
export async function registerDataset(store: IntakeStore, request: DatasetRegistration): Promise<Outcome<RegisteredDataset, RegistrationRefusal>> {
  // The URLs are https URLs, as the intake of a file asks (the contract of the record asks for a URL only).
  const notHttps = [...(isValidOfficialUrl(request.dataset.sourceUrl) ? [] : ["sourceUrl"]), ...(isValidOfficialUrl(request.license.url) ? [] : ["license"])];
  if (notHttps.length > 0) {
    return fail({ code: "LEDGER_INVALID", fields: notHttps });
  }
  const datasets = await readDatasetRecords(store);
  if (!datasets.ok) {
    return fail({ code: "STORE_READ_FAILED", reason: datasets.error.cause });
  }
  const existing = findDatasetByCatalog(datasets.value, request.catalog);
  if (!existing.ok) {
    return fail(existing.error);
  }
  const fileFormat = request.fileFormat ?? "OTHER";
  const planned = planLedger(existing.value, {
    dataset: request.dataset,
    catalog: request.catalog,
    license: request.license,
    publisher: request.publisher,
    sourceId: null,
    format: { fileFormat, encoding: fileFormat === "CSV" ? "UNKNOWN" : "NOT_APPLICABLE" },
    today: request.today,
  });
  if (!planned.ok) {
    return fail(planned.error);
  }
  const written = await writeLedger(store, planned.value);
  if (!written.ok) {
    return fail(written.error);
  }
  return succeed({ state: planned.value.state, record: planned.value.record });
}
