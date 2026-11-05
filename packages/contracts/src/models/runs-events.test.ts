import { describe, expect, it } from "vitest";

import {
  RUN_EVENT_SCHEMA_VERSION,
  RunEventAppendSchema,
  RunEventContentSchema,
  RunEventSchema,
} from "./runs.js";
import { createPendingAnalysisRun } from "../../../../tests/harness/run-event-fixture.js";

const HASH = "a".repeat(64);
const OCCURRED_AT = "2026-01-01T00:00:00.000Z";

describe("strict run event contracts", () => {
  it("accepts the minimal append command and persisted hash envelope", () => {
    const run = createPendingAnalysisRun();
    const append = {
      runId: run.runId,
      occurredAt: OCCURRED_AT,
      payload: { type: "RUN_CREATED", run },
    };

    expect(RunEventAppendSchema.safeParse(append).success).toBe(true);
    expect(
      RunEventContentSchema.safeParse({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        sequence: 1,
        previousEventHash: null,
        ...append,
      }).success,
    ).toBe(true);
    expect(
      RunEventSchema.safeParse({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        sequence: 1,
        previousEventHash: null,
        ...append,
        eventHash: HASH,
      }).success,
    ).toBe(true);
  });

  it("rejects unknown envelope and payload fields", () => {
    const run = createPendingAnalysisRun();
    const base = {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      sequence: 1,
      previousEventHash: null,
      runId: run.runId,
      occurredAt: OCCURRED_AT,
      payload: { type: "RUN_CREATED", run },
      eventHash: HASH,
    };

    expect(
      RunEventSchema.safeParse({ ...base, unexpected: true }).success,
    ).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...base,
        payload: { ...base.payload, unexpected: true },
      }).success,
    ).toBe(false);
  });

  it("requires the creation payload and envelope to identify the same run", () => {
    const run = createPendingAnalysisRun("run-inside-payload");

    expect(
      RunEventAppendSchema.safeParse({
        runId: "different-envelope-run",
        occurredAt: OCCURRED_AT,
        payload: { type: "RUN_CREATED", run },
      }).success,
    ).toBe(false);
  });

  it("rejects missing integrity fields and unsupported event kinds", () => {
    const run = createPendingAnalysisRun();
    const event = {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      sequence: 1,
      previousEventHash: null,
      runId: run.runId,
      occurredAt: OCCURRED_AT,
      payload: { type: "RUN_CREATED", run },
      eventHash: HASH,
    };

    const withoutHash = { ...event } as Partial<typeof event>;
    delete withoutHash.eventHash;
    expect(RunEventSchema.safeParse(withoutHash).success).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...event,
        payload: { type: "RUN_DELETED" },
      }).success,
    ).toBe(false);
  });
});
