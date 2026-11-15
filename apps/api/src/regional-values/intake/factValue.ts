import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { AggregationRecordSchema, GATE_REASON_CLASS, RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { AggregationRecord, GateFinding, GateReasonCode, RealFact, RealSource } from "@ehime-vote-navigator/contracts";
import {
  aggregate,
  checkFactSentence,
  computeDerivedValue,
  computedFactSentence,
  csvCellNumber,
  csvCellsOfLines,
  deriveFact,
  encodeCanonicalJson,
  sha256Hex,
} from "@ehime-vote-navigator/domain";
import type { AggregateResult, ComputedMethod, DerivedOperation, FactSentenceViolation, UnitPair, WrittenValue } from "@ehime-vote-navigator/domain";

import { atomicReplaceFile } from "../../store/atomicReplaceFile.js";
import { writeImmutableRecord } from "../draft/draftStore.js";
import { readRecords } from "../draft/recordReader.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { csvToText, CSV_TEXT_PROCEDURE_ID } from "./csvToText.js";
import { currentOriginalShas, sourceOf } from "./originals.js";
import { findOriginal, latestRevisionOf, readRealSources } from "./sourceRecords.js";
import type { ReadFailure } from "./sourceRecords.js";
import { AGGREGATIONS_DIRECTORY, FACTS_DIRECTORY, aggregationRecordPath, factRecordPath, isSafeRecordName } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * The fact items of real data (13.11): their creation from an original that was taken in, the
 * deterministic check of what they say against that original (8.7: `FACT_VALUE_MISMATCH`,
 * `FACT_SOURCE_MISMATCH`, `SOURCE_CHANGED`), and the reading that a person's `verify-fact` rests on.
 *
 * A fact item is made `PROVISIONAL`, always. Its value comes from `aggregate` (a count, or a sum of a
 * column) or from `deriveFact` (a ratio, a difference, a percent change of two verified facts), or it
 * is quoted from a place of the original that a person names. Its sentence is a fixed template with
 * the value put in; an AI writes nothing. Nothing here makes a fact `VERIFIED`: that is `verifyFact`, and
 * only after a person says so.
 *
 * Nothing here rewrites a stored fact item when an original changes. The effective state is computed
 * from what is stored and from the original as it is now (`effectiveVerification`, `checkRealFact`), and
 * when a stored fact item is rewritten is the open point 【要確認8】, which this code does not decide.
 */

// ---------------------------------------------------------------------------
// Reading the fact items and the records of computations
// ---------------------------------------------------------------------------

/** Every fact item of real data, in the order of the paths. A record that is not at the path of its own ID fails the read. */
export async function readRealFacts(store: IntakeStore): Promise<Outcome<readonly RealFact[], ReadFailure>> {
  const read = await readRecords(store.root, FACTS_DIRECTORY, RealFactSchema);
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  for (const stored of read.value) {
    if (stored.relativePath !== factRecordPath(stored.record.factId)) {
      return fail({ code: "STORE_READ_FAILED", cause: "PATH_MISMATCH" });
    }
  }
  return succeed(read.value.map((stored) => stored.record));
}

export async function readAggregationRecords(store: IntakeStore): Promise<Outcome<readonly AggregationRecord[], ReadFailure>> {
  const read = await readRecords(store.root, AGGREGATIONS_DIRECTORY, AggregationRecordSchema);
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  for (const stored of read.value) {
    if (stored.relativePath !== aggregationRecordPath(stored.record.factId)) {
      return fail({ code: "STORE_READ_FAILED", cause: "PATH_MISMATCH" });
    }
  }
  return succeed(read.value.map((stored) => stored.record));
}

// ---------------------------------------------------------------------------
// The value that a fact item has to have now
// ---------------------------------------------------------------------------

type SurveyDates = readonly [string | number, ...(string | number)[]];

/** What the method gives now, and what the sentence has to say of it. */
export type RecomputedValue = Readonly<{
  value: WrittenValue;
  /** The number that the sentence writes: the value, or the size of a change; `null` when it writes none. */
  written: WrittenValue | null;
  surveyDates: SurveyDates;
  /** The words of the definition that a sentence may repeat a number of. */
  definitionTexts: readonly string[];
}>;

export type RecomputationDetail =
  | Readonly<{ kind: "COMPUTED"; source: RealSource; result: AggregateResult }>
  | Readonly<{ kind: "QUOTED"; source: RealSource }>
  | Readonly<{ kind: "DERIVED"; operands: readonly [RealFact, RealFact] }>;

export const UNAVAILABLE_REASONS = ["SOURCE_MISSING", "ORIGINAL_MISSING", "ORIGINAL_CHANGED", "OPERAND_MISSING", "READ_FAILED"] as const;

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * The result of computing a fact item again from the original that it rests on.
 *  - `OK`: the value that the method gives now.
 *  - `UNAVAILABLE`: it could not be tried, because the original or an operand is not there (the original that is not there or not the same file is
 *    `SOURCE_CHANGED`, and says nothing of the value).
 *  - `REFUSED`: it was tried, and the method does not give a value now (the table is not read, a column is gone, a quoted value is not at its place).
 */
export type Recomputation =
  | Readonly<{ state: "OK"; recomputed: RecomputedValue; detail: RecomputationDetail }>
  | Readonly<{ state: "UNAVAILABLE"; reason: UnavailableReason }>
  | Readonly<{ state: "REFUSED"; reason: string }>;

export type RecomputeWorld = Readonly<{
  sources: readonly RealSource[];
  factsById: ReadonlyMap<string, RealFact>;
}>;

function definitionTextsOf(method: ComputedMethod): readonly string[] {
  return [method.column, method.whereColumn, method.equals].filter((text): text is string => typeof text === "string");
}

/** The size of a change as the sentence of a derived fact writes it; none for a change of nothing. */
function writtenChange(operation: DerivedOperation, value: WrittenValue): WrittenValue | null {
  if (operation === "RATIO") {
    return value;
  }
  return value.amount === 0 ? null : { amount: Math.abs(value.amount), unit: value.unit };
}

/** The text of the original that a fact item rests on: the file with its SHA-256, expanded as it was when it was taken in. */
async function originalTextOf(store: IntakeStore, source: RealSource): Promise<Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; recomputation: Recomputation }>> {
  const found = await findOriginal(store, source);
  if (!found.ok) {
    return { ok: false, recomputation: { state: "UNAVAILABLE", reason: "READ_FAILED" } };
  }
  if (found.value.state !== "FOUND") {
    return { ok: false, recomputation: { state: "UNAVAILABLE", reason: found.value.state === "MISSING" ? "ORIGINAL_MISSING" : "ORIGINAL_CHANGED" } };
  }
  const expanded = csvToText(found.value.file.bytes);
  if (!expanded.ok) {
    return { ok: false, recomputation: { state: "REFUSED", reason: expanded.error.code } };
  }
  return { ok: true, text: expanded.value.text };
}

