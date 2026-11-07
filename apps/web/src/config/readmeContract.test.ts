import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { resolvePreviewTarget } from "../../scripts/preview-preflight.mjs";
import { createWebViteConfig } from "../../vite.config.js";
import {
  ANALYST_ROUTE_CONTRACTS,
  selectAnalystRouteContract,
} from "../app/analyst/routeContracts.js";
import { VISITOR_ROUTE_CONTRACTS } from "../app/visitor/routeContracts.js";
import {
  resolveBuildTarget,
  WEB_BUILD_MARKER_FILENAME,
} from "./applicationMode.js";

const repositoryRoot = new URL("../../../../", import.meta.url);

const MODE_SECTION = "## 利用者モードと分析者モード";
const VISITOR_SECTION = "### Visitor Mode（通常command）";
const ANALYST_SECTION = "### Analyst Mode（明示command）";
const PREVIEW_SECTION = "### previewの事前確認";
const BUILD_BOUNDARY_SECTION = "### build境界の確認";
const SOURCES_SECTION = "## 公開出典一覧（`/sources`）の廃止";

const RETIRED_PUBLIC_SOURCES_PATH = "/sources";
const SOURCE_MANIFEST_PATH = "/analyst/sources";

type PackageManifest = Readonly<{
  name?: string;
  workspaces?: readonly string[];
  scripts?: Readonly<Record<string, string>>;
}>;

type DocumentedCommand = Readonly<{
  line: string;
  script: string;
  workspace: string | null;
}>;

async function readRepositoryText(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

async function readManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(await readRepositoryText(relativePath)) as PackageManifest;
}

/** Maps every npm workspace package name to its manifest. */
async function readWorkspaceManifests(
  rootManifest: PackageManifest,
): Promise<ReadonlyMap<string, PackageManifest>> {
  const manifests = new Map<string, PackageManifest>();
  for (const workspacePath of rootManifest.workspaces ?? []) {
    const manifest = await readManifest(`${workspacePath}/package.json`);
    if (manifest.name !== undefined) {
      manifests.set(manifest.name, manifest);
    }
  }
  return manifests;
}

function headingLevel(line: string): number | null {
  const hashes = /^(#{1,6}) /u.exec(line)?.[1];
  return hashes === undefined ? null : hashes.length;
}

/**
 * Returns the Markdown section that starts at the exact heading line and ends
 * before the next heading of the same or a higher level. Fenced code is never
 * treated as a heading.
 */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.indexOf(heading);
  const level = headingLevel(heading);
  if (start === -1 || level === null) {
    throw new Error(`README heading is missing: ${heading}`);
  }

  const body: string[] = [];
  let inFence = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    const nextLevel = inFence ? null : headingLevel(line);
    if (nextLevel !== null && nextLevel <= level) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

/** Extracts every `npm.cmd run` and `npm.cmd test` line from PowerShell fences. */
function documentedCommands(markdown: string): DocumentedCommand[] {
  const commands: DocumentedCommand[] = [];
  let inPowerShell = false;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inPowerShell = !inPowerShell && line === "```powershell";
      continue;
    }
    if (!inPowerShell) {
      continue;
    }

    const run = /^npm\.cmd run (\S+)(?: --workspace (\S+))?$/u.exec(line);
    const script = run?.[1];
    if (script !== undefined) {
      commands.push({ line, script, workspace: run?.[2] ?? null });
    } else if (line === "npm.cmd test") {
      commands.push({ line, script: "test", workspace: null });
    }
  }
  return commands;
}

function scriptNames(commands: readonly DocumentedCommand[]): string[] {
  return commands
    .filter((command) => command.workspace === null)
    .map((command) => command.script);
}

