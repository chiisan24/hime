import { z } from "zod";

import {
  DataKindSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  Sha256Schema,
} from "../primitives.js";
import { LocatorSchema } from "../sources.js";
import { ThemeIdSchema } from "./core.js";
import { distinctStrings, limitedText, oneSentence } from "./limitedText.js";

/**
 * Regional values map: the AI draft process (Req 8). The AI output of each task, the saved draft,
 * the record of what a person did with a draft, and the approval ledger.
 *
 * Every object is strict. A draft record has no `disposition`: whether a draft was adopted is
 * derived from the draft events and the approval ledger, not stored (design D16).
 * A rank, a score, a recommendation or a superiority is not a field of any output, so the strict
 * objects reject it as an unknown key (Req 8.24, 13.2).
 */

const IdSchema = NonEmptyStringSchema.max(64);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const DRAFT_TASKS = [
  "ISSUE_CANDIDATE",
  "ISSUE_SUMMARY",
  "BACKGROUND_DRAFT",
  "TERM_GLOSS",
  "QUESTION_DRAFT",
  "NEUTRALITY_REVIEW",
  "THEME_CLASSIFY",
] as const;

export const DraftTaskSchema = z.enum(DRAFT_TASKS);

// ---------------------------------------------------------------------------
// Grounded sentences
// ---------------------------------------------------------------------------

/** A piece of a quotation that the AI may rest a sentence on (an input of the draft). */
export const EvidenceUnitSchema = z
  .object({
    /** "E1" and so on. Unique within one input (a property of the input, not of one unit). */
    evidenceId: IdSchema,
    sourceId: IdSchema,
    locator: LocatorSchema,
    /** The quotation as it stands in the original. */
    text: NonEmptyStringSchema,
  })
  .strict();

/** A sentence of at most 60 code points that rests on one or more evidence units. */
export const GroundedSentenceSchema = z
  .object({
    text: limitedText(1, 60),
    groundIds: distinctStrings(IdSchema).min(1),
  })
  .strict();

/**
 * One sentence of at most 60 code points that rests on one or more fact items, not on a
 * quotation (an issue candidate rests on fact items, Req 8.24).
 */
export const FactGroundedSentenceSchema = z
  .object({
    text: oneSentence(1, 60),
    groundFactIds: distinctStrings(IdSchema).min(1),
  })
  .strict();

