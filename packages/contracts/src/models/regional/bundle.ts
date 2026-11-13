import { z } from "zod";

import { DataKindSchema, ISOInstantSchema, NonEmptyStringSchema, Sha256Schema } from "../primitives.js";
import { MapConfigSchema } from "./config.js";
import { FixedTextsSchema, GuidanceQuestionSchema, IssueCardSchema, ResultTextSchema } from "./content.js";
import { DiagnosticSetSchema, QuestionSchema, ThemeDefSchema } from "./core.js";

/** The requested source of a regional-values bundle. */
export const DATA_MODES = ["REAL", "FIXTURE", "REAL_PREFERRED"] as const;
export const RESOLVED_DATA_MODES = ["REAL", "FIXTURE"] as const;
export const BUILD_KINDS = ["DEMO", "PUBLIC"] as const;
export const BUNDLE_SCHEMA_VERSION = 1 as const;

export const DataModeSchema = z.enum(DATA_MODES);
export const ResolvedDataModeSchema = z.enum(RESOLVED_DATA_MODES);
export const BuildKindSchema = z.enum(BUILD_KINDS);

/** A reason is either a missing record that can be supplied, or a defective value. */
export const GATE_REASON_CODES = [
  "REAL_DATA_ABSENT",
  "USAGE_NOT_CONFIRMED",
  "NOTE_REVIEW_MISSING",
  "TRANSMISSION_NOT_ALLOWED",
  "LICENSE_INFO_MISSING",
  "FACT_NOT_VERIFIED",
  "CARD_NOT_APPROVED",
  "QUESTION_NOT_APPROVED",
  "RESULT_TEXT_NOT_APPROVED",
  "SOURCE_CHANGED",
  "SOURCE_FILE_MISSING",
  "CARD_COVERAGE_MISSING",
  "LEGAL_REVIEW_MISSING",
  "RELEASE_APPROVAL_MISSING",
  "APPROVER_COUNT_INSUFFICIENT",
  "FIXED_TEXT_NOT_APPROVED",
  "CONFIG_UNREADABLE",
  "CONTRACT_VIOLATION",
  "DATA_KIND_INVALID",
  "DATA_KIND_MIXED",
  "STORAGE_ROOT_MISMATCH",
  "QUOTE_NOT_FOUND",
  "QUOTE_TOO_LONG",
  "GROUNDING_FAILED",
  "FACT_VALUE_MISMATCH",
  "FACT_SOURCE_MISMATCH",
  "FICTIONAL_NAME_FOUND",
  "NEUTRALITY_VIOLATION",
  "SET_COMPOSITION_INVALID",
  "FIXED_TEXT_INVALID",
  "PUBLIC_REQUIRES_REAL",
] as const;

export const GateReasonCodeSchema = z.enum(GATE_REASON_CODES);
export const GATE_REASON_CLASS = {
  REAL_DATA_ABSENT: "SHORTAGE",
  USAGE_NOT_CONFIRMED: "SHORTAGE",
  NOTE_REVIEW_MISSING: "SHORTAGE",
  TRANSMISSION_NOT_ALLOWED: "SHORTAGE",
  LICENSE_INFO_MISSING: "SHORTAGE",
  FACT_NOT_VERIFIED: "SHORTAGE",
  CARD_NOT_APPROVED: "SHORTAGE",
  QUESTION_NOT_APPROVED: "SHORTAGE",
  RESULT_TEXT_NOT_APPROVED: "SHORTAGE",
  SOURCE_CHANGED: "SHORTAGE",
  SOURCE_FILE_MISSING: "SHORTAGE",
  CARD_COVERAGE_MISSING: "SHORTAGE",
  LEGAL_REVIEW_MISSING: "SHORTAGE",
  RELEASE_APPROVAL_MISSING: "SHORTAGE",
  APPROVER_COUNT_INSUFFICIENT: "SHORTAGE",
  FIXED_TEXT_NOT_APPROVED: "SHORTAGE",
  CONFIG_UNREADABLE: "DEFECT",
  CONTRACT_VIOLATION: "DEFECT",
  DATA_KIND_INVALID: "DEFECT",
  DATA_KIND_MIXED: "DEFECT",
  STORAGE_ROOT_MISMATCH: "DEFECT",
  QUOTE_NOT_FOUND: "DEFECT",
  QUOTE_TOO_LONG: "DEFECT",
  GROUNDING_FAILED: "DEFECT",
  FACT_VALUE_MISMATCH: "DEFECT",
  FACT_SOURCE_MISMATCH: "DEFECT",
  FICTIONAL_NAME_FOUND: "DEFECT",
  NEUTRALITY_VIOLATION: "DEFECT",
  SET_COMPOSITION_INVALID: "DEFECT",
  FIXED_TEXT_INVALID: "DEFECT",
  PUBLIC_REQUIRES_REAL: "DEFECT",
} as const satisfies Readonly<Record<(typeof GATE_REASON_CODES)[number], "SHORTAGE" | "DEFECT">>;

