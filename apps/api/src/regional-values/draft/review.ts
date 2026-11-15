import {
  ApprovalLedgerRecordSchema,
  ISOInstantSchema,
  IssueCandidateOutputSchema,
  IssueSourceRecordSchema,
  THEME_IDS,
} from "@ehime-vote-navigator/contracts";
import type {
  ApprovalBasisFact,
  ApprovalLedgerRecord,
  ApprovalTargetKind,
  DraftEvent,
  DraftRecord,
  DraftTask,
  IssueConfirmation,
  IssueSourceRecord,
  ThemeId,
} from "@ehime-vote-navigator/contracts";

import { appendLedgerRecord, hashOf } from "./approvalLedger.js";
import { runDraftChecks } from "./checks.js";
import type { DraftCheckContext, DraftCheckViolation } from "./checks.js";
import { deriveDisposition } from "./disposition.js";
import { createFileIssueInputs } from "../issues/inputs.js";
import { makeDraftEvent, writeImmutableRecord } from "./draftStore.js";
import type { DraftStore, StoreErrorCode } from "./draftStore.js";
import { readRecords } from "./recordReader.js";
import { fail, succeed } from "./types.js";
import type { Outcome, RecordRoot } from "./types.js";

/**
 * What a person does with a draft, and the approvals (design: 人の確認と採用). Every step appends
 * a record and changes none: a draft has no field of its fate, so the fate is derived from the
 * records (`deriveDisposition`).
 */

export type ReviewError =
  | Readonly<{ code: "DRAFT_NOT_FOUND" | "DECISION_ALREADY_MADE" | "TARGET_KIND_INVALID" | "THEME_NOT_DECIDED" }>
  | Readonly<{ code: "RECHECK_CONTEXT_MISSING" | "EDITED_OUTPUT_INVALID" }>
  | Readonly<{ code: "RECHECK_FAILED"; violations: readonly DraftCheckViolation[] }>
  | Readonly<{ code: "ISSUE_RECORD_INVALID" | "ISSUE_RECORD_CONFLICT" | "TARGET_NOT_FOUND" | "TARGET_HASH_REQUIRED" | "TARGET_HASH_MISMATCH" }>
  /** The fact items that the version names are not all there, so the approval cannot say what it rests on. Nothing is written. */
  | Readonly<{ code: "BASIS_FACT_NOT_FOUND"; factIds: readonly string[] }>
  | Readonly<{ code: "STORE_READ_FAILED" | "STORE_WRITE_FAILED"; cause: StoreErrorCode }>;

export type ReviewDeps = Readonly<{
  store: DraftStore;
  now: () => Date;
}>;

function instantOf(deps: ReviewDeps): DraftEvent["at"] {
  return ISOInstantSchema.parse(deps.now().toISOString());
}

/** The kinds of target that the output of a task can be adopted as. */
const TARGET_KINDS_OF_TASK: Readonly<Record<DraftTask, readonly ApprovalTargetKind[]>> = {
  ISSUE_CANDIDATE: ["ISSUE"],
  ISSUE_SUMMARY: ["CARD"],
  BACKGROUND_DRAFT: ["CARD"],
  TERM_GLOSS: ["CARD"],
  THEME_CLASSIFY: ["CARD"],
  QUESTION_DRAFT: ["QUESTION"],
  NEUTRALITY_REVIEW: ["QUESTION"],
};

const SIX_THEMES: readonly string[] = THEME_IDS;

async function loadForDecision(
  deps: ReviewDeps,
  task: DraftTask,
  draftId: string,
): Promise<Outcome<DraftRecord, ReviewError>> {
  const draft = await deps.store.findDraft(task, draftId);
  if (!draft.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: draft.error.code });
  }
  if (draft.value === null) {
    return fail({ code: "DRAFT_NOT_FOUND" });
  }
  const events = await deps.store.loadEvents();
  if (!events.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: events.error.code });
  }
  // At most one record of adoption or rejection for a draft (design).
  if (deriveDisposition(draftId, events.value) !== "PENDING") {
    return fail({ code: "DECISION_ALREADY_MADE" });
  }
  return succeed(draft.value);
}

async function append(deps: ReviewDeps, event: DraftEvent): Promise<Outcome<DraftEvent, ReviewError>> {
  const appended = await deps.store.appendEvent(event);
  return appended.ok ? succeed(event) : fail({ code: "STORE_WRITE_FAILED", cause: appended.error.code });
}

export type AdoptArgs = Readonly<{
  task: DraftTask;
  draftId: string;
  reviewerId: string;
  target: Readonly<{ targetKind: ApprovalTargetKind; targetId: string }>;
  /** The output as a person changed it. Without it the draft is adopted as it is. */
  edited?: unknown;
  /** The theme that a person decided for a candidate that has none (`UNCLASSIFIED`). */
  themeId?: ThemeId;
  /** The input of the draft, to run the checks again on what a person changed. */
  recheck?: DraftCheckContext;
}>;

export type Adoption = Readonly<{
  event: DraftEvent;
  /** The record of the issue, when an issue candidate was adopted. */
  issueRecord?: IssueSourceRecord;
}>;

