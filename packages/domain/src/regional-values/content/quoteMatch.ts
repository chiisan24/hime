/**
 * Matching a quotation against its source (Req 7.6 a, 7.11). The line breaks of a Japanese PDF
 * fall at places that the author of a quotation does not see, so both sides are compared after
 * every run of white space (a line break included) is replaced by one half-width space.
 */

/** Every run of white space, including line breaks, as one half-width space. Nothing else changes. */
export function normalizeSpacing(text: string): string {
  return text.replace(/\s+/gu, " ");
}

/**
 * True when the quotation is a part of the source text after both are put into the form above.
 * A quotation that is empty or only white space is never found, and one character of difference
 * is enough not to find it.
 */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  if (quote.trim() === "") {
    return false;
  }
  return normalizeSpacing(sourceText).includes(normalizeSpacing(quote));
}

/** The length of a quotation: the Unicode code points without the line breaks (Req 7.11). */
export function quoteLength(quote: string): number {
  return Array.from(quote.replace(/[\r\n]/gu, "")).length;
}

/** True when the length of the quotation is more than the limit. */
export function quoteExceedsLimit(quote: string, maxChars: number): boolean {
  return quoteLength(quote) > maxChars;
}
