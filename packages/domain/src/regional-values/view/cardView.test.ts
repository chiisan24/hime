import { IssueCardSchema, type IssueCard } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { syntheticFixedTexts } from "../../../../../tests/harness/regional-values/testFixedTexts.js";
import { QUICK_VIEW_BUNDLE, fixtureCardOf, realCardOf } from "../../../../../tests/harness/regional-values/testViewBundle.js";
import { buildCardView } from "./cardView.js";
import type { RichText, ViewBundle } from "./viewTypes.js";

const APPROVAL = { status: "APPROVED", approverId: "test-approver", approvedAt: "2026-01-01T00:00:00Z" };

function withCards(cards: readonly IssueCard[]): ViewBundle {
  return { ...QUICK_VIEW_BUNDLE, cards };
}

const termsOf = (text: RichText): string[] => text.flatMap((part) => (part.t === "term" ? [part.v] : []));

/** A fictional card with a background that uses the registered term, a fictional fact, and the given overrides. */
function richFixtureCard(overrides: Record<string, unknown> = {}): IssueCard {
  return IssueCardSchema.parse({
    cardId: "card-x",
    dataKind: "FIXTURE",
    themeId: "EDUCATION_CHILDCARE",
    title: "架空市の課題",
    background: "試験用の説明です。試験用の続きです。",
    glossary: [{ term: "試験用", description: "試すためのもの" }],
    quote: { sourceId: "fsrc-x", text: "架空の引用" },
    aiInvolvement: "HUMAN",
    updatedOn: "2026-01-01",
    approval: APPROVAL,
    sources: [{ dataKind: "FIXTURE", sourceId: "fsrc-x" }],
    facts: [
      {
        dataKind: "FIXTURE",
        factId: "f1",
        sentence: "架空市の対象は100件です。",
        value: { amount: 100, unit: "件" },
        surveyDate: 2024,
        area: "架空市",
        fictionalSourceId: "fsrc-x",
      },
      {
        dataKind: "FIXTURE",
        factId: "f2",
        sentence: "架空市の別の対象は5件です。",
        value: { amount: 5, unit: "件" },
        surveyDate: "2024-04-01",
        area: "架空市",
        fictionalSourceId: "fsrc-x",
      },
    ],
    ...overrides,
  });
}

describe("buildCardView: a fictional card", () => {
  const view = buildCardView(withCards([richFixtureCard()]), "card-x");

  it("shows the title, the theme, the data kind label and no AI label", () => {
    expect(view.cardId).toBe("card-x");
    expect(view.title).toBe("架空市の課題");
    expect(view.themeName).toBe("教育・子育て");
    expect(view.dataKindLabel).toEqual({ kind: "FIXTURE", text: "〈label.dataKind.FIXTURE〉" });
    expect(view.aiLabel).toBeNull();
  });

  it("shows the AI label for a card drafted by AI", () => {
    const drafted = buildCardView(withCards([richFixtureCard({ aiInvolvement: "AI_DRAFT" })]), "card-x");
    expect(drafted.aiLabel).toBe("〈label.ai〉");
  });

  it("notes the registered term at its first occurrence in the background only", () => {
    expect(termsOf(view.background)).toEqual(["試験用"]);
    expect(view.background.map((part) => part.v).join("")).toBe("試験用の説明です。試験用の続きです。");
    expect(view.glossary).toEqual([{ term: "試験用", description: "試すためのもの" }]);
  });

  it("shows the source by its fictional document ID only: no publisher, no date, no link", () => {
    expect(view.sources).toEqual([{ publisher: null, publishedOn: null, retrievedAt: null, link: null, documentId: "fsrc-x" }]);
    expect(JSON.stringify(view)).not.toContain("http");
  });

  it("shows a fact by its sentence, area and date, with the year or the date written out", () => {
    expect(view.facts.map((fact) => [fact.sentence, fact.area, fact.surveyDate])).toEqual([
      ["架空市の対象は100件です。", "架空市", "2024年"],
      ["架空市の別の対象は5件です。", "架空市", "2024年4月1日"],
    ]);
    expect(view.facts.every((fact) => fact.publisher === null && fact.license === null && fact.credit.length === 0)).toBe(true);
  });

  it("shows the quotation and the update date", () => {
    expect(view.quote).toBe("架空の引用");
    expect(view.updatedOn).toBe("2026年1月1日");
  });

  it("works for the cards of the test bundle, and throws for a card that does not exist", () => {
    const bundle = withCards([fixtureCardOf("card-1", "EDUCATION_CHILDCARE")]);
    expect(buildCardView(bundle, "card-1").title).toBe("〈card-1〉");
    expect(() => buildCardView(bundle, "card-none")).toThrow("no such issue card");
  });
});

describe("buildCardView: a real-data card", () => {
  const real = (usage: "CONFIRMED" | "UNKNOWN" | "RESTRICTED", reference: "url" | "document-id") =>
    buildCardView(
      {
        ...QUICK_VIEW_BUNDLE,
        meta: { dataKind: "REAL_AI" },
        fixedTexts: syntheticFixedTexts("REAL_AI"),
        cards: [realCardOf("card-r", "EDUCATION_CHILDCARE", { sourceId: "src-r", usage, reference })],
      },
      "card-r",
    ).sources[0];

  it("shows the publisher and the dates in Japan Standard Time, and links when the terms of use are confirmed", () => {
    expect(real("CONFIRMED", "url")).toEqual({
      publisher: "試験用の公開者",
      publishedOn: "2026年1月1日",
      retrievedAt: "2026年2月1日 09:00",
      link: { href: "https://example.com/src-r", label: "試験用の公開者" },
      documentId: null,
    });
  });

  it("gives no link when the terms of use are not confirmed, and shows a document ID instead of a URL", () => {
    expect(real("UNKNOWN", "url")?.link).toBeNull();
    expect(real("RESTRICTED", "url")?.link).toBeNull();
    expect(real("CONFIRMED", "document-id")).toMatchObject({ link: null, documentId: "doc-src-r" });
  });

  it("leaves the license, the credit and the processing note empty until the real-data task", () => {
    const view = buildCardView(
      { ...QUICK_VIEW_BUNDLE, meta: { dataKind: "REAL_AI" },
        fixedTexts: syntheticFixedTexts("REAL_AI"), cards: [realCardOf("card-r", "EDUCATION_CHILDCARE", { sourceId: "s", usage: "CONFIRMED", reference: "url" })] },
      "card-r",
    );
    expect(view.dataKindLabel.kind).toBe("REAL_AI");
    expect(view.facts).toEqual([]);
  });
});