/**
 * Computes a fact item again, from its original or from its operands, by the method that it names. It only reads. A computed
 * fact is computed by `aggregate` from the expanded text of the original, a quoted fact is looked for at the place that its location
 * names (a number in a cell of those lines, with the unit of the fact if the cell has one), a derived fact is computed from the
 * values of its two operands as they are stored now.
 */
export async function recomputeFact(store: IntakeStore, fact: RealFact, world: RecomputeWorld): Promise<Recomputation> {
  const { method } = fact;
  if (method.kind === "DERIVED") {
    const first = world.factsById.get(method.operandFactIds[0]);
    const second = world.factsById.get(method.operandFactIds[1]);
    if (first === undefined || second === undefined) {
      return { state: "UNAVAILABLE", reason: "OPERAND_MISSING" };
    }
    const computed = computeDerivedValue(method.operation, [first.value, second.value], method.unitPair);
    if (!computed.ok) {
      return { state: "REFUSED", reason: computed.code };
    }
    return {
      state: "OK",
      recomputed: {
        value: computed.value,
        written: writtenChange(method.operation, computed.value),
        surveyDates: [first.surveyDate, second.surveyDate],
        definitionTexts: [],
      },
      detail: { kind: "DERIVED", operands: [first, second] },
    };
  }

  const source = sourceOf(fact, world.sources);
  if (source === undefined) {
    return { state: "UNAVAILABLE", reason: "SOURCE_MISSING" };
  }
  const original = await originalTextOf(store, source);
  if (!original.ok) {
    return original.recomputation;
  }

  if (method.kind === "QUOTED") {
    const { locator } = fact;
    if (locator.kind !== "text-lines") {
      return { state: "REFUSED", reason: "LOCATOR_UNSUPPORTED" };
    }
    const cells = csvCellsOfLines(original.text, locator.startLine, locator.endLine);
    const found = cells?.some((cell) => {
      const number = csvCellNumber(cell);
      return number !== null && number.amount === fact.value.amount && (number.unit === null || number.unit === fact.value.unit);
    });
    if (found !== true) {
      return { state: "REFUSED", reason: "QUOTED_VALUE_NOT_FOUND" };
    }
    return {
      state: "OK",
      recomputed: { value: fact.value, written: fact.value, surveyDates: [fact.surveyDate], definitionTexts: [] },
      detail: { kind: "QUOTED", source },
    };
  }

  const result = aggregate({ text: original.text, inputSha256: source.sha256, method, surveyDate: fact.surveyDate });
  if (!result.ok) {
    return { state: "REFUSED", reason: result.error };
  }
  // A count has no unit of its own: the unit of the fact is the one that a person gave. A sum has the unit of its cells, if they have one.
  const value: WrittenValue = { amount: result.value.amount, unit: result.value.unit ?? fact.value.unit };
  return {
    state: "OK",
    recomputed: { value, written: value, surveyDates: [fact.surveyDate], definitionTexts: definitionTextsOf(method) },
    detail: { kind: "COMPUTED", source, result: result.value },
  };
}

