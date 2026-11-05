import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const rootUrl = new URL("../", import.meta.url);
const workspacePaths = [
  "packages/contracts",
  "packages/domain",
  "packages/fixtures",
  "apps/api",
  "apps/web",
] as const;

type RootPackageJson = {
  private?: boolean;
  workspaces?: string[];
};

type RootTsConfig = {
  references?: Array<{ path?: string }>;
};

type PackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, unknown>;
};

async function readJson<T>(relativePath: string): Promise<T> {
  const content = await readFile(new URL(relativePath, rootUrl), "utf8");
  return JSON.parse(content) as T;
}

describe("workspace skeleton", () => {
  it("declares every required npm workspace on a private root", async () => {
    const packageJson = await readJson<RootPackageJson>("package.json");

    expect(packageJson.private).toBe(true);
    expect(packageJson.workspaces).toEqual(workspacePaths);

    await Promise.all(
      workspacePaths.map(async (workspacePath) => {
        await access(new URL(`${workspacePath}/package.json`, rootUrl));
      }),
    );
  });

  it("keeps a TypeScript project reference for every workspace", async () => {
    const tsconfig = await readJson<RootTsConfig>("tsconfig.json");
    const referencePaths = tsconfig.references?.map(({ path }) => path);

    expect(referencePaths).toEqual(workspacePaths.map((path) => `./${path}`));
  });

  it("records every workspace in the single npm lockfile", async () => {
    const lockfile = await readJson<PackageLock>("package-lock.json");

    expect(lockfile.lockfileVersion).toBe(3);
    for (const workspacePath of workspacePaths) {
      expect(Object.hasOwn(lockfile.packages ?? {}, workspacePath)).toBe(true);
    }
  });

  it("retains the existing Git and specification assets", async () => {
    const protectedPaths = [
      ".git/HEAD",
      ".kiro/specs/ehime-vote-navigator/.config.kiro",
      ".kiro/specs/ehime-vote-navigator/requirements.md",
      ".kiro/specs/ehime-vote-navigator/design.md",
      ".kiro/specs/ehime-vote-navigator/tasks.md",
    ];

    await expect(
      Promise.all(protectedPaths.map(async (path) => access(new URL(path, rootUrl)))),
    ).resolves.toHaveLength(protectedPaths.length);
  });
});
