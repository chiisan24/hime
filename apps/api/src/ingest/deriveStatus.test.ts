import { describe, expect, it } from "vitest";

import {
  deriveAnalysisStatus,
  deriveApprovalStatus,
  type StageRunSummary,
} from "./deriveStatus.js";

function run(
  stage: StageRunSummary["stage"],
  passageId: string | null,
  status: StageRunSummary["status"],
  createdAt = "2026-11-08T03:00:00.000Z",
): StageRunSummary {
  return { stage, passageId, status, createdAt };
}

const PASSAGES = ["p1", "p2"];

describe("deriveAnalysisStatus", () => {
  it("is NOT_READY whenever extraction is not ready, even with runs", () => {
    expect(deriveAnalysisStatus({ notReady: true, passageIds: [], runs: [] })).toBe("NOT_READY");
    expect(deriveAnalysisStatus({ notReady: true, passageIds: PASSAGES, runs: [run("EXTRACT", null, "SUCCEEDED")] })).toBe("NOT_READY");
  });

  it("is NOT_ANALYZED without any run", () => {
    expect(deriveAnalysisStatus({ notReady: false, passageIds: PASSAGES, runs: [] })).toBe("NOT_ANALYZED");
  });

  it("is IN_PROGRESS after extraction or a partial pilot", () => {
    expect(deriveAnalysisStatus({ notReady: false, passageIds: PASSAGES, runs: [run("EXTRACT", null, "SUCCEEDED")] })).toBe("IN_PROGRESS");
    expect(
      deriveAnalysisStatus({
        notReady: false,
        passageIds: PASSAGES,
        runs: [run("EXTRACT", null, "SUCCEEDED"), run("JUDGE", "p1", "SUCCEEDED")],
      }),
    ).toBe("IN_PROGRESS");
  });

  it("is COMPLETED only when every passage has a succeeded JUDGE", () => {
    expect(
      deriveAnalysisStatus({
        notReady: false,
        passageIds: PASSAGES,
        runs: [run("JUDGE", "p1", "SUCCEEDED"), run("JUDGE", "p2", "SUCCEEDED")],
      }),
    ).toBe("COMPLETED");
  });

  it("never reports COMPLETED for a revision without passages", () => {
    expect(deriveAnalysisStatus({ notReady: false, passageIds: [], runs: [run("EXTRACT", null, "SUCCEEDED")] })).toBe("IN_PROGRESS");
  });

  it("is FAILED when the latest run of a stage and passage failed", () => {
    expect(
      deriveAnalysisStatus({
        notReady: false,
        passageIds: PASSAGES,
        runs: [run("CLASSIFY", "p1", "SUCCEEDED", "2026-11-08T03:00:00.000Z"), run("CLASSIFY", "p1", "FAILED", "2026-11-08T03:05:00.000Z")],
      }),
    ).toBe("FAILED");
  });

  it("recovers when a later run of the same stage and passage succeeds", () => {
    expect(
      deriveAnalysisStatus({
        notReady: false,
        passageIds: ["p1"],
        runs: [
          run("JUDGE", "p1", "FAILED", "2026-11-08T03:00:00.000Z"),
          run("JUDGE", "p1", "SUCCEEDED", "2026-11-08T03:05:00.000Z"),
        ],
      }),
    ).toBe("COMPLETED");
  });

  it("resolves equal times by list order", () => {
    const at = "2026-11-08T03:00:00.000Z";
    expect(
      deriveAnalysisStatus({ notReady: false, passageIds: ["p1"], runs: [run("JUDGE", "p1", "SUCCEEDED", at), run("JUDGE", "p1", "FAILED", at)] }),
    ).toBe("FAILED");
    expect(
      deriveAnalysisStatus({ notReady: false, passageIds: ["p1"], runs: [run("JUDGE", "p1", "FAILED", at), run("JUDGE", "p1", "SUCCEEDED", at)] }),
    ).toBe("COMPLETED");
  });
});

describe("deriveApprovalStatus", () => {
  it("is PENDING without results", () => {
    expect(deriveApprovalStatus([])).toBe("PENDING");
  });

  it("is APPROVED only when every result meets the publish gate", () => {
    expect(deriveApprovalStatus(["SATISFIED", "SATISFIED"])).toBe("APPROVED");
    expect(deriveApprovalStatus(["SATISFIED", "OPEN"])).toBe("PENDING");
  });

  it("is REJECTED only when every result was rejected", () => {
    expect(deriveApprovalStatus(["REJECTED", "REJECTED"])).toBe("REJECTED");
    expect(deriveApprovalStatus(["REJECTED", "SATISFIED"])).toBe("PENDING");
    expect(deriveApprovalStatus(["REJECTED", "OPEN"])).toBe("PENDING");
  });
});