export const GateReasonClassSchema = z.enum(["SHORTAGE", "DEFECT"]);

function codeClassIsShortage(code: (typeof GATE_REASON_CODES)[number]): boolean {
  return GATE_REASON_CLASS[code] === "SHORTAGE";
}

/** Metadata common to all static regional-values bundles. */
export const BundleMetaSchema = z
  .object({
    schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
    generatedAt: ISOInstantSchema,
    dataVersion: NonEmptyStringSchema.max(32),
    buildKind: BuildKindSchema,
    dataKind: DataKindSchema,
    dataModeRequested: DataModeSchema,
    dataModeResolved: ResolvedDataModeSchema,
    switched: z.boolean(),
    switchReasonCodes: z.array(GateReasonCodeSchema),
    contentHash: Sha256Schema,
  })
  .strict()
  .superRefine((meta, context) => {
    const expectedKind = meta.dataModeResolved === "REAL" ? "REAL_AI" : "FIXTURE";
    if (meta.dataKind !== expectedKind) {
      context.addIssue({
        code: "custom",
        message: "dataKind must match dataModeResolved",
        path: ["dataKind"],
      });
    }
    const switched = meta.dataModeRequested === "REAL_PREFERRED" && meta.dataModeResolved === "FIXTURE";
    if (meta.switched !== switched) {
      context.addIssue({
        code: "custom",
        message: "switched must match the requested and resolved data modes",
        path: ["switched"],
      });
    }
    if ((meta.switchReasonCodes.length !== 0) !== meta.switched) {
      context.addIssue({
        code: "custom",
        message: "switchReasonCodes is empty exactly when the bundle did not switch",
        path: ["switchReasonCodes"],
      });
    }
    meta.switchReasonCodes.forEach((code, index) => {
      if (!codeClassIsShortage(code)) {
        context.addIssue({
          code: "custom",
          message: "Only a shortage can cause a switch to FIXTURE",
          path: ["switchReasonCodes", index],
        });
      }
    });
    if (meta.dataModeRequested === "REAL" && meta.dataModeResolved !== "REAL") {
      context.addIssue({ code: "custom", message: "REAL must resolve to REAL", path: ["dataModeResolved"] });
    }
    if (meta.dataModeRequested === "FIXTURE" && meta.dataModeResolved !== "FIXTURE") {
      context.addIssue({ code: "custom", message: "FIXTURE must resolve to FIXTURE", path: ["dataModeResolved"] });
    }
    if (
      meta.buildKind === "PUBLIC" &&
      (meta.dataKind !== "REAL_AI" || meta.dataModeRequested !== "REAL" || meta.switched)
    ) {
      context.addIssue({
        code: "custom",
        message: "A public bundle needs unswitched REAL data",
        path: ["buildKind"],
      });
    }
  });

const AiContributionSchema = z
  .object({
    drafted: z.number().int().min(0),
    rejectedByChecks: z.number().int().min(0),
    humanEdited: z.number().int().min(0),
    humanRejected: z.number().int().min(0),
  })
  .strict()
  .superRefine((contribution, context) => {
    if (contribution.rejectedByChecks + contribution.humanEdited + contribution.humanRejected > contribution.drafted) {
      context.addIssue({
        code: "custom",
        message: "The outcome counts must not exceed drafted",
        path: ["drafted"],
      });
    }
  });

/**
 * A static bundle. The public data type is uniform: questions, cards, result texts
 * and fixed texts have the same data kind as the meta data. Issue-card nested sources
 * and facts are constrained to their card's kind by IssueCardSchema.
 */
export const RegionalBundleSchema = z
  .object({
    meta: BundleMetaSchema,
    themes: z.array(ThemeDefSchema).length(6),
    questions: z.array(QuestionSchema),
    diagnosticSets: z.array(DiagnosticSetSchema),
    cards: z.array(IssueCardSchema),
    resultTexts: z.array(ResultTextSchema),
    fixedTexts: FixedTextsSchema,
    guidance: z.array(GuidanceQuestionSchema),
    mapConfig: MapConfigSchema,
    aiContribution: AiContributionSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const kind = bundle.meta.dataKind;
    bundle.questions.forEach((question, index) => {
      if (question.dataKind !== kind) {
        context.addIssue({ code: "custom", message: "Question dataKind must match meta", path: ["questions", index, "dataKind"] });
      }
    });
    bundle.cards.forEach((card, index) => {
      if (card.dataKind !== kind) {
        context.addIssue({ code: "custom", message: "Card dataKind must match meta", path: ["cards", index, "dataKind"] });
      }
    });
    bundle.resultTexts.forEach((text, index) => {
      if (text.dataKind !== kind) {
        context.addIssue({ code: "custom", message: "Result text dataKind must match meta", path: ["resultTexts", index, "dataKind"] });
      }
    });
    if (bundle.fixedTexts.dataKind !== kind) {
      context.addIssue({ code: "custom", message: "Fixed-text dataKind must match meta", path: ["fixedTexts", "dataKind"] });
    }
  });

