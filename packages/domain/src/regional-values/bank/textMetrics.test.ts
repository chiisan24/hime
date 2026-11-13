import { describe, expect, it } from "vitest";

import { containsAny, contentLength, lengthOf, numericTokens, sentencesOf } from "./textMetrics.js";

describe("text metrics", () => {
  it("counts code points after trimming, including a surrogate pair as one", () => {
    expect(lengthOf("  あ😀  ")).toBe(2);
    expect(lengthOf(" \n ")).toBe(0);
    expect(contentLength(" あ \n い 😀 ")).toBe(3);
  });

  it("keeps sentence boundaries for full stop, question, exclamation and line break", () => {
    expect(sentencesOf("一つ。二つ？\n三つ！\n")).toEqual(["一つ", "二つ", "三つ"]);
    expect(sentencesOf("  ")).toEqual([]);
  });

  it("makes the 60 and 61 code-point boundary visible", () => {
    expect(lengthOf("あ".repeat(60))).toBe(60);
    expect(lengthOf("あ".repeat(61))).toBe(61);
  });

  it("finds half-width, full-width, Japanese numerals and year forms", () => {
    expect(numericTokens("2024年、２０２５年、令和6年、平成二十年、１２、三百。")).toEqual([
      "2024年",
      "２０２５年",
      "令和6年",
      "平成二十年",
      "１２",
      "三百",
    ]);
  });

  it("keeps a number with thousands separators and a decimal part as one token", () => {
    expect(numericTokens("1,973か所、１，９７３件、12,345,678人、3.5倍、３．５倍")).toEqual([
      "1,973",
      "１，９７３",
      "12,345,678",
      "3.5",
      "３．５",
    ]);
  });

  it("does not join digits that a comma does not group by three", () => {
    expect(numericTokens("1,2と12、34")).toEqual(["1", "2", "12", "34"]);
  });

  it("finds a year that is written 元年", () => {
    expect(numericTokens("令和元年と平成元年")).toEqual(["令和元年", "平成元年"]);
  });

  it("does not count a numeral sequence inside an exempt word", () => {
    expect(numericTokens("一方、万全、三件", ["一方", "万全"])).toEqual(["三"]);
  });

  it("does not count a numeral sequence inside any occurrence of an exempt word", () => {
    expect(numericTokens("一方、万全、一方、万全", ["一方", "万全"])).toEqual([]);
    expect(numericTokens("一方、三件、一方", ["一方"])).toEqual(["三"]);
  });

  it("does not stop on a blank exempt word", () => {
    expect(numericTokens("三件", [""])).toEqual(["三"]);
  });

  it("matches half-width and full-width strings after NFKC normalization", () => {
    expect(containsAny("ＡＢＣ１２３", ["ABC", "123"])).toBe(true);
    expect(containsAny("地域交通", ["防災", "子育て"])).toBe(false);
  });
});