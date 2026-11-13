import { describe, expect, it } from "vitest";

import { checkGrounding } from "./checkGrounding.js";
import { normalizeSpacing, quoteAppearsIn, quoteExceedsLimit, quoteLength } from "./quoteMatch.js";

const NOUNS = ["愛媛県", "松山市"] as const;

function failures(sentence: string, quote: string) {
  return checkGrounding(sentence, quote, { properNouns: NOUNS });
}

describe("checkGrounding: numbers", () => {
  it("passes a sentence without a number, a date or a listed name", () => {
    expect(failures("地域の集まりに参加する人が減っています。", "地域の集まりに参加する人が減っている")).toEqual([]);
  });

  it("passes the numbers that the quotation has", () => {
    expect(failures("参加者は12人で、3回開かれました。", "12人が参加し、3回開かれた")).toEqual([]);
  });

  it("fails a number that the quotation does not have", () => {
    expect(failures("参加者は13人でした。", "12人が参加した")).toEqual([{ kind: "NUMBER", value: "13" }]);
  });

  it("does not find 7 in 17, because a number is compared as a whole", () => {
    expect(failures("7人が参加しました。", "17人が参加した")).toEqual([{ kind: "NUMBER", value: "7" }]);
    expect(failures("17人が参加しました。", "7人が参加した")).toEqual([{ kind: "NUMBER", value: "17" }]);
  });

  it("does not tell half-width, full-width and separator forms apart", () => {
    expect(failures("参加者は12人です。", "参加者は１２人")).toEqual([]);
    expect(failures("件数は1,973件です。", "件数は1973件")).toEqual([]);
    expect(failures("件数は１９７３件です。", "件数は1,973件")).toEqual([]);
  });

  it("does not tell a year with 年 from the same year without it", () => {
    expect(failures("2020年の調査です。", "2020に調査した")).toEqual([]);
    expect(failures("2020の調査です。", "2020年に調査した")).toEqual([]);
    expect(failures("2021年の調査です。", "2020年に調査した")).toEqual([{ kind: "NUMBER", value: "2021年" }]);
  });

  it("does not take a kanji numeral for the same number in digits", () => {
    expect(failures("三百人です。", "300人が参加した")).toEqual([{ kind: "NUMBER", value: "三百" }]);
    expect(failures("三百人です。", "三百人が参加した")).toEqual([]);
  });

  it("does not count a kanji numeral inside a word of the exempt list", () => {
    const lists = { properNouns: NOUNS, numeralExemptWords: ["一時的", "一方"] };
    expect(checkGrounding("いったん一時的に向かう場所です。", "避難する場所", lists)).toEqual([]);
    expect(checkGrounding("一時的に向かう場所です。", "避難する場所", { properNouns: NOUNS })).toEqual([
      { kind: "NUMBER", value: "一" },
    ]);
    // A numeral outside the exempt words is still a number.
    expect(checkGrounding("一時的に三か所へ向かいます。", "避難する場所", lists)).toEqual([{ kind: "NUMBER", value: "三" }]);
    // The exempt words apply to the quotation too: its 一方 is not the number 一.
    expect(checkGrounding("一人です。", "一方で避難する", lists)).toEqual([{ kind: "NUMBER", value: "一" }]);
  });

  it("reports each missing number once, in the order of the sentence", () => {
    expect(failures("5件と9件と5件です。", "1件")).toEqual([
      { kind: "NUMBER", value: "5" },
      { kind: "NUMBER", value: "9" },
    ]);
  });

  it("fails every number when the quotation is empty", () => {
    expect(failures("12人です。", "")).toEqual([{ kind: "NUMBER", value: "12" }]);
  });
});

describe("checkGrounding: dates", () => {
  it("passes a date that the quotation writes in the same form", () => {
    expect(failures("2025年4月1日に始まりました。", "2025年4月1日から始める")).toEqual([]);
    expect(failures("令和7年9月30日に終わりました。", "令和7年9月30日に終了")).toEqual([]);
    expect(failures("6月15日に集まります。", "6月15日に集まる")).toEqual([]);
  });

  it("fails a date whose numbers are all in the quotation but in another order", () => {
    // 4 and 1 are numbers of the quotation, but the quotation says 1月4日.
    expect(failures("4月1日に始まりました。", "1月4日から始める")).toEqual([{ kind: "DATE", value: "4月1日" }]);
  });

  it("fails a date with another day", () => {
    const result = failures("2025年4月1日です。", "2025年4月2日です");
    expect(result.map((item) => item.kind)).toContain("DATE");
  });

  it("does not mind a space or a line break inside the date, or a full-width digit", () => {
    expect(failures("2025年4月1日です。", "2025年 4月\n1日です")).toEqual([]);
    expect(failures("２０２５年４月１日です。", "2025年4月1日です")).toEqual([]);
  });

  it("checks a year with a month", () => {
    expect(failures("2025年4月に始まりました。", "2025年4月から始める")).toEqual([]);
    expect(failures("2025年5月に始まりました。", "2025年4月から始める").map((item) => item.kind)).toContain("DATE");
  });
});

