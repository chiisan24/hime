import { GATE_REASON_CLASS } from "@ehime-vote-navigator/contracts";
import type {
  BuildKind,
  DataMode,
  GateFinding,
  GateReasonCode,
  ResolvedDataMode,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";

/**
 * The gate that decides which data a bundle is made of (design: "dataMode の門", Req 10.13, 10.15,
 * 10.16). It is a pure function of the requested mode, the kind of the build and the findings, and
 * it reads no file.
 *
 * `findings` are the findings of the real data that the build read. A build of `FIXTURE` does not
 * read real data, so the findings are of no concern to it. The findings of the fictional data are
 * checked after the choice, by `confirmFixtureFallback` (the situation D of the table).
 */

/**
 * The choice: the data to use (`REAL` is the official data, `REAL_AI`), whether it is a switch from
 * the real data, and why. The exit code is 0.
 */
export type DataModeAdoption = Readonly<{
  resolved: ResolvedDataMode;
  /** True only when `REAL_PREFERRED` fell back to `FIXTURE`. */
  switched: boolean;
  /** The shortages that caused the switch, in the order they were found. Empty without a switch. */
  switchReasonCodes: readonly GateReasonCode[];
  exitCode: 0;
}>;

/** No bundle is written. The exit code is 1. `reasonCodes` are the codes of the findings, once each. */
export type DataModeRefusal = Readonly<{
  reasonCodes: readonly GateReasonCode[];
  exitCode: 1;
}>;

export type DataModeDecision = Result<DataModeAdoption, DataModeRefusal>;

/** The codes of the findings, each once, in the order in which they first appear. */
function codesOf(findings: readonly GateFinding[]): GateReasonCode[] {
  return [...new Set(findings.map((finding) => finding.code))];
}

function adopt(resolved: ResolvedDataMode, switchReasonCodes: readonly GateReasonCode[] = []): DataModeDecision {
  return { ok: true, value: { resolved, switched: switchReasonCodes.length > 0, switchReasonCodes, exitCode: 0 } };
}

function refuse(reasonCodes: readonly GateReasonCode[]): DataModeDecision {
  return { ok: false, error: { reasonCodes, exitCode: 1 } };
}

/**
 * Decides the data of the build (the table of the design).
 *
 * - A public build takes only `REAL`, and only without a finding: a shortage fails too, because there
 *   is nothing to fall back to. A request of another mode is refused with `PUBLIC_REQUIRES_REAL`.
 * - A bundle that mixes the two kinds (`DATA_KIND_MIXED`) is refused in every mode.
 * - `FIXTURE` uses the fictional data and does not read the real data.
 * - `REAL` uses the real data when it has no finding, and is refused otherwise.
 * - `REAL_PREFERRED` uses the real data when it has no finding; falls back to `FIXTURE` when it has
 *   only shortages (a record that can be supplied); and is refused when it has a defect, because a
 *   defect in the real data must not be hidden by the fictional data.
 */
export function resolveDataMode(
  requested: DataMode,
  buildKind: BuildKind,
  findings: readonly GateFinding[],
): DataModeDecision {
  if (buildKind === "PUBLIC") {
    if (requested !== "REAL") {
      return refuse(["PUBLIC_REQUIRES_REAL"]);
    }
    return findings.length === 0 ? adopt("REAL") : refuse(codesOf(findings));
  }
  if (findings.some((finding) => finding.code === "DATA_KIND_MIXED")) {
    return refuse(["DATA_KIND_MIXED"]);
  }
  if (requested === "FIXTURE") {
    return adopt("FIXTURE");
  }
  if (findings.length === 0) {
    return adopt("REAL");
  }
  if (requested === "REAL") {
    return refuse(codesOf(findings));
  }
  if (findings.some((finding) => GATE_REASON_CLASS[finding.code] === "DEFECT")) {
    return refuse(codesOf(findings));
  }
  return adopt("FIXTURE", codesOf(findings));
}

/**
 * The check of the fictional data after the choice (situation D, Req 10.16). The fictional data is the
 * last resort, so a shortage in it fails as well as a defect. A choice of the real data, and a
 * refusal, are returned as they are.
 */
export function confirmFixtureFallback(
  decision: DataModeDecision,
  fixtureFindings: readonly GateFinding[],
): DataModeDecision {
  if (!decision.ok || decision.value.resolved !== "FIXTURE" || fixtureFindings.length === 0) {
    return decision;
  }
  return refuse(codesOf(fixtureFindings));
}
