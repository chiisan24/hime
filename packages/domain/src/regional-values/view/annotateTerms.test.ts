import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { annotateTerms } from "./annotateTerms.js";
import type { RichText } from "./viewTypes.js";

const GLOSSARY = [
  { term: "人口減少", description: "人口が減ること" },
  { term: "人口", description: "住んでいる人の数" },
  { term: "空き家", description: "誰も住んでいない家" },
] as const;

const plain = (text: RichText): string => text.map((part) => part.v).join("");
const termsOf = (text: RichText): string[] => text.flatMap((part) => (part.t === "term" ? [part.v] : []));

describe("annotateTerms", () => {
  it("notes a registered term at its first occurrence only", () => {
    const [text] = annotateTerms(["空き家が増え、空き家の管理が課題です。"], GLOSSARY);
    expect(text).toEqual([
      { t: "term", v: "空き家", description: "誰も住んでいない家" },
      { t: "text", v: "が増え、空き家の管理が課題です。" },
    ]);
  });

  it("notes a term once on the whole screen, across the texts", () => {
    const [first, second] = annotateTerms(["空き家の問題です。", "空き家は増えています。"], GLOSSARY);
    expect(termsOf(first ?? [])).toEqual(["空き家"]);
    expect(termsOf(second ?? [])).toEqual([]);
    expect(second).toEqual([{ t: "text", v: "空き家は増えています。" }]);
  });

  it("notes each different term at its own first occurrence, in reading order", () => {
    const [text] = annotateTerms(["空き家と人口減少の関係。人口減少は続きます。"], GLOSSARY);
    expect(termsOf(text ?? [])).toEqual(["空き家", "人口減少"]);
    expect(plain(text ?? [])).toBe("空き家と人口減少の関係。人口減少は続きます。");
  });

  it("takes the longer term where two terms start at the same place", () => {
    const [text] = annotateTerms(["人口減少が進みます。"], GLOSSARY);
    expect(termsOf(text ?? [])).toEqual(["人口減少"]);
  });

  it("returns a text without a registered term unchanged", () => {
    expect(annotateTerms(["何も登録されていない文です。"], GLOSSARY)).toEqual([
      [{ t: "text", v: "何も登録されていない文です。" }],
    ]);
  });

  it("returns an empty text as no part, and an empty glossary as plain texts", () => {
    expect(annotateTerms([""], GLOSSARY)).toEqual([[]]);
    expect(annotateTerms(["空き家"], [])).toEqual([[{ t: "text", v: "空き家" }]]);
  });

  it("ignores a term with an empty name and a repeated entry of the same term", () => {
    const glossary = [{ term: "", description: "x" }, ...GLOSSARY, { term: "空き家", description: "別の説明" }];
    const [text] = annotateTerms(["空き家です。"], glossary);
    expect(text?.[0]).toEqual({ t: "term", v: "空き家", description: "誰も住んでいない家" });
  });

  // Feature: regional-values-map, text round trip of the term notes (Req 11.11)
  it("never changes the words: the parts joined give the original, and a term is noted at most once", () => {
    const piece = fc.constantFrom("人口", "減少", "空き家", "あ", "。", "人口減少");
    fc.assert(
      fc.property(fc.array(fc.array(piece, { maxLength: 8 }).map((pieces) => pieces.join("")), { maxLength: 4 }), (texts) => {
        const annotated = annotateTerms(texts, GLOSSARY);
        expect(annotated.map(plain)).toEqual(texts);
        const noted = annotated.flatMap(termsOf);
        expect(new Set(noted).size).toBe(noted.length);
      }),
      { seed: 350_054, numRuns: 150 },
    );
  });
});