export const GATE_TARGET_KINDS = [
  "ISSUE_CARD",
  "FACT_ITEM",
  "SOURCE",
  "QUESTION",
  "RESULT_TEXT",
  "FIXED_TEXT",
  "GUIDANCE_QUESTION",
  "DIAGNOSTIC_SET",
  "BUNDLE",
  "CONFIG",
  "RELEASE",
] as const;

/** A code and stable target ID only. It never carries a source body, answer or other content. */
export const GateFindingSchema = z
  .object({
    code: GateReasonCodeSchema,
    class: GateReasonClassSchema,
    targetKind: z.enum(GATE_TARGET_KINDS),
    targetId: NonEmptyStringSchema.nullable(),
  })
  .strict()
  .superRefine((finding, context) => {
    if (finding.class !== GATE_REASON_CLASS[finding.code]) {
      context.addIssue({ code: "custom", message: "Finding class must match its code", path: ["class"] });
    }
  });

const CheckStatusSchema = z.enum(["PASSED", "FAILED", "SKIPPED"]);
const BuildChecksSchema = z
  .object({
    dataBoundary: CheckStatusSchema,
    questionBank: CheckStatusSchema,
    issueCards: CheckStatusSchema,
    contentHash: CheckStatusSchema,
  })
  .strict();

const BuildOutputSchema = z
  .object({
    bundlePath: NonEmptyStringSchema,
    dataKind: DataKindSchema,
    contentHash: Sha256Schema,
    bytes: z.number().int().min(0),
  })
  .strict();

/** The build report contains stable codes and IDs, never source bodies or responses. */
export const BuildReportSchema = z
  .object({
    schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
    buildKind: BuildKindSchema,
    startedAt: ISOInstantSchema,
    finishedAt: ISOInstantSchema,
    dataModeRequested: DataModeSchema,
    dataModeResolved: ResolvedDataModeSchema.nullable(),
    switched: z.boolean(),
    switchReasonCodes: z.array(GateReasonCodeSchema),
    findings: z.array(GateFindingSchema),
    checks: BuildChecksSchema,
    output: BuildOutputSchema.nullable(),
    warnings: z.array(z.literal("DATA_MODE_SWITCHED")),
    exitCode: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .superRefine((report, context) => {
    const switched = report.dataModeRequested === "REAL_PREFERRED" && report.dataModeResolved === "FIXTURE";
    if (report.switched !== switched) {
      context.addIssue({ code: "custom", message: "switched must match the resolved mode", path: ["switched"] });
    }
    if ((report.switchReasonCodes.length !== 0) !== report.switched) {
      context.addIssue({ code: "custom", message: "switchReasonCodes must match switched", path: ["switchReasonCodes"] });
    }
    report.switchReasonCodes.forEach((code, index) => {
      if (!codeClassIsShortage(code)) {
        context.addIssue({ code: "custom", message: "Only shortages switch the data mode", path: ["switchReasonCodes", index] });
      }
    });
    const hasWarning = report.warnings.includes("DATA_MODE_SWITCHED");
    if (hasWarning !== report.switched || report.warnings.length !== (report.switched ? 1 : 0)) {
      context.addIssue({ code: "custom", message: "Warnings must match switched", path: ["warnings"] });
    }
    if (report.exitCode === 0 && (report.output === null || report.dataModeResolved === null)) {
      context.addIssue({ code: "custom", message: "A successful build needs its output and resolved mode", path: ["output"] });
    }
    if (report.exitCode === 1 && report.output !== null) {
      context.addIssue({ code: "custom", message: "A failed build has no output", path: ["output"] });
    }
    if (report.output !== null && report.dataModeResolved !== null) {
      const expectedKind = report.dataModeResolved === "REAL" ? "REAL_AI" : "FIXTURE";
      if (report.output.dataKind !== expectedKind) {
        context.addIssue({ code: "custom", message: "Output dataKind must match the resolved mode", path: ["output", "dataKind"] });
      }
    }
  });

export type DataMode = z.infer<typeof DataModeSchema>;
export type ResolvedDataMode = z.infer<typeof ResolvedDataModeSchema>;
export type BuildKind = z.infer<typeof BuildKindSchema>;
export type GateReasonCode = z.infer<typeof GateReasonCodeSchema>;
export type GateReasonClass = z.infer<typeof GateReasonClassSchema>;
export type BundleMeta = z.infer<typeof BundleMetaSchema>;
export type RegionalBundle = z.infer<typeof RegionalBundleSchema>;
export type GateFinding = z.infer<typeof GateFindingSchema>;
export type BuildReport = z.infer<typeof BuildReportSchema>;
export type AiContribution = z.infer<typeof AiContributionSchema>;