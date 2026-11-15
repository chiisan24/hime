import { decimalText, surveyLabel } from "./surveyDate.js";

/**
 * What the text is made from. A fact item has all of it (`FactItem` is assignable here); a value that is computed again, and a survey
 * date that is not a branded date yet, can be given without making a fact item.
 */
export type FactGroundingSource = Readonly<{
  sentence: string;
  value: Readonly<{ amount: number; unit: string }>;
  area: string;
  surveyDate: string | number;
}>;

/**
 * The text that a sentence of an issue candidate rests on, made from one fact item (design:
 * 課題候補の根拠の照合). `checkGrounding(sentence, quote, lists)` takes a quotation; an issue
 * candidate rests on fact items, not on a quotation, so the text of each of its fact items is
 * given as the quotation.
 *
 * The text is the sentence of the fact, the number with its unit, the area, and the survey date.
 * `checkGrounding` finds a date only when the quotation writes the same date in the same form, so
 * a date is written in the two forms that a sentence can use: 2025-04-01 and 2025年4月1日. A year
 * alone is written as 2025 and 2025年. A sentence of a candidate can then say "2025年4月1日" and
 * be found. A number that is not in the text, a calculated value for one, is not found.
 *
 * It is deterministic and has no side effect. It is for the build and the draft process, not for
 * the browser.
 */
export function factGroundingText(fact: FactGroundingSource): string {
  const amount = `${decimalText(fact.value.amount)}${fact.value.unit}`;
  const dates =
    typeof fact.surveyDate === "number"
      ? [String(fact.surveyDate), `${fact.surveyDate}年`]
      : [fact.surveyDate, surveyLabel(fact.surveyDate)];
  return [fact.sentence, amount, fact.area, ...dates].join(" ");
}
