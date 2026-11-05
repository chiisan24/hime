import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type GitResult = Readonly<{
  status: number;
  stdout: string;
}>;

function runGit(args: readonly string[]): GitResult {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null) {
    throw new Error("Git did not return an exit status.");
  }

  return {
    status: result.status,
    stdout: result.stdout,
  };
}

function isIgnored(relativePath: string): boolean {
  const result = runGit([
    "check-ignore",
    "--quiet",
    "--no-index",
    "--",
    relativePath,
  ]);

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed with status ${result.status}.`);
  }

  return result.status === 0;
}

describe("repository data boundaries", () => {
  it("ignores every real-data artifact class without accessing those paths", () => {
    const ignoredPaths = [
      "data/real/.gitkeep",
      "data/real/raw/source.pdf",
      "data/real/manifests/source.json",
      "data/real/extracted/segment.json",
      "data/real/policy-units/unit.json",
      "data/real/indexes/index.json",
      "data/real/runs/run-1/events/000001.json",
      "data/real/approvals/approval.json",
      "data/real/evaluations/evaluation.json",
      "data/real/p0/status.json",
      "data/real/.temporary/artifact.tmp",
      "data/real/runs/run-1/artifact.tmp",
    ] as const;

    expect(
      ignoredPaths.filter((relativePath) => !isIgnored(relativePath)),
    ).toEqual([]);
  });

  it("keeps fixtures and the secret-free example eligible for tracking", () => {
    const trackablePaths = [
      ".env.example",
      "packages/fixtures/src/index.ts",
      "packages/fixtures/raw/example.txt",
      "packages/fixtures/runs/example.json",
      "packages/fixtures/evaluations/example.json",
    ] as const;

    expect(
      trackablePaths.filter((relativePath) => isIgnored(relativePath)),
    ).toEqual([]);
  });

  it("ignores local environment files but not the checked-in example", () => {
    expect(isIgnored(".env")).toBe(true);
    expect(isIgnored(".env.local")).toBe(true);
    expect(isIgnored(".env.example")).toBe(false);
  });

  it("has no real-data entry in the existing Git index", () => {
    const result = runGit(["ls-files", "--", "data/real"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
