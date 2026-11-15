import { z } from "zod";

import {
  DataKindSchema,
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  Sha256Schema,
  SourceIdSchema,
} from "../primitives.js";
import { LocatorSchema, UrlSourceReferenceSchema, UsageReviewSchema } from "../sources.js";
import { LevelSchema, ThemeIdSchema } from "./core.js";
import {
  allowedPlaceholders,
  isFixedTextKey,
  requiredFixedTextKeys,
} from "./fixedTextKeys.js";

export {
  FIXED_TEXT_KEYS,
  allowedPlaceholders,
  isFixedTextKey,
  requiredFixedTextKeys,
  type FixedTextKey,
} from "./fixedTextKeys.js";

/**
 * Regional values map: approved content that is shown as it is (result texts,
 * fixed texts, guidance questions). Every object is strict. The length rules count
 * Unicode code points. (This file duplicates the small text metrics of core.ts on
 * purpose, so that core.ts keeps its helpers private.)
 */

const IdSchema = NonEmptyStringSchema.max(64);

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function sentencesOf(text: string): string[] {
  return text.split(/[。？！\r\n]/u).filter((sentence) => sentence.trim() !== "");
}

const SENTENCE_MAX = 60;
const RESULT_TEXT_MAX = 200;
const FIXED_TEXT_MAX = 300;

