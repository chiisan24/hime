import {
  GATE_REASON_CLASS,
  GATE_REASON_CODES,
  type BuildKind,
  type DataMode,
  type GateFinding,
  type GateReasonCode,
} from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { confirmFixtureFallback, resolveDataMode, type DataModeDecision } from "./resolveDataMode.js";

function finding(code: GateReasonCode, targetId = "target-1"): GateFinding {
  const targetKind = code === "DATA_KIND_MIXED" ? "BUNDLE" : "SOURCE";
  return { code, class: GATE_REASON_CLASS[code], targetKind, targetId };
}

const NONE: GateFinding[] = [];
/** Shortages, in a fixed order: the order in which a build finds them. */
const SHORTAGES = [finding("FACT_NOT_VERIFIED"), finding("NOTE_REVIEW_MISSING"), finding("TRANSMISSION_NOT_ALLOWED")];
const DEFECT = finding("QUOTE_NOT_FOUND");
const MIXED = finding("DATA_KIND_MIXED");

const adopted = (resolved: "REAL" | "FIXTURE", switched = false, switchReasonCodes: GateReasonCode[] = []): DataModeDecision => ({
  ok: true,
  value: { resolved, switched, switchReasonCodes, exitCode: 0 },
});

const refused = (reasonCodes: GateReasonCode[]): DataModeDecision => ({ ok: false, error: { reasonCodes, exitCode: 1 } });

function decide(mode: DataMode, findings: readonly GateFinding[], kind: BuildKind = "DEMO"): DataModeDecision {
  return resolveDataMode(mode, kind, findings);
}