describe("README startup, build, and preview contract", () => {
  it("documents only npm commands that exist in the real package scripts", async () => {
    const readme = await readRepositoryText("README.md");
    const rootManifest = await readManifest("package.json");
    const workspaces = await readWorkspaceManifests(rootManifest);
    const commands = documentedCommands(readme);

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const manifest =
        command.workspace === null
          ? rootManifest
          : workspaces.get(command.workspace);

      expect(manifest, command.line).toBeDefined();
      expect(manifest?.scripts?.[command.script], command.line).toEqual(
        expect.any(String),
      );
    }
  });

  it("documents the visitor and analyst commands in separate sections", async () => {
    const readme = await readRepositoryText("README.md");
    const rootScripts = (await readManifest("package.json")).scripts ?? {};
    const webScripts =
      (await readManifest("apps/web/package.json")).scripts ?? {};
    const visitorCommands = scriptNames(
      documentedCommands(sectionOf(readme, VISITOR_SECTION)),
    );
    const analystCommands = scriptNames(
      documentedCommands(sectionOf(readme, ANALYST_SECTION)),
    );

    expect(visitorCommands).toEqual(["dev", "build", "preview"]);
    expect(analystCommands).toEqual([
      "dev:analyst",
      "build:analyst",
      "preview:analyst",
    ]);

    for (const script of visitorCommands) {
      expect(rootScripts[script], script).toEqual(expect.any(String));
      expect(webScripts[script], script).toEqual(expect.any(String));
      expect(webScripts[script], script).not.toMatch(/\banalyst\b/u);
    }
    for (const script of analystCommands) {
      expect(rootScripts[script], script).toEqual(expect.any(String));
      expect(webScripts[script], script).toMatch(/\banalyst\b/u);
    }
  });

  it("documents the build boundary checker that both manifests define", async () => {
    const readme = await readRepositoryText("README.md");
    const rootScripts = (await readManifest("package.json")).scripts ?? {};
    const webScripts =
      (await readManifest("apps/web/package.json")).scripts ?? {};

    expect(
      scriptNames(documentedCommands(sectionOf(readme, BUILD_BOUNDARY_SECTION))),
    ).toEqual(["check:build-boundary"]);
    expect(rootScripts["check:build-boundary"]).toEqual(expect.any(String));
    expect(webScripts["check:build-boundary"]).toEqual(expect.any(String));
  });

  it("documents the isolated output directory and strict preview preflight of each mode", async () => {
    const readme = await readRepositoryText("README.md");
    const visitorSection = sectionOf(readme, VISITOR_SECTION);
    const analystSection = sectionOf(readme, ANALYST_SECTION);
    const previewSection = sectionOf(readme, PREVIEW_SECTION);
    const visitorOutput = resolveBuildTarget(undefined).outputDirectory;
    const analystOutput = resolveBuildTarget("analyst").outputDirectory;

    expect(resolvePreviewTarget("visitor").outputDirectory).toBe(visitorOutput);
    expect(resolvePreviewTarget("analyst").outputDirectory).toBe(analystOutput);
    expect(visitorSection).toContain(`\`apps/web/${visitorOutput}\``);
    expect(visitorSection).not.toContain(analystOutput);
    expect(analystSection).toContain(`\`apps/web/${analystOutput}\``);

    expect(previewSection).toContain(`\`${WEB_BUILD_MARKER_FILENAME}\``);
    expect(previewSection).toContain("反対modeの出力へfallbackしません");
    for (const mode of ["visitor", "analyst"] as const) {
      const rebuild = resolvePreviewTarget(mode).rebuildCommand.replace(
        /^npm /u,
        "npm.cmd ",
      );
      expect(previewSection).toContain(`\`${rebuild}\``);
    }
  });

  it("documents loopback-only servers that match the Vite config of both modes", async () => {
    const readme = await readRepositoryText("README.md");
    const modeSection = sectionOf(readme, MODE_SECTION);

    for (const mode of [undefined, "analyst"]) {
      const config = createWebViteConfig(mode);
      expect(config.server?.host).toBe("127.0.0.1");
      expect(config.preview?.host).toBe("127.0.0.1");
      expect(modeSection).toContain(
        `development server（port ${String(config.server?.port)}）`,
      );
      expect(modeSection).toContain(
        `preview server（port ${String(config.preview?.port)}）`,
      );
      expect(modeSection).toContain(
        `http://127.0.0.1:${String(config.server?.port)}`,
      );
      expect(modeSection).toContain(
        `http://127.0.0.1:${String(config.preview?.port)}`,
      );
    }
    expect(modeSection).toContain("`127.0.0.1`だけにbindします");
    expect(readme).not.toContain("0.0.0.0");
  });

  it("states that Visitor Mode is the default and Analyst Mode is not authentication", async () => {
    const modeSection = sectionOf(
      await readRepositoryText("README.md"),
      MODE_SECTION,
    );

    expect(modeSection).toContain("Visitor Modeが既定値です");
    expect(modeSection).toContain(
      "Analyst Modeはローカル限定の共同開発者向け起動modeであり、認証やauthorizationではありません",
    );
    expect(modeSection).toContain("account登録とloginは不要です");
  });

  it("states that runtime inputs and implicit fallback cannot switch the mode", async () => {
    const modeSection = sectionOf(
      await readRepositoryText("README.md"),
      MODE_SECTION,
    );

    for (const source of [
      "query string",
      "Web Storage",
      "browser toggle",
      "暗黙fallback",
    ]) {
      expect(modeSection, source).toContain(source);
    }
    expect(modeSection).toContain("modeを変更できません");
    expect(modeSection).toContain("mode切替のbutton、select、linkがありません");
  });

  it("documents analyst-path exclusion that matches the real Visitor route contracts", async () => {
    const modeSection = sectionOf(
      await readRepositoryText("README.md"),
      MODE_SECTION,
    );
    const wildcard = VISITOR_ROUTE_CONTRACTS.find(
      (contract) => contract.kind === "WILDCARD",
    );

    expect(
      VISITOR_ROUTE_CONTRACTS.filter((contract) =>
        contract.path.startsWith("/analyst"),
      ),
    ).toEqual([]);
    expect(modeSection).toContain(
      "Visitor Modeは`/analyst/*`をrouterへ登録しません",
    );
    expect(modeSection).toContain(`「${String(wildcard?.heading)}」（404）`);
  });
});

