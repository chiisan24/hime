import { z } from "zod";

import {
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
  Sha256Schema,
} from "../primitives.js";
import { TextLinesLocatorSchema, UsageReviewSchema } from "../sources.js";
import {
  CatalogRefSchema,
  DatasetNoteReviewSchema,
  RegionalLicenseSchema,
  RegionalSurveyDateSchema,
  TransmissionReviewSchema,
} from "./content.js";
import { THEME_IDS, ThemeIdSchema } from "./core.js";

/**
 * Regional values map: the data set ledger and the record of a computation (Req 7.23, 7.27).
 * Both are for real data (`REAL_AI`) only and are not part of the public bundle. Every object is
 * strict.
 */

const IdSchema = NonEmptyStringSchema.max(64);

export const DATASET_FILE_FORMATS = ["CSV", "XLSX", "PDF", "HTML", "OTHER"] as const;
export const DATASET_ENCODINGS = ["UTF-8", "UTF-8-BOM", "SHIFT_JIS", "UNKNOWN", "NOT_APPLICABLE"] as const;

/**
 * Whether a data set was chosen. It is a person's decision with the person and the reason, so a
 * candidate has none of them.
 */
const DatasetAdoptionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("CANDIDATE") }).strict(),
  z
    .object({
      status: z.enum(["ADOPTED", "REJECTED"]),
      decidedBy: IdSchema,
      decidedAt: ISOInstantSchema,
      reason: NonEmptyStringSchema,
    })
    .strict(),
]);

/**
 * A data set of a public data catalog (Req 7.23). That a data set exists is a different fact from
 * that it may be published and sent to an external AI: the two have their own fields.
 *
 * ADOPTED needs the terms of use to be CONFIRMED and the record of the check for a note that
 * belongs to the data set (`datasetNote` is not null). Whether the data set may be sent to an
 * external AI is not a condition of ADOPTED: it is a condition of the input of the draft process.
 */
export const DatasetRecordSchema = z
  .object({
    /** A stable key from the catalog name and the data set ID. */
    datasetKey: IdSchema,
    catalog: CatalogRefSchema,
    title: NonEmptyStringSchema,
    publisher: NonEmptyStringSchema,
    sourceUrl: z.string().url(),
    surveyDate: RegionalSurveyDateSchema,
    updatedOn: ISODateSchema.nullable(),
    coverageArea: NonEmptyStringSchema,
    format: z
      .object({
        fileFormat: z.enum(DATASET_FILE_FORMATS),
        encoding: z.enum(DATASET_ENCODINGS),
      })
      .strict(),
    usage: UsageReviewSchema,
    datasetNote: DatasetNoteReviewSchema.nullable(),
    transmission: TransmissionReviewSchema,
    license: RegionalLicenseSchema,
    adoption: DatasetAdoptionSchema,
    /** The themes that the data set belongs to. A theme is listed once. */
    themeIds: z
      .array(ThemeIdSchema)
      .max(THEME_IDS.length)
      .refine((themeIds) => new Set(themeIds).size === themeIds.length, "Must not list a theme twice"),
    /** The records of the source (one for each version) of the data set. */
    sourceIds: z.array(IdSchema).refine((ids) => new Set(ids).size === ids.length, "Must not list a source twice"),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.adoption.status !== "ADOPTED") {
      return;
    }
    if (record.usage.status !== "CONFIRMED") {
      context.addIssue({
        code: "custom",
        message: "An adopted data set needs the terms of use to be CONFIRMED",
        path: ["usage", "status"],
      });
    }
    if (record.datasetNote === null) {
      context.addIssue({
        code: "custom",
        message: "An adopted data set needs the record of the check for its own note",
        path: ["datasetNote"],
      });
    }
  });

/**
 * The record of one computation of a fact item (Req 7.27). It is written with the fact item, so a
 * person who verifies the fact can see how many cells were missing and how many rows were left
 * out as the same row. It holds numbers and hashes and no row of the table.
 */
export const AggregationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataKind: RealAiDataKindSchema,
    factId: IdSchema,
    /** The SHA-256 of the file that was read. */
    inputSha256: Sha256Schema,
    /** The SHA-256 of the canonical JSON of the method. */
    methodHash: Sha256Schema,
    surveyDate: RegionalSurveyDateSchema,
    /** The number of blank cells. */
    missingCount: z.number().int().nonnegative(),
    /** The number of rows left out because `dedupeColumns` made them the same row. 0 without `dedupeColumns`. */
    duplicatesRemoved: z.number().int().nonnegative(),
    /** The lines of the text that were used. */
    locator: TextLinesLocatorSchema,
  })
  .strict();

export type DatasetRecord = z.infer<typeof DatasetRecordSchema>;
export type AggregationRecord = z.infer<typeof AggregationRecordSchema>;
