import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FIXTURE_CARD_CONTEXT,
  TEST_BUILD_CONFIG,
  loadFixtureCards,
} from "../../../../../tests/harness/regional-values/contentFixtures.js";
import { checkFixtureIssueCard, type CardCheckContext } from "./checkIssueCard.js";
import { checkGrounding, type GroundingFailureKind } from "./checkGrounding.js";
import { quoteAppearsIn, quoteExceedsLimit } from "./quoteMatch.js";

// Feature: regional-values-map, Property 24 (ground) and Property 25 (quotation)

/** Fixed seeds: a green run repeats and a failure can be replayed. */
const PARAMETERS_24 = { seed: 350_024, numRuns: 200 };
const PARAMETERS_25 = { seed: 350_025, numRuns: 200 };

// ---------------------------------------------------------------------------
// Property 24: the ground of a sentence
// ---------------------------------------------------------------------------

/** The proper nouns that the check is given. The quotation uses some of them. */
const NOUNS = ["架空市あおば", "架空町みなと", "架空村ひなた"] as const;

/** Spellings of one value. A sentence may use another spelling than the quotation, because the check ignores the form. */
const NUMBER_FAMILIES: readonly (readonly string[])[] = [
  ["12", "１２"],
  ["3,450", "3450", "３，４５０"],
  ["2020年", "２０２０年", "2020"],
  ["令和6年", "令和６年"],
  ["三百"],
  ["10.5", "１０．５"],
];

const DATE_FAMILIES: readonly (readonly string[])[] = [
  ["2025年4月1日", "２０２５年４月１日"],
  ["令和7年9月30日"],
  ["6月15日", "６月１５日"],
];

/** Numbers, dates and names that none of the families above have, in any spelling. */
const FOREIGN_NUMBERS: readonly string[] = ["77", "８８８", "9,999", "1999年", "四千", "66.6"];
const FOREIGN_DATES: readonly string[] = ["2024年11月11日", "令和8年2月28日", "12月25日"];

/** Words without a digit, a kanji numeral or a name; they join the items so that no new number is made. */
const FILLERS: readonly string[] = ["の", "は", "が", "です", "という記録", "地域", "活動", "避難", "情報"];

type Item = Readonly<{ kind: GroundingFailureKind; family: readonly string[] }>;

const itemArbitrary: fc.Arbitrary<Item> = fc.oneof(
  fc.constantFrom(...NUMBER_FAMILIES).map((family): Item => ({ kind: "NUMBER", family })),
  fc.constantFrom(...DATE_FAMILIES).map((family): Item => ({ kind: "DATE", family })),
  fc.constantFrom(...NOUNS).map((noun): Item => ({ kind: "PROPER_NOUN", family: [noun] })),
);

const fillerArbitrary = fc.constantFrom(...FILLERS);

/** Items, each with the spelling used in the quotation, the spelling used in the sentence and a filler after it. */
const quotedItemsArbitrary = fc.uniqueArray(
  fc.record({
    item: itemArbitrary,
    quoted: fc.nat({ max: 5 }),
    sentenced: fc.nat({ max: 5 }),
    filler: fillerArbitrary,
    inSentence: fc.boolean(),
  }),
  { minLength: 1, maxLength: 7, selector: ({ item }) => item.family.join("|") },
);

function spelling(family: readonly string[], pick: number): string {
  return family[pick % family.length] ?? "";
}

const foreignArbitrary = fc.oneof(
  fc.constantFrom(...FOREIGN_NUMBERS).map((value) => ({ kind: "NUMBER" as const, value })),
  fc.constantFrom(...FOREIGN_DATES).map((value) => ({ kind: "DATE" as const, value })),
);

