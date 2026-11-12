import {
  BUNDLE_SCHEMA_VERSION,
  ISOInstantSchema,
  RegionalBundleSchema,
  requiredFixedTextKeys,
  type BuildKind,
  type RegionalBundle,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";
import { calculateContentHash, type Digest } from "./contentHash.js";

/** The only errors a browser receives when a bundle cannot be used. No bundle content is returned. */
export const BUNDLE_LOAD_ERROR_CODES = [
  "FETCH_FAILED",
  "TOO_LARGE",
  "NOT_JSON",
  "META_MISSING",
  "GENERATED_AT_INVALID",
  "SCHEMA_VERSION_MISMATCH",
  "DATA_VERSION_MISMATCH",
  "BUILD_KIND_MISMATCH",
  "SCHEMA_INVALID",
  "HASH_MISMATCH",
  "REFERENCE_BROKEN",
  "PUBLIC_CONDITION_FAILED",
] as const;

export type BundleLoadErrorCode = (typeof BUNDLE_LOAD_ERROR_CODES)[number];

/** The values embedded by the release build and checked before a bundle is used. */
export type ExpectedBundle = Readonly<{
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  dataVersion: string;
  buildKind: BuildKind;
}>;

/**
 * A nominal, immutable result of a successful verification. Its public fields are a
 * structural ViewBundle and SessionBundle. The private marker prevents construction
 * from an unchecked ordinary bundle outside this module.
 */
class VerifiedBundleImpl {
  private readonly verifiedMarker = true;

  readonly meta: RegionalBundle["meta"];
  readonly themes: RegionalBundle["themes"];
  readonly questions: RegionalBundle["questions"];
  readonly diagnosticSets: RegionalBundle["diagnosticSets"];
  readonly cards: RegionalBundle["cards"];
  readonly resultTexts: RegionalBundle["resultTexts"];
  readonly fixedTexts: RegionalBundle["fixedTexts"];
  readonly guidance: RegionalBundle["guidance"];
  readonly mapConfig: RegionalBundle["mapConfig"];
  readonly aiContribution: RegionalBundle["aiContribution"];

  constructor(bundle: RegionalBundle) {
    this.meta = bundle.meta;
    this.themes = bundle.themes;
    this.questions = bundle.questions;
    this.diagnosticSets = bundle.diagnosticSets;
    this.cards = bundle.cards;
    this.resultTexts = bundle.resultTexts;
    this.fixedTexts = bundle.fixedTexts;
    this.guidance = bundle.guidance;
    this.mapConfig = bundle.mapConfig;
    this.aiContribution = bundle.aiContribution;
  }
}

export type VerifiedBundle = VerifiedBundleImpl;

function failure(code: BundleLoadErrorCode): Result<VerifiedBundle, BundleLoadErrorCode> {
  return { ok: false, error: code };
}

function own(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key);
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function hasRequiredMeta(value: unknown): boolean {
  const meta = field(value, "meta");
  return ["schemaVersion", "generatedAt", "dataVersion", "buildKind", "contentHash"].every((key) => own(meta, key));
}

function allReferencesExist(bundle: RegionalBundle): boolean {
  const definedThemeIds = new Set(bundle.themes.map((theme) => theme.themeId));
  if (definedThemeIds.size !== bundle.themes.length || definedThemeIds.size !== 6) {
    return false;
  }
  const questionIds = new Set(bundle.questions.map((question) => question.questionId));
  const hasQuick = bundle.diagnosticSets.some((set) => set.setKind === "QUICK");
  if (!hasQuick) {
    return false;
  }
  const fixedKeys = new Set(bundle.fixedTexts.items.map((item) => item.key));
  if (requiredFixedTextKeys(bundle.meta.dataKind).some((key) => !fixedKeys.has(key))) {
    return false;
  }
  for (const set of bundle.diagnosticSets) {
    if (set.themeIds.some((themeId) => !definedThemeIds.has(themeId))) {
      return false;
    }
    for (const questionId of set.questionIds) {
      const question = bundle.questions.find((candidate) => candidate.questionId === questionId);
      if (question === undefined) {
        return false;
      }
      if (question.kind !== "PRIORITY_PICK" && !set.themeIds.includes(question.themeId)) {
        return false;
      }
    }
    for (const themeId of set.themeIds) {
      if (!bundle.cards.some((card) => card.themeId === themeId)) {
        return false;
      }
      for (const axis of ["IMPORTANCE", "TRADEOFF"] as const) {
        for (const level of [2, 1, 0, -1, -2] as const) {
          if (!bundle.resultTexts.some((text) => text.themeId === themeId && text.axis === axis && text.level === level)) {
            return false;
          }
        }
      }
      for (const scene of ["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"] as const) {
        if (!bundle.guidance.some((item) => item.themeId === themeId && item.scene === scene)) {
          return false;
        }
      }
    }
  }
  return true;
}

function publicConditionsHold(bundle: RegionalBundle): boolean {
  if (bundle.meta.dataKind !== "REAL_AI") {
    return false;
  }
  return bundle.cards.every(
    (card) => card.dataKind === "REAL_AI" && card.sources.every((source) => source.dataKind === "REAL_AI" && source.usage.status === "CONFIRMED"),
  );
}

/**
 * Verifies a complete bundle in the browser. It returns the first error code only and
 * never returns a partially parsed bundle. The caller can display a build-kind-specific
 * fixed failure message without exposing the bundle content.
 */
export async function verifyBundleText(
  text: string,
  expected: ExpectedBundle,
  digest?: Digest,
): Promise<Result<VerifiedBundle, BundleLoadErrorCode>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return failure("NOT_JSON");
  }
  if (!hasRequiredMeta(raw)) {
    return failure("META_MISSING");
  }
  const meta = field(raw, "meta");
  if (!ISOInstantSchema.safeParse(field(meta, "generatedAt")).success) {
    return failure("GENERATED_AT_INVALID");
  }
  if (field(meta, "schemaVersion") !== expected.schemaVersion) {
    return failure("SCHEMA_VERSION_MISMATCH");
  }
  if (field(meta, "dataVersion") !== expected.dataVersion) {
    return failure("DATA_VERSION_MISMATCH");
  }
  if (field(meta, "buildKind") !== expected.buildKind) {
    return failure("BUILD_KIND_MISMATCH");
  }
  const parsed = RegionalBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return failure("SCHEMA_INVALID");
  }
  let calculated: string;
  try {
    calculated = await calculateContentHash(parsed.data, digest);
  } catch {
    return failure("HASH_MISMATCH");
  }
  if (calculated !== parsed.data.meta.contentHash) {
    return failure("HASH_MISMATCH");
  }
  if (!allReferencesExist(parsed.data)) {
    return failure("REFERENCE_BROKEN");
  }
  if (parsed.data.meta.buildKind === "PUBLIC" && !publicConditionsHold(parsed.data)) {
    return failure("PUBLIC_CONDITION_FAILED");
  }
  return { ok: true, value: new VerifiedBundleImpl(parsed.data) };
}