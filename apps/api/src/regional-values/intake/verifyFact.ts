import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { AggregationRecord, RealFact } from "@ehime-vote-navigator/contracts";
import { DERIVED_DECIMALS } from "@ehime-vote-navigator/domain";

import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { evaluateFact } from "./factStatus.js";
import { readAggregationRecords, readRealFacts, replaceJsonRecord } from "./factValue.js";
import type { Recomputation, SentenceLists } from "./factValue.js";
import { currentOriginalShas } from "./originals.js";
import { readRealSources } from "./sourceRecords.js";
import { factRecordPath, isSafeRecordName } from "./storeLayout.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * `verify-fact` (13.11): a person looks at a fact item and the value that is computed again from its
 * original, and says that they agree. Only then is the fact item `VERIFIED`, with the person and the time.
 *
 *  - Nothing here decides for the person. The question is asked through `confirm`, and anything but an
 *    explicit yes (a no, no answer, a closed input, an error of the input) writes nothing.
 *  - A fact item that does not pass the checks of 8.7 is not offered for verification at all: a stored
 *    value that is not the value that the original gives, an original that is not the file that the fact
 *    was made from, a source that is not the fact's source. The person is shown why, and nothing is written.
 *  - A derived fact item is verified only on two operands that are verified now, from the original that
 *    they were verified against, with a comparison that is allowed (`checkFactComparison`).
 *  - The fact item is written back once, as a whole, after the file is read again and found to be the file that was shown.
 *
 * It prints through `write`: the stored value, the value that is computed again, the place in the original,
 * the number of blank cells and of rows that were left out, and, for a derived fact, the operands and the formula.
 * It prints no row of the original.
 */

export type VerifyFactRequest = Readonly<{
  factId: string;
  /** The person who verifies (1 to 64 characters). */
  verifierId: string;
}>;

export type VerifyFactDeps = Readonly<{
  now: () => Date;
  /** Asks the person a question. Only `true` is a yes: the implementation must say `false` for anything else. */
  confirm: (question: string) => Promise<boolean>;
  /** Shows a line to the person. */
  write: (line: string) => void;
  /** The lists of words of the settings, for the check of the sentence. */
  lists?: SentenceLists;
}>;

/** What the person is asked, for a fact item that is computed or quoted and for one that is derived. Both have to be answered yes. */
export const VERIFY_QUESTIONS = {
  value: ["保存値と再計算値が、原本の該当箇所の値と一致することを確認しましたか? [y/N] ", "調査年、対象地域、単位が、事実の文と原本で整合していることを確認しましたか? [y/N] "],
  derived: ["元の値と計算式から再計算した値が、保存値と一致することを確認しましたか? [y/N] ", "調査年、対象地域、単位が、事実の文と元の事実項目で整合していることを確認しましたか? [y/N] "],
} as const;

export const VERIFY_REFUSAL_CODES = [
  "FACT_ID_INVALID",
  "VERIFIER_INVALID",
  "FACT_NOT_FOUND",
  "STORE_READ_FAILED",
  "CHECK_FAILED",
  "CANCELLED",
  "FACT_CHANGED",
  "STORE_WRITE_FAILED",
] as const;

export type VerifyRefusalCode = (typeof VERIFY_REFUSAL_CODES)[number];

/** Why a fact item was not verified: a fixed code, and for `CHECK_FAILED` the codes of the checks. Never a value. */
export type VerifyRefusal = Readonly<{
  code: VerifyRefusalCode;
  reason?: string;
  /** The findings of 8.7 (`FACT_VALUE_MISMATCH`, `FACT_SOURCE_MISMATCH`, `SOURCE_CHANGED`). */
  findings?: readonly string[];
  /** The other reasons that the fact item cannot be verified (a record of the computation, the operands, the comparison, the sentence). */
  problems?: readonly string[];
}>;

export type VerifyOutcome =
  | Readonly<{ status: "VERIFIED"; fact: RealFact }>
  /** The fact item was `VERIFIED` already. Nothing was asked and nothing was written; `effective` says whether it counts as verified now. */
  | Readonly<{ status: "ALREADY_VERIFIED"; fact: RealFact; effective: "VERIFIED" | "PROVISIONAL"; findings: readonly string[]; problems: readonly string[] }>;