describe("checkGrounding: proper nouns", () => {
  it("passes a listed name that the quotation has", () => {
    expect(failures("愛媛県の取り組みです。", "愛媛県が行う取り組み")).toEqual([]);
  });

  it("fails a listed name that the quotation does not have", () => {
    expect(failures("松山市の取り組みです。", "愛媛県が行う取り組み")).toEqual([{ kind: "PROPER_NOUN", value: "松山市" }]);
  });

  it("does not check a name that is not in the list", () => {
    expect(failures("架空市あおばの取り組みです。", "取り組み")).toEqual([]);
  });

  it("does not check a listed name that the sentence does not use", () => {
    expect(failures("取り組みです。", "愛媛県が行う取り組み")).toEqual([]);
  });

  it("uses the list that the caller gives", () => {
    expect(checkGrounding("架空市あおばの取り組みです。", "取り組み", { properNouns: ["架空市あおば"] })).toEqual([
      { kind: "PROPER_NOUN", value: "架空市あおば" },
    ]);
    expect(checkGrounding("架空市あおばの取り組みです。", "架空市あおばの取り組み", { properNouns: ["架空市あおば"] })).toEqual([]);
  });

  it("orders the failures as numbers, dates and names", () => {
    const result = failures("松山市で2025年4月1日に9人が集まりました。", "取り組み");
    // The numbers are 2025年, 4, 1 and 9; then the date; then the name.
    expect(result.map((item) => item.kind)).toEqual(["NUMBER", "NUMBER", "NUMBER", "NUMBER", "DATE", "PROPER_NOUN"]);
  });
});

describe("normalizeSpacing and quoteAppearsIn", () => {
  it("turns every run of white space, line breaks included, into one half-width space", () => {
    expect(normalizeSpacing("a  b\nc\r\nd\t\te　f")).toBe("a b c d e f");
    expect(normalizeSpacing("abc")).toBe("abc");
  });

  it("finds a quotation whose line breaks and spaces differ from the source", () => {
    const source = "地域の集まりに\n参加する人が  減って\nいる。";
    expect(quoteAppearsIn("参加する人が 減っている", source)).toBe(false);
    expect(quoteAppearsIn("参加する人が 減って いる", source)).toBe(true);
    expect(quoteAppearsIn("参加する人が\n\n減って\nいる", source)).toBe(true);
    expect(quoteAppearsIn("地域の集まりに 参加する", source)).toBe(true);
  });

  it("finds a part of a word, but not a quotation that is changed by one character", () => {
    expect(quoteAppearsIn("集まり", "地域の集まりに")).toBe(true);
    expect(quoteAppearsIn("集まる", "地域の集まりに")).toBe(false);
    expect(quoteAppearsIn("地域の集まりにn", "地域の集まりに")).toBe(false);
  });

  it("does not insert a space where the source has none", () => {
    expect(quoteAppearsIn("集 まり", "地域の集まりに")).toBe(false);
    expect(quoteAppearsIn("集\nまり", "地域の集まりに")).toBe(false);
  });

  it("never finds an empty quotation or one of white space only", () => {
    expect(quoteAppearsIn("", "abc")).toBe(false);
    expect(quoteAppearsIn("  \n", "a b")).toBe(false);
  });
});

describe("quoteLength and quoteExceedsLimit (Req 7.11)", () => {
  it("counts the characters without the line breaks, and a surrogate pair as one", () => {
    expect(quoteLength("あい\nう\r\nえ")).toBe(4);
    expect(quoteLength("あ😀い")).toBe(3);
    expect(quoteLength("")).toBe(0);
  });

  it("counts a space, because only line breaks are left out", () => {
    expect(quoteLength("あ い")).toBe(3);
  });

  it("accepts a quotation of 200 characters and rejects one of 201", () => {
    const body = "あ".repeat(200);
    expect(quoteExceedsLimit(body, 200)).toBe(false);
    expect(quoteExceedsLimit(`${body}い`, 200)).toBe(true);
  });

  it("does not count the line breaks toward the limit", () => {
    const withBreaks = `${"あ".repeat(100)}\n${"い".repeat(100)}\n`;
    expect(Array.from(withBreaks).length).toBe(202);
    expect(quoteExceedsLimit(withBreaks, 200)).toBe(false);
    expect(quoteExceedsLimit(`${withBreaks}う`, 200)).toBe(true);
  });
});
