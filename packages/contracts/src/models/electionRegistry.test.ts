import { describe, expect, it } from "vitest";

import * as contracts from "../index.js";
import {
  CandidateDefinitionSchema,
  ELECTION_STATUSES,
  ElectionDefinitionSchema,
  ElectionRegistryFileSchema,
} from "./electionRegistry.js";
import {
  CandidateSchema,
  ElectionSchema,
  TARGET_ELECTION_ID,
  TARGET_ELECTION_NAME,
} from "./election.js";

// Names of the existing 2022 candidates, taken from the existing contract so
// no name is retyped here. Everything else below is an obviously fictional
// placeholder.
function nameOf2022(index: number): string {
  const name = CandidateSchema.shape.canonicalName.options[index];
  if (name === undefined) {
    throw new Error("The existing 2022 contract no longer lists this candidate name.");
  }
  return name;
}

const NAME_2022_A = nameOf2022(0);
const NAME_2022_B = nameOf2022(1);

function candidate(candidateId: string, name: string, nameForms = [name]) {
  return { candidateId, name, nameForms };
}

function election2022() {
  return {
    electionId: TARGET_ELECTION_ID,
    name: TARGET_ELECTION_NAME,
    electionDate: "2022-11-20",
    status: "PAST",
    candidates: [
      candidate("candidate-a", NAME_2022_A),
      candidate("candidate-b", NAME_2022_B),
    ],
  };
}

function electionPlanned() {
  return {
    electionId: "test-election-planned",
    name: "テスト選挙（予定）",
    electionDate: "2026-11-15",
    status: "PLANNED",
    candidates: [candidate("candidate-c", "テスト候補C")],
  };
}

function registryFile() {
  return {
    schemaVersion: 1,
    elections: [election2022(), { ...electionPlanned(), status: "CURRENT" }],
  };
}

function withCandidate(patch: Record<string, unknown>) {
  return {
    ...electionPlanned(),
    candidates: [{ ...candidate("candidate-c", "テスト候補C"), ...patch }],
  };
}

