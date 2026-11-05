import { z } from "zod";

import { NonEmptyStringSchema } from "./primitives.js";
import { LocatorSchema, ProvenanceSchema } from "./sources.js";

export const IMPLEMENTATION_STAGES = [
  "CONCEPT",
  "CONSIDERING",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;
export const ImplementationStageSchema = z.enum(IMPLEMENTATION_STAGES);

export const NegationSchema = z
  .object({
    target: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
  })
  .strict();

export const StructuredPolicySchema = z
  .object({
    target: NonEmptyStringSchema.nullable(),
    content: NonEmptyStringSchema.nullable(),
    conditions: z.array(NonEmptyStringSchema).readonly().nullable(),
    exceptions: z.array(NonEmptyStringSchema).readonly().nullable(),
    negation: NegationSchema.nullable(),
    implementationStage: ImplementationStageSchema.nullable(),
    deadline: NonEmptyStringSchema.nullable(),
    evidenceQuote: NonEmptyStringSchema.nullable(),
    locator: LocatorSchema.nullable(),
  })
  .strict();

export const CitationSchema = z
  .object({
    ...ProvenanceSchema.shape,
    citationId: NonEmptyStringSchema,
    locator: LocatorSchema,
    quote: NonEmptyStringSchema,
    policyUnitId: NonEmptyStringSchema,
  })
  .strict();

export type ImplementationStage = z.infer<typeof ImplementationStageSchema>;
export type Negation = z.infer<typeof NegationSchema>;
export type StructuredPolicy = z.infer<typeof StructuredPolicySchema>;
export type Citation = z.infer<typeof CitationSchema>;
