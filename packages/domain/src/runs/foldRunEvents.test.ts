import {
  RunEventPayloadSchema,
  type RunEvent,
  type RunEventPayload,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  RUN_EVENT_FIXTURE_CREATED_AT,
  RUN_EVENT_FIXTURE_ENDED_AT,
  RUN_EVENT_FIXTURE_STARTED_AT,
  createPendingAnalysisRun,
  createRunEventAppend,
} from "../../../../tests/harness/run-event-fixture.js";
import { createRunEvent, foldRunEvents } from "./foldRunEvents.js";

function appendEvent(
  events: RunEvent[],
  payloadInput: unknown,
  occurredAt = RUN_EVENT_FIXTURE_CREATED_AT,
): RunEvent {
  const payload = RunEventPayloadSchema.parse(payloadInput);
  const append = createRunEventAppend(payload, occurredAt);
  const event = createRunEvent({
    ...append,
    sequence: events.length + 1,
    previousEventHash: events.at(-1)?.eventHash ?? null,
  });
  events.push(event);
  return event;
}

function creationEvents(): RunEvent[] {
  const events: RunEvent[] = [];
  appendEvent(events, {
    type: "RUN_CREATED",
    run: createPendingAnalysisRun(),
  });
  return events;
}

describe("foldRunEvents", () => {
  it("purely reconstructs the AnalysisRun display state from valid events", () => {
    const events = creationEvents();
    appendEvent(
      events,
      {
        type: "RUN_STATUS_RECORDED",
        status: "RUNNING",
        startedAt: RUN_EVENT_FIXTURE_STARTED_AT,
        endedAt: null,
        durationMs: null,
      },
      RUN_EVENT_FIXTURE_STARTED_AT,
    );
    appendEvent(events, {
      type: "RUN_STAGE_RECORDED",
      stage: {
        name: "INGESTION",
        ordinal: 1,
        status: "SUCCEEDED",
        startedAt: RUN_EVENT_FIXTURE_STARTED_AT,
        endedAt: RUN_EVENT_FIXTURE_ENDED_AT,
        resultArtifactIds: ["artifact-fixture-1"],
        errorClassification: null,
        lifecycleCode: null,
        safeReason: null,
      },
    });
    appendEvent(events, {
      type: "MODEL_REQUEST_RECORDED",
      request: {
        requestId: "request-fixture-1",
        purpose: "GENERATION",
        modelId: "generation-fixture-model",
        attempt: 1,
        startedAt: RUN_EVENT_FIXTURE_STARTED_AT,
        endedAt: RUN_EVENT_FIXTURE_ENDED_AT,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          unit: "TOKENS",
          unavailableReason: null,
        },
        priceTableVersion: "pricing-fixture-v1",
        formula: "fixture formula",
        estimatedCost: { currency: "USD", amount: "0.001" },
        unavailableReason: null,
      },
    });
    appendEvent(events, {
      type: "SAFE_DIAGNOSTIC_RECORDED",
      diagnostic: "Fixture request completed.",
    });
    appendEvent(
      events,
      {
        type: "RUN_STATUS_RECORDED",
        status: "SUCCEEDED",
        startedAt: RUN_EVENT_FIXTURE_STARTED_AT,
        endedAt: RUN_EVENT_FIXTURE_ENDED_AT,
        durationMs: 1000,
      },
      RUN_EVENT_FIXTURE_ENDED_AT,
    );
    const before = structuredClone(events);

    const first = foldRunEvents(events);
    const second = foldRunEvents(events);

    expect(first).toEqual(second);
    expect(events).toEqual(before);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.eventCount).toBe(6);
    expect(first.value.lastEventHash).toBe(events.at(-1)?.eventHash);
    expect(first.value.run).toMatchObject({
      status: "SUCCEEDED",
      startedAt: RUN_EVENT_FIXTURE_STARTED_AT,
      endedAt: RUN_EVENT_FIXTURE_ENDED_AT,
      durationMs: 1000,
      safeDiagnostics: ["Fixture request completed."],
    });
    expect(first.value.run.stages[0]).toMatchObject({
      status: "SUCCEEDED",
      resultArtifactIds: ["artifact-fixture-1"],
    });
    expect(first.value.run.requests).toHaveLength(1);
  });

  it("rejects a content hash mutation without returning a partial run", () => {
    const events = creationEvents();
    const corrupted = [
      {
        ...events[0]!,
        eventHash: "f".repeat(64),
      },
    ];

    const result = foldRunEvents(corrupted);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "EVENT_HASH_MISMATCH", sequence: 1 }),
    );
    expect("run" in result).toBe(false);
  });

  it("detects a missing sequence and does not fill or reorder events", () => {
    const events = creationEvents();
    const payload: RunEventPayload = RunEventPayloadSchema.parse({
      type: "SAFE_DIAGNOSTIC_RECORDED",
      diagnostic: "Sequence three fixture.",
    });
    const append = createRunEventAppend(payload);
    const sequenceThree = createRunEvent({
      ...append,
      sequence: 3,
      previousEventHash: events[0]!.eventHash,
    });

    const result = foldRunEvents([events[0], sequenceThree]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "SEQUENCE_GAP", sequence: 2 }),
    );
  });

  it("detects duplicate sequence numbers", () => {
    const events = creationEvents();
    const duplicate = createRunEvent({
      ...createRunEventAppend(
        RunEventPayloadSchema.parse({
          type: "SAFE_DIAGNOSTIC_RECORDED",
          diagnostic: "Duplicate sequence fixture.",
        }),
      ),
      sequence: 1,
      previousEventHash: events[0]!.eventHash,
    });

    const result = foldRunEvents([events[0], duplicate]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.filter(({ code }) => code === "DUPLICATE_SEQUENCE"))
      .toHaveLength(2);
  });

  it("rejects a hash-chain break and an invalid reconstructed AnalysisRun", () => {
    const events = creationEvents();
    const chainBreak = createRunEvent({
      ...createRunEventAppend(
        RunEventPayloadSchema.parse({
          type: "SAFE_DIAGNOSTIC_RECORDED",
          diagnostic: "Broken chain fixture.",
        }),
      ),
      sequence: 2,
      previousEventHash: null,
    });
    const chainResult = foldRunEvents([events[0], chainBreak]);
    expect(chainResult.ok).toBe(false);
    if (!chainResult.ok) {
      expect(chainResult.error.issues).toContainEqual(
        expect.objectContaining({ code: "PREVIOUS_EVENT_HASH_MISMATCH" }),
      );
    }

    const invalidStatus = createRunEvent({
      ...createRunEventAppend(
        RunEventPayloadSchema.parse({
          type: "RUN_STATUS_RECORDED",
          status: "FAILED",
          startedAt: RUN_EVENT_FIXTURE_ENDED_AT,
          endedAt: RUN_EVENT_FIXTURE_STARTED_AT,
          durationMs: 0,
        }),
      ),
      sequence: 2,
      previousEventHash: events[0]!.eventHash,
    });
    const stateResult = foldRunEvents([events[0], invalidStatus]);
    expect(stateResult.ok).toBe(false);
    if (!stateResult.ok) {
      expect(stateResult.error.issues).toContainEqual(
        expect.objectContaining({ code: "INVALID_RUN_STATE" }),
      );
    }
  });

  it("rejects an empty or schema-invalid sequence with fixed safe diagnostics", () => {
    const empty = foldRunEvents([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error.issues).toEqual([
        {
          code: "EMPTY_EVENT_STREAM",
          eventIndex: null,
          sequence: null,
          safeMessage: "The run event sequence is empty.",
        },
      ]);
    }

    const invalid = foldRunEvents([{ sequence: 1, secret: "must not echo" }]);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.issues[0]?.safeMessage).not.toContain("must not echo");
      expect(invalid.error.issues[0]?.code).toBe("INVALID_EVENT_SCHEMA");
    }
  });
});
