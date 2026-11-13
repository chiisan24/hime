import type { IssueCard } from "@ehime-vote-navigator/contracts";

import { annotateTerms } from "./annotateTerms.js";
import { formatDate, formatDateTime } from "./formatDate.js";
import { say, themeName } from "./support.js";
import type { CardView, ViewBundle } from "./viewTypes.js";

/**
 * The view model of an issue card (Req 7). Dates are shown in Japan Standard Time. The
 * parts that belong to real data only (the license text, the credit and the processing
 * note of a fact) are left null or empty here: their wording needs an approval and an
 * update of the requirements, and is added with the real-data task (13.4).
 */

function sourceViews(bundle: ViewBundle, card: IssueCard): CardView["sources"][number][] {
  void bundle;
  const views: CardView["sources"][number][] = [];
  for (const source of card.sources) {
    if (source.dataKind === "FIXTURE") {
      // A fictional source has only a fictional document ID: no publisher, no date, no link.
      views.push({ publisher: null, publishedOn: null, retrievedAt: null, link: null, documentId: source.sourceId });
    } else {
      // A link is shown only when the terms of use are confirmed, as for the guidance.
      const url = source.reference.kind === "url" && source.usage.status === "CONFIRMED" ? source.reference.url : null;
      views.push({
        publisher: source.publisher,
        publishedOn: formatDate(source.publishedOn),
        retrievedAt: formatDateTime(source.retrievedAt),
        link: url === null ? null : { href: url, label: source.publisher },
        documentId: source.reference.kind === "document-id" ? source.reference.documentId : null,
      });
    }
  }
  return views;
}

function surveyDateText(value: string | number): string {
  return typeof value === "number" ? `${value}年` : formatDate(value);
}

function factViews(card: IssueCard): CardView["facts"][number][] {
  const views: CardView["facts"][number][] = [];
  for (const fact of card.facts) {
    views.push({
      sentence: fact.sentence,
      area: fact.area,
      surveyDate: surveyDateText(fact.surveyDate),
      publisher: fact.dataKind === "REAL_AI" ? fact.publisher : null,
      license: null,
      credit: [],
      processing: "",
    });
  }
  return views;
}

export function buildCardView(bundle: ViewBundle, cardId: string): CardView {
  const card = bundle.cards.find((candidate) => candidate.cardId === cardId);
  if (card === undefined) {
    throw new Error("There is no such issue card in the bundle");
  }
  const [background = []] = annotateTerms([card.background], card.glossary);
  return {
    cardId: card.cardId,
    title: card.title,
    themeName: themeName(bundle, card.themeId),
    dataKindLabel: { kind: card.dataKind, text: say(bundle, `label.dataKind.${card.dataKind}`) },
    aiLabel: card.aiInvolvement === "AI_DRAFT" ? say(bundle, "label.ai") : null,
    background,
    glossary: card.glossary.map((entry) => ({ term: entry.term, description: entry.description })),
    quote: card.quote.text,
    sources: sourceViews(bundle, card),
    facts: factViews(card),
    updatedOn: formatDate(card.updatedOn),
  };
}