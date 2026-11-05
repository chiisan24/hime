import { z } from "zod";

import {
  ArtifactIdSchema,
  AutomaticStatusSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
} from "./primitives.js";

export const DETERMINISTIC_CHECK_KINDS = [
  "QUOTE_EXISTS",
  "PROVENANCE_MATCH",
  "NUMBERS_AND_DATES",
  "NEGATION",
  "CONDITIONS_AND_EXCEPTIONS",
  "IMPLEMENTATION_STAGE",
  "DEADLINE",
] as const;
export const DeterministicCheckKindSchema = z.enum(DETERMINISTIC_CHECK_KINDS);

export const DETERMINISTIC_CHECK_OUTCOMES = [
  "PASS",
  "FAIL",
  "UNVERIFIABLE",
] as const;
export const DeterministicCheckOutcomeSchema = z.enum(
  DETERMINISTIC_CHECK_OUTCOMES,
);

export const SEMANTIC_CHECK_OUTCOMES = [
  "DETECTED",
  "NOT_DETECTED",
  "UNDETERMINED",
] as const;
export const SemanticCheckOutcomeSchema = z.enum(SEMANTIC_CHECK_OUTCOMES);

export const DeterministicCheckSchema = z
  .object({
    checkId: NonEmptyStringSchema,
    artifactId: ArtifactIdSchema,
    kind: DeterministicCheckKindSchema,
    outcome: DeterministicCheckOutcomeSchema,
    inputIds: z.array(NonEmptyStringSchema).readonly(),
    reasonCode: NonEmptyStringSchema,
    safeReason: NonEmptyStringSchema,
  })
  .strict();

export const SemanticCheckSchema = z
  .object({
    checkId: NonEmptyStringSchema,
    artifactId: ArtifactIdSchema,
    requestId: NonEmptyStringSchema.nullable(),
    modelId: NonEmptyStringSchema,
    promptVersion: NonEmptyStringSchema,
    meaningChange: SemanticCheckOutcomeSchema,
    meaningReversal: SemanticCheckOutcomeSchema,
    unsupportedAddition: SemanticCheckOutcomeSchema,
    safeReasons: z.array(NonEmptyStringSchema).readonly(),
  })
  .strict();

export const VerificationRecordSchema = z
  .object({
    verificationId: NonEmptyStringSchema,
    artifactId: ArtifactIdSchema,
    deterministic: z.array(DeterministicCheckSchema).readonly(),
    semantic: SemanticCheckSchema,
    automaticStatus: AutomaticStatusSchema,
    decisionReasonCodes: z.array(NonEmptyStringSchema).readonly(),
    createdAt: ISOInstantSchema,
  })
  .strict();

export type DeterministicCheckKind = z.infer<
  typeof DeterministicCheckKindSchema
>;
export type DeterministicCheckOutcome = z.infer<
  typeof DeterministicCheckOutcomeSchema
>;
export type SemanticCheckOutcome = z.infer<typeof SemanticCheckOutcomeSchema>;
export type DeterministicCheck = z.infer<typeof DeterministicCheckSchema>;
export type SemanticCheck = z.infer<typeof SemanticCheckSchema>;
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;