describe("ElectionRegistryFileSchema", () => {
  it("accepts a registry holding the 2022 election and a placeholder 2026 election", () => {
    const parsed = ElectionRegistryFileSchema.safeParse(registryFile());

    expect(parsed.success).toBe(true);
    expect(parsed.data?.elections.map((e) => e.electionDate)).toEqual([
      "2022-11-20",
      "2026-11-15",
    ]);
  });

  it("is exported from the package entry", () => {
    expect(contracts.ElectionRegistryFileSchema).toBe(ElectionRegistryFileSchema);
    expect(contracts.ElectionDefinitionSchema).toBe(ElectionDefinitionSchema);
    expect(contracts.CandidateDefinitionSchema).toBe(CandidateDefinitionSchema);
    expect(contracts.ELECTION_STATUSES).toBe(ELECTION_STATUSES);
  });

  it("requires schemaVersion 1 and at least one election", () => {
    const base = registryFile();

    expect(ElectionRegistryFileSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
    expect(ElectionRegistryFileSchema.safeParse({ ...base, schemaVersion: "1" }).success).toBe(false);
    expect(ElectionRegistryFileSchema.safeParse({ elections: base.elections }).success).toBe(false);
    expect(ElectionRegistryFileSchema.safeParse({ ...base, elections: [] }).success).toBe(false);
    expect(ElectionRegistryFileSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });

  it("rejects unknown keys at the file, election and candidate level", () => {
    const base = registryFile();
    const extraCandidate = {
      ...base,
      elections: [withCandidate({ party: "x" })],
    };

    expect(ElectionRegistryFileSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      ElectionRegistryFileSchema.safeParse({
        ...base,
        elections: [{ ...electionPlanned(), timeZone: "Asia/Tokyo" }],
      }).success,
    ).toBe(false);
    expect(ElectionRegistryFileSchema.safeParse(extraCandidate).success).toBe(false);
  });

  it("rejects non-object input", () => {
    for (const input of [null, undefined, [], "registry", 1]) {
      expect(ElectionRegistryFileSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("ELECTION_STATUSES", () => {
  it("lists exactly PAST, CURRENT and PLANNED", () => {
    expect(ELECTION_STATUSES).toEqual(["PAST", "CURRENT", "PLANNED"]);
  });

  it("accepts each status and rejects anything else", () => {
    for (const status of ELECTION_STATUSES) {
      expect(
        ElectionDefinitionSchema.safeParse({ ...electionPlanned(), status }).success,
      ).toBe(true);
    }
    for (const status of ["current", "FUTURE", "", null, 1]) {
      expect(
        ElectionDefinitionSchema.safeParse({ ...electionPlanned(), status }).success,
      ).toBe(false);
    }
  });
});

describe("ElectionDefinitionSchema electionId", () => {
  const accepts = (electionId: string) =>
    ElectionDefinitionSchema.safeParse({ ...electionPlanned(), electionId }).success;

  it("accepts 1 and 64 ASCII letters, digits and hyphens", () => {
    expect(accepts("a")).toBe(true);
    expect(accepts("A-9")).toBe(true);
    expect(accepts("a".repeat(64))).toBe(true);
  });

  it("rejects empty, 65 characters, and characters outside the allowed set", () => {
    expect(accepts("")).toBe(false);
    expect(accepts("a".repeat(65))).toBe(false);
    for (const value of ["a_b", "a b", "a.b", "a/b", "ａ", "選挙", "a\n", " a"]) {
      expect(accepts(value)).toBe(false);
    }
  });
});

describe("ElectionDefinitionSchema name", () => {
  const accepts = (name: string) =>
    ElectionDefinitionSchema.safeParse({ ...electionPlanned(), name }).success;

  it("accepts 1 and 100 code points and rejects empty and 101", () => {
    expect(accepts("あ")).toBe(true);
    expect(accepts("あ".repeat(100))).toBe(true);
    expect(accepts("")).toBe(false);
    expect(accepts("あ".repeat(101))).toBe(false);
  });

  it("counts code points, not UTF-16 units", () => {
    expect(accepts("𠮷".repeat(100))).toBe(true);
    expect(accepts("𠮷".repeat(101))).toBe(false);
  });
});

describe("ElectionDefinitionSchema electionDate", () => {
  const accepts = (electionDate: unknown) =>
    ElectionDefinitionSchema.safeParse({ ...electionPlanned(), electionDate }).success;

  it("accepts real calendar dates including 2026-11-15 and a leap day", () => {
    expect(accepts("2026-11-15")).toBe(true);
    expect(accepts("2024-02-29")).toBe(true);
    expect(accepts("2022-11-20")).toBe(true);
  });

  it("rejects non-existent dates and other formats", () => {
    for (const value of [
      "2026-02-30",
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-11-00",
      "2026-1-5",
      "2026/11/15",
      "20261115",
      "2026-11-15T00:00:00Z",
      "",
      20261115,
      null,
    ]) {
      expect(accepts(value)).toBe(false);
    }
  });
});

describe("CandidateDefinitionSchema", () => {
  const accepts = (patch: Record<string, unknown>) =>
    CandidateDefinitionSchema.safeParse({
      ...candidate("candidate-c", "テスト候補C"),
      ...patch,
    }).success;

  it("accepts candidate IDs of 1 and 64 characters and rejects empty, blank and 65", () => {
    expect(accepts({ candidateId: "c" })).toBe(true);
    expect(accepts({ candidateId: "c".repeat(64) })).toBe(true);
    expect(accepts({ candidateId: "" })).toBe(false);
    expect(accepts({ candidateId: "   " })).toBe(false);
    expect(accepts({ candidateId: "c".repeat(65) })).toBe(false);
  });

  it("accepts a name of 1 and 50 code points and rejects empty and 51", () => {
    expect(accepts({ name: "あ" })).toBe(true);
    expect(accepts({ name: "あ".repeat(50) })).toBe(true);
    expect(accepts({ name: "𠮷".repeat(50) })).toBe(true);
    expect(accepts({ name: "" })).toBe(false);
    expect(accepts({ name: "あ".repeat(51) })).toBe(false);
    expect(accepts({ name: "𠮷".repeat(51) })).toBe(false);
  });

  it("requires at least one nameForm of 1 to 50 code points each", () => {
    expect(accepts({ nameForms: ["あ"] })).toBe(true);
    expect(accepts({ nameForms: ["あ".repeat(50), "い"] })).toBe(true);
    expect(accepts({ nameForms: [] })).toBe(false);
    expect(accepts({ nameForms: [""] })).toBe(false);
    expect(accepts({ nameForms: ["あ", "い".repeat(51)] })).toBe(false);
    expect(accepts({ nameForms: undefined })).toBe(false);
  });
});

describe("ElectionDefinitionSchema candidates", () => {
  const withCount = (count: number) => ({
    ...electionPlanned(),
    candidates: Array.from({ length: count }, (_, index) =>
      candidate(`candidate-${index}`, `テスト候補${index}`),
    ),
  });

  it("accepts 1 to 20 candidates and rejects 0 and 21", () => {
    expect(ElectionDefinitionSchema.safeParse(withCount(1)).success).toBe(true);
    expect(ElectionDefinitionSchema.safeParse(withCount(20)).success).toBe(true);
    expect(ElectionDefinitionSchema.safeParse(withCount(0)).success).toBe(false);
    expect(ElectionDefinitionSchema.safeParse(withCount(21)).success).toBe(false);
  });
});

describe("existing 2022 contracts are untouched", () => {
  it("ElectionSchema still pins the 2022 election and rejects the 2026 date", () => {
    const existing = {
      electionId: TARGET_ELECTION_ID,
      name: TARGET_ELECTION_NAME,
      electionDate: "2022-11-20",
      timeZone: "Asia/Tokyo",
      sourceIds: [],
      lastUpdated: "2022-11-20",
    };

    expect(ElectionSchema.safeParse(existing).success).toBe(true);
    expect(
      ElectionSchema.safeParse({
        ...existing,
        electionId: "test-election-planned",
        electionDate: "2026-11-15",
      }).success,
    ).toBe(false);
  });
});
