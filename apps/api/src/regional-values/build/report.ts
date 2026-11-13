import { BuildReportSchema } from "@ehime-vote-navigator/contracts";
import type {
  BuildKind,
  BuildReport,
  DataKind,
  DataMode,
  GateFinding,
  GateReasonCode,
  ResolvedDataMode,
  Sha256,
} from "@ehime-vote-navigator/contracts";

/**
 * The build report (`dist/regional-values/<kind>/build-report.json`, design: "ビルドレポート").
 *
 * The report has no free text. Its values are fixed codes, IDs and numbers, so it can neither carry
 * the body of a source, a response, nor an answer (Req 7.19, 10.16). The functions below make the
 * report from the facts of a build and check it with `BuildReportSchema` before they return it.
 */

/** The state of each check of the build. A check that was not run is SKIPPED. */
export type BuildChecks = BuildReport["checks"];

/** What is common to a successful and a failed build. */
export type BuildFacts = Readonly<{
  buildKind: BuildKind;
  startedAt: string;
  finishedAt: string;
  dataModeRequested: DataMode;
  /** The findings of the build: what was left out, and why a build was refused. */
  findings: readonly GateFinding[];
  checks: BuildChecks;
}>;

export type SuccessfulBuild = BuildFacts &
  Readonly<{
    dataModeResolved: ResolvedDataMode;
    /** The shortages that switched `REAL_PREFERRED` to `FIXTURE`. Empty without a switch. */
    switchReasonCodes: readonly GateReasonCode[];
    output: Readonly<{ bundlePath: string; dataKind: DataKind; contentHash: Sha256; bytes: number }>;
  }>;

export type FailedBuild = BuildFacts &
  Readonly<{
    /** The mode the build had chosen before it failed, or null if it failed before the choice. */
    dataModeResolved: ResolvedDataMode | null;
    /** The shortages that switched `REAL_PREFERRED` to `FIXTURE` before the build failed. */
    switchReasonCodes: readonly GateReasonCode[];
  }>;

/** The report cannot be made: the facts do not satisfy the contract of the report. This is a defect of the caller. */
export class BuildReportError extends Error {
  constructor() {
    super("The build report does not satisfy its contract.");
    this.name = "BuildReportError";
  }
}

function checked(report: unknown): BuildReport {
  const parsed = BuildReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new BuildReportError();
  }
  return parsed.data;
}

/**
 * The report of a successful build (exit code 0). When `REAL_PREFERRED` fell back to `FIXTURE`, the
 * report says so with `switched`, the shortages and the warning `DATA_MODE_SWITCHED`.
 */
export function successfulReport(build: SuccessfulBuild): BuildReport {
  const switched = build.dataModeRequested === "REAL_PREFERRED" && build.dataModeResolved === "FIXTURE";
  return checked({
    schemaVersion: 1,
    buildKind: build.buildKind,
    startedAt: build.startedAt,
    finishedAt: build.finishedAt,
    dataModeRequested: build.dataModeRequested,
    dataModeResolved: build.dataModeResolved,
    switched,
    switchReasonCodes: switched ? [...build.switchReasonCodes] : [],
    findings: [...build.findings],
    checks: build.checks,
    output: build.output,
    warnings: switched ? ["DATA_MODE_SWITCHED"] : [],
    exitCode: 0,
  });
}

/**
 * The report of a failed build (exit code 1). It has no output. Its findings say why it failed.
 *
 * The contract defines `switched` by the requested and the resolved mode alone. So a build that
 * chose to fall back from `REAL_PREFERRED` to `FIXTURE` and then failed on the fictional data
 * (situation D of the table) still reports `switched` with its shortages and the warning, which
 * tells that the real data was passed over; a build that failed before the choice reports none.
 */
export function failedReport(build: FailedBuild): BuildReport {
  const switched = build.dataModeRequested === "REAL_PREFERRED" && build.dataModeResolved === "FIXTURE";
  return checked({
    schemaVersion: 1,
    buildKind: build.buildKind,
    startedAt: build.startedAt,
    finishedAt: build.finishedAt,
    dataModeRequested: build.dataModeRequested,
    dataModeResolved: build.dataModeResolved,
    switched,
    switchReasonCodes: switched ? [...build.switchReasonCodes] : [],
    findings: [...build.findings],
    checks: build.checks,
    output: null,
    warnings: switched ? ["DATA_MODE_SWITCHED"] : [],
    exitCode: 1,
  });
}
