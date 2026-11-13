import { BuildReportSchema, Sha256Schema, type GateFinding } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { BuildReportError, failedReport, successfulReport, type BuildChecks } from "./report.js";

const HASH = Sha256Schema.parse("a".repeat(64));

const PASSED: BuildChecks = { dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "PASSED", contentHash: "PASSED" };

const SHORTAGES: GateFinding[] = [
  { code: "FACT_NOT_VERIFIED", class: "SHORTAGE", targetKind: "FACT_ITEM", targetId: "fact-shelters-total" },
  { code: "NOTE_REVIEW_MISSING", class: "SHORTAGE", targetKind: "SOURCE", targetId: "src-shelters" },
  { code: "TRANSMISSION_NOT_ALLOWED", class: "SHORTAGE", targetKind: "SOURCE", targetId: "src-shelters" },
];

const TIMES = { startedAt: "2026-08-10T10:00:00+09:00", finishedAt: "2026-08-10T10:00:03+09:00" } as const;

describe("successfulReport", () => {
  it("makes the report of the design for a switch from REAL_PREFERRED to FIXTURE", () => {
    const report = successfulReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switchReasonCodes: ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"],
      findings: SHORTAGES,
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 48213 },
    });
    expect(report).toEqual({
      schemaVersion: 1,
      buildKind: "DEMO",
      startedAt: "2026-08-10T10:00:00+09:00",
      finishedAt: "2026-08-10T10:00:03+09:00",
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switched: true,
      switchReasonCodes: ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"],
      findings: SHORTAGES,
      checks: { dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "PASSED", contentHash: "PASSED" },
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 48213 },
      warnings: ["DATA_MODE_SWITCHED"],
      exitCode: 0,
    });
  });

  it("makes a report without a switch for FIXTURE, with empty codes and no warning", () => {
    const report = successfulReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "FIXTURE",
      dataModeResolved: "FIXTURE",
      switchReasonCodes: [],
      findings: [],
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 10 },
    });
    expect(report.switched).toBe(false);
    expect(report.switchReasonCodes).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("makes a report without a switch for REAL_PREFERRED that used the real data", () => {
    const report = successfulReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "REAL",
      switchReasonCodes: [],
      findings: [],
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "REAL_AI", contentHash: HASH, bytes: 10 },
    });
    expect(report.switched).toBe(false);
    expect(report.warnings).toEqual([]);
  });

  it("is a report that satisfies the contract of the report", () => {
    const report = successfulReport({
      buildKind: "PUBLIC",
      ...TIMES,
      dataModeRequested: "REAL",
      dataModeResolved: "REAL",
      switchReasonCodes: [],
      findings: [],
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/public/bundle.json", dataKind: "REAL_AI", contentHash: HASH, bytes: 1 },
    });
    expect(BuildReportSchema.safeParse(report).success).toBe(true);
  });

  it("refuses facts that the contract does not accept: a data kind that is not the resolved mode's", () => {
    expect(() =>
      successfulReport({
        buildKind: "DEMO",
        ...TIMES,
        dataModeRequested: "FIXTURE",
        dataModeResolved: "FIXTURE",
        switchReasonCodes: [],
        findings: [],
        checks: PASSED,
        output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "REAL_AI", contentHash: HASH, bytes: 1 },
      }),
    ).toThrow(BuildReportError);
  });

  it("refuses a switch whose reason is a defect, and a switch whose shortages are not named", () => {
    const base = {
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      findings: [],
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 1 },
    } as const;
    expect(() => successfulReport({ ...base, switchReasonCodes: ["QUOTE_NOT_FOUND"] })).toThrow(BuildReportError);
    expect(() => successfulReport({ ...base, switchReasonCodes: [] })).toThrow(BuildReportError);
  });
});

describe("failedReport", () => {
  it("has no output, the exit code 1, and the findings that say why", () => {
    const refused: GateFinding[] = [{ code: "QUOTE_NOT_FOUND", class: "DEFECT", targetKind: "ISSUE_CARD", targetId: "card-1" }];
    const report = failedReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL",
      dataModeResolved: null,
      switchReasonCodes: [],
      findings: refused,
      checks: { dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "FAILED", contentHash: "SKIPPED" },
    });
    expect(report.output).toBeNull();
    expect(report.exitCode).toBe(1);
    expect(report.findings).toEqual(refused);
    expect(report.dataModeResolved).toBeNull();
    expect(report.switched).toBe(false);
    expect(BuildReportSchema.safeParse(report).success).toBe(true);
  });

  it("tells a fall back that then failed on the fictional data (REAL_PREFERRED, situation D)", () => {
    const report = failedReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switchReasonCodes: ["USAGE_NOT_CONFIRMED"],
      findings: [{ code: "GROUNDING_FAILED", class: "DEFECT", targetKind: "ISSUE_CARD", targetId: "card-1" }],
      checks: { dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "FAILED", contentHash: "SKIPPED" },
    });
    expect(report.switched).toBe(true);
    expect(report.switchReasonCodes).toEqual(["USAGE_NOT_CONFIRMED"]);
    expect(report.warnings).toEqual(["DATA_MODE_SWITCHED"]);
    expect(report.output).toBeNull();
    expect(report.exitCode).toBe(1);
  });

  it("makes a report of a build that failed before it chose any data", () => {
    const report = failedReport({
      buildKind: "PUBLIC",
      ...TIMES,
      dataModeRequested: "FIXTURE",
      dataModeResolved: null,
      switchReasonCodes: [],
      findings: [{ code: "PUBLIC_REQUIRES_REAL", class: "DEFECT", targetKind: "RELEASE", targetId: null }],
      checks: { dataBoundary: "SKIPPED", questionBank: "SKIPPED", issueCards: "SKIPPED", contentHash: "SKIPPED" },
    });
    expect(report.dataModeResolved).toBeNull();
    expect(report.exitCode).toBe(1);
  });
});

describe("the report has no free text", () => {
  it("holds codes, IDs, numbers and times only", () => {
    const report = successfulReport({
      buildKind: "DEMO",
      ...TIMES,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switchReasonCodes: ["FACT_NOT_VERIFIED"],
      findings: [SHORTAGES[0] ?? { code: "FACT_NOT_VERIFIED", class: "SHORTAGE", targetKind: "FACT_ITEM", targetId: null }],
      checks: PASSED,
      output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 1 },
    });
    const strings = JSON.stringify(report).match(/"[^"]*"/gu) ?? [];
    for (const value of strings) {
      expect(value, value).not.toMatch(/\s/u);
    }
  });
});
