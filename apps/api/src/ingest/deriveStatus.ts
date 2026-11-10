import type {
  AnalysisStage,
  AnalysisStatus,
  HumanStatus,
} from "@ehime-vote-navigator/contracts";

/** The part of a stored stage run that the status derivation needs. */
export type StageRunSummary = Readonly<{
  createdAt: string;
  passageId: string | null;
  stage: AnalysisStage;
  status: "FAILED" | "SUCCEEDED";
}>;

export type DeriveAnalysisInput = Readonly<{
  /** True when the EXTRACT stage reported a not-ready reason. */
  notReady: boolean;
  /** Every passage of the revision, in document order. */
  passageIds: readonly string[];
  /** Stored runs, oldest first; equal times are resolved by list order. */
  runs: readonly StageRunSummary[];
}>;

function runKey(stage: AnalysisStage, passageId: string | null): string {
  return `${stage}\u0000${passageId ?? ""}`;
}

/**
 * Analysis progress of one revision, derived from its stage runs.
 * NOT_READY: extraction cannot continue. NOT_ANALYZED: no run yet. FAILED: the
 * latest run of some stage and passage failed. COMPLETED: every passage has a
 * succeeded JUDGE. Otherwise IN_PROGRESS.
 */
export function deriveAnalysisStatus(input: DeriveAnalysisInput): AnalysisStatus {
  if (input.notReady) {
    return "NOT_READY";
  }
  if (input.runs.length === 0) {
    return "NOT_ANALYZED";
  }

  const latest = new Map<string, StageRunSummary>();
  for (const run of input.runs) {
    const key = runKey(run.stage, run.passageId);
    const current = latest.get(key);
    if (current === undefined || Date.parse(run.createdAt) >= Date.parse(current.createdAt)) {
      latest.set(key, run);
    }
  }

  for (const run of latest.values()) {
    if (run.status === "FAILED") {
      return "FAILED";
    }
  }

  const completed =
    input.passageIds.length > 0 &&
    input.passageIds.every(
      (passageId) => latest.get(runKey("JUDGE", passageId))?.status === "SUCCEEDED",
    );
  return completed ? "COMPLETED" : "IN_PROGRESS";
}

/** Per publishable result: does it meet the publish gate, was it rejected, or is it still open. */
export type GateOutcome = "OPEN" | "REJECTED" | "SATISFIED";

/**
 * Approval progress of one revision. APPROVED only when every publishable
 * result meets the publish gate; REJECTED only when every one was rejected;
 * otherwise (including no results yet) PENDING.
 */
export function deriveApprovalStatus(outcomes: readonly GateOutcome[]): HumanStatus {
  if (outcomes.length === 0) {
    return "PENDING";
  }
  if (outcomes.every((outcome) => outcome === "SATISFIED")) {
    return "APPROVED";
  }
  if (outcomes.every((outcome) => outcome === "REJECTED")) {
    return "REJECTED";
  }
  return "PENDING";
}