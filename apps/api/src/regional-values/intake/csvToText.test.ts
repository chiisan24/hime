import { describe, expect, it } from "vitest";

import { encodeShiftJis, encodeUtf8 } from "../../../../../tests/harness/regional-values/shiftJis.js";
import { CSV_ENCODINGS, CSV_TEXT_PROCEDURE_ID, MAX_CSV_BYTES, csvToText } from "./csvToText.js";

// Every table here is fictional.
const TABLE = "名称,種別,件数\nあおば,A,12\nみなと,B,７\n";

function isOk(result: ReturnType<typeof csvToText>): result is Extract<ReturnType<typeof csvToText>, { ok: true }> {
  return result.ok;
}

function codePointsOf(text: string): number[] {
  return Array.from(text).map((character) => character.codePointAt(0) ?? 0);
}

describe("csvToText: the encodings that are taken in", () => {
  it("expands UTF-8 as it is, and names the procedure", () => {
    const result = csvToText(encodeUtf8(TABLE));
    expect(result).toEqual({ ok: true, value: { text: TABLE, encoding: "UTF-8", procedureId: "csv-lines-v1" } });
    expect(CSV_TEXT_PROCEDURE_ID).toBe("csv-lines-v1");
  });

  it("expands UTF-8 with a byte order mark and leaves the mark out of the text", () => {
    const result = csvToText(encodeUtf8(TABLE, true));
    expect(result).toEqual({ ok: true, value: { text: TABLE, encoding: "UTF-8-BOM", procedureId: "csv-lines-v1" } });
  });

  it("expands Shift_JIS", () => {
    const result = csvToText(encodeShiftJis(TABLE));
    expect(result).toEqual({ ok: true, value: { text: TABLE, encoding: "SHIFT_JIS", procedureId: "csv-lines-v1" } });
  });

  it("reads the bytes that the design fixed as an example of Shift_JIS: 82 A0 82 A2 83 41 is あいア", () => {
    const result = csvToText(Uint8Array.of(0x82, 0xa0, 0x82, 0xa2, 0x83, 0x41));
    expect(isOk(result) && result.value.encoding).toBe("SHIFT_JIS");
    expect(isOk(result) && codePointsOf(result.value.text)).toEqual([0x3042, 0x3044, 0x30a2]);
  });

  it("gives the same text for the same table in the three encodings", () => {
    const texts = [encodeUtf8(TABLE), encodeUtf8(TABLE, true), encodeShiftJis(TABLE)].map((bytes) => {
      const result = csvToText(bytes);
      return isOk(result) ? result.value.text : null;
    });
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe(TABLE);
  });

  it("takes a file of ASCII only for UTF-8", () => {
    expect(csvToText(encodeUtf8("a,b\n1,2\n"))).toMatchObject({ ok: true, value: { encoding: "UTF-8" } });
  });

  it("names only encodings of the list", () => {
    expect([...CSV_ENCODINGS]).toEqual(["UTF-8", "UTF-8-BOM", "SHIFT_JIS"]);
  });

  it("does not change a character: full-width digits, half-width katakana in UTF-8 and the spaces stay", () => {
    const text = "名称 ,１２\nｱｲｳ,  3 \n";
    expect(csvToText(encodeUtf8(text))).toMatchObject({ ok: true, value: { text } });
  });

  it("takes Shift_JIS text of hiragana whose codes read as short UTF-8 sequences for what it is, not for damaged UTF-8", () => {
    const text = "ななにぬねのはひふへほ\n";
    const bytes = encodeShiftJis(text);
    // The precondition of the test: a lenient UTF-8 reading of these bytes finds more valid characters than wrong sequences ...
    const lenient = Array.from(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    const wrong = lenient.filter((character) => character === "\uFFFD").length;
    const valid = lenient.filter((character) => (character.codePointAt(0) ?? 0) > 0x7f && character !== "\uFFFD").length;
    expect(valid).toBeGreaterThan(wrong);
    // ... but they are letters that no Japanese text has, and the file is Shift_JIS.
    expect(csvToText(bytes)).toMatchObject({ ok: true, value: { text, encoding: "SHIFT_JIS" } });
  });

  it("does not change a table that is Shift_JIS and has half-width katakana of a few cells", () => {
    const text = "名称,カナ\nあおば,ｱｵﾊﾞ\nみなと,ﾐﾅﾄ\n";
    expect(csvToText(encodeShiftJis(text))).toMatchObject({ ok: true, value: { text, encoding: "SHIFT_JIS" } });
  });
});

describe("csvToText: line breaks", () => {
  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
    ["LF", "\n"],
  ])("makes %s a line feed", (_name, lineBreak) => {
    const result = csvToText(encodeUtf8(`a,b${lineBreak}1,2${lineBreak}`));
    expect(result).toMatchObject({ ok: true, value: { text: "a,b\n1,2\n" } });
  });

  it("makes a mixture of line breaks line feeds, and a break inside a field in quotes too", () => {
    const result = csvToText(encodeUtf8('a,b\r\n"x\r\ny",2\r1,3\n'));
    expect(result).toMatchObject({ ok: true, value: { text: 'a,b\n"x\ny",2\n1,3\n' } });
  });

  it("keeps a text that has no line break at the end as it is", () => {
    expect(csvToText(encodeUtf8("a,b\n1,2"))).toMatchObject({ ok: true, value: { text: "a,b\n1,2" } });
  });
});

