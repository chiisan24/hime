import type { BuildKind, DataKind, DataMode, GateReasonCode } from "@ehime-vote-navigator/contracts";

import type { SafeLogger } from "../../logging/safeLogger.js";

/**
 * The build log (design: "ビルドログ"). It goes through `createSafeLogger`, so a value that looks
 * like a credential is redacted before it is written. The events carry codes and numbers only: not
 * an answer, not a key, not the body of a source.
 */

/** Written when the build starts. */
export function logBuildStart(logger: SafeLogger, buildKind: BuildKind, dataModeRequested: DataMode): void {
  logger.info({ code: "BUILD_START", buildKind, dataModeRequested });
}

/** Written when the real data lacks something: the numbers of shortages and defects found in it. */
export function logRealDataInsufficient(logger: SafeLogger, shortageCount: number, defectCount: number): void {
  logger.info({ code: "REAL_DATA_INSUFFICIENT", shortageCount, defectCount });
}

/** Written, as a warning, when `REAL_PREFERRED` falls back to `FIXTURE`: it names the shortages that caused it. */
export function logDataModeSwitched(logger: SafeLogger, from: DataMode, to: "FIXTURE", reasonCodes: readonly GateReasonCode[]): void {
  logger.warn({ code: "DATA_MODE_SWITCHED", from, to, reasonCodes: [...reasonCodes] });
}

/** Written when the build ends: the data kind of the bundle, or null if there is none, and the exit code. */
export function logBuildDone(logger: SafeLogger, dataKind: DataKind | null, exitCode: 0 | 1): void {
  logger.info({ code: "BUILD_DONE", dataKind, exitCode });
}