describe("resolveDataMode: the table of the demo build", () => {
  describe("A. the real data satisfies every condition", () => {
    it("REAL uses the real data without a switch", () => {
      expect(decide("REAL", NONE)).toEqual(adopted("REAL"));
    });
    it("FIXTURE uses the fictional data without a switch, and does not read the real data", () => {
      expect(decide("FIXTURE", NONE)).toEqual(adopted("FIXTURE"));
    });
    it("REAL_PREFERRED uses the real data without a switch", () => {
      expect(decide("REAL_PREFERRED", NONE)).toEqual(adopted("REAL"));
    });
  });

  describe("B. the real data has shortages and no defect (a missing real data is a shortage, REAL_DATA_ABSENT)", () => {
    it("REAL is refused with every code", () => {
      expect(decide("REAL", SHORTAGES)).toEqual(refused(["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"]));
      expect(decide("REAL", [finding("REAL_DATA_ABSENT")])).toEqual(refused(["REAL_DATA_ABSENT"]));
    });
    it("FIXTURE is not concerned and uses the fictional data", () => {
      expect(decide("FIXTURE", SHORTAGES)).toEqual(adopted("FIXTURE"));
    });
    it("REAL_PREFERRED falls back to FIXTURE and names every shortage in the order they were found", () => {
      expect(decide("REAL_PREFERRED", SHORTAGES)).toEqual(
        adopted("FIXTURE", true, ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"]),
      );
      expect(decide("REAL_PREFERRED", [finding("REAL_DATA_ABSENT")])).toEqual(adopted("FIXTURE", true, ["REAL_DATA_ABSENT"]));
    });
    it("names a code once, however many targets it was found for", () => {
      const result = decide("REAL_PREFERRED", [finding("USAGE_NOT_CONFIRMED", "a"), finding("USAGE_NOT_CONFIRMED", "b")]);
      expect(result).toEqual(adopted("FIXTURE", true, ["USAGE_NOT_CONFIRMED"]));
    });
  });

  describe("C. the real data has a defect", () => {
    it("REAL is refused", () => {
      expect(decide("REAL", [DEFECT])).toEqual(refused(["QUOTE_NOT_FOUND"]));
    });
    it("FIXTURE is not concerned and uses the fictional data", () => {
      expect(decide("FIXTURE", [DEFECT])).toEqual(adopted("FIXTURE"));
    });
    it("REAL_PREFERRED does not switch: a defect of the real data is not hidden by the fictional data", () => {
      expect(decide("REAL_PREFERRED", [DEFECT])).toEqual(refused(["QUOTE_NOT_FOUND"]));
    });
    it("REAL_PREFERRED does not switch when a defect comes with shortages, and names every code", () => {
      expect(decide("REAL_PREFERRED", [...SHORTAGES, DEFECT])).toEqual(
        refused(["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED", "QUOTE_NOT_FOUND"]),
      );
    });
  });

  describe("D. the fictional data has a finding", () => {
    const fixtureFindings = [finding("GROUNDING_FAILED", "card-1"), finding("CARD_NOT_APPROVED", "card-2")];

    it("does not matter to REAL, which does not read the fictional data", () => {
      expect(confirmFixtureFallback(decide("REAL", NONE), fixtureFindings)).toEqual(adopted("REAL"));
    });
    it("fails FIXTURE, with a shortage as well as a defect", () => {
      expect(confirmFixtureFallback(decide("FIXTURE", NONE), fixtureFindings)).toEqual(
        refused(["GROUNDING_FAILED", "CARD_NOT_APPROVED"]),
      );
      expect(confirmFixtureFallback(decide("FIXTURE", NONE), [finding("CARD_NOT_APPROVED")])).toEqual(refused(["CARD_NOT_APPROVED"]));
    });
    it("does not matter to REAL_PREFERRED that uses the real data", () => {
      expect(confirmFixtureFallback(decide("REAL_PREFERRED", NONE), fixtureFindings)).toEqual(adopted("REAL"));
    });
    it("fails REAL_PREFERRED that switched", () => {
      expect(confirmFixtureFallback(decide("REAL_PREFERRED", SHORTAGES), fixtureFindings)).toEqual(
        refused(["GROUNDING_FAILED", "CARD_NOT_APPROVED"]),
      );
    });
    it("leaves a refusal and an adoption without findings as they are", () => {
      expect(confirmFixtureFallback(decide("REAL", [DEFECT]), fixtureFindings)).toEqual(refused(["QUOTE_NOT_FOUND"]));
      expect(confirmFixtureFallback(decide("FIXTURE", NONE), [])).toEqual(adopted("FIXTURE"));
    });
  });

  describe("E. the data that is used mixes the two kinds", () => {
    it("is refused in every mode", () => {
      for (const mode of ["REAL", "FIXTURE", "REAL_PREFERRED"] as const) {
        expect(decide(mode, [MIXED]), mode).toEqual(refused(["DATA_KIND_MIXED"]));
      }
    });
    it("is refused with this code alone, even when other findings come with it", () => {
      expect(decide("REAL_PREFERRED", [...SHORTAGES, MIXED])).toEqual(refused(["DATA_KIND_MIXED"]));
    });
  });
});

describe("resolveDataMode: the public build (Req 10.5)", () => {
  it("is refused with PUBLIC_REQUIRES_REAL unless the mode is REAL", () => {
    for (const mode of ["FIXTURE", "REAL_PREFERRED"] as const) {
      expect(decide(mode, NONE, "PUBLIC"), mode).toEqual(refused(["PUBLIC_REQUIRES_REAL"]));
      expect(decide(mode, SHORTAGES, "PUBLIC"), mode).toEqual(refused(["PUBLIC_REQUIRES_REAL"]));
    }
  });

  it("uses the real data in REAL mode without a finding", () => {
    expect(decide("REAL", NONE, "PUBLIC")).toEqual(adopted("REAL"));
  });

  it("fails in REAL mode with a finding, a shortage as well as a defect", () => {
    expect(decide("REAL", [finding("LEGAL_REVIEW_MISSING")], "PUBLIC")).toEqual(refused(["LEGAL_REVIEW_MISSING"]));
    expect(decide("REAL", [finding("RELEASE_APPROVAL_MISSING")], "PUBLIC")).toEqual(refused(["RELEASE_APPROVAL_MISSING"]));
    expect(decide("REAL", [DEFECT], "PUBLIC")).toEqual(refused(["QUOTE_NOT_FOUND"]));
    expect(decide("REAL", [MIXED], "PUBLIC")).toEqual(refused(["DATA_KIND_MIXED"]));
  });

  it("does not switch to FIXTURE", () => {
    const result = decide("REAL", SHORTAGES, "PUBLIC");
    expect(result.ok).toBe(false);
  });
});

describe("resolveDataMode: other points", () => {
  it("names a reason code only from the closed list", () => {
    for (const mode of ["REAL", "FIXTURE", "REAL_PREFERRED"] as const) {
      const result = decide(mode, [finding("REAL_DATA_ABSENT"), DEFECT]);
      const codes = result.ok ? result.value.switchReasonCodes : result.error.reasonCodes;
      for (const code of codes) {
        expect(GATE_REASON_CODES).toContain(code);
      }
    }
  });

  it("gives the same decision for the same input, and does not change the findings", () => {
    const findings = [...SHORTAGES];
    const before = structuredClone(findings);
    expect(decide("REAL_PREFERRED", findings)).toEqual(decide("REAL_PREFERRED", structuredClone(findings)));
    expect(findings).toEqual(before);
  });

  it("makes a decision that the bundle metadata accepts: switched only for a fall back, with shortages only", () => {
    const result = decide("REAL_PREFERRED", SHORTAGES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.switched).toBe(result.value.resolved === "FIXTURE");
      expect(result.value.switchReasonCodes.every((code) => GATE_REASON_CLASS[code] === "SHORTAGE")).toBe(true);
    }
  });
});
