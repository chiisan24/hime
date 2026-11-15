import { GATE_REASON_CLASS, IssueLinksFileSchema } from "@ehime-vote-navigator/contracts";
import type { ApprovedIssue, DataKind, GateFinding, WithdrawnIssue } from "@ehime-vote-navigator/contracts";

/**
 * The check of the record of links (`issue-links.json`) against the issues (Req 13.7, design:
 * 質問との接続). It is a pure function: it reads no file and calls no AI. It is for the build, not
 * for the browser.
 *
 * Two kinds of finding are told apart on purpose:
 *  - `CONTRACT_VIOLATION` (a defect): the record is wrong, so it is not a record that a person
 *    can supply by adding something. It does not satisfy the contract, or it names a question, an
 *    issue card or an issue that does not exist, or a version that has never existed.
 *  - `QUESTION_ISSUE_INVALID` (a shortage): the record is right, and the issue that a question rests
 *    on has changed (it was withdrawn, or the version is old). A person can check the question again
 *    and write the new version in the record.
 *
 * An issue card that rests on such an issue has no finding: its approval is taken as `PENDING`
 * (`applyIssueValidity`) and the assembly leaves it out (`CARD_NOT_APPROVED`).
 */

/** What the check needs of the issues of one data kind: the valid ones and the withdrawn ones. */
export type IssueSnapshotView = Readonly<{
  issues: readonly ApprovedIssue[];
  withdrawn: readonly WithdrawnIssue[];
}>;

export type IssueLinksContext = Readonly<{
  /** The record as it was read. It may be anything: a record that does not satisfy the contract is a defect. */
  links: unknown;
  /** The data kind of the build. A record of the other data kind is a defect. */
  dataKind: DataKind;
  questions: readonly Readonly<{ questionId: string }>[];
  cards: readonly Readonly<{ cardId: string }>[];
  snapshot: IssueSnapshotView;
}>;

/** The file that a defect of the record as a whole is reported for. */
export const ISSUE_LINKS_FILE_NAME = "issue-links.json";

function violation(targetKind: GateFinding["targetKind"], targetId: string | null): GateFinding {
  return { code: "CONTRACT_VIOLATION", class: GATE_REASON_CLASS.CONTRACT_VIOLATION, targetKind, targetId };
}

const CONFIG_DEFECT: GateFinding = violation("CONFIG", ISSUE_LINKS_FILE_NAME);

/** Where an issue stands now. The greatest version is the greatest version among the records of the issue. */
export type IssueStanding =
  | Readonly<{ kind: "VALID"; version: number }>
  | Readonly<{ kind: "WITHDRAWN"; version: number }>
  | Readonly<{ kind: "UNKNOWN" }>;

export function standingOf(snapshot: IssueSnapshotView, issueId: string): IssueStanding {
  const valid = snapshot.issues.find((issue) => issue.issueId === issueId);
  if (valid !== undefined) {
    return { kind: "VALID", version: valid.version };
  }
  const withdrawn = snapshot.withdrawn.find((issue) => issue.issueId === issueId);
  return withdrawn === undefined ? { kind: "UNKNOWN" } : { kind: "WITHDRAWN", version: withdrawn.version };
}

/** Whether a link names an issue that is withdrawn, or an older version than the valid one. */
export function isIssueInvalid(standing: IssueStanding, issueVersion: number): boolean {
  return standing.kind === "WITHDRAWN" || (standing.kind === "VALID" && issueVersion < standing.version);
}

/**
 * The findings of the record of links. An empty record, or a record that is in order, gives none.
 * The same finding is given once, and the order follows the order of the links.
 */
export function checkIssueLinks(context: IssueLinksContext): GateFinding[] {
  const parsed = IssueLinksFileSchema.safeParse(context.links);
  if (!parsed.success || parsed.data.dataKind !== context.dataKind) {
    return [CONFIG_DEFECT];
  }
  const questionIds = new Set(context.questions.map((question) => question.questionId));
  const cardIds = new Set(context.cards.map((card) => card.cardId));

  const found = new Map<string, GateFinding>();
  const add = (finding: GateFinding): void => {
    found.set(`${finding.code}\u0000${finding.targetKind}\u0000${finding.targetId ?? ""}`, finding);
  };

  for (const link of parsed.data.links) {
    const isQuestion = link.targetKind === "QUESTION";
    if (!(isQuestion ? questionIds : cardIds).has(link.targetId)) {
      add(CONFIG_DEFECT);
      continue;
    }
    const targetKind = isQuestion ? "QUESTION" : "ISSUE_CARD";
    const standing = standingOf(context.snapshot, link.issueId);
    if (standing.kind === "UNKNOWN" || link.issueVersion > standing.version) {
      // No such issue, or a version that has never been written: not a record that can be supplied.
      add(violation(targetKind, link.targetId));
      continue;
    }
    if (isQuestion && isIssueInvalid(standing, link.issueVersion)) {
      add({
        code: "QUESTION_ISSUE_INVALID",
        class: GATE_REASON_CLASS.QUESTION_ISSUE_INVALID,
        targetKind: "QUESTION",
        targetId: link.targetId,
      });
    }
  }
  return [...found.values()];
}
