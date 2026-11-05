import {
  AnalysisRunSchema,
  RunEventContentSchema,
  RunEventSchema,
  type AnalysisRun,
  type RunEvent,
  type RunEventAppend,
  type RunEventContent,
  type Sha256,
} from "@ehime-vote-navigator/contracts";

import { hashCanonicalJson } from "../serialization/contentHash.js";

export const RUN_EVENT_FOLD_ISSUE_CODES = [
  "DUPLICATE_SEQUENCE",
  "EMPTY_EVENT_STREAM",
  "EVENT_HASH_MISMATCH",
  "FIRST_EVENT_NOT_RUN_CREATED",
  "FIRST_EVENT_PREVIOUS_HASH_PRESENT",
  "INVALID_EVENT_SCHEMA",
  "INVALID_RUN_STATE",
  "MULTIPLE_RUN_CREATED",
  "OUT_OF_ORDER_SEQUENCE",
  "PREVIOUS_EVENT_HASH_MISMATCH",
  "RUN_ID_MISMATCH",
  "SEQUENCE_GAP",
] as const;

export type RunEventFoldIssueCode =
  (typeof RUN_EVENT_FOLD_ISSUE_CODES)[number];

const FOLD_ISSUE_MESSAGES: Readonly<Record<RunEventFoldIssueCode, string>> =
  Object.freeze({
    DUPLICATE_SEQUENCE: "The run event sequence contains a duplicate number.",
    EMPTY_EVENT_STREAM: "The run event sequence is empty.",
    EVENT_HASH_MISMATCH: "A run event content hash is invalid.",
    FIRST_EVENT_NOT_RUN_CREATED:
      "The first run event is not a run creation event.",
    FIRST_EVENT_PREVIOUS_HASH_PRESENT:
      "The first run event unexpectedly references an earlier event.",
    INVALID_EVENT_SCHEMA: "A run event does not match the strict event schema.",
    INVALID_RUN_STATE:
      "The run event sequence does not reconstruct a valid run state.",
    MULTIPLE_RUN_CREATED:
      "The run event sequence contains more than one creation event.",
    OUT_OF_ORDER_SEQUENCE: "The run events are not in sequence order.",
    PREVIOUS_EVENT_HASH_MISMATCH:
      "A run event does not reference the preceding event hash.",
    RUN_ID_MISMATCH: "The run event sequence contains different run IDs.",
    SEQUENCE_GAP: "The run event sequence contains a missing number.",
  });

export type RunEventFoldIssue = Readonly<{
  code: RunEventFoldIssueCode;
  eventIndex: number | null;
  sequence: number | null;
  safeMessage: string;
}>;

export type FoldedRunEvents = Readonly<{
  eventCount: number;
  lastEventHash: Sha256;
  run: AnalysisRun;
}>;

export type FoldRunEventsResult =
  | Readonly<{ ok: true; value: FoldedRunEvents }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "RUN_EVENT_STREAM_INVALID";
        issues: readonly RunEventFoldIssue[];
      }>;
    }>;

export type CreateRunEventInput = Readonly<
  RunEventAppend & {
    previousEventHash: Sha256 | null;
    sequence: number;
  }
>;

function makeIssue(
  code: RunEventFoldIssueCode,
  eventIndex: number | null,
  sequence: number | null,
): RunEventFoldIssue {
  return Object.freeze({
    code,
    eventIndex,
    sequence,
    safeMessage: FOLD_ISSUE_MESSAGES[code],
  });
}

function candidateSequence(value: unknown): number | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("sequence" in value)
    ) {
      return null;
    }

    const sequence = (value as { sequence?: unknown }).sequence;
    return typeof sequence === "number" && Number.isSafeInteger(sequence)
      ? sequence
      : null;
  } catch {
    return null;
  }
}

function eventContent(event: RunEvent): RunEventContent {
  return RunEventContentSchema.parse({
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    previousEventHash: event.previousEventHash,
    runId: event.runId,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
}

/** Hashes the strict event content, excluding its own eventHash field. */
export function calculateRunEventHash(content: RunEventContent): Sha256 {
  return hashCanonicalJson(RunEventContentSchema.parse(content));
}

/** Creates one strict, hash-chained immutable event for persistence. */
export function createRunEvent(input: CreateRunEventInput): RunEvent {
  const content = RunEventContentSchema.parse({
    schemaVersion: 1,
    sequence: input.sequence,
    previousEventHash: input.previousEventHash,
    runId: input.runId,
    occurredAt: input.occurredAt,
    payload: input.payload,
  });

  return RunEventSchema.parse({
    ...content,
    eventHash: calculateRunEventHash(content),
  });
}

function addIssueOnce(
  issues: RunEventFoldIssue[],
  code: RunEventFoldIssueCode,
  eventIndex: number | null,
  sequence: number | null,
): void {
  if (
    issues.some(
      (issue) =>
        issue.code === code &&
        issue.eventIndex === eventIndex &&
        issue.sequence === sequence,
    )
  ) {
    return;
  }

  issues.push(makeIssue(code, eventIndex, sequence));
}

function invalidResult(
  issues: readonly RunEventFoldIssue[],
): FoldRunEventsResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: "RUN_EVENT_STREAM_INVALID" as const,
      issues: Object.freeze([...issues]),
    }),
  });
}

/**
 * Reconstructs an AnalysisRun from an ordered event sequence without reading
 * clocks, randomness, files, or network state. Any integrity issue fails the
 * whole projection instead of sorting, filling gaps, or returning partial data.
 */
