import { checkGrounding } from "./checkGrounding.js";
import { factGroundingText } from "./factGroundingText.js";
import { decimalText, surveyLabel } from "./surveyDate.js";
import type { SurveyDate } from "./surveyDate.js";

/**
 * The sentence of a fact item whose value a fixed rule computed (13.11), and the check that the
 * numbers, the dates and the proper nouns of a sentence are the ones of the value (Req 7.20). The
 * sentence is made from a fixed template with the computed values put in: an AI writes nothing, and a
 * person who corrects a sentence is judged by the same check, which compares the numbers of the sentence
 * with the value that the method gives and with nothing else.
 *
 * Both are pure functions for the build and the intake, not for the browser.
 */

export type FactSentenceParts = Readonly<{
  /** The target area, as the fact item names it. */
  area: string;
  /** The name of the quantity in the sentence, for example 指定緊急避難場所の数. A person writes it, with no number in it. */
  subject: string;
  surveyDate: SurveyDate;
  /** The computed value and its unit. */
  amount: number;
  unit: string;
}>;

/**
 * The sentence of a computed fact: `<area>の<subject>は、<date>時点で<number><unit>です。` It is the template of a
 * derived fact (`deriveFact`) for a value that is not a change. The number is written without a separator of digits, as
 * `decimalText` writes it, and the date as `surveyLabel` writes it, the same as in `factGroundingText`.
 */
export function computedFactSentence(parts: FactSentenceParts): string {
  return `${parts.area}の${parts.subject}は、${surveyLabel(parts.surveyDate)}時点で${decimalText(parts.amount)}${parts.unit}です。`;
}

/** Why a sentence is not the sentence of its value. The order of this list is the order of the result. */
export const FACT_SENTENCE_VIOLATIONS = ["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED", "DATE_NOT_GROUNDED", "PROPER_NOUN_NOT_GROUNDED"] as const;

export type FactSentenceViolation = (typeof FACT_SENTENCE_VIOLATIONS)[number];

export type WrittenValue = Readonly<{ amount: number; unit: string }>;

export type FactSentenceCheckInput = Readonly<{
  sentence: string;
  /**
   * The value that the method gives. Its number is one that the sentence may repeat, and the dates and the
   * area of the sentence are the ones below.
   */
  value: WrittenValue;
  /**
   * The number and the unit that the sentence has to write, as it writes them: the value itself for a
   * computed fact, the size of a change for a derived one. `null` when the sentence writes no number
   * (a derived value that did not change).
   */
  written: WrittenValue | null;
  area: string;
  /** The survey dates that the sentence may name: one for a computed fact, those of the two operands for a derived one. */
  surveyDates: readonly [SurveyDate, ...SurveyDate[]];
  /**
   * The words of the definition (the name of a column, the value that a row is counted for). A number in them,
   * like the 65 of 65歳以上, may be repeated in the sentence.
   */
  definitionTexts?: readonly string[];
  /** The proper nouns of the settings. One that the sentence uses has to be in the area or in the words of the definition. */
  properNouns?: readonly string[];
  /** The words in which a kanji numeral is not a number (一時的). */
  numeralExemptWords?: readonly string[];
}>;

export type FactSentenceCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; violations: readonly FactSentenceViolation[] }>;

/** NFKC without white space, as the check of a comparison does, so that a space or a line break does not matter. */
function compact(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A number as a sentence writes it: plain, or with a comma between groups of three digits. */
function numberForms(amount: number): string[] {
  return [...new Set([decimalText(amount), amount.toLocaleString("en-US", { maximumFractionDigits: 20 })])];
}

/**
 * Whether the sentence writes the value: the number, right before the unit, and not a part of a longer number
 * (7件 is not in 27件, and 5件 is not in 3.5件).
 */
function writes(sentence: string, written: WrittenValue): boolean {
  const forms = numberForms(written.amount).map(escapeRegExp).join("|");
  return new RegExp(`(?<![0-9.,])(?:${forms})${escapeRegExp(compact(written.unit))}`, "u").test(compact(sentence));
}

/**
 * Checks that a sentence says the value and nothing else of numbers, dates and names:
 *  - it writes the number of the value before its unit (`VALUE_NOT_WRITTEN`), so a number that is changed to another
 *    one cannot pass because it is among the numbers of a date;
 *  - every number and every date in it is in the text of the value (`factGroundingText`: the value with its unit,
 *    the area and the survey dates, in the two forms that a sentence writes a date) or in the words of the definition
 *    (`NUMBER_NOT_GROUNDED`, `DATE_NOT_GROUNDED`); a kanji numeral is a number unless an exempt word has it;
 *  - a proper noun of the list that it uses is in the area or in the words of the definition (`PROPER_NOUN_NOT_GROUNDED`).
 *
 * It does not judge the meaning of the sentence, and it reads nothing but its input. The violations carry no value.
 */
export function checkFactSentence(input: FactSentenceCheckInput): FactSentenceCheck {
  const found = new Set<FactSentenceViolation>();
  if (input.written !== null && !writes(input.sentence, input.written)) {
    found.add("VALUE_NOT_WRITTEN");
  }

  const definition = (input.definitionTexts ?? []).join(" ");
  const groundText = input.surveyDates
    .map((surveyDate) => factGroundingText({ sentence: definition, value: input.value, area: input.area, surveyDate }))
    .join(" ");
  const failures = checkGrounding(input.sentence, groundText, {
    properNouns: input.properNouns ?? [],
    ...(input.numeralExemptWords === undefined ? {} : { numeralExemptWords: input.numeralExemptWords }),
  });
  for (const failure of failures) {
    found.add(failure.kind === "NUMBER" ? "NUMBER_NOT_GROUNDED" : failure.kind === "DATE" ? "DATE_NOT_GROUNDED" : "PROPER_NOUN_NOT_GROUNDED");
  }

  return found.size === 0 ? { ok: true } : { ok: false, violations: FACT_SENTENCE_VIOLATIONS.filter((violation) => found.has(violation)) };
}