// ---------------------------------------------------------------------------
// The check of a fact item of real data (8.7)
// ---------------------------------------------------------------------------

export type FactCheckInput = Readonly<{
  fact: RealFact;
  sources: readonly RealSource[];
  /** The SHA-256 of the original of a fact as it is now (`currentOriginalShas`). `undefined`: it cannot be looked at. */
  currentSha256: (fact: RealFact) => string | undefined;
  recomputation: Recomputation;
  /** The proper nouns of the settings, and the words in which a kanji numeral is not a number. */
  properNouns?: readonly string[];
  numeralExemptWords?: readonly string[];
}>;

const FACT_FINDING_ORDER = ["FACT_VALUE_MISMATCH", "FACT_SOURCE_MISMATCH", "SOURCE_CHANGED"] as const satisfies readonly GateReasonCode[];

/**
 * The checks of a fact item of real data that need the original (13.11, for 8.7). Each finding is a code and the ID of the fact, in
 * this order:
 *  - `FACT_VALUE_MISMATCH`: the value that the method gives now is not the stored value, or the numbers, the dates and the names of the
 *    sentence are not the value and the survey dates (`checkFactSentence`), or the method gives no value now.
 *  - `FACT_SOURCE_MISMATCH`: no source record has the SHA-256 of the fact, or the license of the fact is not the license of that source.
 *  - `SOURCE_CHANGED`: the original is not the file that the fact was made from, or cannot be looked at (the same test as
 *    `effectiveVerification` makes). A derived fact is made from its operands, so the originals of its operands count too.
 * It reads nothing and writes nothing. A fact whose original is not there is not also said to have a wrong value: the value cannot be told.
 */
