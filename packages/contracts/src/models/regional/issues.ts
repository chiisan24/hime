import { z } from "zod";

import {
  DataKindSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
  Sha256Schema,
} from "../primitives.js";
import {
  FixtureFactSchema,
  FixtureSourceSchema,
  RealFactSchema,
  RealSourceSchema,
} from "./content.js";
import { THEME_IDS, ThemeIdSchema } from "./core.js";
import { FactGroundedSentenceSchema, ResponseDirectionCandidateSchema } from "./draft.js";
import { distinctStrings, limitedText, oneSentence } from "./limitedText.js";

/**
 * Regional values map: the issues that a person approved, and the records around the file
 * `issues.json` that hands them to a co-developer (Req 13).
 *
 * The file is not part of the public bundle. Its contract has its own version, apart from the
 * version of the question contracts: a field is added within the same version, and a field is
 * removed or a type is changed with a new version. Every object is strict, and no field is a rank,
 * a score, a recommendation or a superiority.
 */

/** The version of the contract of `issues.json`. It is not the version of the question contracts. */
export const ISSUES_SCHEMA_VERSION = 1 as const;

const IdSchema = NonEmptyStringSchema.max(64);
const VersionSchema = z.number().int().positive();
const CountSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// The content of an issue
// ---------------------------------------------------------------------------

/**
 * What an issue says, apart from its facts, its sources and its approval. `UNCLASSIFIED` is not a
 * theme of an issue: a person decides the theme when a candidate is adopted as an issue.
 * An issue always comes from an AI draft, and a person may have edited it.
 */
const issueContentShape = {
  /** Kept when a person approves the issue again. */
  issueId: IdSchema,
  /** Goes up by one each time the content is changed. It is not the revision of a source. */
  version: VersionSchema,
  themeId: ThemeIdSchema,
  title: limitedText(1, 40),
  /** One sentence of a hypothesis. */
  statement: oneSentence(1, 60),
  factSummary: z.array(FactGroundedSentenceSchema).min(1).max(4),
  background: z.array(FactGroundedSentenceSchema).max(4),
  notDeterminable: z.array(limitedText(1, 60)).min(1).max(5),
  additionalChecks: z.array(limitedText(1, 60)).min(1).max(5),
  decisionScenes: z.array(limitedText(1, 60)).max(3),
  /** For reference only. */
  responseDirections: z.array(ResponseDirectionCandidateSchema).max(4),
  provenance: z
    .object({
      aiInvolvement: z.literal("AI_DRAFT"),
      draftId: Sha256Schema,
      modelId: IdSchema,
      promptVersion: IdSchema,
      generatedAt: ISOInstantSchema,
      humanEdited: z.boolean(),
    })
    .strict(),
} as const;

type GroundedContent = Readonly<{
  factSummary: readonly { groundFactIds: readonly string[] }[];
  background: readonly { groundFactIds: readonly string[] }[];
}>;

/** Every ground of a sentence is one of the given facts. */
function checkGrounds(factIds: ReadonlySet<string>, content: GroundedContent, context: z.RefinementCtx): void {
  for (const section of ["factSummary", "background"] as const) {
    content[section].forEach((sentence, index) => {
      sentence.groundFactIds.forEach((factId, position) => {
        if (!factIds.has(factId)) {
          context.addIssue({
            code: "custom",
            message: "A ground must be one of the facts of the issue",
            path: [section, index, "groundFactIds", position],
          });
        }
      });
    });
  }
}

/**
 * The record of one version of an issue: the content that a person approves. It never changes: a
 * change is the next version in a new record. The SHA-256 of its canonical JSON is the hash that
 * an approval names (`targetHash`) and the `issueHash` of the approved issue.
 */
export const IssueSourceRecordSchema = z
  .object({
    ...issueContentShape,
    dataKind: DataKindSchema,
    basisFactIds: distinctStrings(IdSchema).min(1).max(10),
  })
  .strict()
  .superRefine((record, context) => {
    checkGrounds(new Set<string>(record.basisFactIds), record, context);
  });

// ---------------------------------------------------------------------------
// An approved issue
// ---------------------------------------------------------------------------

const approvedIssueShape = {
  ...issueContentShape,
  approval: z
    .object({
      status: z.literal("APPROVED"),
      /** The approver of the earliest valid approval. */
      approverId: IdSchema,
      approvedAt: ISOInstantSchema,
      /** The number of different approvers of valid approvals. At least `requiredApprovers` (a check of 16.4). */
      approverCount: z.number().int().min(1),
    })
    .strict(),
  /** The SHA-256 of the canonical JSON of the issue record. */
  issueHash: Sha256Schema,
} as const;

