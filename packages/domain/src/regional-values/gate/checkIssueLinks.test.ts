import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GATE_REASON_CLASS, IssueCardSchema } from "@ehime-vote-navigator/contracts";
import type { ApprovedIssue, GateFinding, IssueCard, WithdrawnIssue } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { applyIssueValidity } from "./applyIssueValidity.js";
import { checkIssueLinks, ISSUE_LINKS_FILE_NAME } from "./checkIssueLinks.js";
import type { IssueSnapshotView } from "./checkIssueLinks.js";

// The check reads only the ID and the version of an issue, so an issue here is only that (a stub);
// the cards are the fictional cards of the repository.

const CARDS = IssueCardSchema.array().parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../../fixtures/src/regional-values/cards.json", import.meta.url)), "utf8")) as unknown,
);
const CARD_IDS = CARDS.map((card) => card.cardId);
const [POPULATION_CARD] = CARD_IDS;

const issue = (issueId: string, version: number): ApprovedIssue => ({ issueId, version }) as unknown as ApprovedIssue;
const withdrawn = (issueId: string, version: number): WithdrawnIssue => ({ issueId, version, reason: "REVOKED" });

/** Issue A is valid at version 2, issue B was withdrawn (its greatest version is 3). */
const SNAPSHOT: IssueSnapshotView = { issues: [issue("issue-a", 2)], withdrawn: [withdrawn("issue-b", 3)] };

function links(entries: readonly Record<string, unknown>[], dataKind = "FIXTURE"): unknown {
  return { schemaVersion: 1, dataKind, links: entries };
}

const link = (targetKind: string, targetId: string, issueId: string, issueVersion: number): Record<string, unknown> => ({
  targetKind,
  targetId,
  issueId,
  issueVersion,
});

function check(record: unknown, snapshot: IssueSnapshotView = SNAPSHOT): GateFinding[] {
  return checkIssueLinks({
    links: record,
    dataKind: "FIXTURE",
    questions: [{ questionId: "q-1" }, { questionId: "q-2" }],
    cards: CARD_IDS.map((cardId) => ({ cardId })),
    snapshot,
  });
}

const violation = (targetKind: GateFinding["targetKind"], targetId: string): GateFinding => ({
  code: "CONTRACT_VIOLATION",
  class: "DEFECT",
  targetKind,
  targetId,
});
const invalidQuestion = (targetId: string): GateFinding => ({ code: "QUESTION_ISSUE_INVALID", class: "SHORTAGE", targetKind: "QUESTION", targetId });

describe("checkIssueLinks: a record that is in order", () => {
  it("gives no finding for no link, for a question on the valid version, and for a card on the valid version", () => {
    expect(check(links([]))).toEqual([]);
    expect(check(links([link("QUESTION", "q-1", "issue-a", 2)]))).toEqual([]);
    expect(check(links([link("ISSUE_CARD", POPULATION_CARD ?? "", "issue-a", 2)]))).toEqual([]);
  });

  it("lets a question and a card rest on the same issue, and a question on more than one issue", () => {
    const record = links([link("QUESTION", "q-1", "issue-a", 2), link("QUESTION", "q-2", "issue-a", 2), link("ISSUE_CARD", POPULATION_CARD ?? "", "issue-a", 2)]);
    expect(check(record)).toEqual([]);
  });
});

describe("checkIssueLinks: a defect of the record (CONTRACT_VIOLATION, which a person cannot supply)", () => {
  it("is reported for a record that does not satisfy the contract, and for a record of the other data kind", () => {
    const configDefect = violation("CONFIG", ISSUE_LINKS_FILE_NAME);
    expect(check({ nonsense: true })).toEqual([configDefect]);
    expect(check(links([{ ...link("QUESTION", "q-1", "issue-a", 2), note: "x" }]))).toEqual([configDefect]);
    expect(check(links([link("QUESTION", "q-1", "issue-a", 0)]))).toEqual([configDefect]);
    expect(check(links([link("QUESTION", "q-1", "issue-a", 2), link("QUESTION", "q-1", "issue-a", 2)]))).toEqual([configDefect]);
    expect(check(links([], "REAL_AI"))).toEqual([configDefect]);
    expect(check(undefined)).toEqual([configDefect]);
  });

  it("is reported for a question or a card that does not exist (once, whatever the number of the links)", () => {
    const configDefect = violation("CONFIG", ISSUE_LINKS_FILE_NAME);
    expect(check(links([link("QUESTION", "q-none", "issue-a", 2)]))).toEqual([configDefect]);
    expect(check(links([link("ISSUE_CARD", "card-none", "issue-a", 2)]))).toEqual([configDefect]);
    expect(check(links([link("QUESTION", "q-none", "issue-a", 2), link("QUESTION", "q-none-2", "issue-a", 2)]))).toEqual([configDefect]);
    // A card is not a question: the target kind decides which list the ID is looked up in.
    expect(check(links([link("QUESTION", POPULATION_CARD ?? "", "issue-a", 2)]))).toEqual([configDefect]);
  });

  it("is reported, for the question or the card, for an issue that does not exist and for a version that was never written", () => {
    expect(check(links([link("QUESTION", "q-1", "issue-none", 1)]))).toEqual([violation("QUESTION", "q-1")]);
    expect(check(links([link("ISSUE_CARD", POPULATION_CARD ?? "", "issue-none", 1)]))).toEqual([violation("ISSUE_CARD", POPULATION_CARD ?? "")]);
    expect(check(links([link("QUESTION", "q-1", "issue-a", 3)]))).toEqual([violation("QUESTION", "q-1")]);
    // The greatest version of a withdrawn issue is the greatest version that was written.
    expect(check(links([link("QUESTION", "q-1", "issue-b", 4)]))).toEqual([violation("QUESTION", "q-1")]);
  });
});