export function checkRealFact(input: FactCheckInput): readonly GateFinding[] {
  const { fact, recomputation } = input;
  const found = new Set<(typeof FACT_FINDING_ORDER)[number]>();

  if (recomputation.state === "REFUSED") {
    found.add("FACT_VALUE_MISMATCH");
  } else if (recomputation.state === "OK") {
    const { value, written, surveyDates, definitionTexts } = recomputation.recomputed;
    const sentence = checkFactSentence({
      sentence: fact.sentence,
      value,
      written,
      area: fact.area,
      surveyDates,
      definitionTexts,
      ...(input.properNouns === undefined ? {} : { properNouns: input.properNouns }),
      ...(input.numeralExemptWords === undefined ? {} : { numeralExemptWords: input.numeralExemptWords }),
    });
    if (fact.value.amount !== value.amount || fact.value.unit !== value.unit || !sentence.ok) {
      found.add("FACT_VALUE_MISMATCH");
    }
  }

  const source = sourceOf(fact, input.sources);
  if (source === undefined || source.license.name !== fact.license.name || source.license.url !== fact.license.url) {
    found.add("FACT_SOURCE_MISMATCH");
  }
  const operands = recomputation.state === "OK" && recomputation.detail.kind === "DERIVED" ? recomputation.detail.operands : [];
  if ([fact, ...operands].some((involved) => input.currentSha256(involved) !== involved.sha256)) {
    found.add("SOURCE_CHANGED");
  }

  return FACT_FINDING_ORDER.filter((code) => found.has(code)).map((code) => ({ code, class: GATE_REASON_CLASS[code], targetKind: "FACT_ITEM", targetId: fact.factId }));
}

/** Why the sentence of a fact is not the sentence of its value, if it is not: the fixed codes only. For `verify-fact`, which tells the person. */
export function sentenceViolationsOf(fact: RealFact, recomputation: Recomputation, lists: Readonly<{ properNouns?: readonly string[]; numeralExemptWords?: readonly string[] }> = {}): readonly FactSentenceViolation[] {
  if (recomputation.state !== "OK") {
    return [];
  }
  const { value, written, surveyDates, definitionTexts } = recomputation.recomputed;
  const checked = checkFactSentence({
    sentence: fact.sentence,
    value,
    written,
    area: fact.area,
    surveyDates,
    definitionTexts,
    ...(lists.properNouns === undefined ? {} : { properNouns: lists.properNouns }),
    ...(lists.numeralExemptWords === undefined ? {} : { numeralExemptWords: lists.numeralExemptWords }),
  });
  return checked.ok ? [] : checked.violations;
}

// ---------------------------------------------------------------------------
// The creation of a fact item
// ---------------------------------------------------------------------------

export const CREATE_FACT_REFUSAL_CODES = [
  "FACT_ID_INVALID",
  "SOURCE_NOT_FOUND",
  "SOURCE_URL_REQUIRED",
  "ORIGINAL_MISSING",
  "ORIGINAL_CHANGED",
  "TEXT_REFUSED",
  "AGGREGATE_REFUSED",
  "QUOTED_VALUE_NOT_FOUND",
  "LOCATOR_INVALID",
  "UNIT_REQUIRED",
  "UNIT_MISMATCH",
  "SENTENCE_REJECTED",
  "FACT_INVALID",
  "OPERAND_NOT_FOUND",
  "DERIVE_REFUSED",
  "FACT_EXISTS",
  "STORE_READ_FAILED",
  "STORE_WRITE_FAILED",
] as const;

export type CreateFactRefusalCode = (typeof CREATE_FACT_REFUSAL_CODES)[number];

/** Why a fact item was not made: a fixed code and, at most, a code of the check, the names of the items and the codes of a sentence. Never a value. */
export type CreateFactRefusal = Readonly<{
  code: CreateFactRefusalCode;
  reason?: string;
  fields?: readonly string[];
  violations?: readonly string[];
}>;

export type CreatedFact = Readonly<{
  /** `CREATED`: written now. `UNCHANGED`: the same fact item was there. */
  status: "CREATED" | "UNCHANGED";
  fact: RealFact;
  /** The record of the computation. A quoted fact and a derived fact have none. */
  aggregation: AggregationRecord | null;
}>;

function refuse(code: CreateFactRefusalCode, extra: Omit<CreateFactRefusal, "code"> = {}): Outcome<never, CreateFactRefusal> {
  return fail({ code, ...extra });
}

function samePlainJson(first: unknown, second: unknown): boolean {
  return sha256Hex(encodeCanonicalJson(first)) === sha256Hex(encodeCanonicalJson(second));
}

function fieldsOf(error: { issues: readonly { path: readonly PropertyKey[] }[] }): readonly string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "fact")))];
}

