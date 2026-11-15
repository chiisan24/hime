import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `issues.json` of real data, its state record and the records of real data stay out of Git (Req 13.11,
// 10.3 f). The sample of fictional data is the one `issues.json` that Git keeps. The receipts are in Git.

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLE = "packages/fixtures/src/regional-values/issues.json";
const IGNORED = [
  "dist/regional-values/issues/real/issues.json",
  "dist/regional-values/issues/real/issues-export-report.json",
  "dist/regional-values/issues/fixture/issues.json",
  "data/real/regional-values/issue-links.json",
  "data/real/regional-values/issues/issue-1/v1.json",
  "data/real/regional-values/approvals/ISSUE/issue-1/record.json",
];
const KEPT = [SAMPLE, ".kiro/specs/regional-values-map/records/issues-receipts/0000.json", "packages/fixtures/src/regional-values/issue-links.json"];

function git(...args: string[]): string[] {
  try {
    return execFileSync("git", args, { cwd: REPOSITORY, encoding: "utf8" })
      .split("\n")
      .map((line) => line.replaceAll("\\", "/").trim())
      .filter((line) => line !== "");
  } catch (error) {
    // `git check-ignore` exits with 1 when none of the paths is ignored.
    if (typeof error === "object" && error !== null && (error as { status?: unknown }).status === 1) {
      return [];
    }
    throw error;
  }
}

describe(".gitignore and the issues of real data (16.17)", () => {
  const lines = readFileSync(fileURLToPath(new URL("../../.gitignore", import.meta.url)), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("excludes the records of real data and the directory of the output", () => {
    expect(lines).toContain("data/real/**");
    expect(lines).toContain("dist");
  });

  it("is what Git does: the output and the records of real data are ignored, and the sample, the links of fictional data and the receipts are not", () => {
    expect(git("check-ignore", ...IGNORED).sort()).toEqual([...IGNORED].sort());
    expect(git("check-ignore", ...KEPT)).toEqual([]);
  });

  it("tracks no issues.json other than the sample of fictional data", () => {
    const tracked = git("ls-files", "--", "*issues.json", "*issues-export-report.json");
    expect(tracked.filter((path) => path !== SAMPLE)).toEqual([]);
  });
});
