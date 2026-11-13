import type { GateFinding } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  FIXTURE_CARD_CONTEXT,
  FIXTURE_QUICK_THEMES,
  TEST_BUILD_CONFIG,
  fixtureSourceText,
  loadFixtureCards,
} from "../../../../../tests/harness/regional-values/contentFixtures.js";
import { checkFixtureFactItem } from "./checkFactItem.js";
import {
  checkCardCoverage,
  checkFixtureIssueCard,
  type CardCheckContext,
  type FixtureIssueCard,
} from "./checkIssueCard.js";

const CARDS = loadFixtureCards();

function firstCard(): FixtureIssueCard {
  const [card] = CARDS;
  if (card === undefined) {
    throw new Error("The fixture has a card");
  }
  return card;
}

function codes(findings: readonly GateFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

function run(card: FixtureIssueCard, context: CardCheckContext = FIXTURE_CARD_CONTEXT): GateFinding[] {
  return checkFixtureIssueCard(card, context);
}

/** A context whose source is the stated text, whatever the ID. */
function withSource(text: string | undefined, quoteMaxChars = 200): CardCheckContext {
  return { config: { ...TEST_BUILD_CONFIG, quoteMaxChars }, sourceText: () => text };
}

describe("checkFixtureIssueCard: the fictional cards of the repository", () => {
  it("passes the three cards with no finding", () => {
    expect(CARDS).toHaveLength(3);
    for (const card of CARDS) {
      expect(run(card), card.cardId).toEqual([]);
    }
  });

  it("covers each theme of the QUICK set with an approved card", () => {
    expect(checkCardCoverage(CARDS, FIXTURE_QUICK_THEMES)).toEqual([]);
  });

  it("reads the text of the source of the quotation from the repository", () => {
    for (const card of CARDS) {
      expect(fixtureSourceText(card.quote.sourceId), card.quote.sourceId).toContain(card.quote.text);
    }
  });
});

describe("the contract of the card and of its facts", () => {
  it("reports a card that breaks the contract", () => {
    const card = firstCard();
    const result = run({ ...card, title: "あ".repeat(41) });
    expect(result).toContainEqual({
      code: "CONTRACT_VIOLATION",
      class: "DEFECT",
      targetKind: "ISSUE_CARD",
      targetId: card.cardId,
    });
  });

  it("reports a fact item that breaks the contract, for the card and for the fact", () => {
    const card = firstCard();
    const [fact] = card.facts;
    if (fact === undefined) {
      throw new Error("The fixture card has a fact");
    }
    const broken = { ...fact, sentence: "" };
    expect(checkFixtureFactItem(broken)).toEqual([
      { code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "FACT_ITEM", targetId: fact.factId },
    ]);
    const result = run({ ...card, facts: [broken] });
    expect(result).toContainEqual({ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "ISSUE_CARD", targetId: card.cardId });
    expect(result).toContainEqual({ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "FACT_ITEM", targetId: fact.factId });
  });

  it("accepts every fact item of the repository", () => {
    for (const card of CARDS) {
      for (const fact of card.facts) {
        expect(checkFixtureFactItem(fact)).toEqual([]);
      }
    }
  });

  it("does not skip a real card without a word: a card that is not fictional is reported", () => {
    const card = firstCard();
    // @ts-expect-error a real card is not accepted as a fictional card
    const real: FixtureIssueCard = { ...card, dataKind: "REAL_AI" };
    expect(codes(run(real))).toContain("CONTRACT_VIOLATION");
    // @ts-expect-error a real fact item is not accepted as a fictional fact item
    const realFact: Parameters<typeof checkFixtureFactItem>[0] = { ...(card.facts[0] ?? {}), dataKind: "REAL_AI" };
    expect(codes(checkFixtureFactItem(realFact))).toContain("CONTRACT_VIOLATION");
  });
});

describe("the quotation of the card", () => {
  it("reports a source that cannot be read, as a shortage", () => {
    const result = run(firstCard(), withSource(undefined));
    expect(result).toContainEqual({
      code: "SOURCE_FILE_MISSING",
      class: "SHORTAGE",
      targetKind: "ISSUE_CARD",
      targetId: firstCard().cardId,
    });
    expect(codes(result)).not.toContain("QUOTE_NOT_FOUND");
  });

  it("reports a quotation that is not in the source", () => {
    const result = run(firstCard(), withSource("別の資料の本文です。"));
    expect(codes(result)).toEqual(["QUOTE_NOT_FOUND"]);
  });

  it("finds the quotation when the source has other line breaks and spaces than the quotation", () => {
    const card = firstCard();
    const head = card.quote.text.slice(0, 5);
    const tail = card.quote.text.slice(5);
    // The source breaks the line after the fifth character; the quotation has a single space there.
    const source = `前置き\n${head}\n  ${tail}\n後書き`;
    const spaced = { ...card, quote: { ...card.quote, text: `${head} ${tail}` } };
    expect(codes(run(spaced, withSource(source)))).toEqual([]);
    // The quotation as the card writes it, without a space there, is not in this source.
    expect(codes(run(card, withSource(source)))).toEqual(["QUOTE_NOT_FOUND"]);
  });

  it("accepts a quotation of exactly the limit and reports one that is a character longer", () => {
    const card = firstCard();
    const length = Array.from(card.quote.text).length;
    expect(codes(run(card, withSource(card.quote.text, length)))).toEqual([]);
    expect(codes(run(card, withSource(card.quote.text, length - 1)))).toEqual(["QUOTE_TOO_LONG"]);
  });
});

describe("the ground of the background and the glossary", () => {
  it("reports a number in the background that the quotation does not have", () => {
    const card = firstCard();
    expect(codes(run({ ...card, background: `${card.background}参加者は50人です。` }))).toEqual(["GROUNDING_FAILED"]);
  });

  it("reports a date or a number in a glossary entry that the quotation does not have", () => {
    const card = firstCard();
    const [entry] = card.glossary;
    if (entry === undefined) {
      throw new Error("The fixture card has a glossary entry");
    }
    expect(codes(run({ ...card, glossary: [{ ...entry, description: `${entry.description}2025年4月1日に始まりました。` }] }))).toEqual([
      "GROUNDING_FAILED",
    ]);
    expect(codes(run({ ...card, glossary: [{ ...entry, term: `${entry.term}3` }] }))).toEqual(["GROUNDING_FAILED"]);
  });

  it("reports a listed proper noun that the quotation does not have", () => {
    const card = firstCard();
    const context: CardCheckContext = {
      ...FIXTURE_CARD_CONTEXT,
      config: { ...TEST_BUILD_CONFIG, realNames: [], properNouns: ["架空市あおば"] },
    };
    expect(codes(run(card, context))).toEqual(["GROUNDING_FAILED"]);
    const quoted = { ...card, quote: { ...card.quote, text: "架空市あおば" } };
    expect(codes(run(quoted, { ...context, sourceText: () => "架空市あおばの記録" }))).toEqual([]);
  });

  it("reports the failure once for a card, however many sentences fail", () => {
    const card = firstCard();
    const result = run({ ...card, background: `${card.background}1人、2人、3人です。` });
    expect(codes(result)).toEqual(["GROUNDING_FAILED"]);
  });
});

describe("the fictional card", () => {
  it("reports a background without the word 架空", () => {
    const card = firstCard();
    expect(codes(run({ ...card, background: card.background.replaceAll("架空", "") }))).toEqual(["FICTIONAL_NAME_FOUND"]);
  });

  it("reports each real name of the list, in the title, the background and the facts", () => {
    const card = firstCard();
    const [fact] = card.facts;
    if (fact === undefined) {
      throw new Error("The fixture card has a fact");
    }
    for (const name of TEST_BUILD_CONFIG.realNames) {
      const context: CardCheckContext = {
        ...FIXTURE_CARD_CONTEXT,
        config: { ...TEST_BUILD_CONFIG, properNouns: [] },
      };
      expect(codes(run({ ...card, title: `${name}の取り組み` }, context)), name).toEqual(["FICTIONAL_NAME_FOUND"]);
      expect(codes(run({ ...card, facts: [{ ...fact, area: name }] }, context)), name).toEqual(["FICTIONAL_NAME_FOUND"]);
    }
  });

  it("does not tell the half-width and the full-width spelling of a name apart", () => {
    const card = firstCard();
    const context: CardCheckContext = {
      ...FIXTURE_CARD_CONTEXT,
      config: { ...TEST_BUILD_CONFIG, realNames: ["ABC市"], properNouns: [] },
    };
    expect(codes(run({ ...card, title: "ＡＢＣ市の取り組み" }, context))).toEqual(["FICTIONAL_NAME_FOUND"]);
  });

  it("reports a source ID that is an address", () => {
    const card = firstCard();
    const address = "https://example.org/source";
    const changed: FixtureIssueCard = {
      ...card,
      quote: { ...card.quote, sourceId: address },
      sources: [{ dataKind: "FIXTURE", sourceId: address }],
      facts: [],
    };
    const result = run(changed, withSource(card.quote.text));
    expect(codes(result)).toContain("FICTIONAL_NAME_FOUND");
  });
});

describe("the approval of the card and the coverage of the set", () => {
  it("reports a card that is not approved, as a shortage", () => {
    const card = firstCard();
    const result = run({ ...card, approval: { status: "PENDING" } });
    expect(result).toEqual([
      { code: "CARD_NOT_APPROVED", class: "SHORTAGE", targetKind: "ISSUE_CARD", targetId: card.cardId },
    ]);
  });

  it("reports a theme without an approved card, naming the theme", () => {
    const [first, second] = CARDS;
    if (first === undefined || second === undefined) {
      throw new Error("The fixture has cards");
    }
    expect(checkCardCoverage([first], [first.themeId, second.themeId])).toEqual([
      { code: "CARD_COVERAGE_MISSING", class: "SHORTAGE", targetKind: "ISSUE_CARD", targetId: second.themeId },
    ]);
  });

  it("does not count a card that is not approved, and names a theme once", () => {
    const card = firstCard();
    const pending = { ...card, approval: { status: "PENDING" } as const };
    expect(checkCardCoverage([pending], [card.themeId, card.themeId])).toHaveLength(1);
    expect(checkCardCoverage([pending, card], [card.themeId])).toEqual([]);
    expect(checkCardCoverage([], [])).toEqual([]);
  });
});

describe("the result of the checks", () => {
  it("carries codes and IDs only, never the text of the card", () => {
    const card = firstCard();
    const changed = { ...card, background: `${card.background}参加者は50人です。`, approval: { status: "PENDING" } as const };
    const result = run(changed);
    expect(codes(result)).toEqual(["GROUNDING_FAILED", "CARD_NOT_APPROVED"]);
    for (const finding of result) {
      expect(Object.keys(finding).sort()).toEqual(["class", "code", "targetId", "targetKind"]);
    }
    expect(JSON.stringify(result)).not.toContain("50人");
  });

  it("lists the findings in the order of the checks and gives the same result again", () => {
    const card = firstCard();
    const changed: FixtureIssueCard = {
      ...card,
      title: "あ".repeat(41),
      background: `${card.background.replaceAll("架空", "")}50人`,
      approval: { status: "PENDING" },
    };
    const first = run(changed, withSource("別の本文"));
    expect(codes(first)).toEqual([
      "CONTRACT_VIOLATION",
      "QUOTE_NOT_FOUND",
      "GROUNDING_FAILED",
      "FICTIONAL_NAME_FOUND",
      "CARD_NOT_APPROVED",
    ]);
    expect(run(changed, withSource("別の本文"))).toEqual(first);
  });

  it("does not change the card", () => {
    const card = structuredClone(firstCard());
    const before = structuredClone(card);
    run(card);
    expect(card).toEqual(before);
  });
});
