import type { AggregationRecord, RealFact, RealSource } from "@ehime-vote-navigator/contracts";
import { checkFactComparison, effectiveVerification } from "@ehime-vote-navigator/domain";

import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import { checkRealFact, readAggregationRecords, readRealFacts, recomputeFact, sentenceViolationsOf } from "./factValue.js";
import type { Recomputation, SentenceLists } from "./factValue.js";
import { currentOriginalShas } from "./originals.js";
import { readRealSources } from "./sourceRecords.js";
import type { ReadFailure } from "./sourceRecords.js";
import type { IntakeStore } from "./storeLayout.js";

/**
 * What a fact item of real data is now, judged against its original: the findings of 8.7 (`FACT_VALUE_MISMATCH`, `FACT_SOURCE_MISMATCH`,
 * `SOURCE_CHANGED`) and the other reasons that it cannot be taken as verified (the sentence, the record of the computation, the operands,
 * the comparison). `verify-fact` judges a fact item with this before it asks a person, and `real fact status` shows it. It only reads: it
 * writes nothing, asks no one, and never makes a fact item `VERIFIED`.
 */

export type FactEvaluationInput = Readonly<{
  facts: readonly RealFact[];
  sources: readonly RealSource[];
  records: readonly AggregationRecord[];
  /** The SHA-256 of each original as it is now (`currentOriginalShas`). */
  shas: ReadonlyMap<string, string | undefined>;
  lists?: SentenceLists | undefined;
}>;

export type FactEvaluation = Readonly<{
  recomputation: Recomputation;
  /** The record of the computation of the fact item, `null` when there is none. */
  record: AggregationRecord | null;
  /** The codes of the findings of 8.7, in their order. */
  findings: readonly string[];
  /** The other reasons, as fixed codes. */
  problems: readonly string[];
}>;

/** The names of the fields of the stored record of a computation that are not what the computation gives. */
function recordMismatches(fact: RealFact, record: AggregationRecord, recomputation: Recomputation): readonly string[] {
  if (recomputation.state !== "OK" || recomputation.detail.kind !== "COMPUTED") {
    return [];
  }
  const { result } = recomputation.detail;
  const wrong: string[] = [];
  if (record.inputSha256 !== fact.sha256 || record.inputSha256 !== result.inputSha256) {
    wrong.push("inputSha256");
  }
  if (record.methodHash !== result.methodHash) {
    wrong.push("methodHash");
  }
  if (record.surveyDate !== fact.surveyDate) {
    wrong.push("surveyDate");
  }
  if (record.missingCount !== result.missingCount) {
    wrong.push("missingCount");
  }
  if (record.duplicatesRemoved !== result.duplicatesRemoved) {
    wrong.push("duplicatesRemoved");
  }
  if (record.locator.startLine !== result.locator.startLine || record.locator.endLine !== result.locator.endLine || JSON.stringify(fact.locator) !== JSON.stringify(result.locator)) {
    wrong.push("locator");
  }
  return wrong;
}

