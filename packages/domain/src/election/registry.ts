import {
  ElectionRegistryFileSchema,
  type CandidateId,
  type ElectionId,
  type ElectionStatus,
  type ISODate,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../result.js";

/**
 * Pure election-registry validation and current-election switching.
 *
 * No function here reads or writes files, logs, or mutates its arguments.
 * `ValidatedRegistry` can only be produced by `loadRegistry` (or by
 * `decideChange` from an already validated registry), so every parsing,
 * search and display entrance that takes it fails closed when the registry
 * file is invalid.
 */

export type RegisteredCandidate = Readonly<{
  candidateId: CandidateId;
  name: string;
  nameForms: readonly string[];
}>;

export type RegisteredElection = Readonly<{
  electionId: ElectionId;
  name: string;
  electionDate: ISODate;
  status: ElectionStatus;
  candidates: readonly RegisteredCandidate[];
}>;

declare const validatedRegistryBrand: unique symbol;

export type ValidatedRegistry = Readonly<{
  schemaVersion: 1;
  elections: readonly RegisteredElection[];
}> & {
  readonly [validatedRegistryBrand]: true;
};

export const REGISTRY_VIOLATION_KINDS = [
  "CONTRACT_VIOLATION",
  "DUPLICATE_CANDIDATE_ID",
  "DUPLICATE_ELECTION_ID",
  "INVALID_CURRENT_COUNT",
] as const;

export type RegistryViolationKind = (typeof REGISTRY_VIOLATION_KINDS)[number];

export type RegistryConfigError = Readonly<{
  code: "REGISTRY_CONFIG_INVALID";
  /** Distinct violation kinds in `REGISTRY_VIOLATION_KINDS` order. */
  violations: readonly RegistryViolationKind[];
  safeMessage: string;
}>;

export type ElectionSummary = Readonly<{
  electionId: ElectionId;
  name: string;
}>;

/** What the developer is asked to approve: the election before and after. */
export type ChangeProposal = Readonly<{
  from: ElectionSummary;
  to: ElectionSummary;
}>;

export type ChangeRejection = Readonly<{
  reason: "TARGET_INVALID";
  safeMessage: string;
}>;

export type ChangeDecision = "APPROVE" | "REJECT";

export type ChangeFailureReason = "REJECTED" | "TARGET_INVALID";

/** The registry is returned unchanged (same reference) with the reason. */
export type ChangeFailure = Readonly<{
  reason: ChangeFailureReason;
  registry: ValidatedRegistry;
  safeMessage: string;
}>;

const REGISTRY_CONFIG_MESSAGE =
  "The election registry is invalid, so all election data is excluded.";
const TARGET_INVALID_MESSAGE =
  "The target election is not registered, is already current, or no longer matches the registry.";
const REJECTED_MESSAGE = "The current-election change was rejected.";

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsOf(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value) ? (value as unknown[]).filter(isRecord) : [];
}

