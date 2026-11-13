import { z } from "zod";

/**
 * Regional values map: contracts for the settings files in
 * `config/regional-values/`.
 *
 * Every object is strict, so extra and missing keys are rejected. This file
 * imports `zod` only.
 */

/** The largest allowed T2: a theme score never exceeds 200 in absolute value. */
const MAX_THRESHOLD = 200;

/**
 * The two score thresholds that turn a score into a level: `0 < t1 < t2 <= 200`,
 * both integers. A score with an absolute value below `t1` is level 0, and one
 * at or above `t2` is level 2.
 */
const ThresholdsSchema = z
  .object({
    t1: z.number().int().positive(),
    t2: z.number().int().positive().max(MAX_THRESHOLD),
  })
  .strict()
  .superRefine((thresholds, context) => {
    if (thresholds.t1 >= thresholds.t2) {
      context.addIssue({
        code: "custom",
        message: "t1 must be less than t2",
        path: ["t2"],
      });
    }
  });

/** `config/regional-values/map.json`. */
export const MapConfigSchema = z
  .object({
    thresholds: ThresholdsSchema,
    /** Upper limit on the themes in the guidance on how to use the result (Req 6.6); at least 1. */
    guidanceMaxThemes: z.number().int().min(1),
  })
  .strict();

export type MapConfig = z.infer<typeof MapConfigSchema>;

/** A non-empty word or pattern used by a deterministic content check. */
const CheckTextSchema = z.string().min(1).refine((value) => /\S/u.test(value), "Must contain a non-whitespace character");
const CheckTextsSchema = z.array(CheckTextSchema);
const NonEmptyCheckTextsSchema = CheckTextsSchema.min(1);

function isValidPattern(value: string): boolean {
  try {
    return new RegExp(value, "u").source.length > 0;
  } catch {
    return false;
  }
}

/** A pattern is a regular expression (unicode mode), so that a bad one is refused when the settings are read. */
const PatternsSchema = z.array(CheckTextSchema.refine(isValidPattern, "Must be a valid regular expression"));

export const WORD_CATEGORIES = ["SUPERIORITY", "RECOMMENDATION", "VOTE_URGING"] as const;

const WordCategoriesSchema = z
  .object({
    SUPERIORITY: NonEmptyCheckTextsSchema,
    RECOMMENDATION: NonEmptyCheckTextsSchema,
    VOTE_URGING: NonEmptyCheckTextsSchema,
  })
  .strict();

/** `config/regional-values/neutrality.json`, with the content checks kept as data. */
export const NeutralityConfigSchema = z
  .object({
    candidateAndPartyNames: CheckTextsSchema,
    incumbencyWords: CheckTextsSchema,
    doubleQuestionWords: CheckTextsSchema,
    loadedWords: NonEmptyCheckTextsSchema,
    labelLengthDiffMax: z.number().int().min(0),
    directionLengthDiffMax: z.number().int().min(0),
    policyNames: CheckTextsSchema,
    budgetStanceWords: CheckTextsSchema,
    importanceTemplate: CheckTextSchema,
    premiseTemplates: NonEmptyCheckTextsSchema,
    negationWords: CheckTextsSchema,
    exclusiveWords: CheckTextsSchema,
    disparagingWords: CheckTextsSchema,
    bannedWords: CheckTextsSchema,
    numeralExemptWords: CheckTextsSchema,
    wordCategories: WordCategoriesSchema,
    guidanceNames: CheckTextsSchema,
    choiceEncouragingWords: CheckTextsSchema,
    userClaimPatterns: PatternsSchema,
  })
  .strict();

/** `config/regional-values/build.json`, excluding content that requires human approval. */
export const BuildConfigSchema = z
  .object({
    dataVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/u),
    quoteMaxChars: z.number().int().min(1),
    realNames: CheckTextsSchema,
    properNouns: CheckTextsSchema,
    requiredApprovers: z.number().int().min(1),
  })
  .strict();

export type NeutralityConfig = z.infer<typeof NeutralityConfigSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
export type WordCategory = (typeof WORD_CATEGORIES)[number];