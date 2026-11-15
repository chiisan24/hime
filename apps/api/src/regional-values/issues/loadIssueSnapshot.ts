import { ApprovedIssueSchema, IssueSourceRecordSchema, Sha256Schema } from "@ehime-vote-navigator/contracts";
import type {
  ApprovedIssue,
  FactItem,
  IssueSourceRecord,
  RealFact,
  RealSource,
  RegionalSource,
  Sha256,
  ThemeDef,
  WithdrawnIssue,
  WithdrawnReason,
} from "@ehime-vote-navigator/contracts";
import { effectiveVerification, encodeCanonicalJson, sha256Hex } from "@ehime-vote-navigator/domain";
import type { EffectiveVerification } from "@ehime-vote-navigator/domain";

import { approvalsOf, hashOf, readLedger } from "../draft/approvalLedger.js";
import type { LedgerError } from "../draft/approvalLedger.js";
import { factNumeralsOf, runDraftChecks } from "../draft/checks.js";
import type { DraftCheckConfig, DraftCheckContext } from "../draft/checks.js";
import { readRecords } from "../draft/recordReader.js";
import type { ReadRecordsErrorCode } from "../draft/recordReader.js";
import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";
import type { IssueInputs } from "./inputs.js";

/**
 * The issues that are valid now, and the issues that were approved and are not valid any more
 * (Req 13.2 to 13.5, design: 出力の手順、無効化と再承認). `issues export` and the build use this one
 * function.
 *
 * It only reads. It does not write the approval ledger, the records of the issues, the draft
 * candidates or the fact items, and it calls nothing outside the machine (D30): what it checks
 * about a source (the terms of use, the permission to send it to an external AI, the SHA-256 of the
 * original) is what the local records and files say.
 */

/** The settings that a judgment needs: how many approvers, and the checks (the lists of words) that an issue goes through again. */
export type IssueSettings = Readonly<{
  requiredApprovers: number;
  checks: DraftCheckConfig;
  themes: readonly ThemeDef[];
}>;

export type IssueSnapshot = Readonly<{
  issues: readonly ApprovedIssue[];
  withdrawn: readonly WithdrawnIssue[];
  /** The SHA-256 of the canonical JSON of the input. A changed input changes it. It has no time. */
  inputDigest: Sha256;
  /** Every reason that holds for a withdrawn issue, in the order of precedence. The first is the reason of `withdrawn`. */
  reasons: ReadonlyMap<string, readonly WithdrawnReason[]>;
}>;

export type LoadIssueSnapshotErrorCode = ReadRecordsErrorCode | LedgerError["code"] | "ISSUE_PATH_MISMATCH" | "CONTRACT_INVALID";

export type LoadIssueSnapshotError = Readonly<{ code: LoadIssueSnapshotErrorCode }>;

/** The order of precedence of the reasons (Req 13.3). */
const REASON_ORDER: readonly WithdrawnReason[] = [
  "REVOKED",
  "CONTENT_CHANGED",
  "APPROVAL_INSUFFICIENT",
  "SOURCE_CHANGED",
  "FACT_UNVERIFIED",
  "USAGE_CHANGED",
  "CHECK_FAILED",
];