describe("README standalone public sources retirement contract", () => {
  it("documents /sources as a shell-preserving 404 in both route contracts", async () => {
    const sourcesSection = sectionOf(
      await readRepositoryText("README.md"),
      SOURCES_SECTION,
    );
    const visitorPaths = VISITOR_ROUTE_CONTRACTS.map(
      (contract) => contract.path,
    );
    const analystPaths = ANALYST_ROUTE_CONTRACTS.map(
      (contract) => contract.path,
    );
    const analystFallback = selectAnalystRouteContract(
      RETIRED_PUBLIC_SOURCES_PATH,
    );

    expect(visitorPaths).not.toContain(RETIRED_PUBLIC_SOURCES_PATH);
    expect(analystPaths).not.toContain(RETIRED_PUBLIC_SOURCES_PATH);
    expect(analystFallback.kind).toBe("WILDCARD");

    expect(sourcesSection).toContain(
      "Visitor ModeとAnalyst Modeの両方で廃止しました",
    );
    expect(sourcesSection).toContain(
      "どちらのmodeのrouterにも`/sources`を登録しません",
    );
    expect(sourcesSection).toContain(`「${analystFallback.heading}」（404）`);
    expect(sourcesSection).toContain(
      "HomeとShared Navigationに`/sources`へのlinkはありません",
    );
  });

  it("keeps /analyst/sources Source Manifest management and embedded source evidence", async () => {
    const sourcesSection = sectionOf(
      await readRepositoryText("README.md"),
      SOURCES_SECTION,
    );
    const sourceManifest = ANALYST_ROUTE_CONTRACTS.find(
      (contract) => contract.path === SOURCE_MANIFEST_PATH,
    );

    expect(sourceManifest).toMatchObject({
      heading: "Source Manifest",
      kind: "ANALYST",
    });
    expect(sourcesSection).toContain(
      `Analyst Modeの内部\`${SOURCE_MANIFEST_PATH}\`は、${String(sourceManifest?.heading)}管理画面として維持します`,
    );

    const evidenceLine = sourcesSection
      .split("\n")
      .find((line) => line.endsWith("は維持します。"));
    expect(evidenceLine).toBeDefined();
    for (const field of [
      "出典",
      "根拠引用",
      "根拠リンク",
      "locator",
      "revision",
      "checksum",
      "来歴（provenance）",
    ]) {
      expect(evidenceLine, field).toContain(field);
    }
    expect(sourcesSection).toContain(
      "source data、citation contract、provenance contract、およびSource Manifestは変更しません",
    );
    expect(sourcesSection).toContain("API機能とdomain機能も変更しません");
  });

  it("limits the ehime-vote-navigator supersession to the Home link and keeps the spec documents unedited", async () => {
    const sourcesSection = sectionOf(
      await readRepositoryText("README.md"),
      SOURCES_SECTION,
    );

    expect(sourcesSection).toContain(
      "既存`ehime-vote-navigator` specのRequirement 19.1のうち、Homeから独立した出典一覧へ移動する導線だけを上書きします",
    );
    expect(sourcesSection).toContain(
      "`.kiro/specs/ehime-vote-navigator/`の`requirements.md`、`design.md`、`tasks.md`は編集しません",
    );
  });
});

describe("README preserved project statements", () => {
  it("keeps the NOT_READY, past-election, P1/P2, API startup, and Ctrl+C statements", async () => {
    const readme = await readRepositoryText("README.md");

    expect(readme).toContain("**NOT_READY**");
    expect(readme).toContain("令和4年（2022年）第20回愛媛県知事選挙");
    expect(readme).toContain("P1/P2画面はどちらのmodeでも対象外");
    expect(readme).toContain(
      "npm.cmd run start --workspace @ehime-vote-navigator/api",
    );
    expect(readme).toContain("`Ctrl+C`");
    expect(readme).toContain("実Bedrock要求は行いません");
    expect(readme).not.toContain("最小skeletonとhealth表示だけ");
  });
});
