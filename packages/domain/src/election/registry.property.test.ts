import { ElectionRegistryFileSchema } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  REGISTRY_VIOLATION_KINDS,
  decideChange,
  loadRegistry,
  proposeChange,
  type ChangeProposal,
  type ValidatedRegistry,
} from "./registry.js";

const RUNS = 300;
const ELECTION_IDS = ["election-a", "election-b", "election-c", "election-d"] as const;
const CANDIDATE_IDS = ["candidate-a", "candidate-b", "candidate-c"] as const;
const STATUSES = ["PAST", "CURRENT", "PLANNED"] as const;
const FIXED_ID = "election-fixed";

type RawCandidate = { candidateId: string; name: string; nameForms: string[] };
type RawElection = {
  electionId: string;
  name: string;
  electionDate: string;
  status: string;
  candidates: RawCandidate[];
};
type RawRegistry = { schemaVersion: number; elections: RawElection[] };

// Obviously fictional placeholders; no real candidate appears here.
const candidateArb: fc.Arbitrary<RawCandidate> = fc.record({
  candidateId: fc.constantFrom(...CANDIDATE_IDS),
  name: fc.constant("Test Candidate"),
  nameForms: fc.constant(["Test Candidate"]),
});

const electionArb: fc.Arbitrary<RawElection> = fc.record({
  electionId: fc.constantFrom(...ELECTION_IDS),
  name: fc.constant("Test Election"),
  electionDate: fc.constantFrom("2022-11-20", "2026-11-15"),
  status: fc.constantFrom(...STATUSES),
  candidates: fc.array(candidateArb, { minLength: 1, maxLength: 3 }),
});

const rawRegistryArb: fc.Arbitrary<RawRegistry> = fc.record({
  schemaVersion: fc.constant(1),
  elections: fc.array(electionArb, { minLength: 1, maxLength: 4 }),
});

type Mutation =
  | "none"
  | "extra-key"
  | "bad-date"
  | "no-candidates"
  | "bad-version"
  | "bad-election-id"
  | "blank-name-form";

function mutate(data: RawRegistry, mutation: Mutation): RawRegistry {
  const copy = structuredClone(data);
  const first = copy.elections[0];
  if (first === undefined) {
    return copy;
  }
  switch (mutation) {
    case "extra-key":
      (first as Record<string, unknown>)["timeZone"] = "Asia/Tokyo";
      break;
    case "bad-date":
      first.electionDate = "2026-02-30";
      break;
    case "no-candidates":
      first.candidates = [];
      break;
    case "bad-version":
      copy.schemaVersion = 2;
      break;
    case "bad-election-id":
      first.electionId = "bad id!";
      break;
    case "blank-name-form":
      first.candidates = first.candidates.map((c) => ({ ...c, nameForms: [] }));
      break;
    case "none":
      break;
  }
  return copy;
}

const mixedDataArb: fc.Arbitrary<RawRegistry> = fc
  .tuple(
    rawRegistryArb,
    fc.constantFrom<Mutation>("none", "none", "none", "extra-key", "bad-date", "no-candidates", "bad-version", "bad-election-id", "blank-name-form"),
  )
  .map(([data, mutation]) => mutate(data, mutation));

function expectedViolations(data: RawRegistry): string[] {
  const kinds = new Set<string>();
  if (!ElectionRegistryFileSchema.safeParse(data).success) {
    kinds.add("CONTRACT_VIOLATION");
  }
  if (
    data.elections.some(
      (election) =>
        new Set(election.candidates.map((c) => c.candidateId)).size !== election.candidates.length,
    )
  ) {
    kinds.add("DUPLICATE_CANDIDATE_ID");
  }
  if (new Set(data.elections.map((e) => e.electionId)).size !== data.elections.length) {
    kinds.add("DUPLICATE_ELECTION_ID");
  }
  if (data.elections.filter((e) => e.status === "CURRENT").length !== 1) {
    kinds.add("INVALID_CURRENT_COUNT");
  }
  return REGISTRY_VIOLATION_KINDS.filter((kind) => kinds.has(kind));
}

// A registry that is valid by construction: unique IDs and exactly one CURRENT.
const validRegistryArb: fc.Arbitrary<RawRegistry> = fc
  .uniqueArray(fc.constantFrom(...ELECTION_IDS), { minLength: 1, maxLength: 4 })
  .chain((ids) =>
    fc.tuple(
      fc.constant(ids),
      fc.integer({ min: 0, max: ids.length - 1 }),
      fc.array(fc.constantFrom<"PAST" | "PLANNED">("PAST", "PLANNED"), { minLength: ids.length, maxLength: ids.length }),
      fc.array(fc.uniqueArray(fc.constantFrom(...CANDIDATE_IDS), { minLength: 1, maxLength: 3 }), { minLength: ids.length, maxLength: ids.length }),
    ),
  )
  .map(([ids, currentIndex, others, candidateIds]) => ({
    schemaVersion: 1,
    elections: ids.map((electionId, index) => ({
      electionId,
      name: `Test Election ${electionId}`,
      electionDate: index % 2 === 0 ? "2022-11-20" : "2026-11-15",
      status: index === currentIndex ? "CURRENT" : (others[index] ?? "PAST"),
      candidates: (candidateIds[index] ?? ["candidate-a"]).map((candidateId) => ({
        candidateId,
        name: `Test Candidate ${candidateId}`,
        nameForms: [`Test Candidate ${candidateId}`],
      })),
    })),
  }));

