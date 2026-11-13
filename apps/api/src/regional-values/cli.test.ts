import { readFileSync, writeFileSync } from "node:fs";
import { access, cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { BuildReportSchema, RegionalBundleSchema, type BuildReport } from "@ehime-vote-navigator/contracts";
import { verifyBundleText } from "@ehime-vote-navigator/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBuildWorkspace,
  putRealDataFile,
  type BuildWorkspace,
} from "../../../../tests/harness/regional-values/buildWorkspace.js";
import { runRegionalValuesCli, type RegionalValuesCliOptions } from "./cli.js";

const GENERATED_AT = "2026-01-04T09:00:00Z";
const FIXED_NOW = new Date("2026-08-10T01:00:00.000Z");
const DATA_VERSION = "2026-01-01.1";

let workspace: BuildWorkspace | undefined;

afterEach(async () => {
  await workspace?.remove();
  workspace = undefined;
});

type Run = Readonly<{ exitCode: number; lines: string[]; logLines: string[] }>;

async function run(
  argv: readonly string[],
  base: BuildWorkspace,
  options: Partial<RegionalValuesCliOptions> = {},
): Promise<Run> {
  const lines: string[] = [];
  const logLines: string[] = [];
  const exitCode = await runRegionalValuesCli(argv, {
    workspaceRoot: base.root,
    io: { write: (line) => lines.push(line) },
    now: () => FIXED_NOW,
    logWriter: (line) => logLines.push(line),
    ...options,
  });
  return { exitCode, lines, logLines };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readReport(base: BuildWorkspace, kind: "demo" | "public"): Promise<BuildReport> {
  const text = await readFile(join(base.outputDirectory(kind), "build-report.json"), "utf8");
  return BuildReportSchema.parse(JSON.parse(text) as unknown);
}

async function readBundleText(base: BuildWorkspace, kind: "demo" | "public"): Promise<string> {
  return readFile(join(base.outputDirectory(kind), "bundle.json"), "utf8");
}

describe("runRegionalValuesCli: arguments", () => {
  it("prints the usage and exits with 1 for no command and for an unknown command", async () => {
    workspace = await createBuildWorkspace();
    for (const argv of [[], ["unknown"], ["draft", "run"]]) {
      const result = await run(argv, workspace);
      expect(result.exitCode).toBe(1);
      expect(result.lines.at(-1)).toBe("code=USAGE");
      expect(result.lines.some((line) => line.startsWith("Usage:"))).toBe(true);
    }
  });

  it.each([
    ["no --kind", ["build"]],
    ["an unknown kind", ["build", "--kind", "release"]],
    ["a kind in a wrong case", ["build", "--kind", "Demo"]],
    ["an unknown option", ["build", "--kind", "demo", "--verbose", "yes"]],
    ["an option without a value", ["build", "--kind", "demo", "--data-mode"]],
    ["an option followed by an option", ["build", "--kind", "--data-mode", "FIXTURE"]],
    ["a repeated option", ["build", "--kind", "demo", "--kind", "public"]],
    ["a stray value", ["build", "demo"]],
    ["an unknown data mode", ["build", "--kind", "demo", "--data-mode", "MIXED"]],
    ["a data mode in a wrong case", ["build", "--kind", "demo", "--data-mode", "fixture"]],
    ["a public build with FIXTURE", ["build", "--kind", "public", "--data-mode", "FIXTURE"]],
    ["a public build with REAL_PREFERRED", ["build", "--kind", "public", "--data-mode", "REAL_PREFERRED"]],
    ["a generated-at that is not a time", ["build", "--kind", "demo", "--generated-at", "yesterday"]],
    ["a generated-at without a time zone", ["build", "--kind", "demo", "--generated-at", "2026-01-04T09:00:00"]],
    ["a generated-at that is not a real date", ["build", "--kind", "demo", "--generated-at", "2026-02-30T09:00:00Z"]],
  ])("exits with 1 and writes nothing for %s", async (_name, argv) => {
    workspace = await createBuildWorkspace();
    const result = await run(argv, workspace);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=ARGUMENT_INVALID"]);
    expect(result.logLines).toEqual([]);
    expect(await exists(join(workspace.root, "dist"))).toBe(false);
  });
});

describe("runRegionalValuesCli: FIXTURE build", () => {
  it("writes the bundle and the report and exits with 0", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["code=BUILD_OK dataKind=FIXTURE switched=false"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(true);
    const report = await readReport(workspace, "demo");
    expect(report.exitCode).toBe(0);
    expect(report.dataModeRequested).toBe("FIXTURE");
    expect(report.dataModeResolved).toBe("FIXTURE");
    expect(report.switched).toBe(false);
  });

  it("writes a bundle that the browser verification accepts (Req 10.8)", async () => {
    workspace = await createBuildWorkspace();
    await run(["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT], workspace);
    const text = await readBundleText(workspace, "demo");
    const verified = await verifyBundleText(text, { schemaVersion: 1, dataVersion: DATA_VERSION, buildKind: "DEMO" });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.meta.dataKind).toBe("FIXTURE");
      expect(verified.value.meta.buildKind).toBe("DEMO");
      expect(verified.value.meta.generatedAt).toBe(GENERATED_AT);
    }
  });

  it("takes the generation time from the clock when --generated-at is not given", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "demo", "--data-mode", "FIXTURE"], workspace);
    expect(result.exitCode).toBe(0);
    const bundle = RegionalBundleSchema.parse(JSON.parse(await readBundleText(workspace, "demo")) as unknown);
    expect(bundle.meta.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("builds the same bytes twice from the same inputs", async () => {
    workspace = await createBuildWorkspace();
    const argv = ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT];
    await run(argv, workspace);
    const first = await readBundleText(workspace, "demo");
    await run(argv, workspace);
    expect(await readBundleText(workspace, "demo")).toBe(first);
  });

  it("builds into the directory of the kind that was asked for", async () => {
    workspace = await createBuildWorkspace();
    await run(["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT], workspace);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(true);
    expect(await exists(workspace.outputDirectory("public"))).toBe(false);
  });
});

describe("runRegionalValuesCli: --config-dir", () => {
  it("reads the settings from the default directory below the root", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(0);
  });

  it("reads test-only settings from a directory that is given as a relative path", async () => {
    workspace = await createBuildWorkspace();
    // Moves the settings away from the default directory, so that only --config-dir can find them.
    await cp(workspace.configDir, join(workspace.root, "settings-for-test"), { recursive: true });
    await rm(workspace.configDir, { recursive: true, force: true });

    const argv = ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT];
    const stopped = await run(argv, workspace);
    expect(stopped.exitCode).toBe(1);
    expect(stopped.lines).toEqual(["code=BUILD_FAILED"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);

    const result = await run([...argv, "--config-dir", "settings-for-test"], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["code=BUILD_OK dataKind=FIXTURE switched=false"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(true);
  });

  it("reads test-only settings from a directory that is given as an absolute path", async () => {
    workspace = await createBuildWorkspace();
    const absolute = join(workspace.root, "elsewhere");
    await cp(workspace.configDir, absolute, { recursive: true });
    await rm(workspace.configDir, { recursive: true, force: true });
    const result = await run(
      ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT, "--config-dir", absolute],
      workspace,
    );
    expect(result.exitCode).toBe(0);
  });

  it("fails without a bundle when the settings directory does not exist", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(
      ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT, "--config-dir", "no-such-directory"],
      workspace,
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=BUILD_FAILED"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
    expect((await readReport(workspace, "demo")).exitCode).toBe(1);
  });
});

describe("runRegionalValuesCli: the default data mode", () => {
  it("uses REAL_PREFERRED for the demo build and falls back to the fictional data when there is no real data", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "demo", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["code=BUILD_OK dataKind=FIXTURE switched=true"]);
    const report = await readReport(workspace, "demo");
    expect(report.dataModeRequested).toBe("REAL_PREFERRED");
    expect(report.dataModeResolved).toBe("FIXTURE");
    expect(report.switched).toBe(true);
    expect(report.warnings).toContain("DATA_MODE_SWITCHED");
    expect(result.logLines.some((line) => line.includes("DATA_MODE_SWITCHED"))).toBe(true);
  });

  it("does not switch silently when the real data is there but cannot be read", async () => {
    workspace = await createBuildWorkspace();
    await putRealDataFile(workspace);
    const result = await run(["build", "--kind", "demo", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=BUILD_FAILED"]);
    expect(await exists(join(workspace.outputDirectory("demo"), "bundle.json"))).toBe(false);
  });

  it("uses REAL for the public build and fails without a bundle when there is no real data", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "public", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=BUILD_FAILED"]);
    expect(await exists(join(workspace.outputDirectory("public"), "bundle.json"))).toBe(false);
    const report = await readReport(workspace, "public");
    expect(report.dataModeRequested).toBe("REAL");
    expect(report.exitCode).toBe(1);
    expect(report.switched).toBe(false);
  });

  it("accepts --data-mode REAL for the public build", async () => {
    workspace = await createBuildWorkspace();
    const result = await run(["build", "--kind", "public", "--data-mode", "REAL", "--generated-at", GENERATED_AT], workspace);
    expect(result.exitCode).toBe(1);
    expect((await readReport(workspace, "public")).dataModeRequested).toBe("REAL");
  });
});