function issueRecordOf(
  draft: DraftRecord,
  output: unknown,
  themeId: ThemeId,
  issueId: string,
  humanEdited: boolean,
): IssueSourceRecord | null {
  const candidate = IssueCandidateOutputSchema.safeParse(output);
  if (!candidate.success) {
    return null;
  }
  const value = candidate.data;
  const record = IssueSourceRecordSchema.safeParse({
    issueId,
    version: 1,
    themeId,
    title: value.title,
    statement: value.statement,
    factSummary: value.factSummary,
    background: value.background,
    notDeterminable: value.notDeterminable,
    additionalChecks: value.additionalChecks,
    decisionScenes: value.decisionScenes,
    responseDirections: value.responseDirections,
    provenance: {
      aiInvolvement: "AI_DRAFT",
      draftId: draft.draftId,
      modelId: draft.modelId,
      promptVersion: draft.key.promptVersion,
      generatedAt: draft.generatedAt,
      humanEdited,
    },
    dataKind: draft.dataKind,
    basisFactIds: value.basisFactIds,
  });
  return record.success ? record.data : null;
}

/**
 * Adopts a draft. Without a change it is `HUMAN_ADOPTED`; when a person changed the content, or
 * decided the theme of a candidate that had none, it is `HUMAN_EDITED` and the changed content goes
 * through the checks again, under the same conditions as a draft (Req 8.8). An issue candidate also
 * makes the record of the issue (`issues/<issueId>/v1.json`), which is written before the event, so
 * an adoption without its issue record cannot be seen.
 */
export async function adoptDraft(deps: ReviewDeps, args: AdoptArgs): Promise<Outcome<Adoption, ReviewError>> {
  if (!TARGET_KINDS_OF_TASK[args.task].includes(args.target.targetKind)) {
    return fail({ code: "TARGET_KIND_INVALID" });
  }
  const loaded = await loadForDecision(deps, args.task, args.draftId);
  if (!loaded.ok) {
    return fail(loaded.error);
  }
  const draft = loaded.value;

  let output: unknown = args.edited === undefined ? draft.output : args.edited;
  if (args.task === "ISSUE_CANDIDATE" && typeof output === "object" && output !== null && (output as { themeId?: unknown }).themeId === "UNCLASSIFIED") {
    // A candidate has no theme until a person decides it (an issue has one of the six).
    if (args.themeId === undefined || !SIX_THEMES.includes(args.themeId)) {
      return fail({ code: "THEME_NOT_DECIDED" });
    }
    output = { ...(output as Record<string, unknown>), themeId: args.themeId };
  }

  const edited = hashOf(output) !== hashOf(draft.output);
  if (edited) {
    if (args.recheck === undefined) {
      return fail({ code: "RECHECK_CONTEXT_MISSING" });
    }
    const checked = runDraftChecks(JSON.stringify(output), args.recheck);
    if (!checked.ok) {
      return fail({ code: "RECHECK_FAILED", violations: checked.violations });
    }
    output = checked.output;
  }

  let issueRecord: IssueSourceRecord | undefined;
  if (args.task === "ISSUE_CANDIDATE") {
    const themeId = (output as { themeId: ThemeId }).themeId;
    const built = issueRecordOf(draft, output, themeId, args.target.targetId, edited);
    if (built === null) {
      return fail({ code: "ISSUE_RECORD_INVALID" });
    }
    const written = await writeImmutableRecord(deps.store.root, `issues/${built.issueId}/v${built.version}.json`, built);
    if (!written.ok) {
      return written.error.code === "IMMUTABLE_CONFLICT"
        ? fail({ code: "ISSUE_RECORD_CONFLICT" })
        : fail({ code: "STORE_WRITE_FAILED", cause: written.error.code });
    }
    issueRecord = built;
  }

  const event = makeDraftEvent({
    at: instantOf(deps),
    dataKind: draft.dataKind,
    task: args.task,
    kind: edited ? "HUMAN_EDITED" : "HUMAN_ADOPTED",
    draftId: draft.draftId,
    reviewerId: args.reviewerId,
    target: args.target,
  });
  const appended = await append(deps, event);
  if (!appended.ok) {
    return fail(appended.error);
  }
  return succeed(issueRecord === undefined ? { event } : { event, issueRecord });
}

export type RejectArgs = Readonly<{ task: DraftTask; draftId: string; reviewerId: string }>;

/** Rejects a draft (`HUMAN_REJECTED`). A rejected draft stays in the store: nothing is deleted. */
export async function rejectDraft(deps: ReviewDeps, args: RejectArgs): Promise<Outcome<DraftEvent, ReviewError>> {
  const loaded = await loadForDecision(deps, args.task, args.draftId);
  if (!loaded.ok) {
    return fail(loaded.error);
  }
  return append(
    deps,
    makeDraftEvent({
      at: instantOf(deps),
      dataKind: loaded.value.dataKind,
      task: args.task,
      kind: "HUMAN_REJECTED",
      draftId: loaded.value.draftId,
      reviewerId: args.reviewerId,
    }),
  );
}