describe("checkIssueLinks: an issue that changed (QUESTION_ISSUE_INVALID, a shortage that a person can supply)", () => {
  it("is reported for a question on a withdrawn issue, whatever the version of the link", () => {
    expect(check(links([link("QUESTION", "q-1", "issue-b", 3)]))).toEqual([invalidQuestion("q-1")]);
    expect(check(links([link("QUESTION", "q-1", "issue-b", 1)]))).toEqual([invalidQuestion("q-1")]);
  });

  it("is reported for a question on an older version than the valid one, and not for the valid one", () => {
    expect(check(links([link("QUESTION", "q-1", "issue-a", 1)]))).toEqual([invalidQuestion("q-1")]);
    expect(check(links([link("QUESTION", "q-1", "issue-a", 2)]))).toEqual([]);
  });

  it("is a shortage and not a defect: the code has the class of a shortage", () => {
    expect(GATE_REASON_CLASS.QUESTION_ISSUE_INVALID).toBe("SHORTAGE");
    expect(GATE_REASON_CLASS.CONTRACT_VIOLATION).toBe("DEFECT");
  });

  it("gives no finding for a card on an issue that changed: the card is taken as not approved instead", () => {
    expect(check(links([link("ISSUE_CARD", POPULATION_CARD ?? "", "issue-b", 3)]))).toEqual([]);
    expect(check(links([link("ISSUE_CARD", POPULATION_CARD ?? "", "issue-a", 1)]))).toEqual([]);
  });

  it("reports each question once, and the defect before nothing else is hidden: the findings are of every link", () => {
    const record = links([link("QUESTION", "q-1", "issue-b", 3), link("QUESTION", "q-2", "issue-none", 1), link("QUESTION", "q-1", "issue-a", 1)]);
    expect(check(record)).toEqual([invalidQuestion("q-1"), violation("QUESTION", "q-2")]);
  });
});

describe("applyIssueValidity: the approval of a card whose issue is not valid is PENDING (a copy)", () => {
  const cardLink = (cardId: string, issueId: string, issueVersion: number) => links([link("ISSUE_CARD", cardId, issueId, issueVersion)]);
  const statusOf = (cards: readonly IssueCard[], cardId: string): string | undefined => cards.find((card) => card.cardId === cardId)?.approval.status;

  it("takes a card on a withdrawn issue, and a card on an older version, as PENDING, and leaves the other cards approved", () => {
    const [first = "", second = ""] = CARD_IDS;
    const afterWithdrawn = applyIssueValidity(CARDS, cardLink(first, "issue-b", 3), SNAPSHOT);
    expect(statusOf(afterWithdrawn, first)).toBe("PENDING");
    expect(statusOf(afterWithdrawn, second)).toBe("APPROVED");
    const afterOld = applyIssueValidity(CARDS, cardLink(first, "issue-a", 1), SNAPSHOT);
    expect(statusOf(afterOld, first)).toBe("PENDING");
  });

  it("keeps a card on the valid version approved, and a card that no link names", () => {
    const [first = ""] = CARD_IDS;
    expect(applyIssueValidity(CARDS, cardLink(first, "issue-a", 2), SNAPSHOT)).toEqual(CARDS);
    expect(applyIssueValidity(CARDS, links([]), SNAPSHOT)).toEqual(CARDS);
  });

  it("does not change the cards that it was given, and changes nothing else of the card than the approval", () => {
    const [first = ""] = CARD_IDS;
    const before = JSON.stringify(CARDS);
    const changed = applyIssueValidity(CARDS, cardLink(first, "issue-b", 3), SNAPSHOT);
    expect(JSON.stringify(CARDS)).toBe(before);
    const original = CARDS.find((card) => card.cardId === first);
    const copy = changed.find((card) => card.cardId === first);
    expect({ ...copy, approval: undefined }).toEqual({ ...original, approval: undefined });
  });

  it("does not judge a link that names an issue that does not exist, a link of a question, or a record that does not satisfy the contract", () => {
    const [first = ""] = CARD_IDS;
    expect(applyIssueValidity(CARDS, cardLink(first, "issue-none", 1), SNAPSHOT)).toEqual(CARDS);
    expect(applyIssueValidity(CARDS, links([link("QUESTION", "q-1", "issue-b", 3)]), SNAPSHOT)).toEqual(CARDS);
    expect(applyIssueValidity(CARDS, { nonsense: true }, SNAPSHOT)).toEqual(CARDS);
    expect(applyIssueValidity(CARDS, undefined, SNAPSHOT)).toEqual(CARDS);
  });

  it("is the same for the same input, whatever the order of the links", () => {
    const [first = "", second = ""] = CARD_IDS;
    const forward = links([link("ISSUE_CARD", first, "issue-b", 3), link("ISSUE_CARD", second, "issue-a", 1)]);
    const backward = links([link("ISSUE_CARD", second, "issue-a", 1), link("ISSUE_CARD", first, "issue-b", 3)]);
    expect(applyIssueValidity(CARDS, forward, SNAPSHOT)).toEqual(applyIssueValidity(CARDS, backward, SNAPSHOT));
  });
});
