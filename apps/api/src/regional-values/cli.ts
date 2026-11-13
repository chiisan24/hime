import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ISOInstantSchema } from "@ehime-vote-navigator/contracts";
import type { BuildKind, DataMode } from "@ehime-vote-navigator/contracts";
import { verifyBundleText } from "@ehime-vote-navigator/domain";

import { createSafeLogger, type SafeLogger } from "../logging/safeLogger.js";
import { loadBuildConfig } from "./build/loadConfig.js";
import { failedReport } from "./build/report.js";
import { runBuild, type BuildRequest, type RealDataLoader } from "./build/runBuild.js";
import {
  BUNDLE_FILE_NAME,
  relativeOutputPath,
  removeOldBundle,
  writeReport,
  type OutputOperations,
} from "./build/writeOutputs.js";

/**
 * The command line of the regional values map (`npm run regional-values -- build ...`).
 *
 * It follows `apps/api/src/analysis/cli.ts`: it opens no port, calls no AI, and never prints the
 * detail of an error (a path, a value or a part of a file). The exit code is the one of the build.
 */

/** Terminal boundary of the CLI; tests replace it with a fake. */
export type RegionalValuesCliIo = Readonly<{
  write: (line: string) => void;
}>;

export type RegionalValuesCliOptions = Readonly<{
  io: RegionalValuesCliIo;
  /** The root of the repository. */
  workspaceRoot: string;
  /** The clock for the report and for `--generated-at` when it is not given. A test fixes it. */
  now?: () => Date;
  /** The sink of the build log; the lines go to the standard error by default. */
  logWriter?: (line: string) => void;
  /** Test seams. */
  realDataLoader?: RealDataLoader;
  outputOperations?: OutputOperations;
}>;

/** The stable codes that the CLI prints. It never prints more than a code. */
export const CLI_ERROR_CODES = ["USAGE", "ARGUMENT_INVALID", "BUILD_FAILED", "SELF_CHECK_FAILED"] as const;

const USAGE_LINES: readonly string[] = [
  "Usage: npm run regional-values -- build --kind demo|public",
  "         [--data-mode REAL|FIXTURE|REAL_PREFERRED]",
  "         [--generated-at <ISO 8601 time>] [--config-dir <path>]",
  "  demo   uses REAL_PREFERRED unless --data-mode is given",
  "  public uses REAL and accepts no other mode",
];

type Parsed = Readonly<{ kind: BuildKind; dataMode: DataMode; generatedAt: string | null; configDir: string | null }>;

const DATA_MODES: readonly DataMode[] = ["REAL", "FIXTURE", "REAL_PREFERRED"];

/** Splits `--name value` arguments. A name without a value, a repeated name or an unknown name is invalid. */
function readOptions(args: readonly string[]): Map<string, string> | null {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || value.startsWith("--") || options.has(name)) {
      return null;
    }
    options.set(name, value);
  }
  return options;
}

function parseArguments(args: readonly string[]): Parsed | null {
  const options = readOptions(args);
  if (options === null || [...options.keys()].some((name) => !["--kind", "--data-mode", "--generated-at", "--config-dir"].includes(name))) {
    return null;
  }
  const kindText = options.get("--kind");
  const kind: BuildKind | null = kindText === "demo" ? "DEMO" : kindText === "public" ? "PUBLIC" : null;
  if (kind === null) {
    return null;
  }
  const modeText = options.get("--data-mode");
  const dataMode = DATA_MODES.find((mode) => mode === modeText) ?? null;
  if (modeText !== undefined && dataMode === null) {
    return null;
  }
  // A public build accepts REAL only; the demo build prefers the real data and falls back.
  const resolvedMode: DataMode = dataMode ?? (kind === "PUBLIC" ? "REAL" : "REAL_PREFERRED");
  if (kind === "PUBLIC" && resolvedMode !== "REAL") {
    return null;
  }
  const generatedAt = options.get("--generated-at") ?? null;
  if (generatedAt !== null && !ISOInstantSchema.safeParse(generatedAt).success) {
    return null;
  }
  return { kind, dataMode: resolvedMode, generatedAt, configDir: options.get("--config-dir") ?? null };
}

async function selfCheck(workspaceRoot: string, request: BuildRequest, dataVersion: string): Promise<boolean> {
  try {
    const text = await readFile(join(workspaceRoot, relativeOutputPath(request.buildKind, BUNDLE_FILE_NAME)), "utf8");
    const verified = await verifyBundleText(text, { schemaVersion: 1, dataVersion, buildKind: request.buildKind });
    return verified.ok;
  } catch {
    return false;
  }
}

/**
 * Runs the command. Returns the exit code: 0 for a successful build, 1 for anything else (a wrong
 * argument, a failed build, a bundle that does not pass the browser verification).
 */
export async function runRegionalValuesCli(argv: readonly string[], options: RegionalValuesCliOptions): Promise<number> {
  const { io } = options;
  const [command, ...rest] = argv;
  if (command !== "build") {
    for (const line of USAGE_LINES) {
      io.write(line);
    }
    io.write("code=USAGE");
    return 1;
  }
  const parsed = parseArguments(rest);
  if (parsed === null) {
    io.write("code=ARGUMENT_INVALID");
    return 1;
  }

  const now = options.now ?? ((): Date => new Date());
  const logger: SafeLogger = createSafeLogger(options.logWriter ?? ((line) => console.error(line)));
  const configDir = resolve(options.workspaceRoot, parsed.configDir ?? join("config", "regional-values"));
  const request: BuildRequest = {
    workspaceRoot: options.workspaceRoot,
    configDir,
    buildKind: parsed.kind,
    dataMode: parsed.dataMode,
    generatedAt: parsed.generatedAt ?? now().toISOString(),
  };

  const result = await runBuild(request, {
    now: () => now().toISOString(),
    logger,
    ...(options.realDataLoader === undefined ? {} : { realDataLoader: options.realDataLoader }),
    ...(options.outputOperations === undefined ? {} : { outputOperations: options.outputOperations }),
  });
  if (result.exitCode !== 0) {
    io.write("code=BUILD_FAILED");
    return 1;
  }

  // The bundle that was written must pass the verification that the browser makes (Req 10.8).
  const settings = await loadBuildConfig(configDir);
  if (!settings.ok || !(await selfCheck(options.workspaceRoot, request, settings.value.dataVersion))) {
    // A bundle that does not pass is not left in place, and the report no longer says the build succeeded.
    await removeOldBundle(options.workspaceRoot, request.buildKind, options.outputOperations);
    await writeReport(
      options.workspaceRoot,
      request.buildKind,
      failedReport({
        buildKind: request.buildKind,
        startedAt: result.report.startedAt,
        finishedAt: now().toISOString(),
        dataModeRequested: request.dataMode,
        dataModeResolved: result.report.dataModeResolved,
        switchReasonCodes: result.report.switchReasonCodes,
        findings: result.report.findings,
        checks: { ...result.report.checks, contentHash: "FAILED" },
      }),
    );
    io.write("code=SELF_CHECK_FAILED");
    return 1;
  }
  io.write(`code=BUILD_OK dataKind=${result.report.output?.dataKind ?? "NONE"} switched=${String(result.report.switched)}`);
  return 0;
}