function refuse(code: VerifyRefusalCode, extra: Omit<VerifyRefusal, "code"> = {}): Outcome<never, VerifyRefusal> {
  return fail({ code, ...extra });
}

const FORMULAS = {
  RATIO: "operand1 / operand2",
  RATIO_PERCENT: "operand1 / operand2 * 100",
  DIFFERENCE: "operand1 - operand2",
  PERCENT_CHANGE: "(operand1 - operand2) / operand2 * 100",
} as const;

function surveyText(surveyDate: string | number): string {
  return String(surveyDate);
}

/**
 * The lines that the person is shown for a fact item (the numbers and the places, and the sentence of the fact item): the stored value,
 * the value computed again, the place in the original, the blank cells and the rows left out; for a derived fact item also the operands and
 * the formula. It is a pure function of what it is given.
 */
export function verificationLines(fact: RealFact, recomputation: Recomputation, record: AggregationRecord | null): readonly string[] {
  const lines: string[] = [`fact=${fact.factId} method=${fact.method.kind}${fact.method.kind === "COMPUTED" ? ` aggregation=${fact.method.aggregation}` : fact.method.kind === "DERIVED" ? ` operation=${fact.method.operation}` : ""} status=${fact.verification.status}`];

  if (recomputation.state === "OK" && recomputation.detail.kind === "DERIVED" && fact.method.kind === "DERIVED") {
    const { operands } = recomputation.detail;
    operands.forEach((operand, index) => {
      lines.push(`operand${index + 1} factId=${operand.factId} amount=${operand.value.amount} unit=${operand.value.unit} survey=${surveyText(operand.surveyDate)} sha256=${operand.sha256}`);
    });
    if (fact.method.unitPair !== undefined) {
      lines.push(`unitPair numerator=${fact.method.unitPair.numerator} denominator=${fact.method.unitPair.denominator}`);
    }
    const percent = fact.method.operation === "RATIO" && fact.method.unitPair !== undefined && fact.method.unitPair.numerator === fact.method.unitPair.denominator;
    lines.push(`formula=${fact.method.operation === "RATIO" ? (percent ? FORMULAS.RATIO_PERCENT : FORMULAS.RATIO) : FORMULAS[fact.method.operation]} decimals=${DERIVED_DECIMALS} rounding=half-away-from-zero`);
  } else if (recomputation.state === "OK" && recomputation.detail.kind !== "DERIVED") {
    const { source } = recomputation.detail;
    lines.push(`source sourceId=${source.sourceId} revision=${source.revision} sha256=${source.sha256}`);
  } else {
    lines.push(`source sha256=${fact.sha256}`);
  }

  lines.push(`survey=${surveyText(fact.surveyDate)} area=${fact.area}`);
  lines.push(`stored amount=${fact.value.amount} unit=${fact.value.unit}`);
  if (recomputation.state === "OK") {
    const { value } = recomputation.recomputed;
    const counts = recomputation.detail.kind === "COMPUTED" ? ` missingCount=${recomputation.detail.result.missingCount} duplicatesRemoved=${recomputation.detail.result.duplicatesRemoved}` : "";
    lines.push(`recomputed amount=${value.amount} unit=${value.unit}${counts}`);
    if (recomputation.detail.kind === "QUOTED") {
      lines.push("quoted found=true");
    }
  } else {
    lines.push(`recomputed state=${recomputation.state} reason=${recomputation.reason}`);
  }
  if (fact.method.kind === "COMPUTED") {
    lines.push(record === null ? "record state=MISSING" : `record missingCount=${record.missingCount} duplicatesRemoved=${record.duplicatesRemoved}`);
  }
  if (fact.locator.kind === "text-lines") {
    lines.push(`locator kind=text-lines startLine=${fact.locator.startLine} endLine=${fact.locator.endLine}`);
  } else {
    lines.push(`locator kind=${fact.locator.kind}`);
  }
  lines.push(`sentence=${fact.sentence}`);
  return lines;
}