describe("checkGrounding: properties (Property 24)", () => {
  /** **Validates: Requirements 7.6, 8.9** */
  it("passes a sentence whose numbers, dates and names are all in the quotation, in any spelling", () => {
    fc.assert(
      fc.property(quotedItemsArbitrary, fillerArbitrary, (items, lead) => {
        const quote = items.map(({ item, quoted, filler }) => spelling(item.family, quoted) + filler).join("");
        const chosen = items.filter(({ inSentence }) => inSentence);
        const sentence = lead + chosen.map(({ item, sentenced, filler }) => spelling(item.family, sentenced) + filler).join("");
        expect(checkGrounding(sentence, quote, { properNouns: NOUNS })).toEqual([]);
      }),
      PARAMETERS_24,
    );
  });

  /** **Validates: Requirements 7.6, 8.9** */
  it("fails when one number or one date that the quotation does not have is put into the sentence", () => {
    fc.assert(
      fc.property(quotedItemsArbitrary, foreignArbitrary, fc.nat(), fillerArbitrary, (items, foreign, position, lead) => {
        const quote = items.map(({ item, quoted, filler }) => spelling(item.family, quoted) + filler).join("");
        const parts = items
          .filter(({ inSentence }) => inSentence)
          .map(({ item, sentenced, filler }) => spelling(item.family, sentenced) + filler);
        parts.splice(position % (parts.length + 1), 0, `${foreign.value}と`);
        const result = checkGrounding(lead + parts.join(""), quote, { properNouns: NOUNS });
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.map((failure) => failure.kind)).toContain(foreign.kind);
      }),
      PARAMETERS_24,
    );
  });

  /** **Validates: Requirements 7.6, 8.9** */
  it("fails when one listed name that the quotation does not have is put into the sentence", () => {
    fc.assert(
      fc.property(quotedItemsArbitrary, fc.constantFrom(...NOUNS), fc.nat(), (items, extra, position) => {
        const withoutExtra = items.filter(({ item }) => item.family[0] !== extra);
        const quote = withoutExtra.map(({ item, quoted, filler }) => spelling(item.family, quoted) + filler).join("");
        const parts = withoutExtra
          .filter(({ inSentence }) => inSentence)
          .map(({ item, sentenced, filler }) => spelling(item.family, sentenced) + filler);
        parts.splice(position % (parts.length + 1), 0, `${extra}の`);
        const result = checkGrounding(parts.join(""), quote, { properNouns: NOUNS });
        expect(result).toContainEqual({ kind: "PROPER_NOUN", value: extra });
      }),
      PARAMETERS_24,
    );
  });

  /** **Validates: Requirements 7.6, 8.9** */
  it("is the check that the issue card uses for its background and glossary", () => {
    const [card] = loadFixtureCards();
    if (card === undefined) {
      throw new Error("The fixture has a card");
    }
    fc.assert(
      fc.property(foreignArbitrary, fc.constantFrom("background", "term", "description"), (foreign, where) => {
        const changed = {
          ...card,
          background: where === "background" ? `${card.background}${foreign.value}です。` : card.background,
          glossary: card.glossary.map((entry) =>
            where === "background"
              ? entry
              : { ...entry, [where]: `${where === "term" ? entry.term : entry.description}${foreign.value}` },
          ),
        };
        const codes = checkFixtureIssueCard(changed, FIXTURE_CARD_CONTEXT).map((finding) => finding.code);
        expect(codes).toContain("GROUNDING_FAILED");
        expect(checkFixtureIssueCard(card, FIXTURE_CARD_CONTEXT).map((finding) => finding.code)).not.toContain("GROUNDING_FAILED");
      }),
      PARAMETERS_24,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: the quotation
// ---------------------------------------------------------------------------

/** Characters of the sources. None is white space, and "◆" is not among them. */
const WORD_CHARS = "あいうえおかきくけこさしすせそたちつてと日本語資料地域活動";

const wordArbitrary = fc.string({ unit: fc.constantFrom(...WORD_CHARS), minLength: 1, maxLength: 6 });

/**
 * An independent search for a quotation: the parts between the white space of the quotation
 * must follow each other in the source, separated by white space. It does not use the code
 * under test.
 */
function foundByRegularExpression(quote: string, source: string): boolean {
  const parts = quote.split(/\s+/u).filter((part) => part !== "");
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(escaped.join("\\s+"), "u").test(source);
}

/** One run of white space: a space, a tab, a line break, a CR LF, a full-width space or a mix of them. */
const whitespaceArbitrary = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r\n", "\u3000", "  "), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join(""));

type SourceCase = Readonly<{
  words: readonly string[];
  /** The white space after each word in the source. */
  gaps: readonly string[];
  /** The white space after each word in the quotation. */
  quotedGaps: readonly string[];
  from: number;
  to: number;
  cutStart: number;
  cutEnd: number;
}>;

const sourceCaseArbitrary: fc.Arbitrary<SourceCase> = fc
  .integer({ min: 2, max: 8 })
  .chain((count) =>
    fc.record({
      words: fc.array(wordArbitrary, { minLength: count, maxLength: count }),
      gaps: fc.array(whitespaceArbitrary, { minLength: count, maxLength: count }),
      quotedGaps: fc.array(whitespaceArbitrary, { minLength: count, maxLength: count }),
      from: fc.nat({ max: count - 1 }),
      to: fc.nat({ max: count - 1 }),
      cutStart: fc.nat({ max: 5 }),
      cutEnd: fc.nat({ max: 5 }),
    }),
  );

function sourceOf(sourceCase: SourceCase): string {
  return sourceCase.words.map((word, index) => word + (sourceCase.gaps[index] ?? " ")).join("");
}

/** A part of the source, from inside a word to inside a word, with other white space between the words. */
function quoteOf(sourceCase: SourceCase): string {
  const first = Math.min(sourceCase.from, sourceCase.to);
  const last = Math.max(sourceCase.from, sourceCase.to);
  const words = sourceCase.words.slice(first, last + 1);
  const onlyOne = words.length === 1;
  const cut = (word: string, fromStart: boolean, amount: number): string => {
    const characters = Array.from(word);
    const keep = Math.min(amount, characters.length - 1);
    return fromStart ? characters.slice(keep).join("") : characters.slice(0, characters.length - keep).join("");
  };
  return words
    .map((word, index) => {
      let part = word;
      if (index === 0 && !onlyOne) {
        part = cut(part, true, sourceCase.cutStart);
      }
      if (index === words.length - 1 && !onlyOne) {
        part = cut(part, false, sourceCase.cutEnd);
      }
      return index === words.length - 1 ? part : part + (sourceCase.quotedGaps[first + index] ?? " ");
    })
    .join("");
}

describe("quoteAppearsIn: properties (Property 25)", () => {
  /** **Validates: Requirements 7.6, 7.11** */
  it("finds a part of the source whose white space is inserted or replaced", () => {
    fc.assert(
      fc.property(sourceCaseArbitrary, (sourceCase) => {
        expect(quoteAppearsIn(quoteOf(sourceCase), sourceOf(sourceCase))).toBe(true);
      }),
      PARAMETERS_25,
    );
  });

  /** **Validates: Requirements 7.6, 7.11** */
  it("does not find the quotation when one character is changed, added or removed", () => {
    fc.assert(
      fc.property(sourceCaseArbitrary, fc.nat(), fc.constantFrom("replace", "insert"), (sourceCase, at, how) => {
        const quote = quoteOf(sourceCase);
        const characters = Array.from(quote);
        const solid = characters.flatMap((character, index) => (/\s/u.test(character) ? [] : [index]));
        const index = solid[at % solid.length];
        if (index === undefined) {
          throw new Error("A quotation has a character that is not white space");
        }
        // "◆" is not a character of any source, so the changed quotation cannot be a part of one.
        const changed =
          how === "replace"
            ? [...characters.slice(0, index), "◆", ...characters.slice(index + 1)]
            : [...characters.slice(0, index), "◆", ...characters.slice(index)];
        expect(quoteAppearsIn(changed.join(""), sourceOf(sourceCase))).toBe(false);
      }),
      PARAMETERS_25,
    );
  });

  /** **Validates: Requirements 7.6, 7.11** */
  it("does not find a quotation in which a word is cut by a white space that the source does not have", () => {
    fc.assert(
      fc.property(sourceCaseArbitrary, whitespaceArbitrary, fc.nat(), (sourceCase, gap, at) => {
        const quote = quoteOf(sourceCase);
        const characters = Array.from(quote);
        const inside = characters.flatMap((character, index) =>
          index > 0 && !/\s/u.test(character) && !/\s/u.test(characters[index - 1] ?? " ") ? [index] : [],
        );
        if (inside.length === 0) {
          return;
        }
        const index = inside[at % inside.length] ?? 1;
        const cut = [...characters.slice(0, index), gap, ...characters.slice(index)].join("");
        const source = sourceOf(sourceCase);
        // A short quotation can happen to occur elsewhere in the source; such a case proves nothing.
        fc.pre(!foundByRegularExpression(cut, source));
        expect(quoteAppearsIn(cut, source)).toBe(false);
      }),
      PARAMETERS_25,
    );
  });
});

describe("the length of a quotation: properties (Property 25)", () => {
  /** A body without a line break, and the line breaks put into it. */
  const lengthCase = fc.record({
    body: fc.string({ unit: fc.constantFrom(..."あいうえお 😀"), minLength: 1, maxLength: 80 }),
    breaks: fc.array(fc.constantFrom("\n", "\r\n", "\r"), { maxLength: 6 }),
    where: fc.array(fc.nat(), { maxLength: 6 }),
    margin: fc.constantFrom(-2, -1, 0, 1, 2),
  });

  function withBreaks(body: string, breaks: readonly string[], where: readonly number[]): string {
    const characters = Array.from(body);
    return breaks.reduce((current, lineBreak, index) => {
      const at = (where[index] ?? 0) % (current.length + 1);
      return [...current.slice(0, at), lineBreak, ...current.slice(at)];
    }, characters).join("");
  }

  /** **Validates: Requirements 7.11** */
  it("exceeds the limit exactly when the characters without the line breaks are more than the limit", () => {
    fc.assert(
      fc.property(lengthCase, ({ body, breaks, where, margin }) => {
        const bodyLength = Array.from(body).length;
        const limit = Math.max(1, bodyLength + margin);
        const quote = withBreaks(body, breaks, where);
        expect(quoteExceedsLimit(quote, limit)).toBe(bodyLength > limit);
      }),
      PARAMETERS_25,
    );
  });

  /** **Validates: Requirements 7.11** */
  it("makes the issue card QUOTE_TOO_LONG exactly when the quotation is longer than the limit", () => {
    const [card] = loadFixtureCards();
    if (card === undefined) {
      throw new Error("The fixture has a card");
    }
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 60 }), fc.constantFrom(-2, -1, 0, 1, 2), (limit, margin) => {
        const length = Math.max(1, limit + margin);
        const text = "あ".repeat(length);
        const changed = { ...card, quote: { ...card.quote, text } };
        const context: CardCheckContext = {
          config: { ...TEST_BUILD_CONFIG, quoteMaxChars: limit },
          sourceText: (sourceId) => (sourceId === card.quote.sourceId ? `資料の本文 ${text} 以上` : undefined),
        };
        const codes = checkFixtureIssueCard(changed, context).map((finding) => finding.code);
        expect(codes.includes("QUOTE_TOO_LONG")).toBe(length > limit);
        expect(codes).not.toContain("QUOTE_NOT_FOUND");
      }),
      PARAMETERS_25,
    );
  });
});