function hasRepeatedString(values: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function seal(data: {
  schemaVersion: 1;
  elections: readonly RegisteredElection[];
}): ValidatedRegistry {
  return deepFreeze(data) as ValidatedRegistry;
}

function currentElectionOf(
  registry: ValidatedRegistry,
): RegisteredElection | undefined {
  return registry.elections.find((election) => election.status === "CURRENT");
}

/**
 * Validates parsed registry data (for example the result of `JSON.parse`).
 *
 * All violation kinds that apply are returned together, without duplicates,
 * even when the Zod contract check fails. The duplicate and CURRENT-count
 * checks read the raw data defensively: election IDs and candidate IDs are
 * compared only when they are strings, and the CURRENT count is the number of
 * election-like objects whose `status` is exactly `"CURRENT"` (so data with no
 * readable election definitions counts 0 and is also INVALID_CURRENT_COUNT).
 * The input is never mutated; the returned registry shares no references with
 * it and is deeply frozen.
 */
export function loadRegistry(
  data: unknown,
): Result<ValidatedRegistry, RegistryConfigError> {
  const parsed = ElectionRegistryFileSchema.safeParse(data);
  const found = new Set<RegistryViolationKind>();

  if (!parsed.success) {
    found.add("CONTRACT_VIOLATION");
  }

  const elections = isRecord(data) ? recordsOf(data["elections"]) : [];

  if (
    elections.some((election) =>
      hasRepeatedString(
        recordsOf(election["candidates"]).map(
          (candidate) => candidate["candidateId"],
        ),
      ),
    )
  ) {
    found.add("DUPLICATE_CANDIDATE_ID");
  }

  if (hasRepeatedString(elections.map((election) => election["electionId"]))) {
    found.add("DUPLICATE_ELECTION_ID");
  }

  if (
    elections.filter((election) => election["status"] === "CURRENT").length !==
    1
  ) {
    found.add("INVALID_CURRENT_COUNT");
  }

  if (!parsed.success || found.size > 0) {
    return {
      ok: false,
      error: Object.freeze({
        code: "REGISTRY_CONFIG_INVALID",
        violations: Object.freeze(
          REGISTRY_VIOLATION_KINDS.filter((kind) => found.has(kind)),
        ),
        safeMessage: REGISTRY_CONFIG_MESSAGE,
      }),
    };
  }

  return { ok: true, value: seal(parsed.data) };
}

/**
 * Describes the change from the current election to `toElectionId` without
 * changing anything. A target that is unregistered, or already CURRENT, is
 * rejected as TARGET_INVALID.
 */
export function proposeChange(
  registry: ValidatedRegistry,
  toElectionId: string,
): Result<ChangeProposal, ChangeRejection> {
  const current = currentElectionOf(registry);
  const target = registry.elections.find(
    (election) => election.electionId === toElectionId,
  );

  if (
    current === undefined ||
    target === undefined ||
    target.status === "CURRENT"
  ) {
    return {
      ok: false,
      error: Object.freeze({
        reason: "TARGET_INVALID",
        safeMessage: TARGET_INVALID_MESSAGE,
      }),
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      from: Object.freeze({
        electionId: current.electionId,
        name: current.name,
      }),
      to: Object.freeze({ electionId: target.electionId, name: target.name }),
    }),
  };
}

/**
 * Applies a decision on a proposal and returns the whole next registry.
 *
 * Only an exact `"APPROVE"` can change anything; any other decision is a
 * rejection. On approval the old CURRENT becomes PAST and the target becomes
 * CURRENT in one returned value; all other values, including candidate
 * definitions, are unchanged. A proposal that no longer matches the registry
 * (target unregistered or already CURRENT, or the `from` election is not the
 * current one, or the shown names differ) is TARGET_INVALID. In every failure
 * case the same registry reference is returned unchanged with the reason.
 */
export function decideChange(
  registry: ValidatedRegistry,
  proposal: ChangeProposal,
  decision: ChangeDecision,
): Result<ValidatedRegistry, ChangeFailure> {
  if (decision !== "APPROVE") {
    return {
      ok: false,
      error: Object.freeze({
        reason: "REJECTED",
        registry,
        safeMessage: REJECTED_MESSAGE,
      }),
    };
  }

  const current = currentElectionOf(registry);
  const target = registry.elections.find(
    (election) => election.electionId === proposal.to.electionId,
  );

  if (
    current === undefined ||
    target === undefined ||
    target.status === "CURRENT" ||
    current.electionId !== proposal.from.electionId ||
    current.name !== proposal.from.name ||
    target.name !== proposal.to.name
  ) {
    return {
      ok: false,
      error: Object.freeze({
        reason: "TARGET_INVALID",
        registry,
        safeMessage: TARGET_INVALID_MESSAGE,
      }),
    };
  }

  const elections = registry.elections.map((election): RegisteredElection => {
    if (election.electionId === current.electionId) {
      return { ...election, status: "PAST" };
    }
    if (election.electionId === target.electionId) {
      return { ...election, status: "CURRENT" };
    }
    return election;
  });

  return {
    ok: true,
    value: seal({ schemaVersion: registry.schemaVersion, elections }),
  };
}
