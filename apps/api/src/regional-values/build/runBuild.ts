import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { GATE_REASON_CLASS } from "@ehime-vote-navigator/contracts";
import type {
  AiContribution,
  BuildConfig,
  BuildKind,
  BuildReport,
  DataMode,
  GateFinding,
  GateReasonCode,
  NeutralityConfig,
} from "@ehime-vote-navigator/contracts";
import {
  assembleBundleBody,
  checkCardCoverage,
  checkFixtureIssueCard,
  confirmFixtureFallback,
  finalizeBundle,
  inspectFixedTexts,
  inspectGuidance,
  inspectQuestionBank,
  inspectResultTexts,
  resolveDataMode,
  toGateFinding,
  type AssemblyInput,
  type DataModeDecision,
  type FixtureIssueCard,
} from "@ehime-vote-navigator/domain";

import type { SafeLogger } from "../../logging/safeLogger.js";
import { logBuildDone, logBuildStart, logDataModeSwitched, logRealDataInsufficient } from "./buildLog.js";
import { loadBuildConfig, loadMapConfig, loadNeutralityConfig } from "./loadConfig.js";
import { loadFixtureData, type FixtureData } from "./loadFixtureData.js";
import { failedReport, successfulReport, type BuildChecks } from "./report.js";
import { removeOldBundle, writeBundle, writeReport, type OutputOperations } from "./writeOutputs.js";

/**
 * The build of a regional values bundle (design: "ビルドパイプライン", steps 1 to 10).
 *
 * This version builds from the fictional data (`FIXTURE`). The real data is read through a
 * `RealDataLoader`, which is replaced when the real data is implemented (13.12). The default loader
 * reports that there is no real data (a shortage) or, if there is something in the directory, that
 * reading it is not implemented; the build then fails. It never falls back to the fictional data
 * without saying so.
 */

/** The directory of the real data, relative to the workspace root. It is not in Git. */
export const REAL_DATA_DIRECTORY = ["data", "real", "regional-values"] as const;

/** The directory of the fictional data, relative to the workspace root. */
export const FIXTURE_DATA_DIRECTORY = ["packages", "fixtures", "src", "regional-values"] as const;

/** The result of reading the real data: findings, or the fact that reading it is not implemented. */
export type RealDataOutcome =
  | Readonly<{ kind: "FINDINGS"; findings: readonly GateFinding[] }>
  | Readonly<{ kind: "NOT_IMPLEMENTED" }>;

/** Reads and checks the real data. A test replaces it. */
export type RealDataLoader = (realDataDirectory: string) => Promise<RealDataOutcome>;

const REAL_DATA_ABSENT: GateFinding = {
  code: "REAL_DATA_ABSENT",
  class: GATE_REASON_CLASS.REAL_DATA_ABSENT,
  targetKind: "BUNDLE",
  targetId: null,
};

/**
 * The default loader. A missing directory, or an empty one, is `REAL_DATA_ABSENT`, a shortage that
 * can be supplied. A directory with something in it is real data that this build cannot read yet, so
 * it is a failure, and not a reason to build the fictional data instead.
 */
export const defaultRealDataLoader: RealDataLoader = async (realDataDirectory) => {
  let entries: string[];
  try {
    entries = await readdir(realDataDirectory);
  } catch {
    return { kind: "FINDINGS", findings: [REAL_DATA_ABSENT] };
  }
  return entries.length === 0 ? { kind: "FINDINGS", findings: [REAL_DATA_ABSENT] } : { kind: "NOT_IMPLEMENTED" };
};

export type BuildRequest = Readonly<{
  /** The root of the repository. The files are read and written below it. */
  workspaceRoot: string;
  /** The directory of the settings (`config/regional-values/`), or a directory of test-only settings. */
  configDir: string;
  buildKind: BuildKind;
  dataMode: DataMode;
  /** The time of generation, `meta.generatedAt`. A test and the `--generated-at` option fix it. */
  generatedAt: string;
}>;

export type BuildDependencies = Readonly<{
  /** The clock for the start and the end of the build in the report. A test injects it. */
  now: () => string;
  logger: SafeLogger;
  realDataLoader?: RealDataLoader;
  outputOperations?: OutputOperations;
}>;

export type BuildResult = Readonly<{
  exitCode: 0 | 1;
  report: BuildReport;
}>;

const NO_AI: AiContribution = { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 };

const SKIPPED: BuildChecks = { dataBoundary: "SKIPPED", questionBank: "SKIPPED", issueCards: "SKIPPED", contentHash: "SKIPPED" };

function configFinding(file: string): GateFinding {
  return { code: "CONFIG_UNREADABLE", class: GATE_REASON_CLASS.CONFIG_UNREADABLE, targetKind: "CONFIG", targetId: file };
}