/** The sentence of the method says that the text was expanded as `csv-lines-v1`, so that a person who reads the method knows the lines. */
function withProcedureNote(description: string): string {
  return description.includes(CSV_TEXT_PROCEDURE_ID) ? description : `${description}（テキスト展開: ${CSV_TEXT_PROCEDURE_ID}）`;
}

/** Replaces a record of the fact items (the file is replaced as a whole or not at all). `created` when there was no file. */
export async function replaceJsonRecord(store: IntakeStore, relativePath: string, value: unknown): Promise<Outcome<"created" | "replaced", Readonly<{ code: "STORE_WRITE_FAILED" }>>> {
  try {
    await mkdir(store.root.rootDir, { recursive: true });
    const written = await atomicReplaceFile({
      allowedRoot: store.root.rootDir,
      relativePath,
      bytes: encodeCanonicalJson(value),
      ...(store.operations === undefined ? {} : { operations: store.operations }),
    });
    return succeed(written.state);
  } catch {
    return fail({ code: "STORE_WRITE_FAILED" });
  }
}

/** The source that a request names: the revision that it names, or the latest one. */
async function sourceForRequest(store: IntakeStore, sourceId: string, revision: string | undefined): Promise<Outcome<RealSource, CreateFactRefusal>> {
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return refuse("STORE_READ_FAILED", { reason: sources.error.cause });
  }
  let source: RealSource | undefined;
  if (revision === undefined) {
    const latest = latestRevisionOf(sources.value, sourceId);
    if (!latest.ok) {
      return refuse("STORE_READ_FAILED", { reason: latest.error.cause });
    }
    source = latest.value;
  } else {
    source = sources.value.find((candidate) => candidate.sourceId === sourceId && candidate.revision === revision);
  }
  return source === undefined ? refuse("SOURCE_NOT_FOUND") : succeed(source);
}

type FactPlace = Readonly<{ sourceUrl: string; datasetUrl: string }>;

function placeOf(source: RealSource, request: Readonly<{ sourceUrl?: string; datasetUrl?: string }>): FactPlace | null {
  const url = source.reference.kind === "url" ? source.reference.url : undefined;
  const sourceUrl = request.sourceUrl ?? url;
  const datasetUrl = request.datasetUrl ?? url;
  return sourceUrl === undefined || datasetUrl === undefined ? null : { sourceUrl, datasetUrl };
}

type NewFact = Readonly<{ fact: RealFact; aggregation: AggregationRecord | null }>;

/** Writes the fact item (once) and the record of its computation, in this order, and takes the record away again if the fact cannot be written. */
async function saveFact(store: IntakeStore, made: NewFact, existing: RealFact | undefined): Promise<Outcome<CreatedFact, CreateFactRefusal>> {
  if (existing !== undefined && !samePlainJson(existing, made.fact)) {
    // A fact item is made once. One that is there, and is not this one, is never overwritten, whatever its state.
    return refuse("FACT_EXISTS");
  }
  let recordState: "created" | "replaced" | null = null;
  if (made.aggregation !== null) {
    const record = await replaceJsonRecord(store, aggregationRecordPath(made.fact.factId), made.aggregation);
    if (!record.ok) {
      return refuse("STORE_WRITE_FAILED", { reason: "AGGREGATION_RECORD" });
    }
    recordState = record.value;
  }
  if (existing === undefined) {
    const written = await writeImmutableRecord(store.root, factRecordPath(made.fact.factId), made.fact, store.operations);
    if (!written.ok) {
      if (recordState === "created") {
        try {
          await (store.operations?.unlink ?? ((path: string) => unlink(path)))(join(store.root.rootDir, ...aggregationRecordPath(made.fact.factId).split("/")));
        } catch {
          // The record of a computation of a fact that does not exist is not read by anything; the next creation replaces it.
        }
      }
      return refuse(written.error.code === "IMMUTABLE_CONFLICT" ? "FACT_EXISTS" : "STORE_WRITE_FAILED", { reason: written.error.code });
    }
  }
  return succeed({ status: existing === undefined ? "CREATED" : "UNCHANGED", fact: made.fact, aggregation: made.aggregation });
}

