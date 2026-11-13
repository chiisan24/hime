import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BuildReportSchema, RegionalBundleSchema, type BuildReport, type GateFinding } from "@ehime-vote-navigator/contracts";
import { verifyBundleText } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBuildWorkspace,
  putRealDataFile,
  testBuildSettings,
  type BuildWorkspace,
} from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import { createSafeLogger } from "../../logging/safeLogger.js";
import { runBuild, type BuildRequest, type RealDataLoader } from "./runBuild.js";

const GENERATED_AT = "2026-01-04T09:00:00Z";
const EXPECTED = { schemaVersion: 1, dataVersion: "2026-01-01.1" } as const;

let workspace: BuildWorkspace | undefined;

afterEach(async () => {
  await workspace?.remove();
  workspace = undefined;
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function clock(): () => string {
  const times = ["2026-08-10T10:00:00+09:00", "2026-08-10T10:00:03+09:00"];
  return () => times.shift() ?? "2026-08-10T10:00:03+09:00";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loggerOf(): { lines: string[]; logger: ReturnType<typeof createSafeLogger> } {
  const lines: string[] = [];
  return { lines, logger: createSafeLogger((line) => lines.push(line)) };
}

function request(base: BuildWorkspace, change: Partial<BuildRequest> = {}): BuildRequest {
  return {
    workspaceRoot: base.root,
    configDir: base.configDir,
    buildKind: "DEMO",
    dataMode: "FIXTURE",
    generatedAt: GENERATED_AT,
    ...change,
  };
}

async function readReport(base: BuildWorkspace, kind: "demo" | "public" = "demo"): Promise<BuildReport> {
  return BuildReportSchema.parse(JSON.parse(await readFile(join(base.outputDirectory(kind), "build-report.json"), "utf8")) as unknown);
}

const shortage = (code: GateFinding["code"], targetId: string): GateFinding => ({
  code,
  class: "SHORTAGE",
  targetKind: "SOURCE",
  targetId,
});

const insufficient: RealDataLoader = async () => ({
  kind: "FINDINGS",
  findings: [shortage("FACT_NOT_VERIFIED", "fact-1"), shortage("NOTE_REVIEW_MISSING", "src-1"), shortage("TRANSMISSION_NOT_ALLOWED", "src-1")],
});

const defective: RealDataLoader = async () => ({
  kind: "FINDINGS",
  findings: [{ code: "QUOTE_NOT_FOUND", class: "DEFECT", targetKind: "ISSUE_CARD", targetId: "card-1" }],
});

describe("runBuild: FIXTURE", () => {
  it("builds the fictional data, writes the bundle and the report, and exits with 0", async () => {
    workspace = await createBuildWorkspace();
    const { logger } = loggerOf();
    const result = await runBuild(request(workspace), { now: clock(), logger });
    expect(result.exitCode).toBe(0);
    expect(result.report.dataModeResolved).toBe("FIXTURE");
    expect(result.report.switched).toBe(false);
    expect(result.report.exitCode).toBe(0);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(true);
    expect(await readReport(workspace)).toEqual(result.report);
  });

  it("writes a bundle that the browser verification accepts", async () => {
    workspace = await createBuildWorkspace();
    await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    const text = await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8");
    const verified = await verifyBundleText(text, { ...EXPECTED, buildKind: "DEMO" });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.meta.dataKind).toBe("FIXTURE");
      expect(verified.value.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    }
  });

  it("reports the output, with the hash and the size of the file that was written", async () => {
    workspace = await createBuildWorkspace();
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    const text = await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8");
    expect(result.report.output?.bundlePath).toBe("dist/regional-values/demo/bundle.json");
    expect(result.report.output?.bytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(result.report.output?.dataKind).toBe("FIXTURE");
    expect(result.report.checks).toEqual({ dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "PASSED", contentHash: "PASSED" });
    expect(JSON.parse(text)).toMatchObject({ meta: { contentHash: result.report.output?.contentHash } });
  });

  it("does not read the real data, even when it is there", async () => {
    workspace = await createBuildWorkspace();
    await putRealDataFile(workspace);
    let read = 0;
    const loader: RealDataLoader = async () => {
      read += 1;
      return { kind: "FINDINGS", findings: [] };
    };
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger, realDataLoader: loader });
    expect(result.exitCode).toBe(0);
    expect(read).toBe(0);
  });

  it("logs the start and the end", async () => {
    workspace = await createBuildWorkspace();
    const { lines, logger } = loggerOf();
    await runBuild(request(workspace), { now: clock(), logger });
    const codes = lines.map((line): unknown => JSON.parse(line)).map((event) => (isRecord(event) && isRecord(event.event) ? event.event.code : undefined));
    expect(codes).toEqual(["BUILD_START", "BUILD_DONE"]);
  });
});

describe("runBuild: REAL_PREFERRED", () => {
  it("falls back to FIXTURE when the real data has only shortages, and tells it in the bundle, the report and the log", async () => {
    workspace = await createBuildWorkspace();
    const { lines, logger } = loggerOf();
    const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), { now: clock(), logger, realDataLoader: insufficient });
    const switchCodes = ["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"];
    expect(result.exitCode).toBe(0);
    expect(result.report.switched).toBe(true);
    expect(result.report.switchReasonCodes).toEqual(switchCodes);
    expect(result.report.warnings).toEqual(["DATA_MODE_SWITCHED"]);
    const bundle = RegionalBundleSchema.parse(JSON.parse(await readFile(join(workspace.outputDirectory("demo"), "bundle.json"), "utf8")) as unknown);
    expect(bundle.meta).toMatchObject({ dataKind: "FIXTURE", dataModeRequested: "REAL_PREFERRED", dataModeResolved: "FIXTURE", switched: true, switchReasonCodes: switchCodes });
    const events = lines.map((line): unknown => JSON.parse(line));
    expect(events.map((event) => (isRecord(event) && isRecord(event.event) ? event.event.code : undefined))).toEqual([
      "BUILD_START",
      "REAL_DATA_INSUFFICIENT",
      "DATA_MODE_SWITCHED",
      "BUILD_DONE",
    ]);
    const switchedEvent = events[2];
    expect(isRecord(switchedEvent) && isRecord(switchedEvent.event) ? switchedEvent.event.reasonCodes : undefined).toEqual(switchCodes);
  });

  it("falls back, by default, when there is no real data directory", async () => {
    workspace = await createBuildWorkspace();
    const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(0);
    expect(result.report.switchReasonCodes).toEqual(["REAL_DATA_ABSENT"]);
  });

  it("does not fall back from a defect of the real data, and leaves no bundle", async () => {
    workspace = await createBuildWorkspace();
    const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), { now: clock(), logger: loggerOf().logger, realDataLoader: defective });
    expect(result.exitCode).toBe(1);
    expect(result.report.output).toBeNull();
    expect(result.report.findings.map((finding) => finding.code)).toEqual(["QUOTE_NOT_FOUND"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("does not fall back when there is real data that cannot be read yet, and says nothing is built", async () => {
    workspace = await createBuildWorkspace();
    await putRealDataFile(workspace);
    const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(result.report.switched).toBe(false);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });
});

describe("runBuild: REAL", () => {
  it("is refused with every shortage, and writes no bundle", async () => {
    workspace = await createBuildWorkspace();
    const result = await runBuild(request(workspace, { dataMode: "REAL" }), { now: clock(), logger: loggerOf().logger, realDataLoader: insufficient });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.map((finding) => finding.code)).toEqual(["FACT_NOT_VERIFIED", "NOTE_REVIEW_MISSING", "TRANSMISSION_NOT_ALLOWED"]);
    expect(result.report.switched).toBe(false);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("is refused when there is no real data, with REAL_DATA_ABSENT", async () => {
    workspace = await createBuildWorkspace();
    const result = await runBuild(request(workspace, { dataMode: "REAL" }), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.map((finding) => finding.code)).toEqual(["REAL_DATA_ABSENT"]);
  });

  it("builds nothing when the real data has no finding, because the real data cannot be assembled yet", async () => {
    workspace = await createBuildWorkspace();
    const clean: RealDataLoader = async () => ({ kind: "FINDINGS", findings: [] });
    const result = await runBuild(request(workspace, { dataMode: "REAL" }), { now: clock(), logger: loggerOf().logger, realDataLoader: clean });
    expect(result.exitCode).toBe(1);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });
});

describe("runBuild: the public build", () => {
  it("is refused with PUBLIC_REQUIRES_REAL for a mode other than REAL, and never reads the real data", async () => {
    workspace = await createBuildWorkspace();
    let read = 0;
    const loader: RealDataLoader = async () => {
      read += 1;
      return { kind: "FINDINGS", findings: [] };
    };
    for (const dataMode of ["FIXTURE", "REAL_PREFERRED"] as const) {
      const result = await runBuild(request(workspace, { buildKind: "PUBLIC", dataMode }), { now: clock(), logger: loggerOf().logger, realDataLoader: loader });
      expect(result.exitCode, dataMode).toBe(1);
      expect(result.report.findings.map((finding) => finding.code), dataMode).toEqual(["PUBLIC_REQUIRES_REAL"]);
    }
    expect(read).toBe(1);
    expect(await exists(join(workspace.outputDirectory("public"), "bundle.json"))).toBe(false);
  });
});

describe("runBuild: a failed build leaves no bundle", () => {
  async function putOldBundle(base: BuildWorkspace): Promise<string> {
    const directory = base.outputDirectory("demo");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "bundle.json");
    await writeFile(path, "{\"old\":true}", "utf8");
    return path;
  }

  it("removes an older bundle before it starts, and does not write a new one when it fails", async () => {
    workspace = await createBuildWorkspace();
    const old = await putOldBundle(workspace);
    const result = await runBuild(request(workspace, { dataMode: "REAL" }), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(await exists(old)).toBe(false);
    expect(result.report.output).toBeNull();
    expect((await readReport(workspace)).exitCode).toBe(1);
  });

  it("replaces an older bundle with the new one when it succeeds", async () => {
    workspace = await createBuildWorkspace();
    const old = await putOldBundle(workspace);
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(0);
    expect(await readFile(old, "utf8")).not.toContain("\"old\"");
  });

  it("fails and writes no bundle when an older bundle cannot be removed", async () => {
    workspace = await createBuildWorkspace();
    const old = await putOldBundle(workspace);
    const result = await runBuild(request(workspace), {
      now: clock(),
      logger: loggerOf().logger,
      outputOperations: {
        remove: async () => {
          throw new Error("denied");
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect(await readFile(old, "utf8")).toContain("\"old\"");
  });
});

describe("runBuild: the settings", () => {
  it("fails with CONFIG_UNREADABLE and the base file name when a settings file is missing or broken", async () => {
    for (const [key, file] of [["map", "map.json"], ["neutrality", "neutrality.json"], ["build", "build.json"]] as const) {
      workspace = await createBuildWorkspace({ [key]: null });
      const missing = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
      expect(missing.exitCode).toBe(1);
      expect(missing.report.findings).toEqual([{ code: "CONFIG_UNREADABLE", class: "DEFECT", targetKind: "CONFIG", targetId: file }]);
      await workspace.remove();

      workspace = await createBuildWorkspace({ [key]: "{" });
      const broken = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
      expect(broken.exitCode).toBe(1);
      expect(broken.report.findings.map((finding) => finding.targetId)).toEqual([file]);
      await workspace.remove();
      workspace = undefined;
    }
  });

  it("fails when the list of loaded words is empty, and builds nothing", async () => {
    const { neutrality } = testBuildSettings();
    workspace = await createBuildWorkspace({ neutrality: { ...neutrality, loadedWords: [] } });
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });
});

describe("runBuild: the checks of the fictional data", () => {
  it("fails, with the findings, when the fictional data breaks a check, and builds nothing", async () => {
    // A banned word in the settings that the fictional wording contains turns a shortage-free build into a failure.
    const { neutrality } = testBuildSettings();
    workspace = await createBuildWorkspace({ neutrality: { ...neutrality, bannedWords: [...neutrality.bannedWords, "架空"] } });
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(result.report.output).toBeNull();
    expect(result.report.findings.some((finding) => finding.code === "FIXED_TEXT_INVALID")).toBe(true);
    expect(result.report.checks.issueCards).toBe("FAILED");
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("fails a fall back whose fictional data has a finding, but still tells that it fell back", async () => {
    const { neutrality } = testBuildSettings();
    workspace = await createBuildWorkspace({ neutrality: { ...neutrality, bannedWords: [...neutrality.bannedWords, "架空"] } });
    const result = await runBuild(request(workspace, { dataMode: "REAL_PREFERRED" }), {
      now: clock(),
      logger: loggerOf().logger,
      realDataLoader: insufficient,
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.switched).toBe(true);
    expect(result.report.warnings).toEqual(["DATA_MODE_SWITCHED"]);
    expect(result.report.output).toBeNull();
  });

  it("fails when the fictional data cannot be read", async () => {
    workspace = await createBuildWorkspace();
    await writeFile(join(workspace.root, "packages", "fixtures", "src", "regional-values", "cards.json"), "{", "utf8");
    const result = await runBuild(request(workspace), { now: clock(), logger: loggerOf().logger });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings).toEqual([{ code: "CONTRACT_VIOLATION", class: "DEFECT", targetKind: "BUNDLE", targetId: "cards.json" }]);
  });
});
