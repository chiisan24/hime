import {
  CandidateSchema,
  TARGET_ELECTION_ID,
  TARGET_ELECTION_NAME,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import {
  decideChange,
  loadRegistry,
  proposeChange,
  REGISTRY_VIOLATION_KINDS,
  type ChangeProposal,
  type ValidatedRegistry,
} from "./registry.js";

// Names of the existing 2022 candidates come from the existing contract so no
// name is retyped here. Everything else is an obviously fictional placeholder.
function nameOf2022(index: number): string {
  const name = CandidateSchema.shape.canonicalName.options[index];
  if (name === undefined) {
    throw new Error("The existing 2022 contract no longer lists this candidate name.");
  }
  return name;
}

const NAME_2022_A = nameOf2022(0);
const NAME_2022_B = nameOf2022(1);

const PLANNED_ID = "test-election-planned";
const PLANNED_NAME = "テスト選挙（予定）";
const OLD_ID = "test-election-old";
const OLD_NAME = "テスト選挙（過去）";

function candidate(candidateId: string, name: string, nameForms = [name]) {
  return { candidateId, name, nameForms };
}

type RawElection = Record<string, unknown>;

function election2022(status = "CURRENT") {
  return {
    electionId: TARGET_ELECTION_ID,
    name: TARGET_ELECTION_NAME,
    electionDate: "2022-11-20",
    status,
    candidates: [
      candidate("candidate-a", NAME_2022_A),
      candidate("candidate-b", NAME_2022_B),
    ],
  };
}

function electionPlanned(status = "PLANNED") {
  return {
    electionId: PLANNED_ID,
    name: PLANNED_NAME,
    electionDate: "2026-11-15",
    status,
    candidates: [
      candidate("candidate-c", "テスト候補C"),
      candidate("candidate-d", "テスト候補D", ["テスト候補D", "てすと こうほD"]),
    ],
  };
}

function electionOld(status = "PAST") {
  return {
    electionId: OLD_ID,
    name: OLD_NAME,
    electionDate: "2010-01-01",
    status,
    candidates: [candidate("candidate-e", "テスト候補E")],
  };
}

function file(elections: readonly RawElection[]) {
  return { schemaVersion: 1, elections };
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

function validRegistry(elections: readonly RawElection[]): ValidatedRegistry {
  const result = loadRegistry(file(elections));
  if (!result.ok) {
    throw new Error(`fixture registry invalid: ${result.error.violations.join(",")}`);
  }
  return result.value;
}

function violationsOf(input: unknown) {
  const result = loadRegistry(input);
  if (result.ok) {
    throw new Error("expected the registry to be rejected");
  }
  return result.error.violations;
}

function statusesOf(registry: ValidatedRegistry) {
  return registry.elections.map((e) => [e.electionId, e.status]);
}

function proposalOf(registry: ValidatedRegistry, toElectionId: string): ChangeProposal {
  const result = proposeChange(registry, toElectionId);
  if (!result.ok) {
    throw new Error("expected a proposal");
  }
  return result.value;
}

describe("loadRegistry", () => {
  it("returns a ValidatedRegistry for the 2022 election plus a placeholder PLANNED election", () => {
    const input = file([election2022(), electionPlanned()]);
    const result = loadRegistry(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(input);
    expect(result.value.elections[1]?.electionDate).toBe("2026-11-15");
    expect(result.value.elections[1]?.candidates[1]?.nameForms).toEqual([
      "テスト候補D",
      "てすと こうほD",
    ]);
  });

  it("accepts a registry with a single CURRENT election and boundary sizes", () => {
    const twenty = {
      ...election2022(),
      electionId: "e".repeat(64),
      name: "あ".repeat(100),
      candidates: Array.from({ length: 20 }, (_, i) =>
        candidate(`${"c".repeat(60)}${String(i).padStart(4, "0")}`, "あ".repeat(50), ["い".repeat(50)]),
      ),
    };

    expect(loadRegistry(file([election2022("PAST"), { ...twenty, status: "CURRENT" }])).ok).toBe(true);
    expect(violationsOf(file([{ ...twenty, candidates: [] }]))).toEqual(["CONTRACT_VIOLATION"]);
  });

  it("allows the same candidate ID in different elections", () => {
    const other = { ...electionPlanned(), candidates: [candidate("candidate-a", "テスト候補A")] };

    expect(loadRegistry(file([election2022(), other])).ok).toBe(true);
  });

  it("does not mutate its input, even when the input is deeply frozen", () => {
    const valid = deepFreeze(file([election2022(), electionPlanned()]));
    const invalid = deepFreeze(file([election2022(), { ...electionPlanned(), status: "CURRENT" }]));
    const validBefore = structuredClone(valid);
    const invalidBefore = structuredClone(invalid);

    expect(loadRegistry(valid).ok).toBe(true);
    expect(loadRegistry(invalid).ok).toBe(false);
    expect(valid).toEqual(validBefore);
    expect(invalid).toEqual(invalidBefore);
  });

  it("returns a deeply frozen registry that shares no references with the input", () => {
    const input = file([election2022(), electionPlanned()]);
    const result = loadRegistry(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const registry = result.value;
    expect(registry).not.toBe(input);
    expect(registry.elections[0]).not.toBe(input.elections[0]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.elections)).toBe(true);
    expect(Object.isFrozen(registry.elections[1])).toBe(true);
    expect(Object.isFrozen(registry.elections[1]?.candidates[1]?.nameForms)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);

    const [firstInput] = input.elections;
    if (firstInput !== undefined) {
      firstInput.name = "changed after load";
    }
    expect(registry.elections[0]?.name).toBe(TARGET_ELECTION_NAME);
  });

  describe("violations", () => {
    it("reports CONTRACT_VIOLATION for out-of-range values", () => {
      expect(violationsOf(file([{ ...election2022(), electionDate: "2026-02-30" }]))).toEqual([
        "CONTRACT_VIOLATION",
      ]);
      expect(
        violationsOf(file([election2022(), { ...electionPlanned(), status: "ACTIVE" }])),
      ).toEqual(["CONTRACT_VIOLATION"]);
      expect(violationsOf(file([{ ...election2022(), electionId: "bad id" }]))).toEqual([
        "CONTRACT_VIOLATION",
      ]);
    });

    it("reports CONTRACT_VIOLATION for unknown keys and a wrong schemaVersion", () => {
      expect(
        violationsOf({ ...file([election2022()]), extra: true }),
      ).toEqual(["CONTRACT_VIOLATION"]);
      expect(
        violationsOf(file([{ ...election2022(), timeZone: "Asia/Tokyo" }])),
      ).toEqual(["CONTRACT_VIOLATION"]);
      expect(
        violationsOf({ ...file([election2022()]), schemaVersion: 2 }),
      ).toEqual(["CONTRACT_VIOLATION"]);
    });

    it("reports DUPLICATE_CANDIDATE_ID only for repeats inside one election", () => {
      const duplicated = {
        ...election2022(),
        candidates: [candidate("candidate-a", "テスト候補A"), candidate("candidate-a", "テスト候補B")],
      };

      expect(violationsOf(file([duplicated]))).toEqual(["DUPLICATE_CANDIDATE_ID"]);
    });

    it("reports DUPLICATE_ELECTION_ID across election definitions", () => {
      const copy = { ...electionPlanned("PAST"), electionId: TARGET_ELECTION_ID };

      expect(violationsOf(file([election2022(), copy]))).toEqual(["DUPLICATE_ELECTION_ID"]);
    });

    it("reports INVALID_CURRENT_COUNT for zero and for two CURRENT elections", () => {
      expect(violationsOf(file([election2022("PAST"), electionPlanned()]))).toEqual([
        "INVALID_CURRENT_COUNT",
      ]);
      expect(violationsOf(file([election2022(), electionPlanned("CURRENT")]))).toEqual([
        "INVALID_CURRENT_COUNT",
      ]);
    });

    it("returns every applicable kind once, in a fixed order", () => {
      const everything = file([
        {
          ...election2022(),
          electionDate: "2026-02-30",
          candidates: [candidate("candidate-a", "テスト候補A"), candidate("candidate-a", "テスト候補B")],
        },
        { ...electionPlanned("CURRENT"), electionId: TARGET_ELECTION_ID },
        { ...electionOld("CURRENT"), electionId: TARGET_ELECTION_ID },
      ]);

      const violations = violationsOf(everything);
      expect(violations).toEqual([...REGISTRY_VIOLATION_KINDS]);
      expect(new Set(violations).size).toBe(violations.length);
    });

    it("lists a kind once however many times it occurs", () => {
      const triple = file([
        election2022("PAST"),
        { ...electionPlanned("PAST"), electionId: TARGET_ELECTION_ID },
        { ...electionOld("PAST"), electionId: TARGET_ELECTION_ID },
      ]);

      expect(violationsOf(triple)).toEqual(["DUPLICATE_ELECTION_ID", "INVALID_CURRENT_COUNT"]);
    });

    it("still reports duplicates and count when the contract also fails", () => {
      const input = file([
        { ...election2022(), extra: 1 } as RawElection,
        { ...electionPlanned("CURRENT"), electionId: TARGET_ELECTION_ID },
      ]);

      expect(violationsOf(input)).toEqual([
        "CONTRACT_VIOLATION",
        "DUPLICATE_ELECTION_ID",
        "INVALID_CURRENT_COUNT",
      ]);
    });

    it("rejects input that is not a registry object", () => {
      for (const input of [null, undefined, [], "registry", 7, {}, { schemaVersion: 1, elections: [] }]) {
        expect(violationsOf(input)).toEqual(["CONTRACT_VIOLATION", "INVALID_CURRENT_COUNT"]);
      }
    });

    it("returns a frozen error with a fixed message that leaks no input values", () => {
      const secretId = "secret-election-id";
      const input = file([
        { ...election2022("PAST"), electionId: secretId },
        { ...electionPlanned("PAST"), electionId: secretId },
      ]);
      const result = loadRegistry(input);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(Object.isFrozen(result.error)).toBe(true);
      expect(Object.isFrozen(result.error.violations)).toBe(true);
      expect(JSON.stringify(result.error)).not.toContain(secretId);
      expect(result.error.code).toBe("REGISTRY_CONFIG_INVALID");
    });
  });
});

describe("ValidatedRegistry brand", () => {
  it("cannot be built from a plain object literal", () => {
    const registry = validRegistry([election2022()]);
    const forged = { schemaVersion: 1 as const, elections: registry.elections };

    // @ts-expect-error a plain object is not a ValidatedRegistry
    const attempt = proposeChange(forged, PLANNED_ID);

    // At runtime the forged value still behaves as data, but the compiler
    // refuses it, so entrances typed with ValidatedRegistry cannot take it.
    expect(attempt.ok).toBe(false);
    expect(Object.isFrozen(registry)).toBe(true);
  });
});

describe("proposeChange", () => {
  const registry = () => validRegistry([election2022(), electionPlanned(), electionOld()]);

  it("returns the election names and IDs before and after, without changing anything", () => {
    const reg = registry();
    const before = structuredClone(reg);
    const result = proposeChange(reg, PLANNED_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        from: { electionId: TARGET_ELECTION_ID, name: TARGET_ELECTION_NAME },
        to: { electionId: PLANNED_ID, name: PLANNED_NAME },
      },
    });
    expect(reg).toEqual(before);
    expect(proposeChange(reg, PLANNED_ID)).toEqual(result);
  });

  it("allows a registered PAST election as the target", () => {
    const result = proposeChange(registry(), OLD_ID);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.to.name).toBe(OLD_NAME);
  });

  it("rejects an unregistered target as TARGET_INVALID", () => {
    for (const target of ["no-such-election", "", PLANNED_ID.toUpperCase(), ` ${PLANNED_ID}`]) {
      const result = proposeChange(registry(), target);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.reason).toBe("TARGET_INVALID");
    }
  });

  it("rejects the election that is already CURRENT as TARGET_INVALID", () => {
    const result = proposeChange(registry(), TARGET_ELECTION_ID);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe("TARGET_INVALID");
  });
});

