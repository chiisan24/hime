/** Characters compared by the scorer: NFKC form, whitespace removed. */
export function normaliseForScoring(text: string): string[] {
  return [...text.normalize("NFKC").replace(/\s+/gu, "")];
}

/** Levenshtein distance between two character lists. */
export function editDistance(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(
        Math.min(substitution, (previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

export type TextScore = Readonly<{
  /** Edit distance divided by the reference length, in reading order. */
  cer: number;
  /** Harmonic mean of recall and precision; ignores the order of the characters. */
  f1: number;
  hypothesisChars: number;
  precision: number;
  recall: number;
  referenceChars: number;
}>;

/**
 * Compares recognised text with a human-checked reference. Both sides are
 * normalised first, so spacing and full-width forms do not count as errors.
 * The order-independent F1 separates misread characters from a different
 * reading order.
 */
export function scoreText(reference: string, hypothesis: string): TextScore {
  const expected = normaliseForScoring(reference);
  const actual = normaliseForScoring(hypothesis);

  const counts = new Map<string, number>();
  for (const character of expected) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let overlap = 0;
  for (const character of actual) {
    const remaining = counts.get(character) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(character, remaining - 1);
    }
  }

  const recall = expected.length === 0 ? (actual.length === 0 ? 1 : 0) : overlap / expected.length;
  const precision = actual.length === 0 ? (expected.length === 0 ? 1 : 0) : overlap / actual.length;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  const distance = editDistance(expected, actual);
  const cer = expected.length === 0 ? (actual.length === 0 ? 0 : 1) : distance / expected.length;

  return {
    cer,
    f1,
    hypothesisChars: actual.length,
    precision,
    recall,
    referenceChars: expected.length,
  };
}