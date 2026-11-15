import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { encodeShiftJis, encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { CSV_ENCODINGS, CSV_TEXT_REFUSALS, csvToText } from "./csvToText.js";

// Feature: regional-values-map, Property 59 (入口側の補足): CSVの文字コードの判定と、同じ表から同じテキスト
//
// The texts are made of fictional characters. The Shift_JIS bytes come from the encoder of the tests,
// which is made from the decoder of the runtime, so a text and its bytes are never written twice.

const PARAMETERS = { seed: 130_016, numRuns: 200 };

const HIRAGANA = Array.from({ length: 0x3093 - 0x3041 + 1 }, (_value, index) => String.fromCodePoint(0x3041 + index));
const KATAKANA = Array.from({ length: 0x30f6 - 0x30a1 + 1 }, (_value, index) => String.fromCodePoint(0x30a1 + index));
const KANJI = Array.from("名称種別件数愛媛県松山市今治東予中南避難所人口指定緊急場洪水地震津波土砂災害架空試験町村区");
const FULL_WIDTH_DIGITS = Array.from("０１２３４５６７８９");
const ASCII = Array.from('abcXYZ019 ,"\n');

/** The characters that have a Shift_JIS code whose first byte is not the first byte of a UTF-8 sequence, so that the text is never UTF-8 by chance. */
const SHIFT_JIS_CHARACTERS = [...HIRAGANA, ...KATAKANA, ...KANJI, ...FULL_WIDTH_DIGITS].filter((character) => {
  try {
    const first = encodeShiftJis(character)[0] ?? 0;
    return first < 0xe0;
  } catch {
    return false;
  }
});

const textArbitrary = fc
  .array(fc.constantFrom(...SHIFT_JIS_CHARACTERS, ...ASCII), { minLength: 1, maxLength: 60 })
  .map((characters) => characters.join(""));

function hasNonAscii(text: string): boolean {
  return Array.from(text).some((character) => (character.codePointAt(0) ?? 0) > 0x7f);
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

describe("csvToText: properties", () => {
  /** **Validates: Requirements 7.5, 7.18** */
  it("gives the text back from UTF-8, UTF-8 with a byte order mark and Shift_JIS, and names the encoding", () => {
    fc.assert(
      fc.property(textArbitrary, (text) => {
        expect(csvToText(encodeUtf8(text))).toEqual({ ok: true, value: { text, encoding: "UTF-8", procedureId: "csv-lines-v1" } });
        expect(csvToText(encodeUtf8(text, true))).toEqual({ ok: true, value: { text, encoding: "UTF-8-BOM", procedureId: "csv-lines-v1" } });
        const shiftJis = encodeShiftJis(text);
        // A text of Shift_JIS codes that is UTF-8 as well is the one case that cannot be told; the characters of this test cannot be.
        expect(isValidUtf8(shiftJis)).toBe(!hasNonAscii(text));
        expect(csvToText(shiftJis)).toEqual({
          ok: true,
          value: { text, encoding: hasNonAscii(text) ? "SHIFT_JIS" : "UTF-8", procedureId: "csv-lines-v1" },
        });
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.18** */
  it("gives one text for the line breaks LF, CRLF and CR", () => {
    fc.assert(
      fc.property(textArbitrary, fc.constantFrom("\n", "\r\n", "\r"), (text, lineBreak) => {
        const written = text.replaceAll("\n", lineBreak);
        expect(csvToText(encodeUtf8(written))).toMatchObject({ ok: true, value: { text } });
        expect(csvToText(encodeShiftJis(written))).toMatchObject({ ok: true, value: { text } });
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.5** */
  it("refuses UTF-8 that was cut off in the middle of its last character, whatever its first part is", () => {
    const kana = fc.array(fc.constantFrom(...HIRAGANA, ...KATAKANA), { minLength: 3, maxLength: 12 }).map((characters) => characters.join(""));
    fc.assert(
      fc.property(fc.constantFrom("", "a,b\n", "x\n"), kana, fc.constantFrom(1, 2), (prefix, characters, removed) => {
        const whole = encodeUtf8(`${prefix}${characters}`);
        const cut = whole.subarray(0, whole.length - removed);
        expect(isValidUtf8(cut)).toBe(false);
        expect(csvToText(cut)).toEqual({ ok: false, error: { code: "ENCODING_UNSUPPORTED" } });
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 7.5, 7.18** */
  it("never throws, whatever the bytes are, and gives a text that has no control character and no carriage return, or a fixed code", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 80 }), (bytes) => {
        const result = csvToText(bytes);
        if (result.ok) {
          expect(CSV_ENCODINGS).toContain(result.value.encoding);
          expect(result.value.text).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uFEFF\uFFFD]/u);
          expect(result.value.text).not.toContain("\r");
        } else {
          expect(CSV_TEXT_REFUSALS).toContain(result.error.code);
        }
      }),
      PARAMETERS,
    );
  });
});
