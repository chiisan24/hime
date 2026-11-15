import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { DATASET_FILE_FORMATS, DERIVED_OPERATIONS, FactMethodSchema } from "@ehime-vote-navigator/contracts";
import type { DataKind } from "@ehime-vote-navigator/contracts";
import { z } from "zod";

import type { AtomicFileOperationOverrides } from "../store/atomicFiles.js";
import { loadBuildConfig, loadNeutralityConfig } from "./build/loadConfig.js";
import type { RegionalValuesCliIo } from "./cli.js";
import { defaultRecordRoot } from "./draft/types.js";
import type { RecordRoot } from "./draft/types.js";
import { parseArgs } from "./draftCli.js";
import { inspectLedger, readDatasetRecords, registerDataset } from "./intake/datasetLedger.js";
import type { DatasetRegistration } from "./intake/datasetLedger.js";
import { listFactStatuses } from "./intake/factStatus.js";
import { createComputedFact, createDerivedFact, createQuotedFact } from "./intake/factValue.js";
import type { ComputedFactRequest, CreatedFact, CreateFactRefusal, DerivedFactRequest, QuotedFactRequest, SentenceLists } from "./intake/factValue.js";
import { intakeCsv } from "./intake/intake.js";
import type { IntakeRefusal, IntakeRequest } from "./intake/intake.js";
import { compareWithExpected, verifyStoredOriginals } from "./intake/originals.js";
import { readRealSources } from "./intake/sourceRecords.js";
import { createIntakeStore } from "./intake/storeLayout.js";
import type { IntakeStore } from "./intake/storeLayout.js";

/**
 * `real ...` (`npm run regional-values -- real <group> <action> ...`): what a person does with real data from the command line (13.10, 13.11,
 * 13.15): register a data set in the ledger, take a CSV in, compare an original with the SHA-256 and the size that were told, make a fact item,
 * and look at the state of the fact items. Each action calls the function of the same name in `intake/`, and adds nothing to its rules.
 *
 *   real dataset register --request <dataset.json>
 *   real dataset list
 *   real dataset check
 *   real intake csv --request <intake.json>
 *   real original verify-file --file <path> --expected-sha256 <hex> --expected-bytes <n>
 *   real original verify-stored [--source <sourceId>]
 *   real fact create --request <fact.json> [--config-dir <path>]
 *   real fact status [<factId>] [--config-dir <path>]
 *
 * Like the other commands, it opens no port, calls no AI and no network, and prints no row of a file, no path and no value of an error: it
 * prints fixed codes, IDs, SHA-256 and numbers. It decides nothing that a person decides: a data set is registered as a candidate with
 * every review `UNKNOWN`, a fact item is made `PROVISIONAL`, and the CSV is taken in only when it is the file that the request expects (the
 * SHA-256 and the size are required). To verify a fact item is `verify-fact`, which asks a person.
 */

export type RealCommandSeams = Readonly<{
  /** The directory of the records of real data. A test gives a temporary directory. */
  recordRoot?: (dataKind: DataKind) => RecordRoot;
  /** The directory of the originals (`data/real/raw/regional-values`). The default is next to the records. */
  rawRoot?: string;
  /** The seam for the faults of the file system, in a test. */
  operations?: AtomicFileOperationOverrides;
}>;

export type RealCommandOptions = Readonly<{
  io: RegionalValuesCliIo;
  workspaceRoot: string;
  now?: () => Date;
  real?: RealCommandSeams;
}>;

export const REAL_USAGE_LINES: readonly string[] = [
  "Usage: npm run regional-values -- real dataset register --request <dataset.json>",
  "       npm run regional-values -- real dataset list",
  "       npm run regional-values -- real dataset check",
  "       npm run regional-values -- real intake csv --request <intake.json>",
  "       npm run regional-values -- real original verify-file --file <path> --expected-sha256 <hex> --expected-bytes <n>",
  "       npm run regional-values -- real original verify-stored [--source <sourceId>]",
  "       npm run regional-values -- real fact create --request <fact.json> [--config-dir <path>]",
  "       npm run regional-values -- real fact status [<factId>] [--config-dir <path>]",
  "  intake csv needs expectedOriginal (sha256 and byteLength) in the request: a file that is not the expected one is not taken in",
  "  a data set is registered as a candidate and a fact item as PROVISIONAL; the reviews, the adoption and the verification are a person's (verify-fact)",
];

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

type Token = readonly [name: string, value: string | number | boolean | null | undefined | readonly string[]];

