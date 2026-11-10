import { describe, expect, it } from "vitest";

import { scanPdfStructure } from "./pdfStructure.js";
import { assessTextQuality, flagPage, measurePage } from "./textQuality.js";

const SENTENCE = "これは架空の公報の文章であり、教育や防災について述べています。";
const JAPANESE_PAGE = SENTENCE.repeat(5);

describe("measurePage", () => {
  it("counts characters by script without counting whitespace", () => {
    const metrics = measurePage(2, "あい カナ 漢字\nAb Ab 12 、。! ＡＢ ｶﾅ \uFFFD \uE000 \u0007");

    expect(metrics).toMatchObject({
      page: 2,
      hiragana: 2,
      katakana: 4,
      kanji: 2,
      asciiLetters: 4,
      distinctAsciiLetters: 2,
      longestAsciiLetterRun: 2,
      digits: 2,
      punctuation: 3,
      fullwidth: 2,
      replacement: 1,
      privateUse: 1,
      control: 1,
      other: 0,
      lines: 2,
    });
    expect(metrics.chars).toBe(22);
  });

  it("measures the longest run of Latin letters, which whitespace breaks", () => {
    expect(measurePage(1, "abc defgh ij").longestAsciiLetterRun).toBe(5);
  });
});

describe("flagPage", () => {
  it("flags a page without text", () => {
    expect(flagPage(measurePage(1, " \n "))).toEqual(["NO_TEXT_LAYER"]);
  });

  it("raises no flag for an ordinary Japanese page", () => {
    expect(flagPage(measurePage(1, JAPANESE_PAGE))).toEqual([]);
  });

  it("flags a sparse page", () => {
    expect(flagPage(measurePage(1, "短い文です。"))).toEqual(["SPARSE_TEXT"]);
  });

  it("flags replacement, private-use and control characters", () => {
    expect(flagPage(measurePage(1, `${JAPANESE_PAGE}\uFFFD\uE000\u0001`))).toEqual([
      "REPLACEMENT_CHARS",
      "PRIVATE_USE_CHARS",
      "CONTROL_CHARS",
    ]);
  });

  it("flags a page where Latin letters outweigh Japanese text", () => {
    const page = `${"漢字かな".repeat(20)}${"x".repeat(200)}`;

    expect(flagPage(measurePage(1, page))).toContain("LOW_JAPANESE_SHARE");
  });

  it("flags a very long run of Latin letters", () => {
    expect(flagPage(measurePage(1, `${JAPANESE_PAGE}${"a".repeat(40)}`))).toEqual(["LONG_ASCII_RUN"]);
  });

  it("flags Japanese text with kanji but no hiragana", () => {
    expect(flagPage(measurePage(1, "漢字".repeat(60)))).toEqual(["NO_HIRAGANA"]);
  });
});

describe("assessTextQuality", () => {
  it("calls a page set without flags plausible", () => {
    const report = assessTextQuality([JAPANESE_PAGE, SENTENCE.repeat(4)]);

    expect(report).toMatchObject({ pageCount: 2, suspectPages: [], verdict: "TEXT_LAYER_PLAUSIBLE" });
  });

  it("recommends review or OCR and names the suspect pages", () => {
    const report = assessTextQuality([JAPANESE_PAGE, "", `${JAPANESE_PAGE}\uFFFD`]);

    expect(report).toMatchObject({ suspectPages: [2, 3], verdict: "REVIEW_OR_OCR_RECOMMENDED" });
  });

  it("reports no text layer when every page is empty or there is no page", () => {
    expect(assessTextQuality(["", " "]).verdict).toBe("NO_TEXT_LAYER");
    expect(assessTextQuality([]).verdict).toBe("NO_TEXT_LAYER");
  });

  it("holds counts only, never the page text", () => {
    const report = assessTextQuality(["SECRET-PAGE-TEXT-MARKER 本文"]);

    expect(JSON.stringify(report)).not.toContain("SECRET");
    expect(JSON.stringify(report)).not.toContain("本文");
  });
});

describe("filler lines and text shared by every page", () => {
  const FILLER = "s".repeat(23);

  it("counts a row of one repeated character as filler, not as the page's own text", () => {
    const metrics = measurePage(1, `${FILLER}\n${FILLER}\n${JAPANESE_PAGE}`);

    expect(metrics).toMatchObject({ fillerLines: 2, sharedLines: 0, lines: 3 });
    expect(metrics.ownChars).toBe(measurePage(1, JAPANESE_PAGE).chars);
    expect(flagPage(metrics)).toEqual(["FILLER_LINES"]);
  });

  it("does not take a line of one page alone as shared", () => {
    expect(assessTextQuality([JAPANESE_PAGE]).pages[0]?.metrics.sharedLines).toBe(0);
  });

  it("separates a header that repeats on every page from the text of each page", () => {
    const header = "第一回公報ヘッダーの行です";
    const report = assessTextQuality([`${header}\n${JAPANESE_PAGE}`, `${header}\n${SENTENCE.repeat(4)}`]);

    expect(report.pages.map((page) => [page.metrics.sharedLines, page.metrics.ownChars, page.flags])).toEqual([
      [1, measurePage(1, JAPANESE_PAGE).chars, []],
      [1, measurePage(1, SENTENCE.repeat(4)).chars, []],
    ]);
    expect(report.verdict).toBe("TEXT_LAYER_PLAUSIBLE");
  });

  it("flags pages whose text is mostly filler and a template repeated on every page", () => {
    const report = assessTextQuality([
      `${FILLER}\n${JAPANESE_PAGE}`,
      `${FILLER}\n${JAPANESE_PAGE}\n短い固有の行です。`,
    ]);

    expect(report.pages.map((page) => [page.metrics.ownChars, page.flags])).toEqual([
      [0, ["FILLER_LINES", "LITTLE_OWN_TEXT"]],
      [9, ["FILLER_LINES", "LITTLE_OWN_TEXT"]],
    ]);
    expect(report).toMatchObject({ suspectPages: [1, 2], verdict: "REVIEW_OR_OCR_RECOMMENDED" });
  });
});

describe("scanPdfStructure", () => {
  it("counts building blocks in the raw bytes", () => {
    const text = [
      "%PDF-1.4",
      "<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>",
      "<< /Type /FontDescriptor >>",
      "<< /Subtype /CIDFontType2 >> << /Subtype/CIDFontType0 >>",
      "<< /Subtype /Image >> << /Subtype/Image >>",
      "<< /Type /ObjStm >> << /Encrypt 9 0 R >>",
    ].join("\n");

    expect(scanPdfStructure(new TextEncoder().encode(text))).toEqual({
      cidFonts: 2,
      compressedObjectStreams: 1,
      encrypted: true,
      fonts: 1,
      images: 2,
      toUnicodeMaps: 1,
      type0Fonts: 1,
    });
  });
});