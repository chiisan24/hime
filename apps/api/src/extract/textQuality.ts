/** Pages with fewer non-whitespace characters than this are reported as sparse. */
export const SPARSE_PAGE_CHARS = 100;
/** A Japanese bulletin page is expected to be mostly kanji and kana. */
export const MIN_JAPANESE_SHARE = 0.5;
/** Ordinary words are much shorter than this; a long run of Latin letters is suspicious. */
export const LONG_ASCII_RUN_CHARS = 30;

const MIN_JAPANESE_CHARS_FOR_KANA_CHECK = 30;
/** A line of at least this many copies of one character is filler, not text. */
const MIN_FILLER_LINE_CHARS = 10;

export const PAGE_FLAGS = [
  "NO_TEXT_LAYER",
  "SPARSE_TEXT",
  "REPLACEMENT_CHARS",
  "PRIVATE_USE_CHARS",
  "CONTROL_CHARS",
  "LOW_JAPANESE_SHARE",
  "NO_HIRAGANA",
  "LONG_ASCII_RUN",
  "FILLER_LINES",
  "LITTLE_OWN_TEXT",
] as const;
export type PageFlag = (typeof PAGE_FLAGS)[number];

export const QUALITY_VERDICTS = [
  "NO_TEXT_LAYER",
  "REVIEW_OR_OCR_RECOMMENDED",
  "TEXT_LAYER_PLAUSIBLE",
] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

/** Counts only. A metric never carries any of the page text. */
export type PageMetrics = Readonly<{
  asciiLetters: number;
  chars: number;
  control: number;
  digits: number;
  distinctAsciiLetters: number;
  /** Lines made of one repeated character, such as a row of the same letter. */
  fillerLines: number;
  fullwidth: number;
  hiragana: number;
  japaneseShare: number;
  kanji: number;
  katakana: number;
  lines: number;
  longestAsciiLetterRun: number;
  other: number;
  /** Characters on lines that are neither filler nor shared by every page. */
  ownChars: number;
  page: number;
  privateUse: number;
  punctuation: number;
  replacement: number;
  /** Lines that appear on every page (two pages or more), such as a repeated header. */
  sharedLines: number;
}>;

export type PageAssessment = Readonly<{
  flags: readonly PageFlag[];
  metrics: PageMetrics;
}>;

export type TextQualityReport = Readonly<{
  pageCount: number;
  pages: readonly PageAssessment[];
  /** 1-based numbers of the pages that carry at least one flag. */
  suspectPages: readonly number[];
  verdict: QualityVerdict;
}>;

const WHITESPACE = /\s/u;

function inRange(code: number, low: number, high: number): boolean {
  return code >= low && code <= high;
}

function isPrivateUse(code: number): boolean {
  return inRange(code, 0xe000, 0xf8ff) || inRange(code, 0xf0000, 0x10ffff);
}

function isHiragana(code: number): boolean {
  return inRange(code, 0x3041, 0x309f);
}

function isKatakana(code: number): boolean {
  return (
    inRange(code, 0x30a0, 0x30ff) ||
    inRange(code, 0x31f0, 0x31ff) ||
    inRange(code, 0xff66, 0xff9f)
  );
}

function isKanji(code: number): boolean {
  return (
    code === 0x3005 ||
    inRange(code, 0x3400, 0x4dbf) ||
    inRange(code, 0x4e00, 0x9fff) ||
    inRange(code, 0xf900, 0xfaff) ||
    inRange(code, 0x20000, 0x2fa1f)
  );
}

function isAsciiLetter(code: number): boolean {
  return inRange(code, 0x41, 0x5a) || inRange(code, 0x61, 0x7a);
}

function isAsciiPunctuation(code: number): boolean {
  return (
    inRange(code, 0x21, 0x2f) ||
    inRange(code, 0x3a, 0x40) ||
    inRange(code, 0x5b, 0x60) ||
    inRange(code, 0x7b, 0x7e)
  );
}

function contentLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function compactCharacters(line: string): string[] {
  return [...line.replace(/\s+/gu, "")];
}

function isFillerLine(line: string): boolean {
  const characters = compactCharacters(line);
  return (
    characters.length >= MIN_FILLER_LINE_CHARS &&
    characters.every((character) => character === characters[0])
  );
}

/**
 * Counts the characters of one page by script. Whitespace is not counted.
 * `sharedLines` holds the lines that appear on every page of the document.
 */