/** One line of `name=value` tokens. An absent value, and a list with nothing in it, is left out. Nothing here is a path or a value of a file. */
function tokens(parts: readonly Token[]): string {
  return parts
    .flatMap(([name, value]) => {
      if (value === undefined || value === null) {
        return [];
      }
      if (typeof value === "object") {
        return value.length === 0 ? [] : [`${name}=${value.join(",")}`];
      }
      return [`${name}=${String(value)}`];
    })
    .join(" ");
}

function argumentInvalid(io: RegionalValuesCliIo): number {
  for (const line of REAL_USAGE_LINES) {
    io.write(line);
  }
  io.write("code=ARGUMENT_INVALID");
  return 1;
}

// ---------------------------------------------------------------------------
// Reading what a person gives
// ---------------------------------------------------------------------------

/** The largest file that the command reads (a request, an original, a procedure). The CSV that is taken in has its own limit. */
const MAX_READ_BYTES = 64 * 1024 * 1024;

async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_READ_BYTES) {
      return null;
    }
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

type Fields = readonly string[];

/** The file of a request, as a value that the schema judges. `null` when it cannot be read or is not JSON. */
async function readRequest(workspaceRoot: string, path: string): Promise<unknown> {
  const bytes = await readBytes(resolve(workspaceRoot, path));
  if (bytes === null) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/** A key of a request that is printed as it is: short, and made of the characters of a name. Anything else is not echoed. */
const SAFE_KEY = /^[A-Za-z0-9_.-]{1,40}$/u;

/** The names of the items of a request that are not right: the key that is wrong, or the item that holds the wrong one. Never a value. */
function fieldsOf(error: z.ZodError): Fields {
  const names = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys" && issue.path.length === 0) {
      for (const key of issue.keys) {
        names.add(SAFE_KEY.test(key) ? key : "request");
      }
    } else {
      names.add(String(issue.path[0] ?? "request"));
    }
  }
  return [...names];
}

type Parsed<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: "REQUEST_UNREADABLE" | "REQUEST_INVALID"; fields: Fields }>;

async function parseRequest<T>(workspaceRoot: string, path: string, schema: z.ZodType<T>): Promise<Parsed<T>> {
  const raw = await readRequest(workspaceRoot, path);
  if (raw === null) {
    return { ok: false, code: "REQUEST_UNREADABLE", fields: [] };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "REQUEST_INVALID", fields: fieldsOf(parsed.error) };
}

function requestFailed(io: RegionalValuesCliIo, failure: Extract<Parsed<unknown>, { ok: false }>): number {
  io.write(`code=${failure.code}${failure.fields.length === 0 ? "" : ` fields=${failure.fields.join(",")}`}`);
  return 1;
}

// The shapes of the requests. They say what the file is made of (the keys, the types, no key that is not listed). What the values have to be
// is judged by the functions that the request goes to, with the contracts of the records.
const Text = z.string().min(1);
const CatalogShape = z.object({ name: Text, datasetId: Text }).strict();
const LicenseShape = z.object({ name: Text, url: Text }).strict();
const DatasetShape = z
  .object({
    title: Text,
    publisher: Text.optional(),
    sourceUrl: Text,
    surveyDate: z.union([z.string(), z.number()]),
    updatedOn: z.string().nullable(),
    coverageArea: Text,
    themeIds: z.array(z.string()),
  })
  .strict();
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const DatasetRegisterShape = z
  .object({
    catalog: CatalogShape,
    title: Text,
    publisher: Text,
    sourceUrl: Text,
    surveyDate: z.union([z.string(), z.number()]),
    updatedOn: z.string().nullable(),
    coverageArea: Text,
    themeIds: z.array(z.string()),
    license: LicenseShape,
    fileFormat: z.enum(DATASET_FILE_FORMATS).optional(),
  })
  .strict();