export type ComputedFactRequest = Readonly<{
  /** The name of the fact item: it is the name of its file. */
  factId: string;
  sourceId: string;
  /** The revision. The latest revision of the source is used when it is not given. */
  revision?: string;
  /** How the value is computed (`COUNT_ROWS`, `COUNT_ROWS_WHERE`, `SUM_COLUMN`, with `dedupeColumns` only if the rows that are the same are to be left out). */
  method: ComputedMethod;
  /** The survey date or the year that the values are of. A person says it; it is not read from the file. */
  surveyDate: string | number;
  area: string;
  /** The name of the quantity in the sentence (`指定緊急避難場所の数`), with no number in it. */
  subject: string;
  /** The unit of a count, or of a sum of cells that have no unit. A sum of cells that have a unit takes that unit. */
  unit?: string;
  sourceUrl?: string;
  datasetUrl?: string;
}>;

/** What a person says about the words of the sentence. The lists of the settings are optional, and a check without them is stricter, not looser. */
export type SentenceLists = Readonly<{ properNouns?: readonly string[]; numeralExemptWords?: readonly string[] }>;

/**
 * Makes a fact item from the original of a source that was taken in: the value by `aggregate`, the sentence by a fixed template, the
 * state `PROVISIONAL`, and the record of the computation (`aggregations/<factId>.json`, with the blank cells and the rows that were left
 * out). It refuses, and writes nothing, when the original is not the file that was taken in, when `aggregate` refuses, when the unit is
 * not clear, or when the sentence does not pass the check of its own value. A fact item that is there is never overwritten.
 */
export async function createComputedFact(store: IntakeStore, request: ComputedFactRequest, lists: SentenceLists = {}): Promise<Outcome<CreatedFact, CreateFactRefusal>> {
  if (!isSafeRecordName(request.factId)) {
    return refuse("FACT_ID_INVALID");
  }
  const sourced = await sourceForRequest(store, request.sourceId, request.revision);
  if (!sourced.ok) {
    return sourced;
  }
  const source = sourced.value;
  const place = placeOf(source, request);
  if (place === null) {
    return refuse("SOURCE_URL_REQUIRED");
  }
  const facts = await readRealFacts(store);
  if (!facts.ok) {
    return refuse("STORE_READ_FAILED", { reason: facts.error.cause });
  }

  const original = await originalTextOf(store, source);
  if (!original.ok) {
    const { recomputation } = original;
    if (recomputation.state === "UNAVAILABLE") {
      return refuse(recomputation.reason === "ORIGINAL_CHANGED" ? "ORIGINAL_CHANGED" : "ORIGINAL_MISSING", { reason: recomputation.reason });
    }
    return refuse("TEXT_REFUSED", { reason: recomputation.state === "REFUSED" ? recomputation.reason : "UNKNOWN" });
  }
  const method: ComputedMethod = { ...request.method, description: withProcedureNote(request.method.description) };
  const result = aggregate({ text: original.text, inputSha256: source.sha256, method, surveyDate: request.surveyDate });
  if (!result.ok) {
    return refuse("AGGREGATE_REFUSED", { reason: result.error });
  }
  const computed = result.value;

  if (computed.unit !== null && request.unit !== undefined && request.unit !== computed.unit) {
    return refuse("UNIT_MISMATCH");
  }
  const unit = computed.unit ?? request.unit;
  if (unit === undefined || unit.trim() === "") {
    return refuse("UNIT_REQUIRED");
  }
  const value: WrittenValue = { amount: computed.amount, unit };
  const sentence = computedFactSentence({ area: request.area, subject: request.subject, surveyDate: computed.surveyDate, amount: value.amount, unit });
  const checked = checkFactSentence({
    sentence,
    value,
    written: value,
    area: request.area,
    surveyDates: [computed.surveyDate],
    definitionTexts: definitionTextsOf(method),
    ...(lists.properNouns === undefined ? {} : { properNouns: lists.properNouns }),
    ...(lists.numeralExemptWords === undefined ? {} : { numeralExemptWords: lists.numeralExemptWords }),
  });
  if (!checked.ok) {
    return refuse("SENTENCE_REJECTED", { violations: checked.violations });
  }

  const parsed = RealFactSchema.safeParse({
    dataKind: "REAL_AI",
    factId: request.factId,
    sentence,
    value,
    surveyDate: computed.surveyDate,
    area: request.area,
    publisher: source.publisher,
    sourceUrl: place.sourceUrl,
    datasetUrl: place.datasetUrl,
    license: source.license,
    retrievedAt: source.retrievedAt,
    sha256: source.sha256,
    locator: computed.locator,
    method,
    verification: { status: "PROVISIONAL" },
  });
  if (!parsed.success) {
    return refuse("FACT_INVALID", { fields: fieldsOf(parsed.error) });
  }
  const aggregation = AggregationRecordSchema.parse({
    schemaVersion: 1,
    dataKind: "REAL_AI",
    factId: request.factId,
    inputSha256: computed.inputSha256,
    methodHash: computed.methodHash,
    surveyDate: computed.surveyDate,
    missingCount: computed.missingCount,
    duplicatesRemoved: computed.duplicatesRemoved,
    locator: computed.locator,
  });
  return saveFact(store, { fact: parsed.data, aggregation }, facts.value.find((fact) => fact.factId === request.factId));
}