function checkIssueFacts(
  issue: GroundedContent & { basisFacts: readonly { factId: string }[]; sources: readonly { sourceId: string }[] },
  context: z.RefinementCtx,
): void {
  const factIds = new Set<string>();
  issue.basisFacts.forEach((fact, index) => {
    if (factIds.has(fact.factId)) {
      context.addIssue({ code: "custom", message: "A fact must be listed once", path: ["basisFacts", index, "factId"] });
    }
    factIds.add(fact.factId);
  });
  checkGrounds(factIds, issue, context);
  const sourceIds = new Set<string>();
  issue.sources.forEach((source, index) => {
    if (sourceIds.has(source.sourceId)) {
      context.addIssue({ code: "custom", message: "A source must be listed once", path: ["sources", index, "sourceId"] });
    }
    sourceIds.add(source.sourceId);
  });
}

/** An approved issue of real data: verified facts, and sources that may be used and sent to an external AI. */
const RealApprovedIssueSchema = z
  .object({
    dataKind: z.literal("REAL_AI"),
    ...approvedIssueShape,
    basisFacts: z.array(RealFactSchema).min(1).max(10),
    sources: z.array(RealSourceSchema).min(1).max(10),
  })
  .strict()
  .superRefine((issue, context) => {
    checkIssueFacts(issue, context);
    const sourceHashes = new Set(issue.sources.map((source) => source.sha256));
    issue.basisFacts.forEach((fact, index) => {
      if (fact.verification.status !== "VERIFIED") {
        context.addIssue({
          code: "custom",
          message: "A fact of an approved issue must be VERIFIED",
          path: ["basisFacts", index, "verification", "status"],
        });
      }
      if (!sourceHashes.has(fact.sha256)) {
        context.addIssue({
          code: "custom",
          message: "The source of a fact must be one of the sources of the issue",
          path: ["basisFacts", index, "sha256"],
        });
      }
    });
    issue.sources.forEach((source, index) => {
      if (source.usage.status !== "CONFIRMED") {
        context.addIssue({
          code: "custom",
          message: "The terms of use of a source of an approved issue must be CONFIRMED",
          path: ["sources", index, "usage", "status"],
        });
      }
      if (source.transmission.status !== "ALLOWED") {
        context.addIssue({
          code: "custom",
          message: "A source of an approved issue must be allowed to be sent to an external AI",
          path: ["sources", index, "transmission", "status"],
        });
      }
    });
  });

/** An approved issue of fictional data. */
const FixtureApprovedIssueSchema = z
  .object({
    dataKind: z.literal("FIXTURE"),
    ...approvedIssueShape,
    basisFacts: z.array(FixtureFactSchema).min(1).max(10),
    sources: z.array(FixtureSourceSchema).min(1).max(10),
  })
  .strict()
  .superRefine((issue, context) => {
    checkIssueFacts(issue, context);
    const sourceIds = new Set(issue.sources.map((source) => source.sourceId));
    issue.basisFacts.forEach((fact, index) => {
      if (!sourceIds.has(fact.fictionalSourceId)) {
        context.addIssue({
          code: "custom",
          message: "The source of a fact must be one of the sources of the issue",
          path: ["basisFacts", index, "fictionalSourceId"],
        });
      }
    });
  });

/**
 * An issue that a person approved (Req 13.2). The facts and the sources are the contracts of the
 * fact item and the source, as they are: a value is not defined twice. A fact's source is one of
 * the sources of the issue, and every ground of a sentence is one of the facts.
 */
export const ApprovedIssueSchema = z.discriminatedUnion("dataKind", [RealApprovedIssueSchema, FixtureApprovedIssueSchema]);

// ---------------------------------------------------------------------------
// Issues that are no longer valid, and the file
// ---------------------------------------------------------------------------

/**
 * Why an issue that was approved is not valid now. When more than one reason applies, the first
 * of this list is the reason, so the list is in order of precedence.
 */
export const WITHDRAWN_REASONS = [
  "REVOKED",
  "CONTENT_CHANGED",
  "APPROVAL_INSUFFICIENT",
  "SOURCE_CHANGED",
  "FACT_UNVERIFIED",
  "USAGE_CHANGED",
  "CHECK_FAILED",
] as const;

export const WithdrawnReasonSchema = z.enum(WITHDRAWN_REASONS);

/**
 * An issue that has an approval record but is not valid now. It has no date: the time at which
 * this was found is `meta.generatedAt`, so the same input gives the same bytes.
 */
export const WithdrawnIssueSchema = z
  .object({
    issueId: IdSchema,
    /** The greatest version among the records of the issue. */
    version: VersionSchema,
    reason: WithdrawnReasonSchema,
  })
  .strict();

