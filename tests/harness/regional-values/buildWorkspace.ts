import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NeutralityConfig } from "@ehime-vote-navigator/contracts";

import { TEST_NEUTRALITY_CONFIG } from "./bankInjection.js";
import { TEST_REAL_NAMES } from "./contentFixtures.js";

/**
 * A workspace in a temporary directory for the tests of the build (9.4, 9.5): a copy of the
 * fictional data of the repository, the settings that the build reads (test-only: the production
 * `neutrality.json` and `build.json` are approval-gated, 13.1), and room for the real data and the
 * output. The real repository is never written.
 */

const REPOSITORY_FIXTURES = fileURLToPath(new URL("../../../packages/fixtures/src/regional-values/", import.meta.url));

export type BuildWorkspace = Readonly<{
  root: string;
  configDir: string;
  /** The directory of the real data, which does not exist until a test makes it. */
  realDataDirectory: string;
  outputDirectory: (kind: "demo" | "public") => string;
  remove: () => Promise<void>;
}>;

/** The settings of the build in the form of the files. */
export function testBuildSettings(): { map: unknown; neutrality: NeutralityConfig; build: unknown } {
  return {
    map: { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 },
    neutrality: TEST_NEUTRALITY_CONFIG,
    build: {
      dataVersion: "2026-01-01.1",
      quoteMaxChars: 200,
      realNames: [...TEST_REAL_NAMES],
      properNouns: ["愛媛県", "松山市", "今治市", "新居浜市"],
      requiredApprovers: 1,
    },
  };
}

/**
 * Makes a workspace: the fictional data is copied from the repository, and the settings are written
 * to `configDir`. `override` replaces a settings file with another value, or with text that is not
 * JSON, or leaves it out with `null`.
 */
export async function createBuildWorkspace(
  override: Partial<Record<"map" | "neutrality" | "build", unknown>> = {},
): Promise<BuildWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "regional-values-build-"));
  const configDir = join(root, "config", "regional-values");
  await mkdir(configDir, { recursive: true });
  await cp(REPOSITORY_FIXTURES, join(root, "packages", "fixtures", "src", "regional-values"), { recursive: true });

  const settings = testBuildSettings();
  const files: Record<"map" | "neutrality" | "build", string> = {
    map: "map.json",
    neutrality: "neutrality.json",
    build: "build.json",
  };
  for (const key of ["map", "neutrality", "build"] as const) {
    const value = key in override ? override[key] : settings[key];
    if (value === null) {
      continue;
    }
    await writeFile(join(configDir, files[key]), typeof value === "string" ? value : JSON.stringify(value), "utf8");
  }

  return {
    root,
    configDir,
    realDataDirectory: join(root, "data", "real", "regional-values"),
    outputDirectory: (kind) => join(root, "dist", "regional-values", kind),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/** Makes the real data directory with one file, so that the default loader finds real data it cannot read. */
export async function putRealDataFile(workspace: BuildWorkspace): Promise<void> {
  await mkdir(workspace.realDataDirectory, { recursive: true });
  await writeFile(join(workspace.realDataDirectory, "placeholder.json"), "{}", "utf8");
}
