import { z } from "zod";

import {
  CandidateIdSchema,
  ElectionIdSchema,
  ISODateSchema,
  NonEmptyStringSchema,
} from "./primitives.js";

/**
 * Multi-election registry contracts.
 *
 * These schemas are additive: the 2022-only `ElectionSchema` and the two-name
 * `CandidateSchema` in `election.ts` are intentionally untouched. Election
 * IDs, names, dates and candidate definitions are registry data, not code
 * constants. ID-format and code-point-length rules are layered here on top of
 * the shared brand types in `primitives.ts` (the brands are preserved).
 */

const ELECTION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function textUpTo(maxCodePoints: number) {
  return NonEmptyStringSchema.refine(
    (value) => codePointCount(value) <= maxCodePoints,
    `Must contain no more than ${maxCodePoints} Unicode code points`,
  );
}

const RegistryElectionIdSchema = ElectionIdSchema.refine(
  (value) => ELECTION_ID_PATTERN.test(value),
  "Must be 1 to 64 ASCII letters, digits or hyphens",
);

const RegistryCandidateIdSchema = CandidateIdSchema.refine(
  (value) => codePointCount(value) <= 64,
  "Must contain no more than 64 Unicode code points",
);

const ElectionNameSchema = textUpTo(100);
const CandidateNameSchema = textUpTo(50);
const NameFormSchema = textUpTo(50);

export const ELECTION_STATUSES = ["PAST", "CURRENT", "PLANNED"] as const;
export const ElectionStatusSchema = z.enum(ELECTION_STATUSES);

export const CandidateDefinitionSchema = z
  .object({
    candidateId: RegistryCandidateIdSchema,
    name: CandidateNameSchema,
    // Spellings that appear in source documents; the only strings used to
    // match a passage to a candidate.
    nameForms: z.array(NameFormSchema).min(1),
  })
  .strict();

export const ElectionDefinitionSchema = z
  .object({
    electionId: RegistryElectionIdSchema,
    name: ElectionNameSchema,
    electionDate: ISODateSchema,
    status: ElectionStatusSchema,
    candidates: z.array(CandidateDefinitionSchema).min(1).max(20),
  })
  .strict();

export const ElectionRegistryFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    elections: z.array(ElectionDefinitionSchema).min(1),
  })
  .strict();

export type ElectionStatus = z.infer<typeof ElectionStatusSchema>;
export type CandidateDefinition = z.infer<typeof CandidateDefinitionSchema>;
export type ElectionDefinition = z.infer<typeof ElectionDefinitionSchema>;
export type ElectionRegistryFile = z.infer<typeof ElectionRegistryFileSchema>;
