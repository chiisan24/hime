import {
  GATE_REASON_CLASS,
  GATE_REASON_CODES,
  type BuildKind,
  type DataMode,
  type GateFinding,
  type GateReasonCode,
} from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { confirmFixtureFallback, resolveDataMode, type DataModeDecision } from "./resolveDataMode.js";

// Feature: regional-values-map, Property 32 (dataMode) and Property 40 (public build)

/** Fixed seeds: a green run repeats and a failure can be replayed. */
const PARAMETERS_32 = { seed: 350_032, numRuns: 300 };
const PARAMETERS_40 = { seed: 350_040, numRuns: 300 };

const MODES: readonly DataMode[] = ["REAL", "FIXTURE", "REAL_PREFERRED"];

const SHORTAGE_CODES = GATE_REASON_CODES.filter((code) => GATE_REASON_CLASS[code] === "SHORTAGE");
const DEFECT_CODES = GATE_REASON_CODES.filter((code) => GATE_REASON_CLASS[code] === "DEFECT" && code !== "DATA_KIND_MIXED");

function findingOf(code: GateReasonCode, id: number): GateFinding {
  return { code, class: GATE_REASON_CLASS[code], targetKind: "SOURCE", targetId: `target-${id}` };
}

const shortageFinding = fc.tuple(fc.constantFrom(...SHORTAGE_CODES), fc.nat({ max: 5 })).map(([code, id]) => findingOf(code, id));
const defectFinding = fc.tuple(fc.constantFrom(...DEFECT_CODES), fc.nat({ max: 5 })).map(([code, id]) => findingOf(code, id));
const mixedFinding = fc.nat({ max: 5 }).map((id) => findingOf("DATA_KIND_MIXED", id));

/** A situation of the table: none, shortages, a defect (with or without shortages), a mixture. */
type Situation = "A" | "B" | "C" | "E";

const situationArbitrary: fc.Arbitrary<{ situation: Situation; findings: GateFinding[] }> = fc.oneof(
  fc.constant({ situation: "A" as const, findings: [] as GateFinding[] }),
  fc
    .array(shortageFinding, { minLength: 1, maxLength: 6 })
    .map((findings) => ({ situation: "B" as const, findings })),
  fc
    .tuple(fc.array(shortageFinding, { maxLength: 4 }), defectFinding, fc.array(shortageFinding, { maxLength: 4 }))
    .map(([before, defect, after]) => ({ situation: "C" as const, findings: [...before, defect, ...after] })),
  fc
    .tuple(fc.array(fc.oneof(shortageFinding, defectFinding), { maxLength: 4 }), mixedFinding)
    .map(([others, mixed]) => ({ situation: "E" as const, findings: [...others, mixed] })),
);

/** The table of the design for the demo build, written as a lookup: the cell is "REAL", "FIXTURE", "SWITCH" or "REFUSED". */
const TABLE: Readonly<Record<Situation, Readonly<Record<DataMode, "REAL" | "FIXTURE" | "SWITCH" | "REFUSED">>>> = {
  A: { REAL: "REAL", FIXTURE: "FIXTURE", REAL_PREFERRED: "REAL" },
  B: { REAL: "REFUSED", FIXTURE: "FIXTURE", REAL_PREFERRED: "SWITCH" },
  C: { REAL: "REFUSED", FIXTURE: "FIXTURE", REAL_PREFERRED: "REFUSED" },
  E: { REAL: "REFUSED", FIXTURE: "REFUSED", REAL_PREFERRED: "REFUSED" },
};

function firstSeen(findings: readonly GateFinding[]): GateReasonCode[] {
  const seen: GateReasonCode[] = [];
  for (const item of findings) {
    if (!seen.includes(item.code)) {
      seen.push(item.code);
    }
  }
  return seen;
}

function expectedDecision(cell: "REAL" | "FIXTURE" | "SWITCH" | "REFUSED", findings: readonly GateFinding[], situation: Situation): DataModeDecision {
  switch (cell) {
    case "REAL":
      return { ok: true, value: { resolved: "REAL", switched: false, switchReasonCodes: [], exitCode: 0 } };
    case "FIXTURE":
      return { ok: true, value: { resolved: "FIXTURE", switched: false, switchReasonCodes: [], exitCode: 0 } };
    case "SWITCH":
      return { ok: true, value: { resolved: "FIXTURE", switched: true, switchReasonCodes: firstSeen(findings), exitCode: 0 } };
    case "REFUSED":
      return { ok: false, error: { reasonCodes: situation === "E" ? ["DATA_KIND_MIXED"] : firstSeen(findings), exitCode: 1 } };
  }
}