/** The findings that say why the data mode was refused: those of the data, and the code of the gate alone. */
function refusalFindings(decision: DataModeDecision, known: readonly GateFinding[]): GateFinding[] {
  if (decision.ok) {
    return [];
  }
  const { reasonCodes } = decision.error;
  const fromData = known.filter((finding) => reasonCodes.includes(finding.code));
  const covered = new Set(fromData.map((finding) => finding.code));
  const ofGate = reasonCodes
    .filter((code) => !covered.has(code))
    .map((code): GateFinding => ({ code, class: GATE_REASON_CLASS[code], targetKind: "RELEASE", targetId: null }));
  return [...fromData, ...ofGate];
}

/**
 * The numbers and years of the fact items, as they would be written in a sentence, for the check
 * `NO_FACT_NUMBERS`: the amount of each fact and its survey year.
 */
function factNumeralsOf(cards: readonly FixtureData["cards"][number][]): ReadonlySet<string> {
  const numerals = new Set<string>();
  for (const card of cards) {
    for (const fact of card.facts) {
      numerals.add(String(fact.value.amount));
      numerals.add(typeof fact.surveyDate === "number" ? String(fact.surveyDate) : fact.surveyDate.slice(0, 4));
    }
  }
  return numerals;
}

type CheckedFixture = Readonly<{
  findings: readonly GateFinding[];
  checks: BuildChecks;
}>;

/** Checks the fictional data (steps 5 and 7): the question bank, the cards with the coverage, and the texts. */
function checkFixtureData(
  data: FixtureData,
  neutrality: NeutralityConfig,
  buildConfig: BuildConfig,
): CheckedFixture {
  const themes = [...new Set(data.bank.diagnosticSets.flatMap((set) => set.themeIds))];

  const bankResult = inspectQuestionBank(data.bank, { config: neutrality, factNumerals: factNumeralsOf(data.cards) });
  const bankFindings = bankResult.ok ? [] : bankResult.error.violations.map(toGateFinding);

  const fixtureCards = data.cards.filter((card): card is FixtureIssueCard => card.dataKind === "FIXTURE");
  const cardConfig = {
    quoteMaxChars: buildConfig.quoteMaxChars,
    realNames: buildConfig.realNames,
    properNouns: buildConfig.properNouns,
    numeralExemptWords: neutrality.numeralExemptWords,
  };
  const cardFindings = [
    ...fixtureCards.flatMap((card) => checkFixtureIssueCard(card, { config: cardConfig, sourceText: (id) => data.sourceTexts.get(id) })),
    ...checkCardCoverage(data.cards, themes),
  ];
  const textFindings = [
    ...inspectFixedTexts(data.fixedTexts, neutrality),
    ...inspectResultTexts(data.resultTexts, neutrality, themes),
    ...inspectGuidance(data.guidance, neutrality, themes),
  ];

  return {
    findings: [...bankFindings, ...cardFindings, ...textFindings],
    checks: {
      dataBoundary: "PASSED",
      questionBank: bankFindings.length === 0 ? "PASSED" : "FAILED",
      issueCards: cardFindings.length + textFindings.length === 0 ? "PASSED" : "FAILED",
      contentHash: "SKIPPED",
    },
  };
}

/**
 * Runs a build and returns its exit code and report. It removes an older `bundle.json` first, writes
 * `bundle.json` only when the build succeeds, and writes `build-report.json` in every case. It calls no
 * AI, opens no port, and logs only the events of the design.
 */