/** Text of 1 to `max` code points in which every sentence has at most 60. */
function shownText(max: number) {
  return NonEmptyStringSchema.superRefine((value, context) => {
    const length = codePointCount(value.trim());
    if (length < 1 || length > max) {
      context.addIssue({ code: "custom", message: `Must contain 1 to ${max} Unicode code points` });
    }
    if (sentencesOf(value).some((sentence) => codePointCount(sentence.trim()) > SENTENCE_MAX)) {
      context.addIssue({
        code: "custom",
        message: `Every sentence must contain no more than ${SENTENCE_MAX} Unicode code points`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** PENDING has no record; APPROVED has the approver and the time of approval. */
export const ApprovalSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("PENDING") }).strict(),
  z
    .object({
      status: z.literal("APPROVED"),
      approverId: IdSchema,
      approvedAt: ISOInstantSchema,
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// Result texts: theme x axis x level
// ---------------------------------------------------------------------------

export const RESULT_AXES = ["IMPORTANCE", "TRADEOFF"] as const;

export const ResultTextSchema = z
  .object({
    dataKind: DataKindSchema,
    themeId: ThemeIdSchema,
    axis: z.enum(RESULT_AXES),
    level: LevelSchema,
    text: shownText(RESULT_TEXT_MAX),
    approval: ApprovalSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Fixed texts
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

export const FixedTextSchema = z
  .object({
    key: z.string().refine(isFixedTextKey, "Must be a key of the closed list"),
    text: shownText(FIXED_TEXT_MAX),
    approval: ApprovalSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (!isFixedTextKey(item.key)) {
      return;
    }
    const allowed = allowedPlaceholders(item.key);
    for (const name of placeholdersIn(item.text)) {
      if (!allowed.includes(name)) {
        context.addIssue({
          code: "custom",
          message: `The key ${item.key} does not allow the placeholder {${name}}`,
          path: ["text"],
        });
      }
    }
  });

/** One text for each required key of the data kind: a missing key and a repeated key are contract violations. */
export const FixedTextsSchema = z
  .object({
    dataKind: DataKindSchema,
    items: z.array(FixedTextSchema),
  })
  .strict()
  .superRefine((fixedTexts, context) => {
    const seen = new Set<string>();
    fixedTexts.items.forEach((item, index) => {
      if (seen.has(item.key)) {
        context.addIssue({
          code: "custom",
          message: "A key must appear only once",
          path: ["items", index, "key"],
        });
      }
      seen.add(item.key);
    });
    for (const key of requiredFixedTextKeys(fixedTexts.dataKind)) {
      if (!seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: `The required key ${key} is missing`,
          path: ["items"],
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Guidance questions: theme x scene
// ---------------------------------------------------------------------------

export const GUIDANCE_SCENES = ["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"] as const;

export const GuidanceQuestionSchema = z
  .object({
    themeId: ThemeIdSchema,
    scene: z.enum(GUIDANCE_SCENES),
    /** One sentence of at most 60 code points that ends with the question mark particle. */
    text: NonEmptyStringSchema.superRefine((value, context) => {
      const trimmed = value.trim();
      if (codePointCount(trimmed) > SENTENCE_MAX) {
        context.addIssue({ code: "custom", message: `Must contain no more than ${SENTENCE_MAX} Unicode code points` });
      }
      if (sentencesOf(trimmed).length !== 1) {
        context.addIssue({ code: "custom", message: "Must be one sentence" });
      }
      if (!/か[？?]?$/u.test(trimmed)) {
        context.addIssue({ code: "custom", message: "Must end with the question particle" });
      }
    }),
    linkSourceId: IdSchema.nullable(),
    approval: ApprovalSchema,
  })
  .strict();

export type Approval = z.infer<typeof ApprovalSchema>;
export type ResultText = z.infer<typeof ResultTextSchema>;
export type FixedText = z.infer<typeof FixedTextSchema>;
export type FixedTexts = z.infer<typeof FixedTextsSchema>;
export type GuidanceQuestion = z.infer<typeof GuidanceQuestionSchema>;
export type GuidanceScene = (typeof GUIDANCE_SCENES)[number];
export type ResultAxis = (typeof RESULT_AXES)[number];

// ---------------------------------------------------------------------------
// Sources, fact items and issue cards (Req 7)
// ---------------------------------------------------------------------------

/** The longest name of a technical term. PROVISIONAL: the requirements do not state it. */
const TERM_MAX = 40;

/** Text of 1 to `max` code points, counted after trimming. */
function limited(max: number) {
  return NonEmptyStringSchema.refine((value) => {
    const length = codePointCount(value.trim());
    return length >= 1 && length <= max;
  }, `Must contain 1 to ${max} Unicode code points`);
}

const UrlSchema = z.string().url();

const transmissionRecord = {
  checkedBy: IdSchema,
  checkedAt: ISOInstantSchema,
  evidence: NonEmptyStringSchema,
} as const;

/** Whether the source may be sent to an external AI (Req 8.7, 10.5 b). */
export const TransmissionReviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("UNKNOWN") }).strict(),
  z.object({ status: z.literal("ALLOWED"), ...transmissionRecord }).strict(),
  z.object({ status: z.literal("DENIED"), ...transmissionRecord }).strict(),
]);

/** The record of looking for a note that belongs to the data set (Req 7.5 i). */
export const DatasetNoteReviewSchema = z
  .object({
    hasSpecificNote: z.boolean(),
    noteSummary: NonEmptyStringSchema.optional(),
    checkedBy: IdSchema,
    checkedAt: ISOInstantSchema,
  })
  .strict()
  .superRefine((review, context) => {
    if (review.hasSpecificNote && review.noteSummary === undefined) {
      context.addIssue({
        code: "custom",
        message: "noteSummary is required when there is a specific note",
        path: ["noteSummary"],
      });
    }
  });

const LicenseSchema = z.object({ name: NonEmptyStringSchema, url: UrlSchema }).strict();

const DocumentIdReferenceSchema = z.object({ kind: z.literal("document-id"), documentId: IdSchema }).strict();

/** The data set in a public data catalog that a source comes from (Req 7.5 j). Only such a source has it. */
export const CatalogRefSchema = z.object({ name: NonEmptyStringSchema, datasetId: NonEmptyStringSchema }).strict();

/** A plain file name: no path separator and not a relative path (the same rule as the placement of an original). */
const SimpleFileNameSchema = NonEmptyStringSchema.refine(
  (name) => !/[\\/]/u.test(name) && name !== "." && name !== "..",
  "Must be a plain file name",
);

/**
 * The record of a conversion by a person from the format that the publisher offers (for example
 * xlsx) to the format that is taken in (CSV) (Req 7.24). A conversion is the work of a person and
 * cannot be reproduced by a machine, so the record names the person and the procedure.
 * Only a conversion that keeps every row is recorded: one row of the original is one row of the
 * result.
 */
export const SourceConversionSchema = z
  .object({
    originalFileName: SimpleFileNameSchema,
    originalSha256: Sha256Schema,
    /** The SHA-256 of the file that is taken in. It equals the `sha256` of the source. */
    convertedSha256: Sha256Schema,
    procedureId: IdSchema,
    procedureDocSha256: Sha256Schema,
    convertedBy: IdSchema,
    convertedAt: ISOInstantSchema,
    correspondence: z.literal("ROWS_PRESERVED"),
    originalRowCount: z.number().int().nonnegative(),
    convertedRowCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((conversion, context) => {
    if (conversion.originalRowCount !== conversion.convertedRowCount) {
      context.addIssue({
        code: "custom",
        message: "The number of rows must be the same before and after the conversion",
        path: ["convertedRowCount"],
      });
    }
  });

export const RealSourceSchema = z
  .object({
    dataKind: z.literal("REAL_AI"),
    sourceId: SourceIdSchema,
    revision: RevisionSchema,
    reference: z.discriminatedUnion("kind", [UrlSourceReferenceSchema, DocumentIdReferenceSchema]),
    publisher: NonEmptyStringSchema,
    publishedOn: ISODateSchema,
    retrievedAt: ISOInstantSchema,
    locator: LocatorSchema,
    sha256: Sha256Schema,
    usage: UsageReviewSchema,
    /** `null` means not checked yet. */
    datasetNote: DatasetNoteReviewSchema.nullable(),
    transmission: TransmissionReviewSchema,
    license: LicenseSchema,
    catalog: CatalogRefSchema.optional(),
    /** Only a source that was converted by a person has it. */
    conversion: SourceConversionSchema.optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.conversion !== undefined && source.conversion.convertedSha256 !== source.sha256) {
      context.addIssue({
        code: "custom",
        message: "conversion.convertedSha256 must equal the sha256 of the source",
        path: ["conversion", "convertedSha256"],
      });
    }
  });

/** A fictional source has a fictional document ID only: no URL and no real publisher name (Req 7.17). */
export const FixtureSourceSchema = z.object({ dataKind: z.literal("FIXTURE"), sourceId: IdSchema }).strict();

/** No election ID and no candidate ID: the strict objects reject them as unknown keys (Req 7.7). */
export const RegionalSourceSchema = z.discriminatedUnion("dataKind", [RealSourceSchema, FixtureSourceSchema]);

export const COMPUTED_AGGREGATIONS = ["COUNT_ROWS", "COUNT_ROWS_WHERE", "SUM_COLUMN"] as const;

/**
 * A value that a fixed rule computes from the rows of a table (Req 7.18 m, 7.25, 7.27).
 *
 *  - COUNT_ROWS: counts the rows. It has no `column`, no `equals` and no `whereColumn`.
 *  - COUNT_ROWS_WHERE: counts the rows in which `column` equals `equals`. It has no `whereColumn`.
 *  - SUM_COLUMN: adds the numbers of `column`. The rows can be limited to those in which
 *    `whereColumn` equals `equals`; `whereColumn` and `equals` are both null, or both set.
 *    `whereColumn` is written in this aggregation, and in no other.
 *
 * `sheet` is for a table that has sheets; a CSV has none. `dedupeColumns` names the columns that
 * decide that two rows are the same row (Req 7.27 c). Without it no row is dropped, and two
 * identical rows make the computation fail. It is never null: absent means no columns, so one
 * method has one form (the hash of the method is the hash of this form).
 */
const ComputedMethodSchema = z
  .object({
    kind: z.literal("COMPUTED"),
    aggregation: z.enum(COMPUTED_AGGREGATIONS),
    sheet: NonEmptyStringSchema.optional(),
    column: z.string().nullable(),
    whereColumn: z.string().nullable().optional(),
    equals: z.string().nullable(),
    dedupeColumns: z.array(NonEmptyStringSchema).min(1).optional(),
    description: NonEmptyStringSchema,
  })
  .strict();

const QuotedMethodSchema = z.object({ kind: z.literal("QUOTED"), description: NonEmptyStringSchema }).strict();

export const DERIVED_OPERATIONS = ["RATIO", "DIFFERENCE", "PERCENT_CHANGE"] as const;

/**
 * A value that is derived from two fact items that were verified (Req 7.25). The order of the two
 * operands means something: RATIO is numerator then denominator, and DIFFERENCE and PERCENT_CHANGE
 * are the later value then the earlier value. Only a fact of real data has a method, so only a
 * fact of real data can be derived. The unit pair is the units of the numerator and the
 * denominator of a ratio. An operand is never a derived fact (the MVP does not derive from a
 * derived value).
 */
const DerivedMethodSchema = z
  .object({
    kind: z.literal("DERIVED"),
    operation: z.enum(DERIVED_OPERATIONS),
    operandFactIds: z.tuple([IdSchema, IdSchema]),
    unitPair: z.object({ numerator: NonEmptyStringSchema, denominator: NonEmptyStringSchema }).strict().optional(),
    description: NonEmptyStringSchema,
  })
  .strict();

/** How the value was taken: counted or summed by a fixed rule, derived from verified facts, or quoted as it stands in the original. */
export const FactMethodSchema = z
  .discriminatedUnion("kind", [ComputedMethodSchema, QuotedMethodSchema, DerivedMethodSchema])
  .superRefine((method, context) => {
    if (method.kind === "DERIVED") {
      const [first, second] = method.operandFactIds;
      if (first === second) {
        context.addIssue({ code: "custom", message: "The two operands must be different facts", path: ["operandFactIds", 1] });
      }
      if (method.unitPair !== undefined && method.operation !== "RATIO") {
        context.addIssue({ code: "custom", message: "Only a RATIO has a unit pair", path: ["unitPair"] });
      }
      return;
    }
    if (method.kind !== "COMPUTED") {
      return;
    }
    const { aggregation } = method;
    const sum = aggregation === "SUM_COLUMN";
    const conditional = aggregation === "COUNT_ROWS_WHERE";
    // The rule of the two counts is the one that it was before SUM_COLUMN: set or null. A sum
    // names its columns, so an empty name is not accepted there.
    const need = (field: "column" | "equals", expected: boolean, nonBlank = false): void => {
      const value = method[field];
      const missing = expected ? value === null || (nonBlank && value.trim() === "") : value !== null;
      if (missing) {
        context.addIssue({
          code: "custom",
          message: expected ? `${aggregation} needs ${field}` : `${aggregation} has no ${field}`,
          path: [field],
        });
      }
    };
    if (sum) {
      need("column", true, true);
      // The condition of a sum: whereColumn is written, and it is set exactly when equals is set.
      const where = method.whereColumn;
      if (where === undefined) {
        context.addIssue({ code: "custom", message: "SUM_COLUMN needs whereColumn (null for no condition)", path: ["whereColumn"] });
      } else if ((where !== null) !== (method.equals !== null) || (where !== null && where.trim() === "")) {
        context.addIssue({
          code: "custom",
          message: "whereColumn and equals must both be set, or both be null",
          path: ["whereColumn"],
        });
      }
      return;
    }
    need("column", conditional);
    need("equals", conditional);
    if (method.whereColumn !== undefined) {
      context.addIssue({ code: "custom", message: `${aggregation} has no whereColumn`, path: ["whereColumn"] });
    }
  });

const FactValueSchema = z.object({ amount: z.number().finite(), unit: NonEmptyStringSchema }).strict();

const FactSentenceSchema = limited(200).refine(
  (value) => sentencesOf(value).length === 1,
  "Must be one sentence",
);

/** A date of the survey, or only the year (a Western-calendar year). */
const SurveyDateSchema = z.union([ISODateSchema, z.number().int().min(1900).max(2200)]);

const VerificationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("PROVISIONAL") }).strict(),
  z
    .object({ status: z.literal("VERIFIED"), verifierId: IdSchema, verifiedAt: ISOInstantSchema })
    .strict(),
]);

const factCommonShape = {
  factId: IdSchema,
  sentence: FactSentenceSchema,
  value: FactValueSchema,
  surveyDate: SurveyDateSchema,
  area: NonEmptyStringSchema,
} as const;

export const RealFactSchema = z
  .object({
    dataKind: z.literal("REAL_AI"),
    ...factCommonShape,
    publisher: NonEmptyStringSchema,
    sourceUrl: UrlSchema,
    datasetUrl: UrlSchema,
    license: LicenseSchema,
    retrievedAt: ISOInstantSchema,
    sha256: Sha256Schema,
    locator: LocatorSchema,
    method: FactMethodSchema,
    verification: VerificationSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    // A derived value is never derived from itself. (A derived value of a derived value is
    // refused where two facts are seen together: checkFactComparison, deriveFact.)
    if (fact.method.kind === "DERIVED" && fact.method.operandFactIds.includes(fact.factId)) {
      context.addIssue({
        code: "custom",
        message: "A derived fact must not be its own operand",
        path: ["method", "operandFactIds"],
      });
    }
  });

/** A fictional fact has the sentence, the value, the date, the area and a fictional document ID only. */
export const FixtureFactSchema = z
  .object({ dataKind: z.literal("FIXTURE"), ...factCommonShape, fictionalSourceId: IdSchema })
  .strict();

export const FactItemSchema = z.discriminatedUnion("dataKind", [RealFactSchema, FixtureFactSchema]);

const GlossaryEntrySchema = z.object({ term: limited(TERM_MAX), description: limited(200) }).strict();

const cardBaseShape = {
  cardId: IdSchema,
  themeId: ThemeIdSchema,
  title: limited(40),
  background: limited(400),
  glossary: z.array(GlossaryEntrySchema).min(1).max(10),
  quote: z.object({ sourceId: IdSchema, text: limited(200) }).strict(),
  aiInvolvement: z.enum(["HUMAN", "AI_DRAFT"]),
  updatedOn: ISODateSchema,
  /** APPROVED carries its record; PENDING carries none. */
  approval: ApprovalSchema,
} as const;

const RealCardSchema = z
  .object({
    ...cardBaseShape,
    dataKind: z.literal("REAL_AI"),
    sources: z.array(RealSourceSchema).min(1).max(10),
    facts: z.array(RealFactSchema).max(10),
  })
  .strict();

const FixtureCardSchema = z
  .object({
    ...cardBaseShape,
    dataKind: z.literal("FIXTURE"),
    sources: z.array(FixtureSourceSchema).min(1).max(10),
    facts: z.array(FixtureFactSchema).max(10),
  })
  .strict();

/**
 * An issue card. The data kind of the card, its sources and its facts agree by
 * construction, and the source of the quotation is one of the card's sources.
 */
export const IssueCardSchema = z
  .discriminatedUnion("dataKind", [RealCardSchema, FixtureCardSchema])
  .superRefine((card, context) => {
    const sourceIds = new Set<string>();
    for (const source of card.sources) {
      sourceIds.add(source.sourceId);
    }
    if (!sourceIds.has(card.quote.sourceId)) {
      context.addIssue({
        code: "custom",
        message: "The quotation must come from one of the sources of the card",
        path: ["quote", "sourceId"],
      });
    }
  });

/**
 * The license and the survey date, for the contracts of the data set ledger and the issues. They
 * are exported under names of this feature, so the barrel does not gain the generic names.
 */
export { LicenseSchema as RegionalLicenseSchema, SurveyDateSchema as RegionalSurveyDateSchema };

export type TransmissionReview = z.infer<typeof TransmissionReviewSchema>;
export type DatasetNoteReview = z.infer<typeof DatasetNoteReviewSchema>;
export type CatalogRef = z.infer<typeof CatalogRefSchema>;
export type RegionalSource = z.infer<typeof RegionalSourceSchema>;
export type RealSource = z.infer<typeof RealSourceSchema>;
export type FixtureSource = z.infer<typeof FixtureSourceSchema>;
export type SourceConversion = z.infer<typeof SourceConversionSchema>;
export type FactMethod = z.infer<typeof FactMethodSchema>;
export type FactItem = z.infer<typeof FactItemSchema>;
export type RealFact = z.infer<typeof RealFactSchema>;
export type FixtureFact = z.infer<typeof FixtureFactSchema>;
export type IssueCard = z.infer<typeof IssueCardSchema>;