const IntakeShape = z
  .object({
    sourceId: Text,
    /** The CSV that is taken in (a path, from the root of the repository or absolute). */
    file: Text,
    /** The name that the file is placed under. The name of `file` when it is not given. */
    fileName: Text.optional(),
    reference: z.discriminatedUnion("kind", [z.object({ kind: z.literal("url"), url: Text }).strict(), z.object({ kind: z.literal("document-id"), documentId: Text }).strict()]),
    publisher: Text,
    publishedOn: Text,
    retrievedAt: Text,
    license: LicenseShape,
    catalog: CatalogShape.optional(),
    /** Required. The SHA-256 and the size of the original: of `file`, or of `conversion.originalFile` when the CSV was converted from it. */
    expectedOriginal: z.object({ sha256: z.string(), byteLength: z.number() }).strict(),
    conversion: z
      .object({
        originalFile: Text,
        originalFileName: Text.optional(),
        procedureId: Text,
        procedureFile: Text,
        convertedBy: Text,
        convertedAt: Text,
        correspondence: z.literal("ROWS_PRESERVED"),
        originalRowCount: z.number(),
      })
      .strict()
      .optional(),
    dataset: DatasetShape.optional(),
  })
  .strict();

const FactCreateShape = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("COMPUTED"),
      factId: Text,
      sourceId: Text,
      revision: Text.optional(),
      method: FactMethodSchema,
      surveyDate: z.union([z.string(), z.number()]),
      area: Text,
      subject: Text,
      unit: Text.optional(),
      sourceUrl: Text.optional(),
      datasetUrl: Text.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("QUOTED"),
      factId: Text,
      sourceId: Text,
      revision: Text.optional(),
      description: Text,
      startLine: z.number(),
      endLine: z.number(),
      amount: z.number(),
      unit: Text,
      surveyDate: z.union([z.string(), z.number()]),
      area: Text,
      subject: Text,
      sourceUrl: Text.optional(),
      datasetUrl: Text.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DERIVED"),
      factId: Text,
      operation: z.enum(DERIVED_OPERATIONS),
      operandFactIds: z.tuple([Text, Text]),
      unitPair: z.object({ numerator: Text, denominator: Text }).strict().optional(),
      subject: Text,
      description: Text,
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// The places
// ---------------------------------------------------------------------------

function storeOf(options: RealCommandOptions): IntakeStore {
  const seams = options.real ?? {};
  const root = seams.recordRoot?.("REAL_AI") ?? defaultRecordRoot(options.workspaceRoot, "REAL_AI");
  return createIntakeStore(root, {
    ...(seams.rawRoot === undefined ? {} : { rawRoot: seams.rawRoot }),
    ...(seams.operations === undefined ? {} : { operations: seams.operations }),
  });
}

/** The lists of words that the check of a sentence reads, from the settings of the build. `null` when they cannot be read. */
async function listsOf(options: RealCommandOptions, configDir: string | undefined): Promise<SentenceLists | null> {
  const directory = resolve(options.workspaceRoot, configDir ?? join("config", "regional-values"));
  const build = await loadBuildConfig(directory);
  const neutrality = await loadNeutralityConfig(directory);
  if (!build.ok || !neutrality.ok) {
    return null;
  }
  return { properNouns: build.value.properNouns, numeralExemptWords: neutrality.value.numeralExemptWords };
}

const todayOf = (options: RealCommandOptions): string => (options.now ?? ((): Date => new Date()))().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// real dataset
// ---------------------------------------------------------------------------

async function datasetRegister(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--request"], []);
  const path = parsed?.values.get("--request");
  if (parsed === null || parsed.positionals.length > 0 || path === undefined) {
    return argumentInvalid(io);
  }
  const request = await parseRequest(options.workspaceRoot, path, DatasetRegisterShape);
  if (!request.ok) {
    return requestFailed(io, request);
  }
  const { catalog, license, publisher, fileFormat, ...rest } = request.value;
  const registration = {
    catalog,
    dataset: rest,
    publisher,
    license,
    today: todayOf(options),
    ...(fileFormat === undefined ? {} : { fileFormat }),
  } as unknown as DatasetRegistration;
  const registered = await registerDataset(storeOf(options), registration);
  if (!registered.ok) {
    const { error } = registered;
    io.write(`code=DATASET_REGISTER_FAILED ${tokens([["reason", error.code], ["fields", error.fields], ["cause", error.reason]])}`);
    return 1;
  }
  io.write(`code=DATASET_REGISTERED ${tokens([["state", registered.value.state], ["datasetKey", registered.value.record.datasetKey], ["adoption", registered.value.record.adoption.status]])}`);
  return 0;
}

