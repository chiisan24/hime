import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BuildReportSchema,
  GATE_REASON_CLASS,
  GATE_REASON_CODES,
  RegionalBundleSchema,
  type BuildReport,
  type DataMode,
  type GateFinding,
  type GateReasonCode,
  type RegionalBundle,
} from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBuildWorkspace,
  putRealDataFile,
  type BuildWorkspace,
} from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import { createSafeLogger } from "../../logging/safeLogger.js";
import { runBuild, type BuildRequest, type RealDataLoader } from "./runBuild.js";

// Feature: regional-values-map, Property 33, Property 34 and Property 37

/** Fixed seeds: a green run repeats and a failure can be replayed. The workspace is copied for each run, so there are fewer runs. */
const PARAMETERS_33 = { seed: 350_033, numRuns: 30 };
const PARAMETERS_34 = { seed: 350_034, numRuns: 30 };
const PARAMETERS_37 = { seed: 350_037, numRuns: 20 };

const SHORTAGE_CODES = GATE_REASON_CODES.filter((code) => GATE_REASON_CLASS[code] === "SHORTAGE");
const DEFECT_CODES = GATE_REASON_CODES.filter((code) => GATE_REASON_CLASS[code] === "DEFECT" && code !== "DATA_KIND_MIXED");

const opened: BuildWorkspace[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((workspace) => workspace.remove()));
});

async function workspaceOf(): Promise<BuildWorkspace> {
  const workspace = await createBuildWorkspace();
  opened.push(workspace);
  return workspace;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function clock(): () => string {
  return () => "2026-08-10T10:00:00+09:00";
}

/** The bundle that a build wrote, checked with its contract. */
async function readBundle(workspace: BuildWorkspace): Promise<RegionalBundle> {
  return RegionalBundleSchema.parse(JSON.parse(await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8")) as unknown);
}

/** The report that a build wrote, checked with its contract. */
async function readReport(directory: string): Promise<BuildReport> {
  return BuildReportSchema.parse(JSON.parse(await readFile(join(directory, "build-report.json"), "utf8")) as unknown);
}

/** The events that the log wrote, as the objects of the lines. */
function eventsOf(lines: readonly string[]): { code: string; reasonCodes: readonly string[] | undefined }[] {
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    const event = typeof parsed === "object" && parsed !== null && "event" in parsed ? parsed.event : undefined;
    const code = typeof event === "object" && event !== null && "code" in event && typeof event.code === "string" ? event.code : "";
    const reasons =
      typeof event === "object" && event !== null && "reasonCodes" in event && Array.isArray(event.reasonCodes)
        ? event.reasonCodes.filter((value): value is string => typeof value === "string")
        : undefined;
    return { code, reasonCodes: reasons };
  });
}

function request(workspace: BuildWorkspace, change: Partial<BuildRequest> = {}): BuildRequest {
  return {
    workspaceRoot: workspace.root,
    configDir: workspace.configDir,
    buildKind: "DEMO",
    dataMode: "FIXTURE",
    generatedAt: "2026-01-04T09:00:00Z",
    ...change,
  };
}

function loaderOf(codes: readonly GateReasonCode[]): RealDataLoader {
  const findings: GateFinding[] = codes.map((code, index) => ({
    code,
    class: GATE_REASON_CLASS[code],
    targetKind: "SOURCE",
    targetId: `target-${index}`,
  }));
  return async () => ({ kind: "FINDINGS", findings });
}

const shortageCodes = fc.uniqueArray(fc.constantFrom(...SHORTAGE_CODES), { minLength: 1, maxLength: 5 });
const defectCodes = fc.uniqueArray(fc.constantFrom(...DEFECT_CODES), { minLength: 1, maxLength: 3 });

describe("runBuild: properties (Property 33): the reason codes of a switch", () => {
  /** **Validates: Requirements 10.13, 10.16, 12.13** */
  it("agrees in the bundle, the report and the log, is not empty, and is only shortages", async () => {
    await fc.assert(
      fc.asyncProperty(shortageCodes, async (codes) => {
        const workspace = await workspaceOf();
        const lines: string[] = [];
        const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), {
          now: clock(),
          logger: createSafeLogger((line) => lines.push(line)),
          realDataLoader: loaderOf(codes),
        });
        expect(result.exitCode).toBe(0);
        const bundle = await readBundle(workspace);
        const logged = eventsOf(lines).find((event) => event.code === "DATA_MODE_SWITCHED");
        const inMeta = new Set<GateReasonCode>(bundle.meta.switchReasonCodes);
        expect(bundle.meta.switched).toBe(true);
        expect(inMeta).toEqual(new Set(codes));
        expect(new Set(result.report.switchReasonCodes)).toEqual(inMeta);
        expect(new Set(logged?.reasonCodes)).toEqual(inMeta);
        expect(inMeta.size).toBeGreaterThan(0);
        expect([...inMeta].every((code) => GATE_REASON_CLASS[code] === "SHORTAGE")).toBe(true);
      }),
      PARAMETERS_33,
    );
  });

  /** **Validates: Requirements 10.13, 12.13** */
  it("is empty in all three places when the build does not switch", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<DataMode>("FIXTURE"), async (dataMode) => {
        const workspace = await workspaceOf();
        const lines: string[] = [];
        const result = await runBuild(request(workspace, { dataMode }), { now: clock(), logger: createSafeLogger((line) => lines.push(line)) });
        const bundle = await readBundle(workspace);
        expect(bundle.meta.switched).toBe(false);
        expect(bundle.meta.switchReasonCodes).toEqual([]);
        expect(result.report.switchReasonCodes).toEqual([]);
        expect(lines.some((line) => line.includes("DATA_MODE_SWITCHED"))).toBe(false);
      }),
      { ...PARAMETERS_33, numRuns: 5 },
    );
  });
});

