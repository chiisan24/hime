import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ] as const;

  return day <= (daysInMonth[month - 1] ?? 0);
}

function isRealIsoInstant(value: string): boolean {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (match === null || !isRealIsoDate(value.slice(0, 10))) {
    return false;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);

  return (
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHour >= 0 &&
    offsetHour <= 23 &&
    offsetMinute >= 0 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

export const NonEmptyStringSchema = z
  .string()
  .min(1)
  .regex(/\S/u, "Must contain a non-whitespace character");

const BrandedIdBaseSchema = NonEmptyStringSchema;

export const ElectionIdSchema = BrandedIdBaseSchema.brand<"ElectionId">();
export const CandidateIdSchema = BrandedIdBaseSchema.brand<"CandidateId">();
export const SourceIdSchema = BrandedIdBaseSchema.brand<"SourceId">();
export const RevisionSchema = BrandedIdBaseSchema.brand<"Revision">();
export const RunIdSchema = BrandedIdBaseSchema.brand<"RunId">();
export const ArtifactIdSchema = BrandedIdBaseSchema.brand<"ArtifactId">();

export const Sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "Must be a 64-character lowercase SHA-256 hex value")
  .brand<"Sha256LowerHex">();

export const ISODateSchema = z
  .string()
  .refine(isRealIsoDate, "Must be a real date in YYYY-MM-DD format")
  .brand<"ISODate">();

export const ISOInstantSchema = z
  .string()
  .refine(isRealIsoInstant, "Must be a valid ISO 8601 instant with a timezone")
  .brand<"ISOInstant">();

export const DATA_KINDS = ["REAL_AI", "FIXTURE"] as const;
export const DataKindSchema = z.enum(DATA_KINDS);
export const RealAiDataKindSchema = z.literal("REAL_AI");
export const FixtureDataKindSchema = z.literal("FIXTURE");

export const USAGE_STATUSES = ["CONFIRMED", "UNKNOWN", "RESTRICTED"] as const;
export const UsageStatusSchema = z.enum(USAGE_STATUSES);

export const READINESS_STATUSES = ["READY", "NOT_READY"] as const;
export const ReadinessStatusSchema = z.enum(READINESS_STATUSES);

export const AUTOMATIC_STATUSES = ["PASS", "REVIEW", "FAIL"] as const;
export const AutomaticStatusSchema = z.enum(AUTOMATIC_STATUSES);

export const HUMAN_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const HumanStatusSchema = z.enum(HUMAN_STATUSES);

export const ERROR_CLASSIFICATIONS = [
  "CREDENTIALS_MISSING",
  "ACCESS_DENIED",
  "MODEL_UNAVAILABLE",
  "THROTTLED",
  "INVALID_MODEL_JSON",
  "EXTRACTION_FAILED",
  "EVIDENCE_INSUFFICIENT",
] as const;
export const ErrorClassificationSchema = z.enum(ERROR_CLASSIFICATIONS);

export const API_ERROR_CODES = [
  ...ERROR_CLASSIFICATIONS,
  "VALIDATION_ERROR",
  "LOCAL_REQUEST_REJECTED",
  "NO_ACTIVE_ELECTION",
  "NOT_READY",
  "RUN_ALREADY_ACTIVE",
  "REFERENCE_RESOLUTION_FAILED",
  "MODEL_SCHEMA_INVALID",
  "APPROVAL_SNAPSHOT_STALE",
  "PERSISTENCE_FAILED",
  "VIEW_TIMEOUT",
  "INTERNAL_FAILURE",
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

export type ElectionId = z.infer<typeof ElectionIdSchema>;
export type CandidateId = z.infer<typeof CandidateIdSchema>;
export type SourceId = z.infer<typeof SourceIdSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type Sha256 = z.infer<typeof Sha256Schema>;
export type ISODate = z.infer<typeof ISODateSchema>;
export type ISOInstant = z.infer<typeof ISOInstantSchema>;
export type DataKind = z.infer<typeof DataKindSchema>;
export type UsageStatus = z.infer<typeof UsageStatusSchema>;
export type ReadinessStatus = z.infer<typeof ReadinessStatusSchema>;
export type AutomaticStatus = z.infer<typeof AutomaticStatusSchema>;
export type HumanStatus = z.infer<typeof HumanStatusSchema>;
export type ErrorClassification = z.infer<typeof ErrorClassificationSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