/** The date that the checks of an issue are given. It is not used: only the checks of a question read it. */
const NOT_USED_DATE = "2000-01-01";

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((first, second) => {
    const left = key(first);
    const right = key(second);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function isReal(fact: FactItem): fact is RealFact {
  return fact.dataKind === "REAL_AI";
}

function isRealSource(source: RegionalSource): source is RealSource {
  return source.dataKind === "REAL_AI";
}

/** The source that a fact item rests on: the one with its SHA-256, and the latest one if more than one has it. */
function sourceOf(fact: RealFact, sources: readonly RealSource[]): RealSource | undefined {
  const holders = sources.filter((source) => source.sha256 === fact.sha256);
  return byKey(holders, (source) => `${source.retrievedAt}\u0000${source.sourceId}\u0000${source.revision}`).at(-1);
}

type FactJudgement = Readonly<{ unverified: boolean; sourceChanged: boolean; usageChanged: boolean; sources: readonly RegionalSource[] }>;

type JudgeContext = Readonly<{
  facts: ReadonlyMap<string, FactItem>;
  realFacts: ReadonlyMap<string, RealFact>;
  realSources: readonly RealSource[];
  /** The SHA-256 of the original now, by the SHA-256 that the record has. `undefined`: it cannot be looked at. */
  currentSha: ReadonlyMap<string, string | undefined>;
}>;

/** What the facts that an issue rests on say about the issue: not verified, the original changed, the use changed. */
function judgeFacts(factIds: readonly string[], context: JudgeContext): FactJudgement {
  let unverified = false;
  let sourceChanged = false;
  let usageChanged = false;
  const sources: RegionalSource[] = [];
  const seen = new Set<string>();
  for (const factId of factIds) {
    const fact = context.facts.get(factId);
    if (fact === undefined) {
      unverified = true;
      continue;
    }
    if (!isReal(fact)) {
      const key = `FIXTURE\u0000${fact.fictionalSourceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ dataKind: "FIXTURE", sourceId: fact.fictionalSourceId });
      }
      continue;
    }
    const currentSha256 = (candidate: RealFact): string | undefined => context.currentSha.get(candidate.sha256);
    const verification: EffectiveVerification = effectiveVerification(fact, { factsById: context.realFacts, currentSha256 });
    const operands =
      fact.method.kind === "DERIVED"
        ? fact.method.operandFactIds.map((operandId) => context.realFacts.get(operandId))
        : [];
    const involved = [fact, ...operands.filter((operand): operand is RealFact => operand !== undefined)];
    if (involved.some((member) => currentSha256(member) !== member.sha256)) {
      sourceChanged = true;
    }
    if (verification.status === "PROVISIONAL") {
      const reasons = verification.reasons;
      const operandNotVerified = operands.some((operand) => operand !== undefined && operand.verification.status !== "VERIFIED");
      if (
        reasons.some((reason) => reason === "NOT_VERIFIED" || reason === "OPERAND_MISSING" || reason === "OPERAND_IS_DERIVED" || reason === "VALUE_MISMATCH") ||
        (reasons.includes("OPERAND_NOT_VERIFIED") && operandNotVerified)
      ) {
        unverified = true;
      }
    }
    const source = sourceOf(fact, context.realSources);
    if (source === undefined || source.usage.status !== "CONFIRMED" || source.transmission.status !== "ALLOWED") {
      usageChanged = true;
    }
    if (source !== undefined) {
      const key = `REAL_AI\u0000${source.sourceId}\u0000${source.revision}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(source);
      }
    }
  }
  return { unverified, sourceChanged, usageChanged, sources };
}

export type BuildApprovedIssueInput = Readonly<{
  record: IssueSourceRecord;
  /** The fact items that the record names, in the order of `basisFactIds`. */
  basisFacts: readonly FactItem[];
  sources: readonly RegionalSource[];
  approval: Readonly<{ approverId: string; approvedAt: string; approverCount: number }>;
}>;

/**
 * Makes the approved issue from the record of its version, its facts and sources, and its approval
 * (Req 13.2). The facts and the sources are the contracts of the fact item and the source as they
 * are, and `issueHash` is the SHA-256 that the approvals name. `CONTRACT_INVALID` when the whole is
 * not a valid approved issue: the strict contract is the last check of what an issue rests on (the
 * facts of real data are VERIFIED, and the sources have their terms of use confirmed and may be
 * sent to an external AI).
 */
export function buildApprovedIssue(input: BuildApprovedIssueInput): Outcome<ApprovedIssue, Readonly<{ code: "CONTRACT_INVALID" }>> {
  const { record } = input;
  const parsed = ApprovedIssueSchema.safeParse({
    dataKind: record.dataKind,
    issueId: record.issueId,
    version: record.version,
    themeId: record.themeId,
    title: record.title,
    statement: record.statement,
    factSummary: record.factSummary,
    background: record.background,
    notDeterminable: record.notDeterminable,
    additionalChecks: record.additionalChecks,
    decisionScenes: record.decisionScenes,
    responseDirections: record.responseDirections,
    provenance: record.provenance,
    approval: { status: "APPROVED", ...input.approval },
    issueHash: hashOf(record),
    basisFacts: [...input.basisFacts],
    sources: [...input.sources],
  });
  return parsed.success ? succeed(parsed.data) : fail({ code: "CONTRACT_INVALID" });
}

/** The output of the draft process that an issue stands for, so that the checks of a draft run again on it (Req 13.4 e). */
function candidateOutputOf(record: IssueSourceRecord): string {
  return JSON.stringify({
    themeId: record.themeId,
    title: record.title,
    statement: record.statement,
    basisFactIds: record.basisFactIds,
    factSummary: record.factSummary,
    background: record.background,
    notDeterminable: record.notDeterminable,
    additionalChecks: record.additionalChecks,
    decisionScenes: record.decisionScenes,
    responseDirections: record.responseDirections,
  });
}

function currentShaOf(source: RealSource, hashes: readonly string[] | null): string | undefined {
  if (hashes === null || hashes.length === 0) {
    return undefined;
  }
  return hashes.includes(source.sha256) ? source.sha256 : hashes[0];
}

/**
 * Reads the records and judges each issue that has an approval record. An issue that has none is in
 * neither list: it was never approved. The result does not depend on the order of the files or on
 * the clock.
 */
export async function loadIssueSnapshot(inputs: IssueInputs, settings: IssueSettings): Promise<Outcome<IssueSnapshot, LoadIssueSnapshotError>> {
  const { root } = inputs;

  const issueRead = await readRecords(root, "issues", IssueSourceRecordSchema, { recursive: true });
  if (!issueRead.ok) {
    return fail({ code: issueRead.error.code });
  }
  for (const stored of issueRead.value) {
    if (stored.relativePath !== `issues/${stored.record.issueId}/v${stored.record.version}.json`) {
      return fail({ code: "ISSUE_PATH_MISMATCH" });
    }
  }
  const ledgerRead = await readLedger(root);
  if (!ledgerRead.ok) {
    return fail({ code: ledgerRead.error.code });
  }
  const factsRead = await inputs.readFacts();
  if (!factsRead.ok) {
    return fail({ code: factsRead.error.code });
  }
  const sourcesRead = await inputs.readSources();
  if (!sourcesRead.ok) {
    return fail({ code: sourcesRead.error.code });
  }

  const records = issueRead.value.map((stored) => stored.record);
  const ledger = ledgerRead.value;
  const facts = factsRead.value;
  const sources = sourcesRead.value;
  const realSources = sources.filter(isRealSource);

  // The SHA-256 of each original as it is now, looked at once for each source.
  const currentSha = new Map<string, string | undefined>();
  const originals: { sourceId: string; revision: string; sha256: string; current: string | null }[] = [];
  for (const source of byKey(realSources, (item) => `${item.sourceId}\u0000${item.revision}`)) {
    const current = currentShaOf(source, await inputs.originalHashes(source));
    const earlier = currentSha.get(source.sha256);
    currentSha.set(source.sha256, earlier === source.sha256 ? earlier : current);
    originals.push({ sourceId: source.sourceId, revision: source.revision, sha256: source.sha256, current: current ?? null });
  }

  const inputDigest = Sha256Schema.parse(
    sha256Hex(
      encodeCanonicalJson({
        dataKind: root.dataKind,
        requiredApprovers: settings.requiredApprovers,
        checks: settings.checks,
        issues: byKey(records, hashOf),
        ledger: byKey(ledger, hashOf),
        facts: byKey(facts, hashOf),
        sources: byKey(sources, hashOf),
        originals,
      }),
    ),
  );

  const judge: JudgeContext = {
    facts: new Map(facts.map((fact) => [fact.factId, fact])),
    realFacts: new Map(facts.filter(isReal).map((fact) => [fact.factId, fact])),
    realSources,
    currentSha,
  };

  const byIssue = new Map<string, IssueSourceRecord[]>();
  for (const record of records) {
    byIssue.set(record.issueId, [...(byIssue.get(record.issueId) ?? []), record]);
  }

  const issues: ApprovedIssue[] = [];
  const withdrawn: WithdrawnIssue[] = [];
  const reasonsOf = new Map<string, readonly WithdrawnReason[]>();

  for (const issueId of [...byIssue.keys()].sort()) {
    const versions = byKey(byIssue.get(issueId) ?? [], (record) => String(record.version).padStart(12, "0"));
    const current = versions.at(-1);
    if (current === undefined) {
      continue;
    }
    const approvalRecords = ledger.filter((record) => record.type === "APPROVE" && record.targetKind === "ISSUE" && record.targetId === issueId);
    if (approvalRecords.length === 0) {
      // Never approved: it is not an issue that was withdrawn.
      continue;
    }

    const here = approvalsOf(ledger, { targetKind: "ISSUE", targetId: issueId, targetHash: hashOf(current) });
    const approverIds = [...new Set(here.valid.map((entry) => entry.approverId))].sort();
    const insufficient = approverIds.length < settings.requiredApprovers;

    const basisFacts = current.basisFactIds.map((factId) => judge.facts.get(factId)).filter((fact): fact is FactItem => fact !== undefined);
    const judged = judgeFacts(current.basisFactIds, judge);
    const checkContext: DraftCheckContext = {
      task: "ISSUE_CANDIDATE",
      dataKind: root.dataKind,
      config: settings.checks,
      evidence: [],
      facts: basisFacts,
      themes: settings.themes,
      factNumerals: factNumeralsOf(basisFacts),
      today: NOT_USED_DATE,
    };
    const checked = runDraftChecks(candidateOutputOf(current), checkContext);

    const holds = new Set<WithdrawnReason>();
    if (insufficient && here.revoked.length > 0) holds.add("REVOKED");
    if (here.all.length === 0) holds.add("CONTENT_CHANGED");
    if (insufficient) holds.add("APPROVAL_INSUFFICIENT");
    if (judged.sourceChanged) holds.add("SOURCE_CHANGED");
    if (judged.unverified) holds.add("FACT_UNVERIFIED");
    if (judged.usageChanged) holds.add("USAGE_CHANGED");
    if (!checked.ok) holds.add("CHECK_FAILED");
    const reasons = REASON_ORDER.filter((reason) => holds.has(reason));

    const [reason] = reasons;
    if (reason !== undefined) {
      withdrawn.push({ issueId, version: current.version, reason });
      reasonsOf.set(issueId, reasons);
      continue;
    }

    const earliest = byKey(here.valid, (entry) => `${entry.approvedAt}\u0000${entry.approverId}`)[0];
    if (earliest === undefined) {
      return fail({ code: "CONTRACT_INVALID" });
    }
    const built = buildApprovedIssue({
      record: current,
      basisFacts,
      sources: judged.sources,
      approval: { approverId: earliest.approverId, approvedAt: earliest.approvedAt, approverCount: approverIds.length },
    });
    if (!built.ok) {
      return fail(built.error);
    }
    issues.push(built.value);
  }

  return succeed({ issues, withdrawn, inputDigest, reasons: reasonsOf });
}