describe("runBuild: properties (Property 34): a failed build leaves no bundle", () => {
  /** A request that fails, and a loader for it. */
  const failure = fc.oneof(
    shortageCodes.map((codes) => ({ dataMode: "REAL" as const, buildKind: "DEMO" as const, loader: loaderOf(codes) })),
    defectCodes.map((codes) => ({ dataMode: "REAL_PREFERRED" as const, buildKind: "DEMO" as const, loader: loaderOf(codes) })),
    fc.constantFrom("FIXTURE", "REAL_PREFERRED").map((dataMode) => ({
      dataMode,
      buildKind: "PUBLIC" as const,
      loader: loaderOf([]),
    })),
  );

  /** **Validates: Requirements 10.13, 10.16, 12.13** */
  it("removes an older bundle, writes none, and reports no output and the exit code 1", async () => {
    await fc.assert(
      fc.asyncProperty(failure, async ({ dataMode, buildKind, loader }) => {
        const workspace = await workspaceOf();
        const directory = workspace.outputDirectory(buildKind === "DEMO" ? "demo" : "public");
        await mkdir(directory, { recursive: true });
        const old = join(directory, "bundle.json");
        await writeFile(old, "{\"old\":true}", "utf8");
        const result = await runBuild(request(workspace, { dataMode, buildKind }), {
          now: clock(),
          logger: createSafeLogger(() => undefined),
          realDataLoader: loader,
        });
        expect(result.exitCode).toBe(1);
        expect(await exists(old)).toBe(false);
        expect(result.report.output).toBeNull();
        expect(result.report.exitCode).toBe(1);
        const report = await readReport(directory);
        expect(report.exitCode).toBe(1);
        expect(report.output).toBeNull();
      }),
      PARAMETERS_34,
    );
  });

  /** **Validates: Requirements 10.13, 12.13** */
  it("fails, whatever the findings are, for real data that exists but cannot be read yet", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<DataMode>("REAL", "REAL_PREFERRED"), async (dataMode) => {
        const workspace = await workspaceOf();
        await putRealDataFile(workspace);
        const result = await runBuild(request(workspace, { dataMode }), { now: clock(), logger: createSafeLogger(() => undefined) });
        expect(result.exitCode).toBe(1);
        expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
      }),
      { ...PARAMETERS_34, numRuns: 4 },
    );
  });
});

describe("runBuild: properties (Property 37): the output is determined by the input", () => {
  /** **Validates: Requirements 10.14, 12.13** */
  it("gives the same bytes and hash for the same input and the same time of generation, and another hash for another time", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 86_399 }),
        fc.integer({ min: 1, max: 86_399 }),
        async (seconds, later) => {
          const at = (value: number): string =>
            `2026-01-04T${String(Math.floor(value / 3600)).padStart(2, "0")}:${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}Z`;
          const first = await workspaceOf();
          const second = await workspaceOf();
          const third = await workspaceOf();
          const dependencies = { now: clock(), logger: createSafeLogger(() => undefined) };
          const a = await runBuild(request(first, { generatedAt: at(seconds) }), dependencies);
          const b = await runBuild(request(second, { generatedAt: at(seconds) }), dependencies);
          const c = await runBuild(request(third, { generatedAt: at((seconds + later) % 86_400) }), dependencies);
          const bytesA = await readFile(join(first.outputDirectory("demo"), "bundle.json"), "utf8");
          const bytesB = await readFile(join(second.outputDirectory("demo"), "bundle.json"), "utf8");
          expect(bytesB).toBe(bytesA);
          expect(b.report.output?.contentHash).toBe(a.report.output?.contentHash);
          expect(c.report.output?.contentHash).not.toBe(a.report.output?.contentHash);
        },
      ),
      PARAMETERS_37,
    );
  });

  /** **Validates: Requirements 10.14, 12.13** */
  it("gives the same bytes when the build is run again in the same place", async () => {
    const workspace = await workspaceOf();
    const dependencies = { now: clock(), logger: createSafeLogger(() => undefined) };
    await runBuild(request(workspace), dependencies);
    const first = await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8");
    await runBuild(request(workspace), dependencies);
    expect(await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8")).toBe(first);
  });
});