/** Computes the fact item again from its original or its operands, and gathers every finding and every reason. */
export async function evaluateFact(store: IntakeStore, fact: RealFact, input: FactEvaluationInput): Promise<FactEvaluation> {
  const factsById = new Map(input.facts.map((candidate) => [candidate.factId, candidate] as const));
  const record = input.records.find((candidate) => candidate.factId === fact.factId) ?? null;
  const recomputation = await recomputeFact(store, fact, { sources: input.sources, factsById });

  const findings = checkRealFact({
    fact,
    sources: input.sources,
    currentSha256: (candidate) => input.shas.get(candidate.sha256),
    recomputation,
    ...(input.lists?.properNouns === undefined ? {} : { properNouns: input.lists.properNouns }),
    ...(input.lists?.numeralExemptWords === undefined ? {} : { numeralExemptWords: input.lists.numeralExemptWords }),
  }).map((finding) => finding.code as string);

  const problems: string[] = [];
  for (const violation of sentenceViolationsOf(fact, recomputation, input.lists)) {
    problems.push(`SENTENCE_${violation}`);
  }
  if (fact.method.kind === "COMPUTED") {
    if (record === null) {
      problems.push("AGGREGATION_RECORD_MISSING");
    } else if (recordMismatches(fact, record, recomputation).length > 0) {
      problems.push("AGGREGATION_RECORD_MISMATCH");
    }
  }
  if (fact.method.kind === "DERIVED" && recomputation.state === "OK" && recomputation.detail.kind === "DERIVED") {
    const [first, second] = recomputation.detail.operands;
    const comparison = checkFactComparison({
      operands: [first, second],
      use: { kind: "DERIVE", operation: fact.method.operation, ...(fact.method.unitPair === undefined ? {} : { unitPair: fact.method.unitPair }) },
      sentence: fact.sentence,
    });
    if (!comparison.ok) {
      problems.push(...comparison.violations.map((violation) => `COMPARISON_${violation}`));
    }
  }
  if (fact.method.kind === "DERIVED") {
    // The operands have to count as verified now. The fact itself is not (that is what is being decided), and a changed original or a wrong value are findings above.
    const effective = effectiveVerification(fact, { factsById, currentSha256: (candidate) => input.shas.get(candidate.sha256) });
    if (effective.status === "PROVISIONAL") {
      for (const reason of effective.reasons) {
        if (reason === "OPERAND_MISSING" || reason === "OPERAND_IS_DERIVED" || reason === "OPERAND_NOT_VERIFIED") {
          problems.push(reason);
        }
      }
    }
  }
  return { recomputation, record, findings, problems };
}

export type FactStatus = Readonly<{
  factId: string;
  method: RealFact["method"]["kind"];
  /** What the file says. */
  stored: RealFact["verification"]["status"];
  /** What it counts as now: `VERIFIED` only when it is `VERIFIED` in the file and has no finding and no reason. */
  effective: "VERIFIED" | "PROVISIONAL";
  /** The person and the time of the verification, `null` for a fact item that is not verified. */
  verifierId: string | null;
  verifiedAt: string | null;
  /** Whether `verify-fact` would ask a person about it: it is not verified, and nothing is wrong with it. */
  verifiable: boolean;
  recomputation: Recomputation["state"];
  /** The fixed code of the reason that the value cannot be computed again, `null` when it can. */
  reason: string | null;
  findings: readonly string[];
  problems: readonly string[];
}>;

export function statusOf(fact: RealFact, evaluation: FactEvaluation): FactStatus {
  const sound = evaluation.findings.length === 0 && evaluation.problems.length === 0;
  const { recomputation } = evaluation;
  return {
    factId: fact.factId,
    method: fact.method.kind,
    stored: fact.verification.status,
    effective: fact.verification.status === "VERIFIED" && sound ? "VERIFIED" : "PROVISIONAL",
    verifierId: fact.verification.status === "VERIFIED" ? fact.verification.verifierId : null,
    verifiedAt: fact.verification.status === "VERIFIED" ? fact.verification.verifiedAt : null,
    verifiable: fact.verification.status !== "VERIFIED" && sound,
    recomputation: recomputation.state,
    reason: recomputation.state === "OK" ? null : recomputation.reason,
    findings: evaluation.findings,
    problems: evaluation.problems,
  };
}

/** The status of every fact item of real data, in the order of the fact ID. */
export async function listFactStatuses(store: IntakeStore, lists?: SentenceLists): Promise<Outcome<readonly FactStatus[], ReadFailure>> {
  const facts = await readRealFacts(store);
  if (!facts.ok) {
    return fail(facts.error);
  }
  const sources = await readRealSources(store);
  if (!sources.ok) {
    return fail(sources.error);
  }
  const records = await readAggregationRecords(store);
  if (!records.ok) {
    return fail(records.error);
  }
  const shas = await currentOriginalShas(store, sources.value);
  const statuses: FactStatus[] = [];
  for (const fact of [...facts.value].sort((first, second) => (first.factId < second.factId ? -1 : first.factId > second.factId ? 1 : 0))) {
    const evaluation = await evaluateFact(store, fact, { facts: facts.value, sources: sources.value, records: records.value, shas, lists });
    statuses.push(statusOf(fact, evaluation));
  }
  return succeed(statuses);
}