/** What could be done about an issue. Only for reference: never an answer choice by itself (Req 8.25, 13.6). */
export const ResponseDirectionCandidateSchema = z
  .object({
    label: limitedText(1, 30),
    /** An affirmative expression. It does not state the other direction as a denial (a check of 11.3). */
    description: limitedText(1, 60),
    category: z.enum(["CHANGE", "CONTINUE", "NEUTRAL"]),
    status: z.literal("REFERENCE_ONLY"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Outputs of the tasks
// ---------------------------------------------------------------------------

/**
 * `UNCLASSIFIED` is allowed in an issue candidate only. A person decides the theme when the
 * candidate is adopted as an issue, and an approved issue has one of the six themes.
 */
export const CandidateThemeIdSchema = z.union([ThemeIdSchema, z.literal("UNCLASSIFIED")]);

/** One issue candidate of one call. A candidate is a proposal, not a fact (Req 8.25). */
export const IssueCandidateOutputSchema = z
  .object({
    themeId: CandidateThemeIdSchema,
    title: limitedText(1, 40),
    /** One sentence of a hypothesis. Its ending is a check of 11.3. */
    statement: oneSentence(1, 60),
    /** The verified fact items that the candidate rests on. */
    basisFactIds: distinctStrings(IdSchema).min(1).max(10),
    factSummary: z.array(FactGroundedSentenceSchema).min(1).max(4),
    background: z.array(FactGroundedSentenceSchema).max(4),
    notDeterminable: z.array(limitedText(1, 60)).min(1).max(5),
    additionalChecks: z.array(limitedText(1, 60)).min(1).max(5),
    decisionScenes: z.array(limitedText(1, 60)).max(3),
    responseDirections: z.array(ResponseDirectionCandidateSchema).max(4),
  })
  .strict()
  .superRefine((candidate, context) => {
    const basis = new Set<string>(candidate.basisFactIds);
    for (const section of ["factSummary", "background"] as const) {
      candidate[section].forEach((sentence, index) => {
        sentence.groundFactIds.forEach((factId, position) => {
          if (!basis.has(factId)) {
            context.addIssue({
              code: "custom",
              message: "A ground must be one of basisFactIds",
              path: [section, index, "groundFactIds", position],
            });
          }
        });
      });
    }
  });

export const IssueSummaryOutputSchema = z
  .object({ sentences: z.array(GroundedSentenceSchema).min(1).max(4) })
  .strict();

export const BackgroundDraftOutputSchema = z
  .object({ title: limitedText(1, 40), sentences: z.array(GroundedSentenceSchema).min(1).max(6) })
  .strict();

export const TermGlossOutputSchema = z
  .object({
    items: z
      .array(z.object({ term: limitedText(1, 40), sentences: z.array(GroundedSentenceSchema).min(1).max(3) }).strict())
      .min(1)
      .max(10),
  })
  .strict();

const DraftDirectionSchema = z
  .object({ text: NonEmptyStringSchema, category: z.enum(["CHANGE", "CONTINUE", "NEUTRAL"]) })
  .strict();

const draftQuestionCommon = {
  explanation: NonEmptyStringSchema,
  unsureLabel: NonEmptyStringSchema,
  declineLabel: NonEmptyStringSchema,
} as const;

/**
 * A draft of a question. The strings are not bounded here: the checks of the question bank
 * (`DR_QUESTION_RULES`) apply the same limits as to a question written by a person.
 */
export const QuestionDraftOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("IMPORTANCE"), themeId: ThemeIdSchema, ...draftQuestionCommon }).strict(),
  z
    .object({
      kind: z.literal("TRADEOFF"),
      themeId: ThemeIdSchema,
      text: NonEmptyStringSchema,
      premise: NonEmptyStringSchema,
      directionA: DraftDirectionSchema,
      directionB: DraftDirectionSchema,
      opinionLabels: z.tuple([
        NonEmptyStringSchema,
        NonEmptyStringSchema,
        NonEmptyStringSchema,
        NonEmptyStringSchema,
        NonEmptyStringSchema,
      ]),
      ...draftQuestionCommon,
    })
    .strict(),
  z.object({ kind: z.literal("PRIORITY_PICK"), text: NonEmptyStringSchema, ...draftQuestionCommon }).strict(),
]);

export const NeutralityReviewOutputSchema = z
  .object({
    verdict: z.enum(["NO_BIAS_FOUND", "BIAS_SUSPECTED"]),
    findings: z
      .array(
        z
          .object({
            target: z.enum(["TEXT", "EXPLANATION", "PREMISE", "DIRECTION_A", "DIRECTION_B", "LABELS"]),
            note: limitedText(1, 100),
          })
          .strict(),
      ),
  })
  .strict();

export const ThemeClassifyOutputSchema = z.object({ themeId: CandidateThemeIdSchema }).strict();

/** The schema that a saved draft output is checked against again, for each task. */
export const DRAFT_OUTPUT_SCHEMAS = {
  ISSUE_CANDIDATE: IssueCandidateOutputSchema,
  ISSUE_SUMMARY: IssueSummaryOutputSchema,
  BACKGROUND_DRAFT: BackgroundDraftOutputSchema,
  TERM_GLOSS: TermGlossOutputSchema,
  QUESTION_DRAFT: QuestionDraftOutputSchema,
  NEUTRALITY_REVIEW: NeutralityReviewOutputSchema,
  THEME_CLASSIFY: ThemeClassifyOutputSchema,
} as const satisfies Record<(typeof DRAFT_TASKS)[number], z.ZodType>;

