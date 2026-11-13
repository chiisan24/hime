/** Text metrics shared by deterministic question and content checks. */

/** Code points after trimming surrounding whitespace. */
export function lengthOf(value: string): number {
  return Array.from(value.trim()).length;
}

/** Code points after removing all whitespace and line breaks. */
export function contentLength(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

/** Non-empty sentences separated by Japanese terminal punctuation or a line break. */
export function sentencesOf(value: string): string[] {
  return value.split(/[。？！\r\n]/u).filter((sentence) => sentence.trim() !== "");
}

const DIGIT = "[0-9０-９]";
const KANJI_DIGIT = "[〇零一二三四五六七八九十百千万億]";

/**
 * A year with 年, an era year (令和7年, 令和元年), a number with thousands separators and a decimal
 * part ("1,973", "3.5", in half-width or full-width form), or a run of kanji numerals.
 */
const NUMERIC_TOKEN = new RegExp(
  [
    `${DIGIT}+年`,
    `(?:令和|平成|昭和)(?:元|(?:${DIGIT}|${KANJI_DIGIT})+)年`,
    `${DIGIT}+(?:[,，]${DIGIT}{3})*(?:[.．]${DIGIT}+)?`,
    `${KANJI_DIGIT}+`,
  ].join("|"),
  "gu",
);

/** True when the token lies wholly inside any occurrence of an exempt word, not only the first. */
function isExempt(source: string, index: number, token: string, exemptWords: readonly string[]): boolean {
  const end = index + token.length;
  return exemptWords.some((word) => {
    if (word === "") {
      return false;
    }
    for (let start = source.indexOf(word); start !== -1; start = source.indexOf(word, start + 1)) {
      if (index >= start && end <= start + word.length) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Finds numbers, full-width numbers, Japanese numeral sequences and era/year text.
 * A token wholly inside an exempt word is not returned. The original spelling is kept.
 */
export function numericTokens(value: string, numeralExemptWords: readonly string[] = []): string[] {
  const tokens: string[] = [];
  for (const match of value.matchAll(NUMERIC_TOKEN)) {
    const token = match[0];
    const index = match.index;
    if (token !== undefined && index !== undefined && !isExempt(value, index, token, numeralExemptWords)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * The forms in which a numeric token is compared: NFKC and without thousands separators, and,
 * for a token that ends with 年, also the same without 年. So "2020年", "２０２０年" and "2020" are
 * alike, and so are "1,973" and "１９７３". Kanji numerals are kept as they are.
 */
export function numeralForms(token: string): string[] {
  const normalized = token.normalize("NFKC").replaceAll(",", "");
  return normalized.endsWith("年") ? [normalized, normalized.slice(0, -1)] : [normalized];
}

/** NFKC-normalized partial-string match, so full-width and half-width forms are equal. */
export function containsAny(value: string, needles: readonly string[]): boolean {
  const normalized = value.normalize("NFKC");
  return needles.some((needle) => normalized.includes(needle.normalize("NFKC")));
}