describe("runRegionalValuesCli: the self-check of the written bundle", () => {
  it("fails, removes the bundle and says so in the report when the bundle does not pass the browser verification", async () => {
    workspace = await createBuildWorkspace();
    const bundlePath = join(workspace.outputDirectory("demo"), "bundle.json");
    let tampered = false;
    const result = await run(["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT], workspace, {
      // The build log is written after the bundle, so a change made here happens between the write and the self-check.
      logWriter: (line) => {
        if (line.includes("BUILD_DONE") && !tampered) {
          tampered = true;
          const text = readFileSync(bundlePath, "utf8");
          writeFileSync(bundlePath, text.replace(GENERATED_AT, "2026-01-04T09:00:01Z"), "utf8");
        }
      },
    });
    expect(tampered).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["code=SELF_CHECK_FAILED"]);
    expect(await exists(bundlePath)).toBe(false);
    const report = await readReport(workspace, "demo");
    expect(report.exitCode).toBe(1);
    expect(report.output).toBeNull();
    expect(report.checks.contentHash).toBe("FAILED");
  });
});

describe("runRegionalValuesCli: what is printed", () => {
  it("prints codes only, and never a path, a value or a part of a file", async () => {
    workspace = await createBuildWorkspace();
    const cases: readonly (readonly string[])[] = [
      ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--generated-at", GENERATED_AT],
      ["build", "--kind", "demo", "--data-mode", "FIXTURE", "--config-dir", "no-such-directory"],
      ["build", "--kind", "public"],
      ["build", "--kind", "public", "--data-mode", "FIXTURE"],
      ["unknown"],
    ];
    for (const argv of cases) {
      const result = await run(argv, workspace);
      for (const line of [...result.lines, ...result.logLines]) {
        expect(line).not.toContain(workspace.root);
        expect(line).not.toContain("no-such-directory");
      }
      for (const line of result.lines.filter((text) => !text.startsWith("Usage:") && !text.startsWith(" "))) {
        expect(line).toMatch(/^code=[A-Z_]+( [A-Za-z]+=[A-Za-z_]+)*$/u);
      }
    }
  });
});
