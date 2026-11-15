import type { DataKind, DraftEvent } from "@ehime-vote-navigator/contracts";

/**
 * What became of a draft. It is never stored: it is derived from the draft events (design D16),
 * so a record that is saved once does not have to change when a person decides.
 */
export type Disposition = "PENDING" | "ADOPTED" | "REJECTED";

/**
 * A rejection wins: a draft that has a HUMAN_REJECTED record is REJECTED. A draft that has a
 * HUMAN_ADOPTED (adopted without a change) or a HUMAN_EDITED (adopted after a person edited it)
 * record is ADOPTED. Otherwise it is PENDING. Only the events of the draft count.
 */
export function deriveDisposition(draftId: string, events: readonly DraftEvent[]): Disposition {
  const own = events.filter((event) => event.draftId === draftId);
  if (own.some((event) => event.kind === "HUMAN_REJECTED")) {
    return "REJECTED";
  }
  return own.some((event) => event.kind === "HUMAN_ADOPTED" || event.kind === "HUMAN_EDITED") ? "ADOPTED" : "PENDING";
}

export const EVENT_LOG_VIOLATION_CODES = [
  /** A record of a person refers to a draft that is not saved. */
  "HUMAN_EVENT_WITHOUT_DRAFT",
  /** A record of a person is of another data kind than the draft that it refers to. */
  "HUMAN_EVENT_DATA_KIND_MISMATCH",
  /** One draft has more than one record of adoption or rejection. */
  "HUMAN_DECISION_REPEATED",
] as const;

export type EventLogViolationCode = (typeof EVENT_LOG_VIOLATION_CODES)[number];

/** The ID of a draft and the code of the violation. It never carries a text. */
export type EventLogViolation = Readonly<{ code: EventLogViolationCode; draftId: string }>;

/**
 * Checks the records of the people against the saved drafts (`savedDrafts` maps the ID of a saved
 * draft to its data kind): each record refers to a saved draft of its own data kind, and one draft
 * has at most one record of adoption (HUMAN_ADOPTED or HUMAN_EDITED) or rejection in all.
 * A violation is listed once for a draft and a code, in the order of the codes and the IDs.
 */
export function checkEventLog(
  events: readonly DraftEvent[],
  savedDrafts: ReadonlyMap<string, DataKind>,
): readonly EventLogViolation[] {
  const found = new Map<string, EventLogViolation>();
  const add = (code: EventLogViolationCode, draftId: string): void => {
    found.set(`${code}:${draftId}`, { code, draftId });
  };
  const decisions = new Map<string, number>();
  for (const event of events) {
    if (!event.kind.startsWith("HUMAN_") || event.draftId === null) {
      continue;
    }
    const draftKind = savedDrafts.get(event.draftId);
    if (draftKind === undefined) {
      add("HUMAN_EVENT_WITHOUT_DRAFT", event.draftId);
    } else if (draftKind !== event.dataKind) {
      add("HUMAN_EVENT_DATA_KIND_MISMATCH", event.draftId);
    }
    decisions.set(event.draftId, (decisions.get(event.draftId) ?? 0) + 1);
  }
  for (const [draftId, count] of decisions) {
    if (count > 1) {
      add("HUMAN_DECISION_REPEATED", draftId);
    }
  }
  return [...found.values()].sort((first, second) => {
    const byCode = EVENT_LOG_VIOLATION_CODES.indexOf(first.code) - EVENT_LOG_VIOLATION_CODES.indexOf(second.code);
    return byCode !== 0 ? byCode : first.draftId < second.draftId ? -1 : first.draftId > second.draftId ? 1 : 0;
  });
}