export function measurePage(
  page: number,
  text: string,
  sharedLines: ReadonlySet<string> = new Set(),
): PageMetrics {
  let asciiLetters = 0;
  let chars = 0;
  let control = 0;
  let digits = 0;
  let fullwidth = 0;
  let hiragana = 0;
  let kanji = 0;
  let katakana = 0;
  let other = 0;
  let privateUse = 0;
  let punctuation = 0;
  let replacement = 0;
  let run = 0;
  let longestRun = 0;
  const letters = new Set<string>();

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (isAsciiLetter(code)) {
      run += 1;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
    if (WHITESPACE.test(char)) {
      continue;
    }

    chars += 1;
    if (code === 0xfffd) {
      replacement += 1;
    } else if (isPrivateUse(code)) {
      privateUse += 1;
    } else if (isHiragana(code)) {
      hiragana += 1;
    } else if (isKatakana(code)) {
      katakana += 1;
    } else if (isKanji(code)) {
      kanji += 1;
    } else if (isAsciiLetter(code)) {
      asciiLetters += 1;
      letters.add(char);
    } else if (inRange(code, 0x30, 0x39)) {
      digits += 1;
    } else if (inRange(code, 0xff01, 0xff60) || inRange(code, 0xffe0, 0xffe6)) {
      fullwidth += 1;
    } else if (
      isAsciiPunctuation(code) ||
      inRange(code, 0x3000, 0x303f) ||
      inRange(code, 0x2000, 0x206f)
    ) {
      punctuation += 1;
    } else if (code < 0x20 || inRange(code, 0x7f, 0x9f)) {
      control += 1;
    } else {
      other += 1;
    }
  }

  let fillerLines = 0;
  let sharedLineCount = 0;
  let ownChars = 0;
  const lines = contentLines(text);
  for (const line of lines) {
    if (isFillerLine(line)) {
      fillerLines += 1;
    } else if (sharedLines.has(line)) {
      sharedLineCount += 1;
    } else {
      ownChars += compactCharacters(line).length;
    }
  }

  const japanese = kanji + hiragana + katakana;
  return {
    asciiLetters,
    chars,
    control,
    digits,
    distinctAsciiLetters: letters.size,
    fillerLines,
    fullwidth,
    hiragana,
    japaneseShare: chars === 0 ? 0 : japanese / chars,
    kanji,
    katakana,
    lines: lines.length,
    longestAsciiLetterRun: longestRun,
    other,
    ownChars,
    page,
    privateUse,
    punctuation,
    replacement,
    sharedLines: sharedLineCount,
  };
}

/**
 * Suspicion flags for a page of a Japanese document. They are hints for a human
 * reader, not proof: they cannot see a wrong reading order or missing text.
 */
export function flagPage(metrics: PageMetrics): PageFlag[] {
  if (metrics.chars === 0) {
    return ["NO_TEXT_LAYER"];
  }

  const flags: PageFlag[] = [];
  if (metrics.chars < SPARSE_PAGE_CHARS) {
    flags.push("SPARSE_TEXT");
  }
  if (metrics.replacement > 0) {
    flags.push("REPLACEMENT_CHARS");
  }
  if (metrics.privateUse > 0) {
    flags.push("PRIVATE_USE_CHARS");
  }
  if (metrics.control > 0) {
    flags.push("CONTROL_CHARS");
  }
  if (metrics.chars >= SPARSE_PAGE_CHARS && metrics.japaneseShare < MIN_JAPANESE_SHARE) {
    flags.push("LOW_JAPANESE_SHARE");
  }
  if (
    metrics.kanji + metrics.hiragana + metrics.katakana >= MIN_JAPANESE_CHARS_FOR_KANA_CHECK &&
    metrics.hiragana === 0
  ) {
    flags.push("NO_HIRAGANA");
  }
  if (metrics.longestAsciiLetterRun >= LONG_ASCII_RUN_CHARS) {
    flags.push("LONG_ASCII_RUN");
  }
  if (metrics.fillerLines > 0) {
    flags.push("FILLER_LINES");
  }
  if (metrics.chars >= SPARSE_PAGE_CHARS && metrics.ownChars < SPARSE_PAGE_CHARS) {
    flags.push("LITTLE_OWN_TEXT");
  }
  return flags;
}

/** Measures and flags every page; `pages[0]` is page 1. */
export function assessTextQuality(pages: readonly string[]): TextQualityReport {
  const lineSets = pages.map((text) => new Set(contentLines(text)));
  const sharedLines = new Set<string>();
  if (pages.length >= 2) {
    for (const line of lineSets[0] ?? []) {
      if (!isFillerLine(line) && lineSets.every((lineSet) => lineSet.has(line))) {
        sharedLines.add(line);
      }
    }
  }

  const assessments = pages.map((text, index): PageAssessment => {
    const metrics = measurePage(index + 1, text, sharedLines);
    return { flags: flagPage(metrics), metrics };
  });
  const suspectPages = assessments
    .filter((assessment) => assessment.flags.length > 0)
    .map((assessment) => assessment.metrics.page);

  let verdict: QualityVerdict = "TEXT_LAYER_PLAUSIBLE";
  if (assessments.every((assessment) => assessment.flags.includes("NO_TEXT_LAYER"))) {
    verdict = "NO_TEXT_LAYER";
  } else if (suspectPages.length > 0) {
    verdict = "REVIEW_OR_OCR_RECOMMENDED";
  }

  return { pageCount: pages.length, pages: assessments, suspectPages, verdict };
}