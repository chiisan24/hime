import { numeralForms, numericTokens } from "../bank/textMetrics.js";

/**
 * The check of the ground of a sentence (Req 7.6 b, 8.9 b). The numbers, the dates and the
 * proper nouns of a sentence must all be in the quotation that the sentence rests on. The check
 * of the issue cards and the check of the AI drafts (11.3) both use this function.
 *
 * It is deterministic and does not call an AI. Two sentences are not compared by meaning: a
 * number is found only when the quotation has the same number, so "7" is not found in "17",
 * and a date is found only when the quotation writes the same date in the same form.
 */

export type GroundingFailureKind = "NUMBER" | "DATE" | "PROPER_NOUN";

/** One thing in the sentence that the quotation does not have. */
export type GroundingFailure = Readonly<{ kind: GroundingFailureKind; value: string }>;

const ERA_YEAR = "(?:令和|平成|昭和)(?:元|[0-9]+)年";
const YEAR = `(?:${ERA_YEAR}|[0-9]+年)`;

/** A date with a day, a year with a month, and a numeric date. Applied to NFKC text. */
const DATE_EXPRESSION = new RegExp(
  [`${YEAR}?[0-9]{1,2}月[0-9]{1,2}日`, `${YEAR}[0-9]{1,2}月`, "[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}"].join("|"),
  "gu",
);

/** NFKC without white space, so that a space or a line break inside an expression does not matter. */
function compact(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

function unique(failures: readonly GroundingFailure[]): GroundingFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.kind}:${failure.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The lists from the settings that the check reads. */
export type GroundingLists = Readonly<{
  /** The proper nouns that must be in the quotation when the sentence uses them. */
  properNouns: readonly string[];
  /**
   * Words in which a kanji numeral is not a number (一時的, 一方). A numeral inside such a word is
   * not counted, in the sentence or in the quotation. Without the list, every kanji numeral is a number.
   */
  numeralExemptWords?: readonly string[];
}>;

/**
 * Returns what the sentence has that the quotation does not: its numbers, its dates and the proper
 * nouns of the list. An empty result means that the sentence is grounded. A name that is not in
 * the list is not checked.
 */
export function checkGrounding(
  sentence: string,
  quote: string,
  { properNouns, numeralExemptWords = [] }: GroundingLists,
): GroundingFailure[] {
  const quotedNumbers = new Set(numericTokens(quote, numeralExemptWords).flatMap(numeralForms));
  const quotedText = compact(quote);

  const numbers: GroundingFailure[] = numericTokens(sentence, numeralExemptWords)
    .filter((token) => !numeralForms(token).some((form) => quotedNumbers.has(form)))
    .map((value) => ({ kind: "NUMBER", value }));

  const dates: GroundingFailure[] = [...sentence.normalize("NFKC").matchAll(DATE_EXPRESSION)]
    .map((match) => match[0])
    .filter((expression) => !quotedText.includes(compact(expression)))
    .map((value) => ({ kind: "DATE", value }));

  const sentenceText = compact(sentence);
  const nouns: GroundingFailure[] = properNouns
    .filter((noun) => sentenceText.includes(compact(noun)) && !quotedText.includes(compact(noun)))
    .map((value) => ({ kind: "PROPER_NOUN", value }));

  return unique([...numbers, ...dates, ...nouns]);
}