describe("csvToText: a file that is refused", () => {
  it("refuses a file of no bytes and a file of the byte order mark only", () => {
    expect(csvToText(new Uint8Array(0))).toEqual({ ok: false, error: { code: "EMPTY_FILE" } });
    expect(csvToText(Uint8Array.of(0xef, 0xbb, 0xbf))).toEqual({ ok: false, error: { code: "EMPTY_FILE" } });
  });

  it("refuses a file that is larger than the limit, and takes one of exactly the limit", () => {
    const bytes = encodeUtf8("a,b\n1,2\n");
    expect(csvToText(bytes, { maxBytes: bytes.byteLength })).toMatchObject({ ok: true });
    expect(csvToText(bytes, { maxBytes: bytes.byteLength - 1 })).toEqual({ ok: false, error: { code: "FILE_TOO_LARGE" } });
    expect(MAX_CSV_BYTES).toBe(32 * 1024 * 1024);
  });

  it.each([
    ["an overlong UTF-8 sequence", Uint8Array.of(0xc0, 0x80, 0x41)],
    ["a continuation byte of UTF-8 without its first byte", Uint8Array.of(0x61, 0x80, 0x62)],
    ["UTF-16 little endian with its byte order mark", Uint8Array.of(0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00)],
    ["UTF-16 big endian with its byte order mark", Uint8Array.of(0xfe, 0xff, 0x00, 0x61, 0x00, 0x2c, 0x00, 0x62)],
    ["bytes of a PNG image", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)],
  ])("refuses %s", (_name, bytes) => {
    const result = csvToText(bytes);
    expect(result.ok).toBe(false);
    // Which of the two codes depends on how far a decoder gets; neither is a text.
    expect(["ENCODING_UNSUPPORTED", "INVALID_CHARACTER"]).toContain(result.ok ? "" : result.error.code);
  });

  it("refuses UTF-8 text that begins with a byte order mark and is not UTF-8, and does not try Shift_JIS", () => {
    const body = encodeShiftJis("名称,件数\nあおば,12\n");
    const marked = new Uint8Array(3 + body.length);
    marked.set([0xef, 0xbb, 0xbf], 0);
    marked.set(body, 3);
    expect(csvToText(marked)).toEqual({ ok: false, error: { code: "ENCODING_UNSUPPORTED" } });
  });

  it("refuses a file of Shift_JIS that was cut off after the first byte of a character", () => {
    const bytes = encodeShiftJis("名称,件数\nあおば,12\nみ");
    const cut = bytes.subarray(0, bytes.length - 1);
    // The runtime itself says that the bytes are not Shift_JIS: the cut file is `TypeError` for `fatal`.
    expect(() => new TextDecoder("shift_jis", { fatal: true }).decode(cut)).toThrow(TypeError);
    expect(csvToText(cut)).toEqual({ ok: false, error: { code: "ENCODING_UNSUPPORTED" } });
  });

  it.each([["ありがとう"], ["a,b\nありがとう"]])(
    "refuses UTF-8 that was cut off in the middle of its last character, which the runtime would read as Shift_JIS: %j",
    (text) => {
      const whole = encodeUtf8(text);
      const cut = whole.subarray(0, whole.length - 1);
      // The bytes are not UTF-8 ...
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(cut)).toThrow(TypeError);
      // ... and they are codes of Shift_JIS, so a decoder alone would hand back a text that nobody wrote.
      expect(() => new TextDecoder("shift_jis", { fatal: true }).decode(cut)).not.toThrow();
      expect(csvToText(cut)).toEqual({ ok: false, error: { code: "ENCODING_UNSUPPORTED" } });
    },
  );

  it("refuses EUC-JP, which a Shift_JIS decoder reads as half-width katakana", () => {
    // EUC-JP: ああ is A4 A2 A4 A2, and the runtime reads each byte as a half-width katakana.
    const bytes = Uint8Array.of(0x61, 0x2c, 0x62, 0x0a, 0xa4, 0xa2, 0xa4, 0xa2, 0x2c, 0x31, 0x0a);
    expect(() => new TextDecoder("shift_jis", { fatal: true }).decode(bytes)).not.toThrow();
    expect(csvToText(bytes)).toEqual({ ok: false, error: { code: "ENCODING_UNSUPPORTED" } });
  });

  it.each([
    ["a NUL character (UTF-16 without a mark read as UTF-8)", Uint8Array.of(0x61, 0x00, 0x2c, 0x00, 0x62, 0x00)],
    ["a bell character", Uint8Array.of(0x61, 0x07, 0x62)],
    ["a delete character", Uint8Array.of(0x61, 0x7f, 0x62)],
    ["a second byte order mark", Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61)],
    ["a zero-width no-break space in the text", encodeUtf8("a,b\n1,\uFEFF2\n")],
    ["a replacement character", encodeUtf8("a,b\n1,\uFFFD\n")],
    ["a C1 control character", encodeUtf8("a,b\n1,\u0085\n")],
  ])("refuses a text with %s", (_name, bytes) => {
    expect(csvToText(bytes)).toEqual({ ok: false, error: { code: "INVALID_CHARACTER" } });
  });

  it("takes a tab", () => {
    expect(csvToText(encodeUtf8("a\tb,c\n1,2\n"))).toMatchObject({ ok: true });
  });

  it("gives a fixed code only: no part of the file", () => {
    const secret = "秘密の値-7731";
    const bytes = encodeUtf8(`${secret}\u0000`);
    expect(JSON.stringify(csvToText(bytes))).not.toContain(secret);
  });

  it("does not change the bytes that it is given", () => {
    const bytes = encodeShiftJis(TABLE);
    const copy = Uint8Array.from(bytes);
    csvToText(bytes);
    expect(bytes).toEqual(copy);
  });
});
