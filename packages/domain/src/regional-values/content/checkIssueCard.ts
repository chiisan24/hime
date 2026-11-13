import { IssueCardSchema } from "@ehime-vote-navigator/contracts";
import type { BuildConfig, GateFinding, IssueCard, NeutralityConfig, ThemeId } from "@ehime-vote-navigator/contracts";

import { containsAny } from "../bank/textMetrics.js";
import { checkFixtureFactItem } from "./checkFactItem.js";
import { checkGrounding } from "./checkGrounding.js";
import { gateFinding } from "./gateFinding.js";
import { quoteAppearsIn, quoteExceedsLimit } from "./quoteMatch.js";

/** An issue card of fictional data. The type excludes a real one, so that no check is skipped silently. */
export type FixtureIssueCard = Extract<IssueCard, { dataKind: "FIXTURE" }>;

/**
 * What the checks of a card read: the settings and the text of the source of the quotation. The
 * words in which a kanji numeral is not a number are a setting of the neutrality checks.
 */
export type CardCheckContext = Readonly<{
  config: Pick<BuildConfig, "quoteMaxChars" | "realNames" | "properNouns"> & Pick<NeutralityConfig, "numeralExemptWords">;
  /** The text of a fictional source, or `undefined` when it cannot be read. */
  sourceText: (sourceId: string) => string | undefined;
}>;

/** A fictional card says in its background that it is fictional (Req 7.9). */
const FICTIONAL_MARK = "架空";

/** A source ID that looks like an address is not a fictional document ID (Req 7.17). */
const ADDRESS_LIKE = /[a-z][a-z0-9+.-]*:\/\//iu;

/** Every text of the card that a reader sees or follows, for the check of real names. */
function visibleTexts(card: FixtureIssueCard): string[] {
  return [
    card.title,
    card.background,
    ...card.glossary.flatMap((entry) => [entry.term, entry.description]),
    card.quote.text,
    card.quote.sourceId,
    ...card.sources.map((source) => source.sourceId),
    ...card.facts.flatMap((fact) => [fact.sentence, fact.area, fact.value.unit, fact.fictionalSourceId]),
  ];
}

/**
 * The checks of an issue card of fictional data (8.7), in the order of the design table. Every
 * check runs and every failure is reported once per kind, so that the build can name each check
 * that failed and the card (Req 7.16). It reads no AI and no clock.
 *
 * - contract: the strict contract of the card and of its facts
 * - quotation: the source can be read, and the quotation is in its text; its length is within the limit
 * - ground: the numbers, dates and proper nouns of the background and the glossary are in the quotation
 * - fictional: no real name of the list, "架空" in the background, and sources that are document IDs only
 * - approval: the card is approved
 *
 * The checks of a real card (usage, transmission, the original, the license) are separate (13.11) and
 * are not run here. The coverage of the diagnostic set is `checkCardCoverage`, a check of the set.
 */
export function checkFixtureIssueCard(card: FixtureIssueCard, context: CardCheckContext): GateFinding[] {
  const findings: GateFinding[] = [];
  const report = (code: Parameters<typeof gateFinding>[0]): void => {
    findings.push(gateFinding(code, "ISSUE_CARD", card.cardId));
  };

  const parsed = IssueCardSchema.safeParse(card);
  if (!parsed.success) {
    report("CONTRACT_VIOLATION");
  } else if (parsed.data.dataKind !== "FIXTURE") {
    report("DATA_KIND_INVALID");
  }

  const source = context.sourceText(card.quote.sourceId);
  if (source === undefined) {
    report("SOURCE_FILE_MISSING");
  } else if (!quoteAppearsIn(card.quote.text, source)) {
    report("QUOTE_NOT_FOUND");
  }
  if (quoteExceedsLimit(card.quote.text, context.config.quoteMaxChars)) {
    report("QUOTE_TOO_LONG");
  }

  const explained = [card.background, ...card.glossary.flatMap((entry) => [entry.term, entry.description])];
  const lists = { properNouns: context.config.properNouns, numeralExemptWords: context.config.numeralExemptWords };
  if (explained.some((text) => checkGrounding(text, card.quote.text, lists).length > 0)) {
    report("GROUNDING_FAILED");
  }

  const hasRealName = containsAny(visibleTexts(card).join("\n"), context.config.realNames);
  const addressLike = [card.quote.sourceId, ...card.sources.map((entry) => entry.sourceId)].some((id) =>
    ADDRESS_LIKE.test(id),
  );
  if (hasRealName || addressLike || !card.background.includes(FICTIONAL_MARK)) {
    report("FICTIONAL_NAME_FOUND");
  }

  if (card.approval.status !== "APPROVED") {
    report("CARD_NOT_APPROVED");
  }

  for (const fact of card.facts) {
    findings.push(...checkFixtureFactItem(fact));
  }
  return findings;
}

/**
 * Req 7.2: each theme of the diagnostic set has an approved issue card. A theme without one is a
 * finding that names the theme ID as the target. The card is read only for its theme and approval.
 */
export function checkCardCoverage(
  cards: readonly Pick<IssueCard, "themeId" | "approval">[],
  themeIds: readonly ThemeId[],
): GateFinding[] {
  return [...new Set(themeIds)]
    .filter((theme) => !cards.some((card) => card.themeId === theme && card.approval.status === "APPROVED"))
    .map((theme) => gateFinding("CARD_COVERAGE_MISSING", "ISSUE_CARD", theme));
}