async function datasetList(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  if (args.length > 0) {
    return argumentInvalid(io);
  }
  const datasets = await readDatasetRecords(storeOf(options));
  if (!datasets.ok) {
    io.write(`code=DATASET_LIST_FAILED reason=${datasets.error.code} cause=${datasets.error.cause}`);
    return 1;
  }
  for (const record of datasets.value) {
    io.write(
      `dataset ${tokens([
        ["datasetKey", record.datasetKey],
        ["adoption", record.adoption.status],
        ["usage", record.usage.status],
        ["note", record.datasetNote === null ? "UNCHECKED" : "CHECKED"],
        ["transmission", record.transmission.status],
        ["format", `${record.format.fileFormat}/${record.format.encoding}`],
        ["sources", record.sourceIds.length],
      ])} title=${JSON.stringify(record.title)}`,
    );
  }
  io.write(`code=DATASET_LIST count=${datasets.value.length}`);
  return 0;
}

async function datasetCheck(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  if (args.length > 0) {
    return argumentInvalid(io);
  }
  const store = storeOf(options);
  const datasets = await readDatasetRecords(store);
  const sources = await readRealSources(store);
  if (!datasets.ok || !sources.ok) {
    const cause = !datasets.ok ? datasets.error.cause : !sources.ok ? sources.error.cause : "";
    io.write(`code=DATASET_CHECK_FAILED reason=STORE_READ_FAILED cause=${cause}`);
    return 1;
  }
  const findings = inspectLedger(datasets.value, sources.value);
  for (const finding of findings) {
    io.write(`finding ${tokens([["code", finding.code], ["datasetKey", finding.datasetKey], ["sourceId", finding.sourceId]])}`);
  }
  io.write(findings.length === 0 ? `code=DATASET_CHECK_OK datasets=${datasets.value.length} sources=${sources.value.length}` : `code=DATASET_CHECK_FAILED findings=${findings.length}`);
  return findings.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// real intake
// ---------------------------------------------------------------------------

function intakeRefused(io: RegionalValuesCliIo, error: IntakeRefusal): number {
  io.write(
    `code=INTAKE_FAILED ${tokens([
      ["reason", error.code],
      ["fields", error.fields],
      ["cause", error.reason],
      ["line", error.line],
      ["existingSourceId", error.existingSourceId],
      ["originalRows", error.originalRowCount],
      ["convertedRows", error.convertedRowCount],
      ["leftovers", error.leftovers],
    ])}`,
  );
  return 1;
}

async function intakeCommand(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--request"], []);
  const path = parsed?.values.get("--request");
  if (parsed === null || parsed.positionals.length > 0 || path === undefined) {
    return argumentInvalid(io);
  }
  const request = await parseRequest(options.workspaceRoot, path, IntakeShape);
  if (!request.ok) {
    return requestFailed(io, request);
  }
  const given = request.value;
  // The expected original is required, and has to be a SHA-256 and a size: the request is not read any further without them.
  if (!SHA256_HEX.test(given.expectedOriginal.sha256) || !Number.isSafeInteger(given.expectedOriginal.byteLength) || given.expectedOriginal.byteLength < 0) {
    io.write("code=REQUEST_INVALID fields=expectedOriginal");
    return 1;
  }

  const bytes = await readBytes(resolve(options.workspaceRoot, given.file));
  if (bytes === null) {
    io.write("code=FILE_UNREADABLE field=file");
    return 1;
  }
  let conversion: IntakeRequest["conversion"];
  if (given.conversion !== undefined) {
    const original = await readBytes(resolve(options.workspaceRoot, given.conversion.originalFile));
    if (original === null) {
      io.write("code=FILE_UNREADABLE field=conversion.originalFile");
      return 1;
    }
    const procedure = await readBytes(resolve(options.workspaceRoot, given.conversion.procedureFile));
    if (procedure === null) {
      io.write("code=FILE_UNREADABLE field=conversion.procedureFile");
      return 1;
    }
    conversion = {
      originalFileName: given.conversion.originalFileName ?? basename(given.conversion.originalFile),
      originalBytes: original,
      procedureId: given.conversion.procedureId,
      procedureDocBytes: procedure,
      convertedBy: given.conversion.convertedBy,
      convertedAt: given.conversion.convertedAt,
      correspondence: given.conversion.correspondence,
      originalRowCount: given.conversion.originalRowCount,
    };
  }

  const intake = {
    sourceId: given.sourceId,
    fileName: given.fileName ?? basename(given.file),
    bytes,
    reference: given.reference,
    publisher: given.publisher,
    publishedOn: given.publishedOn,
    retrievedAt: given.retrievedAt,
    license: given.license,
    expectedOriginal: given.expectedOriginal,
    ...(given.catalog === undefined ? {} : { catalog: given.catalog }),
    ...(conversion === undefined ? {} : { conversion }),
    ...(given.dataset === undefined ? {} : { dataset: given.dataset }),
  } as unknown as IntakeRequest;

  const result = await intakeCsv(storeOf(options), intake, options.now ?? ((): Date => new Date()));
  if (!result.ok) {
    return intakeRefused(io, result.error);
  }
  const { source, table } = result.value;
  io.write(
    `code=INTAKE_OK ${tokens([
      ["status", result.value.status],
      ["sourceId", source.sourceId],
      ["revision", source.revision],
      ["sha256", source.sha256],
      ["encoding", result.value.encoding],
      ["rows", table.rowCount],
      ["columns", table.columnCount],
      ["blankCells", table.blankCellCount],
      ["duplicateRows", table.duplicateRowCount],
      ["ledger", result.value.ledger],
      ["rawPath", result.value.rawPath],
    ])}`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// real original
// ---------------------------------------------------------------------------

async function originalVerifyFile(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--file", "--expected-sha256", "--expected-bytes"], []);
  const file = parsed?.values.get("--file");
  const sha256 = parsed?.values.get("--expected-sha256");
  const size = parsed?.values.get("--expected-bytes");
  if (parsed === null || parsed.positionals.length > 0 || file === undefined || sha256 === undefined || size === undefined || !SHA256_HEX.test(sha256) || !/^(0|[1-9][0-9]*)$/u.test(size) || !Number.isSafeInteger(Number(size))) {
    return argumentInvalid(io);
  }
  const bytes = await readBytes(resolve(options.workspaceRoot, file));
  if (bytes === null) {
    io.write("code=FILE_UNREADABLE field=file");
    return 1;
  }
  const compared = compareWithExpected(bytes, { sha256, byteLength: Number(size) });
  io.write(`file ${tokens([["sha256", compared.sha256], ["bytes", compared.byteLength]])}`);
  if (compared.matches) {
    io.write("code=ORIGINAL_MATCH");
    return 0;
  }
  io.write(`code=ORIGINAL_MISMATCH ${tokens([["fields", [...(compared.sha256Matches ? [] : ["sha256"]), ...(compared.byteLengthMatches ? [] : ["byteLength"])]]])}`);
  return 1;
}

async function originalVerifyStored(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--source"], []);
  if (parsed === null || parsed.positionals.length > 0) {
    return argumentInvalid(io);
  }
  const only = parsed.values.get("--source");
  const store = storeOf(options);
  const sources = await readRealSources(store);
  if (!sources.ok) {
    io.write(`code=ORIGINALS_FAILED reason=${sources.error.code} cause=${sources.error.cause}`);
    return 1;
  }
  const chosen = only === undefined ? sources.value : sources.value.filter((source) => source.sourceId === only);
  if (only !== undefined && chosen.length === 0) {
    io.write("code=SOURCE_NOT_FOUND");
    return 1;
  }
  const reports = await verifyStoredOriginals(store, chosen);
  if (!reports.ok) {
    io.write(`code=ORIGINALS_FAILED reason=${reports.error.code} cause=${reports.error.cause}`);
    return 1;
  }
  for (const report of reports.value) {
    io.write(
      `original ${tokens([
        ["sourceId", report.sourceId],
        ["revision", report.revision],
        ["state", report.state],
        ["recorded", report.recordedSha256],
        ["current", report.currentSha256 ?? "none"],
        ["bytes", report.byteLength ?? "none"],
      ])}`,
    );
  }
  const changed = reports.value.filter((report) => report.state === "CHANGED").length;
  const missing = reports.value.filter((report) => report.state === "MISSING").length;
  if (changed === 0 && missing === 0) {
    io.write(`code=ORIGINALS_OK count=${reports.value.length}`);
    return 0;
  }
  io.write(`code=ORIGINALS_NOT_MATCHING changed=${changed} missing=${missing}`);
  return 1;
}

// ---------------------------------------------------------------------------
// real fact
// ---------------------------------------------------------------------------

function factCreateFailed(io: RegionalValuesCliIo, error: CreateFactRefusal): number {
  io.write(`code=FACT_CREATE_FAILED ${tokens([["reason", error.code], ["cause", error.reason], ["fields", error.fields], ["violations", error.violations]])}`);
  return 1;
}

function factCreated(io: RegionalValuesCliIo, created: CreatedFact): number {
  const { fact, aggregation } = created;
  io.write(
    `code=FACT_CREATED ${tokens([
      ["status", created.status],
      ["factId", fact.factId],
      ["method", fact.method.kind],
      ["verification", fact.verification.status],
      ["amount", fact.value.amount],
      ["missingCount", aggregation?.missingCount],
      ["duplicatesRemoved", aggregation?.duplicatesRemoved],
    ])} unit=${JSON.stringify(fact.value.unit)}`,
  );
  return 0;
}

async function factCreate(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--request", "--config-dir"], []);
  const path = parsed?.values.get("--request");
  if (parsed === null || parsed.positionals.length > 0 || path === undefined) {
    return argumentInvalid(io);
  }
  const request = await parseRequest(options.workspaceRoot, path, FactCreateShape);
  if (!request.ok) {
    return requestFailed(io, request);
  }
  const lists = await listsOf(options, parsed.values.get("--config-dir"));
  if (lists === null) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }
  const store = storeOf(options);
  const { value } = request;
  if (value.kind === "COMPUTED") {
    if (value.method.kind !== "COMPUTED") {
      io.write("code=REQUEST_INVALID fields=method");
      return 1;
    }
    const { kind, ...rest } = value;
    void kind;
    const created = await createComputedFact(store, rest as unknown as ComputedFactRequest, lists);
    return created.ok ? factCreated(io, created.value) : factCreateFailed(io, created.error);
  }
  if (value.kind === "QUOTED") {
    const { kind, ...rest } = value;
    void kind;
    const created = await createQuotedFact(store, rest as unknown as QuotedFactRequest, lists);
    return created.ok ? factCreated(io, created.value) : factCreateFailed(io, created.error);
  }
  const { kind, ...rest } = value;
  void kind;
  const created = await createDerivedFact(store, rest as unknown as DerivedFactRequest, lists);
  return created.ok ? factCreated(io, created.value) : factCreateFailed(io, created.error);
}

async function factStatus(args: readonly string[], options: RealCommandOptions): Promise<number> {
  const { io } = options;
  const parsed = parseArgs(args, ["--config-dir"], []);
  if (parsed === null || parsed.positionals.length > 1) {
    return argumentInvalid(io);
  }
  const lists = await listsOf(options, parsed.values.get("--config-dir"));
  if (lists === null) {
    io.write("code=CONFIG_UNREADABLE");
    return 1;
  }
  const statuses = await listFactStatuses(storeOf(options), lists);
  if (!statuses.ok) {
    io.write(`code=FACT_STATUS_FAILED reason=${statuses.error.code} cause=${statuses.error.cause}`);
    return 1;
  }
  const wanted = parsed.positionals[0];
  const chosen = wanted === undefined ? statuses.value : statuses.value.filter((status) => status.factId === wanted);
  if (wanted !== undefined && chosen.length === 0) {
    io.write("code=FACT_NOT_FOUND");
    return 1;
  }
  for (const status of chosen) {
    io.write(
      `fact ${tokens([
        ["factId", status.factId],
        ["method", status.method],
        ["stored", status.stored],
        ["effective", status.effective],
        ["verifiable", status.verifiable],
        ["recomputation", status.recomputation],
        ["reason", status.reason],
        ["findings", status.findings],
        ["problems", status.problems],
        ["verifier", status.verifierId],
        ["verifiedAt", status.verifiedAt],
      ])}`,
    );
  }
  const notVerified = chosen.filter((status) => status.effective !== "VERIFIED").length;
  io.write(notVerified === 0 ? `code=FACT_STATUS_OK count=${chosen.length}` : `code=FACT_STATUS_NOT_VERIFIED count=${chosen.length} notVerified=${notVerified}`);
  return notVerified === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------

/** Runs `real <group> <action>`. Returns 0 when the action did what it was asked and found nothing wrong, and 1 for anything else. */
export async function runRealCommand(argv: readonly string[], options: RealCommandOptions): Promise<number> {
  const [, group, action, ...rest] = argv;
  switch (`${group ?? ""} ${action ?? ""}`) {
    case "dataset register":
      return datasetRegister(rest, options);
    case "dataset list":
      return datasetList(rest, options);
    case "dataset check":
      return datasetCheck(rest, options);
    case "intake csv":
      return intakeCommand(rest, options);
    case "original verify-file":
      return originalVerifyFile(rest, options);
    case "original verify-stored":
      return originalVerifyStored(rest, options);
    case "fact create":
      return factCreate(rest, options);
    case "fact status":
      return factStatus(rest, options);
    default:
      return argumentInvalid(options.io);
  }
}
