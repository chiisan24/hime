import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempRoot, eventOf, hashOfName } from "../../../../../tests/harness/regional-values/draftSupport.js";
import type { TempRoot } from "../../../../../tests/harness/regional-values/draftSupport.js";
import { countContribution, readAiContribution } from "./contribution.js";
import { checkEventLog, deriveDisposition } from "./disposition.js";
import { createDraftStore } from "./draftStore.js";

const D1 = hashOfName("draft-1");
const D2 = hashOfName("draft-2");
const SAVED = new Map<string, "FIXTURE" | "REAL_AI">([
  [D1, "FIXTURE"],
  [D2, "FIXTURE"],
]);

describe("deriveDisposition", () => {
  it("is PENDING without a decision, ADOPTED after an adoption of either kind, REJECTED after a rejection", () => {
    expect(deriveDisposition(D1, [eventOf({ kind: "DRAFTED", draftId: D1 })])).toBe("PENDING");
    expect(deriveDisposition(D1, [eventOf({ kind: "HUMAN_ADOPTED", draftId: D1 })])).toBe("ADOPTED");
    expect(deriveDisposition(D1, [eventOf({ kind: "HUMAN_EDITED", draftId: D1 })])).toBe("ADOPTED");
    expect(deriveDisposition(D1, [eventOf({ kind: "HUMAN_REJECTED", draftId: D1 })])).toBe("REJECTED");
  });

  it("reads only the events of the draft, and a rejection wins", () => {
    const events = [eventOf({ kind: "HUMAN_ADOPTED", draftId: D2 }), eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null })];
    expect(deriveDisposition(D1, events)).toBe("PENDING");
    expect(deriveDisposition(D1, [eventOf({ kind: "HUMAN_ADOPTED", draftId: D1 }), eventOf({ kind: "HUMAN_REJECTED", draftId: D1 })])).toBe("REJECTED");
  });
});

describe("checkEventLog", () => {
  it("accepts a record of a person for a saved draft of the same data kind", () => {
    expect(checkEventLog([eventOf({ kind: "HUMAN_REJECTED", draftId: D1 })], SAVED)).toEqual([]);
  });

  it("finds a record for a draft that is not saved, of another data kind, and a repeated decision", () => {
    expect(checkEventLog([eventOf({ kind: "HUMAN_REJECTED", draftId: hashOfName("unknown") })], SAVED)).toEqual([
      { code: "HUMAN_EVENT_WITHOUT_DRAFT", draftId: hashOfName("unknown") },
    ]);
    expect(checkEventLog([eventOf({ kind: "HUMAN_REJECTED", draftId: D1, dataKind: "REAL_AI" })], SAVED)).toEqual([
      { code: "HUMAN_EVENT_DATA_KIND_MISMATCH", draftId: D1 },
    ]);
    const repeated = [
      eventOf({ kind: "HUMAN_ADOPTED", draftId: D1, at: "2026-11-13T00:00:00Z" }),
      eventOf({ kind: "HUMAN_EDITED", draftId: D1, at: "2026-11-13T01:00:00Z" }),
    ];
    expect(checkEventLog(repeated, SAVED)).toEqual([{ code: "HUMAN_DECISION_REPEATED", draftId: D1 }]);
  });
});