export async function runBuild(request: BuildRequest, dependencies: BuildDependencies): Promise<BuildResult> {
  const { logger } = dependencies;
  const startedAt = dependencies.now();
  logBuildStart(logger, request.buildKind, request.dataMode);

  const finish = async (report: BuildReport, dataKind: "FIXTURE" | "REAL_AI" | null): Promise<BuildResult> => {
    // The report is written when the build fails, too. If it cannot be written, the build fails.
    const written = await writeReport(request.workspaceRoot, request.buildKind, report);
    const exitCode = written.ok ? report.exitCode : 1;
    logBuildDone(logger, exitCode === 0 ? dataKind : null, exitCode);
    return { exitCode, report };
  };

  const fail = (
    findings: readonly GateFinding[],
    checks: BuildChecks,
    resolved: "REAL" | "FIXTURE" | null = null,
    switchReasonCodes: readonly GateReasonCode[] = [],
  ): Promise<BuildResult> =>
    finish(
      failedReport({
        buildKind: request.buildKind,
        startedAt,
        finishedAt: dependencies.now(),
        dataModeRequested: request.dataMode,
        dataModeResolved: resolved,
        switchReasonCodes,
        findings,
        checks,
      }),
      null,
    );

  // Step 2: remove an older bundle first, so that a failed build leaves none behind.
  const removed = await removeOldBundle(request.workspaceRoot, request.buildKind, dependencies.outputOperations);
  if (!removed.ok) {
    return fail([], SKIPPED);
  }

  // Step 1: read the settings.
  const [mapConfig, neutrality, buildConfig] = await Promise.all([
    loadMapConfig(request.configDir),
    loadNeutralityConfig(request.configDir),
    loadBuildConfig(request.configDir),
  ]);
  if (!mapConfig.ok) return fail([configFinding(mapConfig.error.file)], SKIPPED);
  if (!neutrality.ok) return fail([configFinding(neutrality.error.file)], SKIPPED);
  if (!buildConfig.ok) return fail([configFinding(buildConfig.error.file)], SKIPPED);

  // Steps 3 to 5: the real data is read only when the mode can use it.
  let realFindings: readonly GateFinding[] = [];
  if (request.dataMode !== "FIXTURE") {
    const outcome = await (dependencies.realDataLoader ?? defaultRealDataLoader)(join(request.workspaceRoot, ...REAL_DATA_DIRECTORY));
    if (outcome.kind === "NOT_IMPLEMENTED") {
      // Real data exists, but it cannot be read yet. That is not a shortage to fall back from.
      return fail([], SKIPPED);
    }
    realFindings = outcome.findings;
    const shortages = realFindings.filter((finding) => finding.class === "SHORTAGE").length;
    logRealDataInsufficient(logger, shortages, realFindings.length - shortages);
  }

  // Step 6: choose the data.
  const decision = resolveDataMode(request.dataMode, request.buildKind, realFindings);
  if (!decision.ok) {
    return fail(refusalFindings(decision, realFindings), SKIPPED);
  }
  const { switched, switchReasonCodes } = decision.value;
  if (decision.value.resolved === "REAL") {
    // The real data is not assembled until it is read (13.12). Say so, and do not build anything else.
    return fail([], SKIPPED);
  }
  if (switched) {
    logDataModeSwitched(logger, request.dataMode, "FIXTURE", switchReasonCodes);
  }

  // Step 7: read and check the fictional data. A finding here, a shortage or a defect, fails the build.
  const fixture = await loadFixtureData(join(request.workspaceRoot, ...FIXTURE_DATA_DIRECTORY));
  if (!fixture.ok) {
    const unreadable: GateFinding = {
      code: "CONTRACT_VIOLATION",
      class: GATE_REASON_CLASS.CONTRACT_VIOLATION,
      targetKind: "BUNDLE",
      targetId: fixture.error.file,
    };
    return fail([unreadable], { ...SKIPPED, dataBoundary: "FAILED" }, "FIXTURE", switchReasonCodes);
  }
  const checked = checkFixtureData(fixture.value, neutrality.value, buildConfig.value);
  if (!confirmFixtureFallback(decision, checked.findings).ok) {
    return fail(checked.findings, checked.checks, "FIXTURE", switchReasonCodes);
  }

  // Step 8: assemble, hash and check the bundle.
  const assembled = assembleBundleBody({
    identity: {
      buildKind: request.buildKind,
      dataKind: "FIXTURE",
      dataModeRequested: request.dataMode,
      dataModeResolved: "FIXTURE",
      switched,
      switchReasonCodes,
      generatedAt: request.generatedAt,
      dataVersion: buildConfig.value.dataVersion,
    },
    bank: fixture.value.bank,
    cards: fixture.value.cards,
    resultTexts: fixture.value.resultTexts,
    fixedTexts: fixture.value.fixedTexts,
    guidance: fixture.value.guidance,
    mapConfig: mapConfig.value,
    aiContribution: NO_AI,
  } satisfies AssemblyInput);
  if (!assembled.ok) {
    return fail(assembled.error.findings, { ...checked.checks, questionBank: "FAILED" }, "FIXTURE", switchReasonCodes);
  }
  const finalized = await finalizeBundle(assembled.value.body);
  if (!finalized.ok) {
    return fail([], { ...checked.checks, contentHash: "FAILED" }, "FIXTURE", switchReasonCodes);
  }

  // Step 9: write the bundle, then the report.
  const written = await writeBundle(request.workspaceRoot, request.buildKind, finalized.value);
  const checks: BuildChecks = { ...checked.checks, contentHash: "PASSED" };
  if (!written.ok) {
    return fail([], { ...checks, contentHash: "FAILED" }, "FIXTURE", switchReasonCodes);
  }
  return finish(
    successfulReport({
      buildKind: request.buildKind,
      startedAt,
      finishedAt: dependencies.now(),
      dataModeRequested: request.dataMode,
      dataModeResolved: "FIXTURE",
      switchReasonCodes,
      findings: assembled.value.excluded,
      checks,
      output: { bundlePath: written.relativePath, dataKind: "FIXTURE", contentHash: finalized.value.meta.contentHash, bytes: written.bytes },
    }),
    "FIXTURE",
  );
}