function isValidVerifier(verifierId: string): boolean {
  return typeof verifierId === "string" && verifierId.trim() !== "" && verifierId.length <= 64;
}

/**
 * Verifies one fact item (`verify-fact`). Reads the fact items, the sources and the originals; shows the person what the fact item says
 * and what the original gives; asks; and, only on two explicit yes, writes the fact item back as `VERIFIED` with the person and the time.
 * Returns the refusal, with the codes of the checks, when the fact item cannot be offered or when the person does not say yes.
 */
export async function verifyFact(store: IntakeStore, request: VerifyFactRequest, deps: VerifyFactDeps): Promise<Outcome<VerifyOutcome, VerifyRefusal>> {
  if (!isSafeRecordName(request.factId)) {
    return refuse("FACT_ID_INVALID");
  }
  if (!isValidVerifier(request.verifierId)) {
    return refuse("VERIFIER_INVALID");
  }

  const facts = await readRealFacts(store);
  if (!facts.ok) {
    return refuse("STORE_READ_FAILED", { reason: facts.error.cause });
  }
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return refuse("STORE_READ_FAILED", { reason: sources.error.cause });
  }
  const fact = facts.value.find((candidate) => candidate.factId === request.factId);
  if (fact === undefined) {
    return refuse("FACT_NOT_FOUND");
  }
  const factPath = join(store.root.rootDir, ...factRecordPath(fact.factId).split("/"));
  let shownBytes: Uint8Array;
  try {
    shownBytes = new Uint8Array(await readFile(factPath));
  } catch {
    return refuse("STORE_READ_FAILED", { reason: "READ_FAILED" });
  }
  const records = await readAggregationRecords(store);
  if (!records.ok) {
    return refuse("STORE_READ_FAILED", { reason: records.error.cause });
  }
  // What the fact item is now, judged against its original: the same judgment that `real fact status` shows (`evaluateFact`).
  const shas = await currentOriginalShas(store, sources.value);
  const { recomputation, record, findings, problems } = await evaluateFact(store, fact, {
    facts: facts.value,
    sources: sources.value,
    records: records.value,
    shas,
    lists: deps.lists,
  });

  for (const line of verificationLines(fact, recomputation, record)) {
    deps.write(line);
  }

  if (fact.verification.status === "VERIFIED") {
    const effective = findings.length === 0 && problems.length === 0 ? "VERIFIED" : "PROVISIONAL";
    return succeed({ status: "ALREADY_VERIFIED", fact, effective, findings, problems });
  }
  if (findings.length > 0 || problems.length > 0) {
    return refuse("CHECK_FAILED", { findings, problems });
  }

  // The person. Only an explicit yes to each question counts, and a question that cannot be asked is a no.
  const questions = fact.method.kind === "DERIVED" ? VERIFY_QUESTIONS.derived : VERIFY_QUESTIONS.value;
  for (const question of questions) {
    let answer = false;
    try {
      answer = (await deps.confirm(question)) === true;
    } catch {
      answer = false;
    }
    if (!answer) {
      return refuse("CANCELLED");
    }
  }

  // The file that was shown is the file that is written over.
  try {
    const now = new Uint8Array(await readFile(factPath));
    if (now.byteLength !== shownBytes.byteLength || now.some((byte, index) => byte !== shownBytes[index])) {
      return refuse("FACT_CHANGED");
    }
  } catch {
    return refuse("FACT_CHANGED");
  }
  const verified = RealFactSchema.safeParse({ ...fact, verification: { status: "VERIFIED", verifierId: request.verifierId, verifiedAt: deps.now().toISOString() } });
  if (!verified.success) {
    return refuse("VERIFIER_INVALID");
  }
  const written = await replaceJsonRecord(store, factRecordPath(fact.factId), verified.data);
  if (!written.ok) {
    return refuse("STORE_WRITE_FAILED");
  }
  return succeed({ status: "VERIFIED", fact: verified.data });
}