export const IssuesMetaSchema = z
  .object({
    schemaVersion: z.literal(ISSUES_SCHEMA_VERSION),
    kind: z.literal("ISSUES"),
    dataKind: DataKindSchema,
    generatedAt: ISOInstantSchema,
    /** The SHA-256 of the canonical JSON of the input. Not the time. A changed input changes it. */
    inputDigest: Sha256Schema,
    /** The SHA-256 of the canonical JSON of the file without this field. */
    contentHash: Sha256Schema,
  })
  .strict();

/**
 * `issues.json` (Req 13.1 to 13.4). The issues of fictional data and of real data are not mixed.
 * An issue is listed once, with its greatest version, and an issue that is withdrawn is not also
 * in the list of issues. `coverage` lists the six themes in the order of their definition.
 */
export const IssuesFileSchema = z
  .object({
    meta: IssuesMetaSchema,
    issues: z.array(ApprovedIssueSchema),
    withdrawn: z.array(WithdrawnIssueSchema),
    coverage: z
      .array(z.object({ themeId: ThemeIdSchema, issueCount: CountSchema }).strict())
      .length(THEME_IDS.length),
  })
  .strict()
  .superRefine((file, context) => {
    const issueIds = new Set<string>();
    file.issues.forEach((issue, index) => {
      if (issue.dataKind !== file.meta.dataKind) {
        context.addIssue({
          code: "custom",
          message: "Every issue must have the data kind of the file",
          path: ["issues", index, "dataKind"],
        });
      }
      if (issueIds.has(issue.issueId)) {
        context.addIssue({ code: "custom", message: "An issue must be listed once", path: ["issues", index, "issueId"] });
      }
      issueIds.add(issue.issueId);
    });
    const withdrawnIds = new Set<string>();
    file.withdrawn.forEach((withdrawn, index) => {
      if (issueIds.has(withdrawn.issueId) || withdrawnIds.has(withdrawn.issueId)) {
        context.addIssue({
          code: "custom",
          message: "An issue must be in one place only: the issues or the withdrawn issues, once",
          path: ["withdrawn", index, "issueId"],
        });
      }
      withdrawnIds.add(withdrawn.issueId);
    });
    file.coverage.forEach((entry, index) => {
      const themeId = THEME_IDS[index];
      if (entry.themeId !== themeId) {
        context.addIssue({
          code: "custom",
          message: "The themes must be in the order of their definition",
          path: ["coverage", index, "themeId"],
        });
        return;
      }
      const count = file.issues.filter((issue) => issue.themeId === themeId).length;
      if (entry.issueCount !== count) {
        context.addIssue({
          code: "custom",
          message: "issueCount must be the number of issues of the theme",
          path: ["coverage", index, "issueCount"],
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// The record of links
// ---------------------------------------------------------------------------

/**
 * The record of the issues that a question or an issue card rests on, by the ID and the version of
 * the issue. It is written by a person and is not public. It is not a field of a question or a
 * card, because those are the contracts of the public bundle (Req 13.7).
 */
export const IssueLinksFileSchema = z
  .object({
    schemaVersion: z.literal(ISSUES_SCHEMA_VERSION),
    dataKind: DataKindSchema,
    links: z.array(
      z
        .object({
          targetKind: z.enum(["QUESTION", "ISSUE_CARD"]),
          targetId: IdSchema,
          issueId: IdSchema,
          issueVersion: VersionSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((file, context) => {
    const seen = new Set<string>();
    file.links.forEach((link, index) => {
      const key = [link.targetKind, link.targetId, link.issueId].join("\u0000");
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "A target must name an issue once",
          path: ["links", index],
        });
      }
      seen.add(key);
    });
  });

// ---------------------------------------------------------------------------
// The state record of an export
// ---------------------------------------------------------------------------

export const EXPORT_STATUSES = ["RUNNING", "SUCCESS", "FAILED"] as const;

export const EXPORT_FAILURE_CODES = [
  "DELETE_FAILED",
  "INPUT_UNREADABLE",
  "DATA_KIND_MIXED",
  "CONTRACT_INVALID",
  "WRITE_FAILED",
] as const;

const exportedFileShape = {
  fileSha256: Sha256Schema,
  contentHash: Sha256Schema,
  inputDigest: Sha256Schema,
  generatedAt: ISOInstantSchema,
} as const;

/**
 * The record that says whether the last run of `issues export` succeeded (Req 13.1). A file
 * `issues.json` is valid only if this record says SUCCESS for the SHA-256 of that file, so a file
 * that was left by a run that failed, or by a run that stopped, is not taken for a valid output.
 * It has no text of an issue.
 */
export const IssuesExportReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("ISSUES_EXPORT_REPORT"),
    dataKind: DataKindSchema,
    status: z.enum(EXPORT_STATUSES),
    startedAt: ISOInstantSchema,
    /** null while the run is not finished. */
    finishedAt: ISOInstantSchema.nullable(),
    exitCode: z.union([z.literal(0), z.literal(1)]).nullable(),
    failureCode: z.enum(EXPORT_FAILURE_CODES).nullable(),
    /** The input of this run, if it could be computed. It is kept when the run fails. */
    inputDigest: Sha256Schema.nullable(),
    /** The old file that this run made invalid. */
    invalidated: z
      .object({ fileSha256: Sha256Schema, contentHash: Sha256Schema, deleted: z.boolean() })
      .strict()
      .nullable(),
    /** The file that this run wrote. Only a run that succeeded has it. */
    output: z
      .object({
        ...exportedFileShape,
        /** The version of the contract of the file. */
        issuesSchemaVersion: VersionSchema,
        issueCount: CountSchema,
        withdrawnCount: CountSchema,
      })
      .strict()
      .nullable(),
    /** The last output that was a success. It is kept in every state. */
    lastSuccess: z.object({ ...exportedFileShape }).strict().nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    const fail = (message: string, path: string): void => {
      context.addIssue({ code: "custom", message, path: [path] });
    };
    if (report.status === "SUCCESS") {
      if (report.output === null) fail("SUCCESS has the output", "output");
      if (report.failureCode !== null) fail("SUCCESS has no failureCode", "failureCode");
      if (report.exitCode !== 0) fail("SUCCESS has the exit code 0", "exitCode");
      if (report.finishedAt === null) fail("SUCCESS has the time it finished", "finishedAt");
      if (report.output !== null && report.inputDigest !== report.output.inputDigest) {
        fail("The input of the run must be the input of the output", "inputDigest");
      }
    } else if (report.status === "FAILED") {
      if (report.output !== null) fail("FAILED has no output", "output");
      if (report.failureCode === null) fail("FAILED has the failureCode", "failureCode");
      if (report.exitCode !== 1) fail("FAILED has the exit code 1", "exitCode");
      if (report.finishedAt === null) fail("FAILED has the time it finished", "finishedAt");
    } else {
      if (report.output !== null) fail("RUNNING has no output", "output");
      if (report.failureCode !== null) fail("RUNNING has no failureCode", "failureCode");
      if (report.exitCode !== null) fail("RUNNING has no exit code", "exitCode");
      if (report.finishedAt !== null) fail("RUNNING has not finished", "finishedAt");
    }
    if (report.finishedAt !== null && Date.parse(report.finishedAt) < Date.parse(report.startedAt)) {
      fail("finishedAt must not precede startedAt", "finishedAt");
    }
  });

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

/**
 * The record that a file `issues.json` of real data was handed to a co-developer (Req 13.11). It
 * is kept in Git and has no text of an issue. The person who handed it, the person who received
 * it and the time are what the command was told: they are self-reported (`attestation`) and are
 * not a proof of who the persons are. What the receipt can check is the file: its SHA-256, its
 * content hash, the input it was made from and the version of its contract.
 */
export const IssuesReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("ISSUES_RECEIPT"),
    dataKind: RealAiDataKindSchema,
    /** The version of the contract of the file that was handed over. */
    issuesSchemaVersion: VersionSchema,
    generatedAt: ISOInstantSchema,
    fileSha256: Sha256Schema,
    contentHash: Sha256Schema,
    inputDigest: Sha256Schema,
    issueCount: CountSchema,
    withdrawnCount: CountSchema,
    deliveredBy: IdSchema,
    receivedBy: IdSchema,
    receivedAt: ISOInstantSchema,
    attestation: z.literal("SELF_REPORTED"),
  })
  .strict();

export type IssueSourceRecord = z.infer<typeof IssueSourceRecordSchema>;
export type ApprovedIssue = z.infer<typeof ApprovedIssueSchema>;
export type WithdrawnReason = z.infer<typeof WithdrawnReasonSchema>;
export type WithdrawnIssue = z.infer<typeof WithdrawnIssueSchema>;
export type IssuesMeta = z.infer<typeof IssuesMetaSchema>;
export type IssuesFile = z.infer<typeof IssuesFileSchema>;
export type IssueLinksFile = z.infer<typeof IssueLinksFileSchema>;
export type IssuesExportReport = z.infer<typeof IssuesExportReportSchema>;
export type IssuesReceipt = z.infer<typeof IssuesReceiptSchema>;
