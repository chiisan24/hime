import { IssueLinksFileSchema } from "@ehime-vote-navigator/contracts";
import type { IssueCard } from "@ehime-vote-navigator/contracts";

import { isIssueInvalid, standingOf } from "./checkIssueLinks.js";
import type { IssueSnapshotView } from "./checkIssueLinks.js";

/**
 * Takes the approval of an issue card as `PENDING` when the issue that the card rests on is not
 * valid now (Req 7.14, 13.7). It returns copies: the stored cards are not changed. The assembly of
 * the bundle then leaves such a card out, with the finding that it always gives for a card that is
 * not approved (`CARD_NOT_APPROVED`).
 *
 * A card is not valid when the record of links names, for the card, an issue that is withdrawn, or a
 * version that is older than the valid one. A link that names an issue that does not exist is not
 * judged here: `checkIssueLinks` reports it as a defect. A record of links that does not satisfy
 * the contract changes nothing (it is a defect too). It is a pure function for the build, not for
 * the browser.
 */
export function applyIssueValidity(
  cards: readonly IssueCard[],
  links: unknown,
  snapshot: IssueSnapshotView,
): IssueCard[] {
  const parsed = IssueLinksFileSchema.safeParse(links);
  if (!parsed.success) {
    return [...cards];
  }
  const invalidCards = new Set<string>();
  for (const link of parsed.data.links) {
    if (link.targetKind === "ISSUE_CARD" && isIssueInvalid(standingOf(snapshot, link.issueId), link.issueVersion)) {
      invalidCards.add(link.targetId);
    }
  }
  return cards.map((card): IssueCard => (invalidCards.has(card.cardId) ? { ...card, approval: { status: "PENDING" } } : card));
}
