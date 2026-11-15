import { fail, succeed } from "../draft/types.js";
import type { Outcome } from "../draft/types.js";

/**
 * The expansion of a CSV file into text, `csv-lines-v1` (design: 実データの取り込み手順, 13.15).
 *
 * A CSV file of the publishers is UTF-8, UTF-8 with a byte order mark, or Shift_JIS. This function
 * finds out which, and gives UTF-8 text with LF as the line break. The same bytes always give the same
 * text, so the lines of the text are a place that a person can point at (`text-lines`), and `aggregate`
 * reads the text and nothing else. It uses `TextDecoder` only: no dependency, no file, no clock.
 *
 * What it does not do: it does not change a character (no normalization of the width or of the form),
 * and it does not read the table (that is `inspectCsvTable` and `aggregate`). The SHA-256 that is
 * recorded is the one of the bytes of the file, not of this text.
 *
 * An encoding that cannot be told is refused, and the file is not taken in. The rules:
 *  1. Bytes that begin with EF BB BF are UTF-8 with a byte order mark. The rest has to be UTF-8.
 *  2. Otherwise bytes that are UTF-8 (strictly: a wrong sequence makes it fail) are UTF-8. A file of
 *     ASCII only is UTF-8.
 *  3. Otherwise bytes that are Shift_JIS (strictly: `fatal`) are Shift_JIS, unless they look like another
 *     encoding: bytes that are UTF-8 with a few wrong sequences (a file that was cut off in the middle of a
 *     character, or damaged) and bytes that are mostly half-width katakana (EUC-JP read as Shift_JIS).
 *     Such a file is refused instead of being read as a text that is not what the publisher wrote.
 *  4. The text must have no control character other than the tab, the line feed and the carriage
 *     return, no U+FEFF after the byte order mark and no U+FFFD.
 */

export const CSV_TEXT_PROCEDURE_ID = "csv-lines-v1";

/** The names that `DatasetRecord.format.encoding` uses. */
export const CSV_ENCODINGS = ["UTF-8", "UTF-8-BOM", "SHIFT_JIS"] as const;

export type CsvEncoding = (typeof CSV_ENCODINGS)[number];

/** The largest file that is taken in, in bytes. The table is read in memory. */
export const MAX_CSV_BYTES = 32 * 1024 * 1024;

export const CSV_TEXT_REFUSALS = ["EMPTY_FILE", "FILE_TOO_LARGE", "ENCODING_UNSUPPORTED", "INVALID_CHARACTER"] as const;

export type CsvTextRefusalCode = (typeof CSV_TEXT_REFUSALS)[number];

export type CsvTextRefusal = Readonly<{ code: CsvTextRefusalCode }>;

export type CsvText = Readonly<{
  /** UTF-8 text with LF. It has no byte order mark. */
  text: string;
  encoding: CsvEncoding;
  procedureId: typeof CSV_TEXT_PROCEDURE_ID;
}>;

export type CsvToTextOptions = Readonly<{
  /** The largest file in bytes. A test gives a small one. */
  maxBytes?: number;
}>;

/**
 * A control character that a CSV text does not have, the byte order mark inside the text, and the
 * replacement character. The tab, the line feed and the carriage return are the controls that a table has.
 */
const FORBIDDEN_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFEFF\uFFFD]/u;

const HALF_WIDTH_KATAKANA = /[\uFF61-\uFF9F]/gu;

/** More than this share of the non-ASCII characters being half-width katakana makes a Shift_JIS reading doubtful. */
const HALF_WIDTH_KATAKANA_LIMIT = 0.5;

function decodeStrictly(label: "utf-8" | "shift_jis", bytes: Uint8Array): string | null {
  try {
    // `ignoreBOM: true` keeps a U+FEFF in the text, so that the check below sees it. The byte order mark of the file is cut off by the caller.
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function nonAsciiCount(text: string): number {
  let count = 0;
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) {
      count += 1;
    }
  }
  return count;
}

/** The characters that a Japanese text is made of, in the ranges of UTF-8 that kana, kanji and the full-width forms take. */
const JAPANESE_CHARACTER = /[\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;

/**
 * Whether bytes that are not valid UTF-8 are UTF-8 with a wrong sequence or two: a file that was cut off
 * in the middle of a character, or damaged. Such a file can still be read as Shift_JIS (the bytes of a
 * Japanese UTF-8 text often are codes of Shift_JIS), and the result is a text that nobody wrote. Bytes
 * that are Shift_JIS have many wrong UTF-8 sequences (the first byte of a character is not the first
 * byte of a UTF-8 sequence), and the valid sequences that are there by chance are mostly two bytes long
 * and are letters of Latin, Greek or Cyrillic, not kana and kanji. Bytes that are UTF-8 with a wrong
 * sequence have far more valid kana and kanji than wrong sequences.
 */
function looksLikeDamagedUtf8(bytes: Uint8Array): boolean {
  const lenient = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
  let wrong = 0;
  let valid = 0;
  for (const character of lenient) {
    if (character === "\uFFFD") {
      wrong += 1;
    } else if (JAPANESE_CHARACTER.test(character)) {
      valid += 1;
    }
  }
  return valid > wrong;
}

function looksLikeAnotherEncoding(text: string, bytes: Uint8Array): boolean {
  const nonAscii = nonAsciiCount(text);
  const katakana = (text.match(HALF_WIDTH_KATAKANA) ?? []).length;
  if (nonAscii > 0 && katakana / nonAscii > HALF_WIDTH_KATAKANA_LIMIT) {
    return true;
  }
  return looksLikeDamagedUtf8(bytes);
}

/** LF for every line break: CRLF and a lone CR both become LF. */
function withLineFeeds(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

/** Expands the bytes of a CSV file into UTF-8 text with LF (`csv-lines-v1`), or refuses with a fixed code. */
export function csvToText(bytes: Uint8Array, options: CsvToTextOptions = {}): Outcome<CsvText, CsvTextRefusal> {
  if (bytes.byteLength === 0) {
    return fail({ code: "EMPTY_FILE" });
  }
  if (bytes.byteLength > (options.maxBytes ?? MAX_CSV_BYTES)) {
    return fail({ code: "FILE_TOO_LARGE" });
  }

  const hasByteOrderMark = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let encoding: CsvEncoding;
  let decoded: string | null;
  if (hasByteOrderMark) {
    // The mark says UTF-8, so the rest is not tried as another encoding.
    encoding = "UTF-8-BOM";
    decoded = decodeStrictly("utf-8", bytes.subarray(3));
  } else {
    encoding = "UTF-8";
    decoded = decodeStrictly("utf-8", bytes);
    if (decoded === null) {
      encoding = "SHIFT_JIS";
      decoded = decodeStrictly("shift_jis", bytes);
      if (decoded !== null && looksLikeAnotherEncoding(decoded, bytes)) {
        decoded = null;
      }
    }
  }
  if (decoded === null) {
    return fail({ code: "ENCODING_UNSUPPORTED" });
  }
  if (decoded === "") {
    // A file of the byte order mark only.
    return fail({ code: "EMPTY_FILE" });
  }
  if (FORBIDDEN_CHARACTER.test(decoded)) {
    return fail({ code: "INVALID_CHARACTER" });
  }
  return succeed({ text: withLineFeeds(decoded), encoding, procedureId: CSV_TEXT_PROCEDURE_ID });
}