export type LedgerTargetArgs = Readonly<{
  targetKind: ApprovalTargetKind;
  targetId: string;
  /** The SHA-256 of the content that is approved. An issue does not need it: it is the hash of the record of the version. */
  targetHash?: string;
  /** The version of an issue. */
  version?: number;
}>;

/** The hash that an approval of this target names. For an issue it is the SHA-256 of the record of the version. */
async function resolveTargetHash(
  root: RecordRoot,
  args: LedgerTargetArgs,
): Promise<Outcome<{ targetHash: string; targetVersion?: number; basisFactIds?: readonly string[] }, ReviewError>> {
  if (args.targetKind !== "ISSUE") {
    return args.targetHash === undefined ? fail({ code: "TARGET_HASH_REQUIRED" }) : succeed({ targetHash: args.targetHash });
  }
  if (args.version === undefined) {
    return fail({ code: "TARGET_NOT_FOUND" });
  }
  const read = await readRecords(root, `issues/${args.targetId}`, IssueSourceRecordSchema);
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  const found = read.value.find((stored) => stored.record.version === args.version);
  if (found === undefined) {
    return fail({ code: "TARGET_NOT_FOUND" });
  }
  const hash = hashOf(found.record);
  if (args.targetHash !== undefined && args.targetHash !== hash) {
    return fail({ code: "TARGET_HASH_MISMATCH" });
  }
  return succeed({ targetHash: hash, targetVersion: args.version, basisFactIds: found.record.basisFactIds });
}

/**
 * The fact items that an approval of an issue rests on, as they are now: the SHA-256 of each fact item that the version names,
 * in the order of `basisFactIds`. The person approves the issue on these facts, so a fact item that is not there is a reason not
 * to approve, and nothing is written.
 */
async function basisFactsOf(root: RecordRoot, basisFactIds: readonly string[]): Promise<Outcome<readonly ApprovalBasisFact[], ReviewError>> {
  const read = await createFileIssueInputs(root).readFacts();
  if (!read.ok) {
    return fail({ code: "STORE_READ_FAILED", cause: read.error.code });
  }
  const byId = new Map(read.value.map((fact) => [fact.factId, fact] as const));
  const missing = basisFactIds.filter((factId) => !byId.has(factId));
  if (missing.length > 0) {
    return fail({ code: "BASIS_FACT_NOT_FOUND", factIds: missing });
  }
  return succeed(basisFactIds.map((factId) => ({ factId, sha256: hashOf(byId.get(factId)) })));
}

export type ApproveArgs = LedgerTargetArgs &
  Readonly<{
    approverId: string;
    /** The six confirmations of an issue. Only an issue has them, and every one is `true`. */
    issueChecks?: IssueConfirmation;
  }>;

/** Adds an approval to the ledger. The target is not changed. */
export async function approveTarget(deps: ReviewDeps, args: ApproveArgs): Promise<Outcome<ApprovalLedgerRecord, ReviewError>> {
  const resolved = await resolveTargetHash(deps.store.root, args);
  if (!resolved.ok) {
    return fail(resolved.error);
  }
  const common = {
    type: "APPROVE" as const,
    targetKind: args.targetKind,
    targetId: args.targetId,
    targetHash: resolved.value.targetHash,
    approverId: args.approverId,
    approvedAt: deps.now().toISOString(),
  };
  let candidate: Record<string, unknown> = common;
  if (args.targetKind === "ISSUE") {
    // The approval names the facts that it rests on, with their SHA-256 now. If the facts are made again later, the approval does not come back.
    const basis = await basisFactsOf(deps.store.root, resolved.value.basisFactIds ?? []);
    if (!basis.ok) {
      return fail(basis.error);
    }
    candidate = { ...common, targetVersion: resolved.value.targetVersion, issueChecks: args.issueChecks, basisFacts: basis.value };
  }
  const written = await appendLedgerRecordFrom(deps, candidate);
  return written;
}

export type RevokeArgs = LedgerTargetArgs & Readonly<{ revokerId: string }>;

/** Revokes the approvals of a content by adding a REVOKE record. The approvals are not deleted. */
export async function revokeApproval(deps: ReviewDeps, args: RevokeArgs): Promise<Outcome<ApprovalLedgerRecord, ReviewError>> {
  const resolved = await resolveTargetHash(deps.store.root, args);
  if (!resolved.ok) {
    return fail(resolved.error);
  }
  return appendLedgerRecordFrom(deps, {
    type: "REVOKE" as const,
    targetKind: args.targetKind,
    targetId: args.targetId,
    targetHash: resolved.value.targetHash,
    revokerId: args.revokerId,
    revokedAt: deps.now().toISOString(),
  });
}

async function appendLedgerRecordFrom(deps: ReviewDeps, candidate: unknown): Promise<Outcome<ApprovalLedgerRecord, ReviewError>> {
  const parsed = ApprovalLedgerRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail({ code: "STORE_WRITE_FAILED", cause: "RECORD_INVALID" });
  }
  const written = await appendLedgerRecord(deps.store.root, parsed.data);
  return written.ok ? succeed(parsed.data) : fail({ code: "STORE_WRITE_FAILED", cause: written.error.code });
}