describe("countContribution", () => {
  it("counts the four numbers from the events", () => {
    const events = [
      eventOf({ kind: "DRAFTED", draftId: D1 }),
      eventOf({ kind: "DRAFTED", draftId: D2 }),
      eventOf({ kind: "DRAFTED", draftId: hashOfName("rejected"), at: "2026-11-13T00:10:00Z" }),
      eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null, at: "2026-11-13T00:10:00Z" }),
      eventOf({ kind: "HUMAN_EDITED", draftId: D1 }),
      eventOf({ kind: "HUMAN_REJECTED", draftId: D2 }),
    ];
    expect(countContribution(events, SAVED, "FIXTURE")).toEqual({
      ok: true,
      value: { drafted: 3, rejectedByChecks: 1, humanEdited: 1, humanRejected: 1 },
    });
  });

  it("does not count an adoption without a change", () => {
    const base = [eventOf({ kind: "DRAFTED", draftId: D1 })];
    const withAdoption = [...base, eventOf({ kind: "HUMAN_ADOPTED", draftId: D1 })];
    expect(countContribution(withAdoption, SAVED, "FIXTURE")).toEqual(countContribution(base, SAVED, "FIXTURE"));
  });

  it("counts the records of one data kind only", () => {
    const events = [
      eventOf({ kind: "DRAFTED", draftId: D1 }),
      eventOf({ kind: "DRAFTED", draftId: hashOfName("real"), dataKind: "REAL_AI" }),
      eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null, dataKind: "REAL_AI" }),
    ];
    expect(countContribution(events, SAVED, "FIXTURE")).toEqual({ ok: true, value: { drafted: 1, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 } });
    expect(countContribution(events, SAVED, "REAL_AI")).toEqual({ ok: true, value: { drafted: 1, rejectedByChecks: 1, humanEdited: 0, humanRejected: 0 } });
  });

  it("is all zero without events (no call has been made)", () => {
    expect(countContribution([], new Map(), "FIXTURE")).toEqual({ ok: true, value: { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 } });
  });

  it("fails when the records of the people do not fit the saved drafts", () => {
    const result = countContribution([eventOf({ kind: "HUMAN_REJECTED", draftId: hashOfName("unknown") })], SAVED, "FIXTURE");
    expect(result).toEqual({
      ok: false,
      error: { code: "EVENT_LOG_INVALID", violations: [{ code: "HUMAN_EVENT_WITHOUT_DRAFT", draftId: hashOfName("unknown") }] },
    });
  });

  it("fails when the numbers break the rule rejectedByChecks + humanEdited + humanRejected <= drafted", () => {
    const events = [eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null }), eventOf({ kind: "DRAFTED", draftId: D1 }), eventOf({ kind: "HUMAN_REJECTED", draftId: D1 })];
    expect(countContribution(events, SAVED, "FIXTURE")).toEqual({ ok: false, error: { code: "CONTRIBUTION_INVARIANT" } });
  });
});

describe("readAiContribution", () => {
  let temp: TempRoot | undefined;

  afterEach(async () => {
    await temp?.remove();
    temp = undefined;
  });

  it("reads the events of the store and counts them", async () => {
    temp = await createTempRoot("FIXTURE");
    const store = createDraftStore(temp.root);
    for (const event of [
      eventOf({ kind: "DRAFTED", draftId: D1, at: "2026-11-13T00:00:00Z" }),
      eventOf({ kind: "DRAFTED", draftId: D2, at: "2026-11-13T00:00:10Z" }),
      eventOf({ kind: "REJECTED_BY_CHECKS", draftId: null, at: "2026-11-13T00:00:10Z" }),
    ]) {
      expect((await store.appendEvent(event)).ok).toBe(true);
    }
    expect(await readAiContribution(store)).toEqual({ ok: true, value: { drafted: 2, rejectedByChecks: 1, humanEdited: 0, humanRejected: 0 } });
  });

  it("fails the read when a record of the other data kind is in the store", async () => {
    temp = await createTempRoot("FIXTURE");
    const store = createDraftStore(temp.root);
    const foreign = eventOf({ kind: "DRAFTED", dataKind: "REAL_AI", draftId: D1 });
    await mkdir(join(temp.root.rootDir, "events"), { recursive: true });
    await writeFile(join(temp.root.rootDir, "events", `${foreign.eventId}.json`), JSON.stringify(foreign), "utf8");
    expect(await readAiContribution(store)).toEqual({ ok: false, error: { code: "DATA_KIND_MIXED" } });
  });
});