describe("resolveDataMode: properties (Property 32)", () => {
  /** **Validates: Requirements 10.2, 10.13, 10.15, 10.16, 12.13** */
  it("gives the cell of the table for every situation and mode", () => {
    fc.assert(
      fc.property(situationArbitrary, fc.constantFrom(...MODES), ({ situation, findings }, mode) => {
        expect(resolveDataMode(mode, "DEMO", findings)).toEqual(expectedDecision(TABLE[situation][mode], findings, situation));
      }),
      PARAMETERS_32,
    );
  });

  /** **Validates: Requirements 10.13, 10.15, 12.13** */
  it("gives the same decision for the same input in every case, and leaves the findings as they were", () => {
    fc.assert(
      fc.property(situationArbitrary, fc.constantFrom(...MODES), fc.constantFrom<BuildKind>("DEMO", "PUBLIC"), ({ findings }, mode, kind) => {
        const before = structuredClone(findings);
        const first = resolveDataMode(mode, kind, findings);
        expect(resolveDataMode(mode, kind, structuredClone(findings))).toEqual(first);
        expect(findings).toEqual(before);
      }),
      PARAMETERS_32,
    );
  });

  /** **Validates: Requirements 10.15, 10.16** */
  it("fails REAL when one finding is added to data that satisfied every condition, whatever the condition", () => {
    // The five conditions of the gate (data kind, usage, license, verification, approval) and the
    // transmission, as a finding of each code.
    fc.assert(
      fc.property(fc.constantFrom(...GATE_REASON_CODES), fc.nat({ max: 5 }), (code, id) => {
        const decision = resolveDataMode("REAL", "DEMO", [findingOf(code, id)]);
        expect(decision.ok).toBe(false);
      }),
      PARAMETERS_32,
    );
  });

  /** **Validates: Requirements 10.15, 10.16** */
  it("switches REAL_PREFERRED for a shortage only, and never for a defect", () => {
    fc.assert(
      fc.property(fc.constantFrom(...GATE_REASON_CODES), fc.nat({ max: 5 }), (code, id) => {
        const decision = resolveDataMode("REAL_PREFERRED", "DEMO", [findingOf(code, id)]);
        const isShortage = GATE_REASON_CLASS[code] === "SHORTAGE";
        expect(decision.ok).toBe(isShortage && code !== "DATA_KIND_MIXED");
        if (decision.ok) {
          expect(decision.value.resolved).toBe("FIXTURE");
          expect(decision.value.switched).toBe(true);
          expect(decision.value.switchReasonCodes).toEqual([code]);
        }
      }),
      PARAMETERS_32,
    );
  });

  /** **Validates: Requirements 10.16** */
  it("fails a fall back whenever the fictional data has a finding, and leaves every other decision as it is", () => {
    fc.assert(
      fc.property(
        situationArbitrary,
        fc.constantFrom(...MODES),
        fc.array(fc.oneof(shortageFinding, defectFinding), { maxLength: 4 }),
        ({ findings }, mode, fixtureFindings) => {
          const decision = resolveDataMode(mode, "DEMO", findings);
          const confirmed = confirmFixtureFallback(decision, fixtureFindings);
          const usesFixture = decision.ok && decision.value.resolved === "FIXTURE";
          if (usesFixture && fixtureFindings.length > 0) {
            expect(confirmed).toEqual({ ok: false, error: { reasonCodes: firstSeen(fixtureFindings), exitCode: 1 } });
          } else {
            expect(confirmed).toEqual(decision);
          }
        },
      ),
      PARAMETERS_32,
    );
  });

  it("(sanity) the situations A, B, C and E are all common in the generated data", () => {
    const samples = fc.sample(situationArbitrary, { seed: 350_032, numRuns: 400 });
    for (const situation of ["A", "B", "C", "E"] as const) {
      expect(samples.filter((sample) => sample.situation === situation).length, situation).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("resolveDataMode: properties of the public build (Property 40)", () => {
  /** The records that a public bundle needs: usage, transmission, legal review and release approval. */
  const RECORD_SHORTAGES: readonly GateReasonCode[] = [
    "USAGE_NOT_CONFIRMED",
    "TRANSMISSION_NOT_ALLOWED",
    "LEGAL_REVIEW_MISSING",
    "RELEASE_APPROVAL_MISSING",
  ];

  /** **Validates: Requirements 10.5, 10.13** */
  it("outputs only for REAL without any finding", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MODES),
        fc.oneof(fc.constant([] as GateFinding[]), fc.array(fc.oneof(shortageFinding, defectFinding, mixedFinding), { minLength: 1, maxLength: 5 })),
        (mode, findings) => {
          const decision = resolveDataMode(mode, "PUBLIC", findings);
          expect(decision.ok).toBe(mode === "REAL" && findings.length === 0);
          if (decision.ok) {
            expect(decision.value).toEqual({ resolved: "REAL", switched: false, switchReasonCodes: [], exitCode: 0 });
          }
        },
      ),
      PARAMETERS_40,
    );
  });

  /** **Validates: Requirements 10.5** */
  it("fails when any one of the four records is missing", () => {
    fc.assert(
      fc.property(fc.constantFrom(...RECORD_SHORTAGES), fc.array(fc.nat({ max: 5 }), { maxLength: 3 }), (code, others) => {
        const findings = [findingOf(code, 0), ...others.map((id) => findingOf("USAGE_NOT_CONFIRMED", id + 1))];
        const decision = resolveDataMode("REAL", "PUBLIC", findings);
        expect(decision).toEqual({ ok: false, error: { reasonCodes: firstSeen(findings), exitCode: 1 } });
      }),
      PARAMETERS_40,
    );
  });

  /** **Validates: Requirements 10.5** */
  it("names PUBLIC_REQUIRES_REAL alone for any other mode, whatever the findings are", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<DataMode>("FIXTURE", "REAL_PREFERRED"),
        fc.array(fc.oneof(shortageFinding, defectFinding, mixedFinding), { maxLength: 5 }),
        (mode, findings) => {
          expect(resolveDataMode(mode, "PUBLIC", findings)).toEqual({
            ok: false,
            error: { reasonCodes: ["PUBLIC_REQUIRES_REAL"], exitCode: 1 },
          });
        },
      ),
      PARAMETERS_40,
    );
  });
});
