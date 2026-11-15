import type { FactItem } from "@ehime-vote-navigator/contracts";

import { isLaterSurvey, surveyYear } from "./surveyDate.js";

/**
 * The conditions under which two fact items may be put side by side, put in a time series, or be
 * the operands of a derived value (Req 7.26). The check is deterministic and does not call an AI.
 * It judges the facts and the sentence that says the comparison; it does not judge the meaning of
 * the sentence. It is for the build and the draft process, not for the browser.
 *
 * The conditions:
 *  a. The units are the same. A ratio is the exception: it needs the unit pair (the unit of the
 *     numerator and the unit of the denominator) in the method, and the pair has to be the units
 *     of the two values.
 *  b. The areas are the same. Values of different areas are put side by side only in a sentence
 *     that names both areas and does not say that one is better: the check finds the names of
 *     the areas in the sentence and none of the words of superiority (a list of the settings).
 *     A time series and a change over time are of one area.
 *  c. The survey dates can be read. When the years are different, the sentence names both years.
 *  d. A time series is of values with the same definition (the method). When the definition
 *     changed, a person has to confirm that the values may be compared: the confirmation is an
 *     input, and without it a changed definition, or a definition that cannot be known, is refused.
 *
 * A derived value of a derived value is refused in the MVP. A DIFFERENCE and a PERCENT_CHANGE are
 * a change over time: the first operand is the later value and the second is the earlier value.
 */

export type DerivedOperation = "RATIO" | "DIFFERENCE" | "PERCENT_CHANGE";

/** The unit of the numerator and the unit of the denominator of a ratio. */
export type UnitPair = Readonly<{ numerator: string; denominator: string }>;

/** What the two facts are used for. */
export type ComparisonUse =
  | Readonly<{ kind: "COMPARE" }>
  | Readonly<{ kind: "TIME_SERIES" }>
  | Readonly<{ kind: "DERIVE"; operation: DerivedOperation; unitPair?: UnitPair }>;

/** Why a comparison is refused. The order of this list is the order of the result. */
export const COMPARISON_VIOLATIONS = [
  "UNIT_MISMATCH",
  "UNIT_PAIR_MISSING",
  "UNIT_PAIR_MISMATCH",
  "AREA_MISMATCH",
  "AREA_NOT_STATED",
  "SUPERIORITY_STATED",
  "SURVEY_DATE_UNREADABLE",
  "YEAR_NOT_STATED",
  "TIME_ORDER_INVALID",
  "DEFINITION_CHANGED",
  "DERIVED_OPERAND_NOT_ALLOWED",
] as const;

export type ComparisonViolation = (typeof COMPARISON_VIOLATIONS)[number];

export type FactComparisonInput = Readonly<{
  /** For a ratio, the numerator and the denominator. For a change over time, the later value and the earlier value. */
  operands: readonly [FactItem, FactItem];
  use: ComparisonUse;
  /** The sentence that says the comparison or the derived value, or `null` when it is not written yet. */
  sentence: string | null;
  /** The words of superiority of the settings. Without them no sentence is judged to say that one area is better. */
  superiorityWords?: readonly string[];
  /** A person confirmed that the values may be compared although the definition changed. */
  definitionChangeConfirmed?: boolean;
}>;

export type FactComparisonResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "FACT_COMPARISON_INVALID"; violations: readonly ComparisonViolation[] }>;

/** NFKC without white space, so that a space or a line break in a sentence does not matter. */
function compact(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

/** A year written in the sentence: not a part of a longer number (2024 is not in 12024). */
function mentionsYear(sentence: string, year: number): boolean {
  return new RegExp(`(?<![0-9])${year}(?![0-9])`, "u").test(sentence.normalize("NFKC"));
}

/** The method of a fact, without the free text that explains it, as a text to compare. `null`: the definition cannot be known. */
function definitionOf(fact: FactItem): string | null {
  if (fact.dataKind !== "REAL_AI") {
    return null;
  }
  const method = fact.method;
  switch (method.kind) {
    case "COMPUTED":
      return JSON.stringify([
        "COMPUTED",
        method.aggregation,
        method.sheet ?? null,
        method.column,
        method.whereColumn ?? null,
        method.equals,
        method.dedupeColumns ?? null,
      ]);
    case "QUOTED":
      return JSON.stringify(["QUOTED", method.description.normalize("NFKC").trim()]);
    case "DERIVED":
      return JSON.stringify(["DERIVED", method.operation, method.unitPair ?? null]);
  }
}

function isDerived(fact: FactItem): boolean {
  return fact.dataKind === "REAL_AI" && fact.method.kind === "DERIVED";
}

export function checkFactComparison(input: FactComparisonInput): FactComparisonResult {
  const [first, second] = input.operands;
  const { use, sentence } = input;
  const found = new Set<ComparisonViolation>();

  const derive = use.kind === "DERIVE" ? use : null;
  const ratio = derive?.operation === "RATIO";
  // A change over time: the two values are of one place and one definition, and the first is the later.
  const overTime = use.kind === "TIME_SERIES" || (derive !== null && !ratio);

  // a. Units.
  if (derive !== null && ratio) {
    const pair = derive.unitPair;
    if (pair === undefined) {
      found.add("UNIT_PAIR_MISSING");
    } else if (pair.numerator !== first.value.unit || pair.denominator !== second.value.unit) {
      found.add("UNIT_PAIR_MISMATCH");
    }
  } else if (first.value.unit !== second.value.unit) {
    found.add("UNIT_MISMATCH");
  }

  // b. Areas.
  if (first.area !== second.area) {
    if (overTime) {
      found.add("AREA_MISMATCH");
    } else {
      const text = sentence === null ? null : compact(sentence);
      if (text === null || !text.includes(compact(first.area)) || !text.includes(compact(second.area))) {
        found.add("AREA_NOT_STATED");
      }
      if (use.kind === "COMPARE" && sentence !== null) {
        const normalized = sentence.normalize("NFKC");
        if ((input.superiorityWords ?? []).some((word) => word !== "" && normalized.includes(word.normalize("NFKC")))) {
          found.add("SUPERIORITY_STATED");
        }
      }
    }
  }

  // c. Survey dates.
  const firstYear = surveyYear(first.surveyDate);
  const secondYear = surveyYear(second.surveyDate);
  if (firstYear === null || secondYear === null) {
    found.add("SURVEY_DATE_UNREADABLE");
  } else {
    if (firstYear !== secondYear && (sentence === null || !mentionsYear(sentence, firstYear) || !mentionsYear(sentence, secondYear))) {
      found.add("YEAR_NOT_STATED");
    }
    if (derive !== null && !ratio && !isLaterSurvey(first.surveyDate, second.surveyDate)) {
      found.add("TIME_ORDER_INVALID");
    }
  }

  // d. Definition of a time series.
  if (overTime && input.definitionChangeConfirmed !== true) {
    const firstDefinition = definitionOf(first);
    if (firstDefinition === null || firstDefinition !== definitionOf(second)) {
      found.add("DEFINITION_CHANGED");
    }
  }

  // The MVP does not derive a value from a derived value.
  if (derive !== null && (isDerived(first) || isDerived(second))) {
    found.add("DERIVED_OPERAND_NOT_ALLOWED");
  }

  if (found.size === 0) {
    return { ok: true };
  }
  return { ok: false, code: "FACT_COMPARISON_INVALID", violations: COMPARISON_VIOLATIONS.filter((violation) => found.has(violation)) };
}
