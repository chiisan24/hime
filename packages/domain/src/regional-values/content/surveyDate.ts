/**
 * Small, deterministic helpers for the survey date of a fact item and for a number in a sentence.
 * They are not exported from the package: `factGroundingText`, `checkFactComparison` and
 * `deriveFact` use them, so that the three read a date and a number in the same way.
 */

/** A survey date is a date (YYYY-MM-DD) or only the year (a Western-calendar year). */
export type SurveyDate = string | number;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** The year of a survey date, or `null` when the value cannot be read as a date or a year. */
export function surveyYear(surveyDate: SurveyDate): number | null {
  if (typeof surveyDate === "number") {
    return Number.isInteger(surveyDate) ? surveyDate : null;
  }
  const match = ISO_DATE.exec(surveyDate);
  return match === null ? null : Number(match[1]);
}

/**
 * Whether the first date is later than the second. Two dates are compared by the date; a date
 * and a year, or two years, are compared by the year, so the same year is not later.
 */
export function isLaterSurvey(first: SurveyDate, second: SurveyDate): boolean {
  const firstYear = surveyYear(first);
  const secondYear = surveyYear(second);
  if (firstYear === null || secondYear === null) {
    return false;
  }
  if (firstYear !== secondYear) {
    return firstYear > secondYear;
  }
  return typeof first === "string" && typeof second === "string" && first > second;
}

/** How a date is written in a sentence: 2025年4月1日 for a date, 2025年 for a year. */
export function surveyLabel(surveyDate: SurveyDate): string {
  if (typeof surveyDate === "number") {
    return `${surveyDate}年`;
  }
  const match = ISO_DATE.exec(surveyDate);
  return match === null ? surveyDate : `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

/** A number without an exponent, so that it can be read in a sentence and found in a quotation. */
export function decimalText(amount: number): string {
  const text = String(amount);
  if (!/e/iu.test(text)) {
    return text;
  }
  return amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}