describe("decideChange", () => {
  const registry = () => validRegistry([election2022(), electionPlanned(), electionOld()]);

  it("APPROVE makes the old CURRENT PAST and the target CURRENT, and nothing else changes", () => {
    const reg = registry();
    const before = structuredClone(reg);
    const result = decideChange(reg, proposalOf(reg, PLANNED_ID), "APPROVE");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value;
    expect(statusesOf(next)).toEqual([
      [TARGET_ELECTION_ID, "PAST"],
      [PLANNED_ID, "CURRENT"],
      [OLD_ID, "PAST"],
    ]);
    // Everything except the two status values is identical, including the
    // candidate definitions and the 2022 definition.
    const withoutStatus = (r: ValidatedRegistry) =>
      r.elections.map((e) => ({ ...e, status: "IGNORED" }));
    expect(withoutStatus(next)).toEqual(withoutStatus(reg));
    expect(next.elections.flatMap((e) => e.candidates.map((c) => c.candidateId))).toEqual(
      reg.elections.flatMap((e) => e.candidates.map((c) => c.candidateId)),
    );
    expect(next.elections.filter((e) => e.status === "CURRENT")).toHaveLength(1);
    // The previous registry value is untouched.
    expect(reg).toEqual(before);
    expect(next).not.toBe(reg);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.elections[0])).toBe(true);
  });

  it("returns a registry that can be proposed against again and switched back", () => {
    const reg = registry();
    const approved = decideChange(reg, proposalOf(reg, PLANNED_ID), "APPROVE");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const back = decideChange(
      approved.value,
      proposalOf(approved.value, TARGET_ELECTION_ID),
      "APPROVE",
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    // The former CURRENT (2022) is CURRENT again; the former target is PAST,
    // not PLANNED again. Candidate definitions are unchanged throughout.
    expect(statusesOf(back.value)).toEqual([
      [TARGET_ELECTION_ID, "CURRENT"],
      [PLANNED_ID, "PAST"],
      [OLD_ID, "PAST"],
    ]);
    expect(back.value.elections.map((e) => e.candidates)).toEqual(
      reg.elections.map((e) => e.candidates),
    );
  });

  it("REJECT returns the same registry unchanged with reason REJECTED", () => {
    const reg = registry();
    const result = decideChange(reg, proposalOf(reg, PLANNED_ID), "REJECT");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("REJECTED");
    expect(result.error.registry).toBe(reg);
    expect(statusesOf(reg)[0]).toEqual([TARGET_ELECTION_ID, "CURRENT"]);
  });

  it("treats any decision other than the exact APPROVE as a rejection", () => {
    const reg = registry();
    const proposal = proposalOf(reg, PLANNED_ID);

    for (const decision of ["approve", "YES", "", undefined, null]) {
      const result = decideChange(reg, proposal, decision as never);

      expect(!result.ok && result.error.reason).toBe("REJECTED");
    }
  });

  it("REJECT takes precedence over an invalid target", () => {
    const reg = registry();
    const bogus: ChangeProposal = {
      from: { electionId: TARGET_ELECTION_ID as never, name: TARGET_ELECTION_NAME },
      to: { electionId: "missing" as never, name: "x" },
    };

    const result = decideChange(reg, bogus, "REJECT");

    expect(!result.ok && result.error.reason).toBe("REJECTED");
  });

  it("returns TARGET_INVALID and the unchanged registry for an unregistered target", () => {
    const reg = registry();
    const forged: ChangeProposal = {
      from: { electionId: TARGET_ELECTION_ID as never, name: TARGET_ELECTION_NAME },
      to: { electionId: "missing" as never, name: "x" },
    };

    const result = decideChange(reg, forged, "APPROVE");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("TARGET_INVALID");
    expect(result.error.registry).toBe(reg);
  });

  it("returns TARGET_INVALID when the target is already CURRENT", () => {
    const reg = registry();
    const proposal = proposalOf(reg, PLANNED_ID);
    const approved = decideChange(reg, proposal, "APPROVE");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    // Replaying the same approved proposal on the new registry.
    const replay = decideChange(approved.value, proposal, "APPROVE");

    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error.reason).toBe("TARGET_INVALID");
    expect(replay.error.registry).toBe(approved.value);
  });

  it("returns TARGET_INVALID for a stale proposal whose from-election is no longer CURRENT", () => {
    const reg = registry();
    const stale = proposalOf(reg, PLANNED_ID);
    const switched = decideChange(reg, proposalOf(reg, OLD_ID), "APPROVE");
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;

    const result = decideChange(switched.value, stale, "APPROVE");

    expect(!result.ok && result.error.reason).toBe("TARGET_INVALID");
    expect(!result.ok && result.error.registry).toBe(switched.value);
  });

  it("returns TARGET_INVALID when the proposal names differ from the registry", () => {
    const reg = registry();
    const proposal = proposalOf(reg, PLANNED_ID);
    const renamed: ChangeProposal = { ...proposal, to: { ...proposal.to, name: "別の名前" } };

    const result = decideChange(reg, renamed, "APPROVE");

    expect(!result.ok && result.error.reason).toBe("TARGET_INVALID");
  });
});
