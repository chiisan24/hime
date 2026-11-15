import type { DraftEvent } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { eventOf, hashOfName } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { countContribution } from "./contribution.js";

const RUNS = 200;

/** What happened to one call, and what a person did later. */
type Call =
  | Readonly<{ outcome: "FAILED" | "REFUSED" }>
  | Readonly<{ outcome: "REJECTED_BY_CHECKS" }>
  | Readonly<{ outcome: "SAVED"; human: "NONE" | "ADOPTED" | "EDITED" | "REJECTED" }>;

const callArbitrary: fc.Arbitrary<Call> = fc.oneof(
  fc.constantFrom<Call>({ outcome: "FAILED" }, { outcome: "REFUSED" }, { outcome: "REJECTED_BY_CHECKS" }),
  fc.constantFrom("NONE", "ADOPTED", "EDITED", "REJECTED").map((human): Call => ({ outcome: "SAVED", human })),
);

/** The events that the process writes for the calls. A failed call and a refused input write none. */
function eventsOf<K extends "FIXTURE" | "REAL_AI" = "FIXTURE">(calls: readonly Call[], dataKind: K = "FIXTURE" as K): { events: DraftEvent[]; saved: Map<string, K> } {
  const events: DraftEvent[] = [];
  const saved = new Map<string, K>();
  calls.forEach((call, index) => {
    const draftId = hashOfName(`draft-${index}`);
    const at = new Date(Date.parse("2026-11-13T00:00:00Z") + index * 10_000).toISOString();
    if (call.outcome === "REJECTED_BY_CHECKS") {
      events.push(eventOf({ kind: "DRAFTED", draftId, at, dataKind }), eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null, at, dataKind }));
    } else if (call.outcome === "SAVED") {
      saved.set(draftId, dataKind);
      events.push(eventOf({ kind: "DRAFTED", draftId, at, dataKind }));
      if (call.human !== "NONE") {
        events.push(eventOf({ kind: `HUMAN_${call.human}`, draftId, at: new Date(Date.parse(at) + 1_000).toISOString(), dataKind }));
      }
    }
  });
  return { events, saved };
}

function expectedCounts(calls: readonly Call[]): { drafted: number; rejectedByChecks: number; humanEdited: number; humanRejected: number } {
  return {
    drafted: calls.filter((call) => call.outcome === "SAVED" || call.outcome === "REJECTED_BY_CHECKS").length,
    rejectedByChecks: calls.filter((call) => call.outcome === "REJECTED_BY_CHECKS").length,
    humanEdited: calls.filter((call) => call.outcome === "SAVED" && call.human === "EDITED").length,
    humanRejected: calls.filter((call) => call.outcome === "SAVED" && call.human === "REJECTED").length,
  };
}

describe("Property 30: the four numbers of the contribution of the AI", () => {
  /** **Validates: Requirements 8.22, 12.15** */
  it("equal the numbers counted from the process, satisfy the rule, and ignore failed calls and refused inputs", () => {
    fc.assert(
      fc.property(fc.array(callArbitrary, { maxLength: 30 }), (calls) => {
        const { events, saved } = eventsOf(calls);
        const result = countContribution(events, saved, "FIXTURE");
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(result.value).toEqual(expectedCounts(calls));
        const { drafted, rejectedByChecks, humanEdited, humanRejected } = result.value;
        for (const value of [drafted, rejectedByChecks, humanEdited, humanRejected]) {
          expect(Number.isInteger(value) && value >= 0).toBe(true);
        }
        expect(rejectedByChecks + humanEdited + humanRejected).toBeLessThanOrEqual(drafted);
      }),
      { numRuns: RUNS },
    );
  });

  it("do not change when an adoption without a change is added for a draft that has no decision yet", () => {
    fc.assert(
      fc.property(fc.array(callArbitrary, { maxLength: 30 }), (calls) => {
        const { events, saved } = eventsOf(calls);
        const undecided = calls.flatMap((call, index) => (call.outcome === "SAVED" && call.human === "NONE" ? [index] : []));
        const adoptions = undecided.map((index) => eventOf({ kind: "HUMAN_ADOPTED", draftId: hashOfName(`draft-${index}`), at: "2026-12-01T00:00:00Z" }));
        expect(countContribution([...events, ...adoptions], saved, "FIXTURE")).toEqual(countContribution(events, saved, "FIXTURE"));
      }),
      { numRuns: RUNS },
    );
  });

  it("do not depend on the order of the events", () => {
    fc.assert(
      fc.property(fc.array(callArbitrary, { maxLength: 20 }), fc.nat(), (calls, seed) => {
        const { events, saved } = eventsOf(calls);
        const turn = events.length === 0 ? 0 : seed % events.length;
        const rotated = [...events.slice(turn), ...events.slice(0, turn)];
        const expected = countContribution(events, saved, "FIXTURE");
        expect(countContribution(rotated, saved, "FIXTURE")).toEqual(expected);
        expect(countContribution([...events].reverse(), saved, "FIXTURE")).toEqual(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it("leave out the records of the other data kind", () => {
    fc.assert(
      fc.property(fc.array(callArbitrary, { maxLength: 20 }), fc.array(callArbitrary, { maxLength: 20 }), (own, foreign) => {
        const ownEvents = eventsOf(own);
        const foreignEvents = eventsOf(foreign, "REAL_AI").events;
        const mixed = countContribution([...ownEvents.events, ...foreignEvents], ownEvents.saved, "FIXTURE");
        expect(mixed).toEqual(countContribution(ownEvents.events, ownEvents.saved, "FIXTURE"));
      }),
      { numRuns: RUNS },
    );
  });
});