export type QuotedFactRequest = Readonly<{
  factId: string;
  sourceId: string;
  revision?: string;
  /** What the value is and where it stands in the original, in words (`method.description`). */
  description: string;
  /** The lines of the expanded text (`csv-lines-v1`) that the value stands on. */
  startLine: number;
  endLine: number;
  amount: number;
  unit: string;
  surveyDate: string | number;
  area: string;
  subject: string;
  sourceUrl?: string;
  datasetUrl?: string;
}>;

/**
 * Makes a fact item that quotes a value of the original as it stands: a person names the lines and the value, and the value has to be
 * a number in a cell of those lines (with the unit of the fact, if the cell has one). `PROVISIONAL`, with no record of a computation.
 */
export async function createQuotedFact(store: IntakeStore, request: QuotedFactRequest, lists: SentenceLists = {}): Promise<Outcome<CreatedFact, CreateFactRefusal>> {
  if (!isSafeRecordName(request.factId)) {
    return refuse("FACT_ID_INVALID");
  }
  if (!Number.isSafeInteger(request.startLine) || !Number.isSafeInteger(request.endLine) || request.startLine < 1 || request.endLine < request.startLine) {
    return refuse("LOCATOR_INVALID");
  }
  const sourced = await sourceForRequest(store, request.sourceId, request.revision);
  if (!sourced.ok) {
    return sourced;
  }
  const source = sourced.value;
  const place = placeOf(source, request);
  if (place === null) {
    return refuse("SOURCE_URL_REQUIRED");
  }
  const facts = await readRealFacts(store);
  if (!facts.ok) {
    return refuse("STORE_READ_FAILED", { reason: facts.error.cause });
  }
  const original = await originalTextOf(store, source);
  if (!original.ok) {
    const { recomputation } = original;
    if (recomputation.state === "UNAVAILABLE") {
      return refuse(recomputation.reason === "ORIGINAL_CHANGED" ? "ORIGINAL_CHANGED" : "ORIGINAL_MISSING", { reason: recomputation.reason });
    }
    return refuse("TEXT_REFUSED", { reason: recomputation.state === "REFUSED" ? recomputation.reason : "UNKNOWN" });
  }
  const cells = csvCellsOfLines(original.text, request.startLine, request.endLine);
  const found = cells?.some((cell) => {
    const number = csvCellNumber(cell);
    return number !== null && number.amount === request.amount && (number.unit === null || number.unit === request.unit);
  });
  if (found !== true) {
    return refuse("QUOTED_VALUE_NOT_FOUND");
  }

  const value: WrittenValue = { amount: request.amount, unit: request.unit };
  const sentence = computedFactSentence({ area: request.area, subject: request.subject, surveyDate: request.surveyDate, amount: value.amount, unit: value.unit });
  const checked = checkFactSentence({
    sentence,
    value,
    written: value,
    area: request.area,
    surveyDates: [request.surveyDate],
    ...(lists.properNouns === undefined ? {} : { properNouns: lists.properNouns }),
    ...(lists.numeralExemptWords === undefined ? {} : { numeralExemptWords: lists.numeralExemptWords }),
  });
  if (!checked.ok) {
    return refuse("SENTENCE_REJECTED", { violations: checked.violations });
  }
  const parsed = RealFactSchema.safeParse({
    dataKind: "REAL_AI",
    factId: request.factId,
    sentence,
    value,
    surveyDate: request.surveyDate,
    area: request.area,
    publisher: source.publisher,
    sourceUrl: place.sourceUrl,
    datasetUrl: place.datasetUrl,
    license: source.license,
    retrievedAt: source.retrievedAt,
    sha256: source.sha256,
    locator: { kind: "text-lines", startLine: request.startLine, endLine: request.endLine },
    method: { kind: "QUOTED", description: withProcedureNote(request.description) },
    verification: { status: "PROVISIONAL" },
  });
  if (!parsed.success) {
    return refuse("FACT_INVALID", { fields: fieldsOf(parsed.error) });
  }
  return saveFact(store, { fact: parsed.data, aggregation: null }, facts.value.find((fact) => fact.factId === request.factId));
}

