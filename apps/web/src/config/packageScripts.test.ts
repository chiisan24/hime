import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../../../../", import.meta.url);

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>;
}>;

async function readManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(new URL(relativePath, repositoryRoot), "utf8"),
  ) as PackageManifest;
}

describe("root and web mode command contracts", () => {
  it("keeps the root normal build as the all-workspace build", async () => {
    const rootManifest = await readManifest("package.json");

    expect(rootManifest.scripts?.build).toBe(
      "npm run build --workspaces --if-present",
    );
  });

  it("delegates normal and analyst startup commands to the web workspace", async () => {
    const rootManifest = await readManifest("package.json");

    expect(rootManifest.scripts).toMatchObject({
      dev: "npm run dev --workspace @ehime-vote-navigator/web",
      "dev:analyst":
        "npm run dev:analyst --workspace @ehime-vote-navigator/web",
      preview: "npm run preview --workspace @ehime-vote-navigator/web",
      "preview:analyst":
        "npm run preview:analyst --workspace @ehime-vote-navigator/web",
    });
  });

  it("builds shared workspaces before the isolated analyst web output", async () => {
    const rootManifest = await readManifest("package.json");
    const analystBuild = rootManifest.scripts?.["build:analyst"] ?? "";

    expect(analystBuild).toContain(
      "--workspace @ehime-vote-navigator/contracts",
    );
    expect(analystBuild).toContain("--workspace @ehime-vote-navigator/domain");
    expect(analystBuild).toContain("--workspace @ehime-vote-navigator/fixtures");
    expect(analystBuild).toContain("--workspace @ehime-vote-navigator/api");
    expect(analystBuild).toContain("--if-present");
    expect(analystBuild).toMatch(
      /&& npm run build:analyst --workspace @ehime-vote-navigator\/web$/,
    );
  });

  it("uses the analyst Vite mode only for explicit analyst dev and build", async () => {
    const webManifest = await readManifest("apps/web/package.json");
    const scripts = webManifest.scripts ?? {};

    expect(scripts.dev).toBe("vite --host 127.0.0.1");
    expect(scripts.build).toBe("vite build");
    expect(scripts["dev:analyst"]).toBe(
      "vite --mode analyst --host 127.0.0.1",
    );
    expect(scripts["build:analyst"]).toBe("vite build --mode analyst");
    expect(scripts.dev).not.toContain("--mode analyst");
    expect(scripts.build).not.toContain("--mode analyst");
  });

  it("exposes the finite build boundary checker from root and web", async () => {
    const rootManifest = await readManifest("package.json");
    const webManifest = await readManifest("apps/web/package.json");

    expect(rootManifest.scripts?.["check:build-boundary"]).toBe(
      "npm run check:build-boundary --workspace @ehime-vote-navigator/web",
    );
    expect(webManifest.scripts?.["check:build-boundary"]).toBe(
      "node ./scripts/check-build-boundary.mjs",
    );
  });

  it("routes preview commands through strict mode-specific preflight", async () => {
    const webManifest = await readManifest("apps/web/package.json");

    expect(webManifest.scripts?.preview).toBe(
      "node ./scripts/preview.mjs visitor",
    );
    expect(webManifest.scripts?.["preview:analyst"]).toBe(
      "node ./scripts/preview.mjs analyst",
    );
  });
});