export function foldRunEvents(events: readonly unknown[]): FoldRunEventsResult {
  if (events.length === 0) {
    return invalidResult([makeIssue("EMPTY_EVENT_STREAM", null, null)]);
  }

  const issues: RunEventFoldIssue[] = [];
  const parsedEvents: Array<Readonly<{ event: RunEvent; inputIndex: number }>> =
    [];

  events.forEach((candidate, inputIndex) => {
    try {
      const parsed = RunEventSchema.safeParse(candidate);
      if (parsed.success) {
        parsedEvents.push(Object.freeze({ event: parsed.data, inputIndex }));
      } else {
        issues.push(
          makeIssue(
            "INVALID_EVENT_SCHEMA",
            inputIndex,
            candidateSequence(candidate),
          ),
        );
      }
    } catch {
      issues.push(
        makeIssue(
          "INVALID_EVENT_SCHEMA",
          inputIndex,
          candidateSequence(candidate),
        ),
      );
    }
  });

  const sequenceOwners = new Map<number, number>();
  for (const { event, inputIndex } of parsedEvents) {
    const firstOwner = sequenceOwners.get(event.sequence);
    if (firstOwner !== undefined) {
      addIssueOnce(
        issues,
        "DUPLICATE_SEQUENCE",
        firstOwner,
        event.sequence,
      );
      addIssueOnce(
        issues,
        "DUPLICATE_SEQUENCE",
        inputIndex,
        event.sequence,
      );
    } else {
      sequenceOwners.set(event.sequence, inputIndex);
    }
  }

  const uniqueSequences = [...sequenceOwners.keys()].sort(
    (left, right) => left - right,
  );
  let expectedSequence = 1;
  for (const sequence of uniqueSequences) {
    while (expectedSequence < sequence) {
      addIssueOnce(issues, "SEQUENCE_GAP", null, expectedSequence);
      expectedSequence += 1;
    }
    expectedSequence = Math.max(expectedSequence, sequence + 1);
  }

  let priorSequence = 0;
  for (const { event, inputIndex } of parsedEvents) {
    if (event.sequence <= priorSequence) {
      addIssueOnce(
        issues,
        "OUT_OF_ORDER_SEQUENCE",
        inputIndex,
        event.sequence,
      );
    }
    priorSequence = event.sequence;
  }

  const first = parsedEvents[0];
  if (first !== undefined) {
    if (first.event.payload.type !== "RUN_CREATED") {
      addIssueOnce(
        issues,
        "FIRST_EVENT_NOT_RUN_CREATED",
        first.inputIndex,
        first.event.sequence,
      );
    }
    if (first.event.previousEventHash !== null) {
      addIssueOnce(
        issues,
        "FIRST_EVENT_PREVIOUS_HASH_PRESENT",
        first.inputIndex,
        first.event.sequence,
      );
    }
  }

  const expectedRunId = first?.event.runId;
  let priorHash: Sha256 | null = null;
  let creationCount = 0;

  for (const { event, inputIndex } of parsedEvents) {
    if (expectedRunId !== undefined && event.runId !== expectedRunId) {
      addIssueOnce(issues, "RUN_ID_MISMATCH", inputIndex, event.sequence);
    }

    if (event.payload.type === "RUN_CREATED") {
      creationCount += 1;
      if (creationCount > 1) {
        addIssueOnce(
          issues,
          "MULTIPLE_RUN_CREATED",
          inputIndex,
          event.sequence,
        );
      }
    }

    if (event.previousEventHash !== priorHash) {
      addIssueOnce(
        issues,
        event.sequence === 1
          ? "FIRST_EVENT_PREVIOUS_HASH_PRESENT"
          : "PREVIOUS_EVENT_HASH_MISMATCH",
        inputIndex,
        event.sequence,
      );
    }

    if (calculateRunEventHash(eventContent(event)) !== event.eventHash) {
      addIssueOnce(
        issues,
        "EVENT_HASH_MISMATCH",
        inputIndex,
        event.sequence,
      );
    }

    priorHash = event.eventHash;
  }

  if (issues.length > 0 || first === undefined) {
    return invalidResult(issues);
  }

  let projection: AnalysisRun | undefined;
  for (const { event } of parsedEvents) {
    const payload = event.payload;
    switch (payload.type) {
      case "RUN_CREATED": {
        projection = payload.run;
        break;
      }
      case "RUN_STATUS_RECORDED": {
        if (projection === undefined) {
          break;
        }
        projection = {
          ...projection,
          status: payload.status,
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
          durationMs: payload.durationMs,
        };
        break;
      }
      case "RUN_STAGE_RECORDED": {
        if (projection === undefined) {
          break;
        }
        const stages = projection.stages.map((stage, index) =>
          index === payload.stage.ordinal - 1 ? payload.stage : stage,
        ) as unknown as AnalysisRun["stages"];
        projection = { ...projection, stages };
        break;
      }
      case "MODEL_REQUEST_RECORDED": {
        if (projection === undefined) {
          break;
        }
        projection = {
          ...projection,
          requests: [...projection.requests, payload.request],
        };
        break;
      }
      case "SAFE_DIAGNOSTIC_RECORDED": {
        if (projection === undefined) {
          break;
        }
        projection = {
          ...projection,
          safeDiagnostics: [
            ...projection.safeDiagnostics,
            payload.diagnostic,
          ],
        };
        break;
      }
    }
  }

  const reconstructed = AnalysisRunSchema.safeParse(projection);
  if (!reconstructed.success) {
    return invalidResult([
      makeIssue(
        "INVALID_RUN_STATE",
        parsedEvents.length - 1,
        parsedEvents.at(-1)?.event.sequence ?? null,
      ),
    ]);
  }

  const lastEventHash = parsedEvents.at(-1)?.event.eventHash;
  if (lastEventHash === undefined) {
    return invalidResult([makeIssue("EMPTY_EVENT_STREAM", null, null)]);
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      eventCount: parsedEvents.length,
      lastEventHash,
      run: reconstructed.data,
    }),
  });
}