describe("Feature: multi-election-ai-analysis, Property 1: registry validation fails closed", () => {
  it("returns a registry exactly when the data is valid, otherwise every applicable violation kind", () => {
    let accepted = 0;
    let rejected = 0;

    fc.assert(
      fc.property(mixedDataArb, (data) => {
        const before = JSON.stringify(data);
        const expected = expectedViolations(data);

        const result = loadRegistry(data);

        expect(JSON.stringify(data)).toBe(before);
        if (expected.length === 0) {
          accepted += 1;
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(JSON.parse(JSON.stringify(result.value))).toEqual(data);
          }
        } else {
          rejected += 1;
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.violations).toEqual(expected);
            expect(new Set(result.error.violations).size).toBe(result.error.violations.length);
          }
        }
      }),
      { numRuns: RUNS },
    );

    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("always accepts a registry that is valid by construction", () => {
    fc.assert(
      fc.property(validRegistryArb, (data) => {
        const result = loadRegistry(data);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.elections.filter((e) => e.status === "CURRENT")).toHaveLength(1);
          expect(JSON.parse(JSON.stringify(result.value))).toEqual(data);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("rejects every registry that has no CURRENT election or two", () => {
    fc.assert(
      fc.property(validRegistryArb, fc.constantFrom("none", "two"), (data, shape) => {
        const copy = structuredClone(data);
        for (const election of copy.elections) {
          if (election.status === "CURRENT") {
            election.status = "PAST";
          }
        }
        if (shape === "two") {
          for (const election of copy.elections) {
            election.status = "CURRENT";
          }
          copy.elections.push({ ...copy.elections[0]!, electionId: "election-extra" });
        }

        const result = loadRegistry(copy);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.violations).toContain("INVALID_CURRENT_COUNT");
      }),
      { numRuns: RUNS },
    );
  });
});

type Operation = { target: string; decision: "APPROVE" | "REJECT"; useOldProposal: boolean };

const operationArb: fc.Arbitrary<Operation> = fc.record({
  target: fc.constantFrom(...ELECTION_IDS, FIXED_ID, "no-such-election"),
  decision: fc.constantFrom<"APPROVE" | "REJECT">("APPROVE", "REJECT", "APPROVE"),
  useOldProposal: fc.boolean(),
});

function startRegistry(currentId: string): ValidatedRegistry {
  const ids = [FIXED_ID, ...ELECTION_IDS];
  const loaded = loadRegistry({
    schemaVersion: 1,
    elections: ids.map((electionId, index) => ({
      electionId,
      name: `Test Election ${electionId}`,
      electionDate: index === 0 ? "2022-11-20" : "2026-11-15",
      status: electionId === currentId ? "CURRENT" : index % 2 === 0 ? "PAST" : "PLANNED",
      candidates: [
        { candidateId: `candidate-${index}`, name: `Test Candidate ${index}`, nameForms: [`Test Candidate ${index}`] },
      ],
    })),
  });
  if (!loaded.ok) {
    throw new Error("fixture registry invalid");
  }
  return loaded.value;
}

function withoutStatus(registry: ValidatedRegistry) {
  return registry.elections.map((election) => ({ ...election, status: "" }));
}

function statusOf(registry: ValidatedRegistry, electionId: string): string | undefined {
  return registry.elections.find((e) => e.electionId === electionId)?.status;
}

describe("Feature: multi-election-ai-analysis, Property 2: current-election state machine", () => {
  it("keeps exactly one CURRENT election and changes only the two statuses on approval", () => {
    let changes = 0;
    let refusals = 0;

    fc.assert(
      fc.property(fc.constantFrom(FIXED_ID, ...ELECTION_IDS), fc.array(operationArb, { minLength: 1, maxLength: 8 }), (startId, operations) => {
        let registry = startRegistry(startId);
        let previousProposal: ChangeProposal | undefined;

        for (const operation of operations) {
          const before = registry;
          const beforeSnapshot = JSON.stringify(before);
          const currentId = before.elections.find((e) => e.status === "CURRENT")?.electionId;
          const proposed = proposeChange(before, operation.target);

          if (!proposed.ok) {
            refusals += 1;
            expect(proposed.error.reason).toBe("TARGET_INVALID");
            expect(operation.target === "no-such-election" || operation.target === currentId).toBe(true);
          } else {
            const proposal = operation.useOldProposal && previousProposal !== undefined ? previousProposal : proposed.value;
            previousProposal = proposed.value;
            const decided = decideChange(before, proposal, operation.decision);

            if (decided.ok) {
              changes += 1;
              expect(operation.decision).toBe("APPROVE");
              expect(proposal.from.electionId).toBe(currentId);
              registry = decided.value;
              expect(statusOf(registry, proposal.to.electionId)).toBe("CURRENT");
              expect(statusOf(registry, proposal.from.electionId)).toBe("PAST");
              for (const election of registry.elections) {
                if (election.electionId !== proposal.to.electionId && election.electionId !== proposal.from.electionId) {
                  expect(election.status).toBe(statusOf(before, election.electionId));
                }
              }
              expect(withoutStatus(registry)).toEqual(withoutStatus(before));
            } else {
              refusals += 1;
              expect(decided.error.registry).toBe(before);
              if (operation.decision === "REJECT") {
                expect(decided.error.reason).toBe("REJECTED");
              }
            }
          }

          if (registry === before) {
            expect(JSON.stringify(registry)).toBe(beforeSnapshot);
          }
          expect(registry.elections.filter((e) => e.status === "CURRENT")).toHaveLength(1);
          expect(loadRegistry(JSON.parse(JSON.stringify(registry))).ok).toBe(true);
          const fixed = registry.elections.find((e) => e.electionId === FIXED_ID);
          expect(fixed?.name).toBe(`Test Election ${FIXED_ID}`);
          expect(fixed?.electionDate).toBe("2022-11-20");
          expect(fixed?.candidates.map((c) => c.candidateId)).toEqual(["candidate-0"]);
        }
      }),
      { numRuns: RUNS },
    );

    expect(changes).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
  });
});