export type DerivedFactRequest = Readonly<{
  factId: string;
  operation: DerivedOperation;
  /** A ratio: the numerator then the denominator. A difference and a percent change: the later value then the earlier value. */
  operandFactIds: readonly [string, string];
  /** The units of the numerator and the denominator. A ratio needs it. */
  unitPair?: UnitPair;
  subject: string;
  description: string;
}>;

/**
 * Makes a derived fact item from two fact items that a person verified, by `deriveFact`: `PROVISIONAL` until a person verifies it too. It
 * refuses an operand that is not verified (as the state is now: an operand whose original changed is not), a derived operand, a comparison
 * that is not allowed (units, area, dates, definition), and a value that cannot be written.
 */
export async function createDerivedFact(store: IntakeStore, request: DerivedFactRequest, lists: SentenceLists = {}): Promise<Outcome<CreatedFact, CreateFactRefusal>> {
  if (!isSafeRecordName(request.factId)) {
    return refuse("FACT_ID_INVALID");
  }
  const facts = await readRealFacts(store);
  if (!facts.ok) {
    return refuse("STORE_READ_FAILED", { reason: facts.error.cause });
  }
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return refuse("STORE_READ_FAILED", { reason: sources.error.cause });
  }
  const byId = new Map(facts.value.map((fact) => [fact.factId, fact] as const));
  const first = byId.get(request.operandFactIds[0]);
  const second = byId.get(request.operandFactIds[1]);
  if (first === undefined || second === undefined) {
    return refuse("OPERAND_NOT_FOUND");
  }
  // An operand counts as verified only if its original is still the file that it was verified against.
  const shas = await currentOriginalShas(store, sources.value);
  const stillVerified = (operand: RealFact): RealFact =>
    shas.get(operand.sha256) === operand.sha256 ? operand : { ...operand, verification: { status: "PROVISIONAL" } };
  const derived = deriveFact({
    factId: request.factId,
    operation: request.operation,
    operands: [stillVerified(first), stillVerified(second)],
    ...(request.unitPair === undefined ? {} : { unitPair: request.unitPair }),
    subject: request.subject,
    description: request.description,
  });
  if (!derived.ok) {
    return refuse("DERIVE_REFUSED", { reason: derived.code, ...(derived.violations === undefined ? {} : { violations: derived.violations }) });
  }

  // The sentence of a derived fact is checked by the same check as any other: what `deriveFact` writes has to pass it.
  const recomputation = await recomputeFact(store, derived.fact, { sources: sources.value, factsById: byId });
  if (recomputation.state !== "OK") {
    return refuse("DERIVE_REFUSED", { reason: recomputation.reason });
  }
  const violations = sentenceViolationsOf(derived.fact, recomputation, lists);
  if (violations.length > 0) {
    return refuse("SENTENCE_REJECTED", { violations });
  }
  return saveFact(store, { fact: derived.fact, aggregation: null }, byId.get(request.factId));
}