// ---------------------------------------------------------------------------
// Draft records and events
// ---------------------------------------------------------------------------

/** The key of an idempotent run. `draftId` is the SHA-256 of the canonical JSON of the key. */
export const DraftRunKeySchema = z
  .object({
    task: DraftTaskSchema,
    promptVersion: IdSchema,
    modelId: IdSchema,
    inputHash: Sha256Schema,
  })
  .strict();

/**
 * A draft that passed the deterministic checks (Req 8.8). It never changes and has no
 * `disposition`. The output is checked again against the schema of the task.
 */
export const DraftRecordSchema = z
  .object({
    draftId: Sha256Schema,
    key: DraftRunKeySchema,
    dataKind: DataKindSchema,
    aiClass: z.literal("AI_DRAFT"),
    modelId: IdSchema,
    generatedAt: ISOInstantSchema,
    inputSources: z.array(
      z.object({ sourceId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema }).strict(),
    ),
    output: z.unknown(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.modelId !== record.key.modelId) {
      context.addIssue({ code: "custom", message: "modelId must equal key.modelId", path: ["modelId"] });
    }
    const seen = new Set<string>();
    record.inputSources.forEach((source, index) => {
      const key = `${source.sourceId}\u0000${source.revision}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "A source revision must be listed once",
          path: ["inputSources", index],
        });
      }
      seen.add(key);
    });
    const parsed = DRAFT_OUTPUT_SCHEMAS[record.key.task].safeParse(record.output);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ code: "custom", message: issue.message, path: ["output", ...issue.path] });
      }
    }
  });

export const DRAFT_EVENT_KINDS = [
  "DRAFTED",
  "REJECTED_BY_CHECKS",
  "HUMAN_ADOPTED",
  "HUMAN_EDITED",
  "HUMAN_REJECTED",
] as const;

/** What a draft can become when a person adopts it. The same kinds as the approval ledger. */
export const APPROVAL_TARGET_KINDS = ["QUESTION", "CARD", "RESULT_TEXT", "FIXED_TEXT", "ISSUE"] as const;
export const ApprovalTargetKindSchema = z.enum(APPROVAL_TARGET_KINDS);

/**
 * A record of the draft process. `HUMAN_ADOPTED` is a draft that a person adopted without a
 * change. It is not an approval and not a count of the contribution of the AI: it only lets the
 * adoption of a draft be derived.
 *
 *  - REJECTED_BY_CHECKS is not saved as a draft, so it has no `draftId`; every other kind has one.
 *  - The `HUMAN_*` kinds have the reviewer. The adoption kinds have the target they were adopted as.
 */
export const DraftEventSchema = z
  .object({
    eventId: Sha256Schema,
    at: ISOInstantSchema,
    dataKind: DataKindSchema,
    task: DraftTaskSchema,
    kind: z.enum(DRAFT_EVENT_KINDS),
    draftId: Sha256Schema.nullable(),
    reviewerId: IdSchema.optional(),
    target: z.object({ targetKind: ApprovalTargetKindSchema, targetId: IdSchema }).strict().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const human = event.kind.startsWith("HUMAN_");
    const adoption = event.kind === "HUMAN_ADOPTED" || event.kind === "HUMAN_EDITED";
    if (event.kind === "REJECTED_BY_CHECKS" ? event.draftId !== null : event.draftId === null) {
      context.addIssue({
        code: "custom",
        message:
          event.kind === "REJECTED_BY_CHECKS"
            ? "REJECTED_BY_CHECKS has no draftId (the draft is not saved)"
            : "This kind needs the draftId of a saved draft",
        path: ["draftId"],
      });
    }
    if (human !== (event.reviewerId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: human ? "A human record needs reviewerId" : "Only a human record has reviewerId",
        path: ["reviewerId"],
      });
    }
    if (adoption !== (event.target !== undefined)) {
      context.addIssue({
        code: "custom",
        message: adoption ? "An adoption needs the target" : "Only an adoption has a target",
        path: ["target"],
      });
    }
  });

// ---------------------------------------------------------------------------
// Approval ledger
// ---------------------------------------------------------------------------

/**
 * The six confirmations of a person who approves an issue (Req 8.27). Each is the literal `true`,
 * so a record that says a check was not made is a contract violation, not a weaker approval.
 */
export const IssueConfirmationSchema = z
  .object({
    factsMatch: z.literal(true),
    factAndHypothesisSeparated: z.literal(true),
    noCausalClaim: z.literal(true),
    noRecommendation: z.literal(true),
    unknownsStated: z.literal(true),
    sourcesShown: z.literal(true),
  })
  .strict();

const ledgerTarget = {
  targetKind: ApprovalTargetKindSchema,
  targetId: IdSchema,
  /** The SHA-256 of the canonical JSON of the target without its approval fields. */
  targetHash: Sha256Schema,
} as const;

const ApproveRecordSchema = z
  .object({
    type: z.literal("APPROVE"),
    ...ledgerTarget,
    /** The version of the issue. Only an issue has it. */
    targetVersion: z.number().int().positive().optional(),
    approverId: IdSchema,
    approvedAt: ISOInstantSchema,
    /** Only an approval of an issue has it, and it is required there. */
    issueChecks: IssueConfirmationSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const issue = record.targetKind === "ISSUE";
    for (const field of ["targetVersion", "issueChecks"] as const) {
      if (issue !== (record[field] !== undefined)) {
        context.addIssue({
          code: "custom",
          message: issue ? `An approval of an issue needs ${field}` : `Only an approval of an issue has ${field}`,
          path: [field],
        });
      }
    }
  });

const RevokeRecordSchema = z
  .object({
    type: z.literal("REVOKE"),
    ...ledgerTarget,
    revokerId: IdSchema,
    revokedAt: ISOInstantSchema,
  })
  .strict();

/**
 * A record of the approval ledger. One file for each record, never changed: an approval is
 * revoked by adding a REVOKE record. (Not named `ApprovalRecord`: the election feature has a
 * contract of that name.)
 */
export const ApprovalLedgerRecordSchema = z.discriminatedUnion("type", [ApproveRecordSchema, RevokeRecordSchema]);

export type DraftTask = z.infer<typeof DraftTaskSchema>;
export type EvidenceUnit = z.infer<typeof EvidenceUnitSchema>;
export type GroundedSentence = z.infer<typeof GroundedSentenceSchema>;
export type FactGroundedSentence = z.infer<typeof FactGroundedSentenceSchema>;
export type ResponseDirectionCandidate = z.infer<typeof ResponseDirectionCandidateSchema>;
export type CandidateThemeId = z.infer<typeof CandidateThemeIdSchema>;
export type IssueCandidateOutput = z.infer<typeof IssueCandidateOutputSchema>;
export type IssueSummaryOutput = z.infer<typeof IssueSummaryOutputSchema>;
export type BackgroundDraftOutput = z.infer<typeof BackgroundDraftOutputSchema>;
export type TermGlossOutput = z.infer<typeof TermGlossOutputSchema>;
export type QuestionDraftOutput = z.infer<typeof QuestionDraftOutputSchema>;
export type NeutralityReviewOutput = z.infer<typeof NeutralityReviewOutputSchema>;
export type ThemeClassifyOutput = z.infer<typeof ThemeClassifyOutputSchema>;
export type DraftRunKey = z.infer<typeof DraftRunKeySchema>;
export type DraftRecord = z.infer<typeof DraftRecordSchema>;
export type DraftEventKind = (typeof DRAFT_EVENT_KINDS)[number];
export type DraftEvent = z.infer<typeof DraftEventSchema>;
export type ApprovalTargetKind = z.infer<typeof ApprovalTargetKindSchema>;
export type IssueConfirmation = z.infer<typeof IssueConfirmationSchema>;
export type ApprovalLedgerRecord = z.infer<typeof ApprovalLedgerRecordSchema>;
