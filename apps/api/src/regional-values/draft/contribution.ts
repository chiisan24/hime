import type { DataKind, DraftEvent } from "@ehime-vote-navigator/contracts";

import { checkEventLog } from "./disposition.js";
import type { EventLogViolation } from "./disposition.js";
import type { DraftStore, StoreError } from "./draftStore.js";
import { fail, succeed } from "./types.js";
import type { Outcome } from "./types.js";

/**
 * The four numbers that tell how much of the content came from an AI draft (Req 8.22). They are
 * counted from the draft events, never from a field of a draft.
 *
 *  - drafted: the calls that gave an output that went on to the checks (DRAFTED).
 *  - rejectedByChecks: the outputs that the checks refused (REJECTED_BY_CHECKS). The output is not
 *    saved, but it is counted.
 *  - humanEdited: the drafts that a person edited and adopted (HUMAN_EDITED).
 *  - humanRejected: the drafts that a person rejected (HUMAN_REJECTED).
 *
 * HUMAN_ADOPTED (adopted without a change) is not one of them: it is only what lets the adoption
 * be derived. A call that failed (a time out) and an input that was refused do not make a draft, so
 * they are not counted.
 */
export type AiContribution = Readonly<{
  drafted: number;
  rejectedByChecks: number;
  humanEdited: number;
  humanRejected: number;
}>;

export type ContributionError =
  | Readonly<{ code: "EVENT_LOG_INVALID"; violations: readonly EventLogViolation[] }>
  | Readonly<{ code: "CONTRIBUTION_INVARIANT" }>;

/**
 * Counts the events of one data kind (a record of the other kind is not counted, so the bundle of
 * fictional data does not hold a number of the real data). The records of the people are checked
 * against the saved drafts first, and then the numbers against their rule:
 * `rejectedByChecks + humanEdited + humanRejected <= drafted`.
 */
export function countContribution(
  events: readonly DraftEvent[],
  savedDrafts: ReadonlyMap<string, DataKind>,
  dataKind: DataKind,
): Outcome<AiContribution, ContributionError> {
  const own = events.filter((event) => event.dataKind === dataKind);
  const violations = checkEventLog(own, savedDrafts);
  if (violations.length > 0) {
    return fail({ code: "EVENT_LOG_INVALID", violations });
  }
  const count = (kind: DraftEvent["kind"]): number => own.filter((event) => event.kind === kind).length;
  const contribution: AiContribution = {
    drafted: count("DRAFTED"),
    rejectedByChecks: count("REJECTED_BY_CHECKS"),
    humanEdited: count("HUMAN_EDITED"),
    humanRejected: count("HUMAN_REJECTED"),
  };
  if (contribution.rejectedByChecks + contribution.humanEdited + contribution.humanRejected > contribution.drafted) {
    return fail({ code: "CONTRIBUTION_INVARIANT" });
  }
  return succeed(contribution);
}

/** Reads the drafts and the events of the store, and counts them. A record of the other data kind in the store fails the read (D29). */
export async function readAiContribution(store: DraftStore): Promise<Outcome<AiContribution, ContributionError | StoreError>> {
  const drafts = await store.loadDrafts();
  if (!drafts.ok) {
    return fail(drafts.error);
  }
  const events = await store.loadEvents();
  if (!events.ok) {
    return fail(events.error);
  }
  return countContribution(events.value, new Map(drafts.value.map((draft) => [draft.draftId, draft.dataKind])), store.root.dataKind);
}
