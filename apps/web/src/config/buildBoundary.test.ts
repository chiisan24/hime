import { spawn } from "node:child_process";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTemporaryTestDirectory,
  type TemporaryTestDirectory,
} from "../../../../tests/harness/temporary-directory.js";
import {
  assertIsolatedOutputRoot,
  BUILD_BOUNDARY_TARGETS,
  evaluateBuildBoundary,
  evaluateSourceContractModules,
  extractAnalystHomeTexts,
  extractRouteDescriptors,
  inspectBuildArtifact,
  parseWebModuleManifest,
  WEB_MODULE_MANIFEST_FILENAME,
  type BuildBoundaryMode,
  type BuildBoundaryTarget,
  type WebModuleManifest,
} from "../../scripts/build-boundary.mjs";
import { ANALYST_ROUTE_CONTRACTS } from "../app/analyst/routeContracts.js";
import { VISITOR_ROUTE_CONTRACTS } from "../app/visitor/routeContracts.js";
import { WEB_BUILD_MARKER_FILENAME } from "./applicationMode.js";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "..", "..");
const checkerPath = path.join(webRoot, "scripts", "check-build-boundary.mjs");
const CHECKER_TIMEOUT_MS = 180_000;

const SHARED_SHELL_MODULE = "src/shared/ui/AppShell.tsx";
const ANALYST_NAVIGATION_MODULE = "src/app/analyst/navigationItems.ts";
/** Mutation anchors in the real Visitor route entry and shared shell sources. */
const VISITOR_SHELL_IMPORT = 'import { AppShell, VISITOR_NAV_ITEMS } from "../../shared/ui/AppShell.js";';
const LAST_PUBLIC_NAV_ITEM = '{ to: "/venue", label: "会場閲覧", end: true },';
const VISITOR_LAYOUT_VIOLATION =
  "expected one AppShell layout whose navigationItems is VISITOR_NAV_ITEMS imported from src/shared/ui/AppShell.tsx";

/** The analyst navigation label as raw UTF-8 and as a lowercased JavaScript unicode escape. */
const ANALYST_NAVIGATION_LABEL_FORMS = ["分析状態", "\\u5206\\u6790\\u72b6\\u614b"] as const;

type CheckerRun = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;

type BuildArtifact = Readonly<{
  target: BuildBoundaryTarget;
  manifest: WebModuleManifest;
  sources: ReadonlyMap<string, string>;
}>;

/** Environment for a child build that mirrors a plain `vite build`, not the Vitest worker. */
function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("VITEST") ||
      ["NODE_ENV", "TEST", "MODE", "DEV", "PROD", "SSR", "BASE_URL"].includes(key)
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function runChecker(args: readonly string[], cwd: string): Promise<CheckerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [checkerPath, ...args], {
      cwd,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function replaceOnce(text: string, search: string, replacement: string): string {
  const index = text.indexOf(search);
  if (index === -1) {
    throw new Error(`Mutation anchor not found: ${search}`);
  }
  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
}

function moduleEntry(artifact: BuildArtifact, modulePath: string) {
  const entry = artifact.manifest.modules.find((candidate) => candidate.path === modulePath);
  if (entry === undefined) {
    throw new Error(`${modulePath} is not in the ${artifact.target.applicationMode} manifest`);
  }
  return entry;
}

describe("Visitor/Analyst build boundary checker", () => {
  let workspace: TemporaryTestDirectory;
  let outputRoot: string;
  let checkerRun: CheckerRun;
  let artifacts: Readonly<Record<BuildBoundaryMode, BuildArtifact>>;
  let analystHomeTexts: readonly string[];
  let webDependencies: readonly string[];

  async function loadArtifact(mode: BuildBoundaryMode): Promise<BuildArtifact> {
    const target = BUILD_BOUNDARY_TARGETS[mode];
    const manifest = parseWebModuleManifest(
      JSON.parse(
        await readFile(
          path.join(outputRoot, target.outputDirectory, WEB_MODULE_MANIFEST_FILENAME),
          "utf8",
        ),
      ),
    );
    if (manifest === null) {
      throw new Error(`Invalid ${mode} module manifest`);
    }

    const sources = new Map<string, string>();
    for (const entry of manifest.modules) {
      if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.path)) {
        sources.set(entry.path, await readFile(path.join(webRoot, entry.path), "utf8"));
      }
    }
    return { target, manifest, sources };
  }

  function evaluate(
    artifact: BuildArtifact,
    overrides: Partial<{
      target: BuildBoundaryTarget;
      manifest: WebModuleManifest;
      sources: ReadonlyMap<string, string>;
    }> = {},
  ): readonly string[] {
    return evaluateBuildBoundary({
      target: overrides.target ?? artifact.target,
      manifest: overrides.manifest ?? artifact.manifest,
      sources: overrides.sources ?? artifact.sources,
      analystHomeTexts,
      webDependencies,
    });
  }

  function withSource(
    artifact: BuildArtifact,
    modulePath: string,
    mutate: (sourceText: string) => string,
  ): ReadonlyMap<string, string> {
    const sourceText = artifact.sources.get(modulePath);
    if (sourceText === undefined) {
      throw new Error(`${modulePath} is not a bundled source`);
    }
    return new Map([...artifact.sources, [modulePath, mutate(sourceText)]]);
  }

  beforeAll(async () => {
    workspace = await createTemporaryTestDirectory("build-boundary");
    outputRoot = path.join(workspace.path, "artifacts");
    checkerRun = await runChecker(["--output-root", outputRoot], workspace.path);

    if (checkerRun.status === 0) {
      artifacts = {
        visitor: await loadArtifact("visitor"),
        analyst: await loadArtifact("analyst"),
      };
    }

    const analystPagesPath = "src/app/analyst/pages.tsx";
    analystHomeTexts = extractAnalystHomeTexts(
      analystPagesPath,
      await readFile(path.join(webRoot, analystPagesPath), "utf8"),
    );
    const webPackage = JSON.parse(
      await readFile(path.join(webRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    webDependencies = Object.keys(webPackage.dependencies ?? {});
  }, CHECKER_TIMEOUT_MS);

  afterAll(async () => {
    if (workspace === undefined) {
      return;
    }
    // On Windows a recursive rm can hit ENOTEMPTY or EBUSY while a timed-out test
    // is still copying into the workspace. Retry with backoff, and only warn about
    // a leftover directory so that cleanup never hides the original failure.
    try {
      await rm(workspace.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`Could not remove the build boundary workspace ${workspace.path}: ${String(error)}`);
    }
  });

  it("passes against fresh visitor and analyst builds in an isolated output root", async () => {
    expect(checkerRun).toMatchObject({ status: 0 });
    expect(checkerRun.stderr).not.toContain("BUILD_BOUNDARY_FAILED");
    expect(checkerRun.stdout).toMatch(/^BUILD_BOUNDARY_OK VISITOR dist modules=\d+/mu);
    expect(checkerRun.stdout).toMatch(/^BUILD_BOUNDARY_OK ANALYST dist-analyst modules=\d+/mu);
    expect(checkerRun.stdout).toContain("BUILD_BOUNDARY_OK SOURCE_CONTRACTS");
    expect(checkerRun.stdout).toContain("BUILD_BOUNDARY_RESULT PASS");

    for (const target of Object.values(BUILD_BOUNDARY_TARGETS)) {
      const marker = JSON.parse(
        await readFile(
          path.join(outputRoot, target.outputDirectory, WEB_BUILD_MARKER_FILENAME),
          "utf8",
        ),
      ) as unknown;
      expect(marker).toEqual({
        schemaVersion: 1,
        applicationMode: target.applicationMode,
        outputDirectory: target.outputDirectory,
      });

      const manifestText = await readFile(
        path.join(outputRoot, target.outputDirectory, WEB_MODULE_MANIFEST_FILENAME),
        "utf8",
      );
      for (const absoluteRoot of [
        repositoryRoot.replaceAll("\\", "/"),
        JSON.stringify(repositoryRoot).slice(1, -1),
      ]) {
        expect(manifestText.toLowerCase()).not.toContain(absoluteRoot.toLowerCase());
      }

      await expect(
        inspectBuildArtifact({ webRoot, outputRoot, requestedMode: target.requestedMode }),
      ).resolves.toMatchObject({ violations: [] });
    }
  });

  it("records real module metadata: visitor excludes app/analyst, analyst bundles it via the explicit entry", () => {
    const visitorPaths = artifacts.visitor.manifest.modules.map(({ path: modulePath }) => modulePath);
    const analystPaths = artifacts.analyst.manifest.modules.map(({ path: modulePath }) => modulePath);

    expect(visitorPaths).toEqual(
      expect.arrayContaining(["src/App.tsx", "src/app/visitor/routes.tsx", "src/app/public/pages.tsx"]),
    );
    expect(visitorPaths.filter((modulePath) => modulePath.startsWith("src/app/analyst/"))).toEqual([]);
    expect(moduleEntry(artifacts.visitor, "src/App.tsx").importedPaths).toContain(
      "src/app/visitor/routes.tsx",
    );

    expect(analystPaths).toEqual(
      expect.arrayContaining(["src/app/analyst/routes.tsx", "src/app/analyst/pages.tsx"]),
    );
    expect(analystPaths).not.toContain("src/app/visitor/routes.tsx");
    expect(moduleEntry(artifacts.analyst, "src/App.tsx").importedPaths).toContain(
      "src/app/analyst/routes.tsx",
    );
    expect(moduleEntry(artifacts.analyst, "src/app/analyst/pages.tsx").renderedExports).toEqual(
      expect.arrayContaining(["AnalystHomePage", "AnalystSourcesPage"]),
    );

    for (const artifact of Object.values(artifacts)) {
      expect(
        artifact.manifest.modules.filter(({ renderedExports }) =>
          renderedExports.includes("SourcesPage"),
        ),
      ).toEqual([]);
      expect(
        artifact.manifest.modules.filter(({ path: modulePath }) => modulePath.startsWith("src/config/")),
      ).toEqual([]);
    }
  });

  it("emits Visitor JavaScript without analyst route strings or the analyst navigation label", async () => {
    async function emittedJavaScript(outputDirectory: string): Promise<string> {
      const assetsDirectory = path.join(outputRoot, outputDirectory, "assets");
      const files = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"));
      expect(files.length).toBeGreaterThan(0);
      const texts = await Promise.all(
        files.map((name) => readFile(path.join(assetsDirectory, name), "utf8")),
      );
      return texts.join("\n").toLowerCase();
    }

    const visitorJavaScript = await emittedJavaScript("dist");
    const analystJavaScript = await emittedJavaScript("dist-analyst");

    expect(visitorJavaScript).not.toContain("/analyst");
    for (const form of ANALYST_NAVIGATION_LABEL_FORMS) {
      expect(visitorJavaScript).not.toContain(form);
    }

    // The same scan finds both strings in the Analyst bundle, so the absence above is meaningful.
    expect(analystJavaScript).toContain("/analyst/readiness");
    expect(ANALYST_NAVIGATION_LABEL_FORMS.some((form) => analystJavaScript.includes(form))).toBe(
      true,
    );
  });

  it("extracts normalized route descriptors that match both route contract matrices", async () => {
    const visitorPath = BUILD_BOUNDARY_TARGETS.visitor.routeEntryPath;
    const analystPath = BUILD_BOUNDARY_TARGETS.analyst.routeEntryPath;
    const visitor = extractRouteDescriptors(
      visitorPath,
      await readFile(path.join(webRoot, visitorPath), "utf8"),
    );
    const analyst = extractRouteDescriptors(
      analystPath,
      await readFile(path.join(webRoot, analystPath), "utf8"),
    );

    expect(BUILD_BOUNDARY_TARGETS.visitor.routePaths).toEqual(
      VISITOR_ROUTE_CONTRACTS.map(({ path: routePath }) => routePath),
    );
    expect(BUILD_BOUNDARY_TARGETS.analyst.routePaths).toEqual(
      ANALYST_ROUTE_CONTRACTS.map(({ path: routePath }) => routePath),
    );
    expect(visitor.routes.map(({ path: routePath }) => routePath)).toEqual(
      BUILD_BOUNDARY_TARGETS.visitor.routePaths,
    );
    expect(analyst.routes.map(({ path: routePath }) => routePath)).toEqual(
      BUILD_BOUNDARY_TARGETS.analyst.routePaths,
    );
    expect(BUILD_BOUNDARY_TARGETS.visitor.navigationItems).toEqual({
      identifier: "VISITOR_NAV_ITEMS",
      modulePath: "src/shared/ui/AppShell.tsx",
    });
    expect(BUILD_BOUNDARY_TARGETS.analyst.navigationItems).toEqual({
      identifier: "ANALYST_NAV_ITEMS",
      modulePath: "src/app/analyst/navigationItems.ts",
    });
    expect(visitor.layouts).toEqual([
      { path: null, component: "AppShell", navigationItems: "VISITOR_NAV_ITEMS" },
    ]);
    expect(analyst.layouts).toEqual([
      { path: null, component: "AppShell", navigationItems: "ANALYST_NAV_ITEMS" },
    ]);
    expect(analyst.routes.find(({ path: routePath }) => routePath === "/analyst/sources")).toEqual({
      path: "/analyst/sources",
      index: false,
      component: "AnalystSourcesPage",
    });
    expect(analystHomeTexts).toEqual(
      expect.arrayContaining(["ローカル分析のP0画面", "資料版と来歴の管理画面枠です。"]),
    );
  });

  it.each([
    {
      name: "a Visitor Build that bundles the analyst page module",
      mode: "visitor",
      mutate: (artifact: BuildArtifact, analyst: BuildArtifact) => {
        const analystPages = moduleEntry(analyst, "src/app/analyst/pages.tsx");
        return {
          manifest: { ...artifact.manifest, modules: [...artifact.manifest.modules, analystPages] },
          sources: new Map([
            ...artifact.sources,
            ["src/app/analyst/pages.tsx", analyst.sources.get("src/app/analyst/pages.tsx") ?? ""],
          ]),
        };
      },
      expected: [
        "src/app/analyst/pages.tsx: analyst module is bundled into the Visitor Build",
        'contains analyst Home content "ローカル分析のP0画面"',
      ],
    },
    {
      name: "a Visitor Build composed from the analyst route entry",
      mode: "visitor",
      mutate: (_artifact: BuildArtifact, analyst: BuildArtifact) => ({
        manifest: analyst.manifest,
        sources: analyst.sources,
      }),
      expected: [
        'instead of the explicit "src/app/visitor/routes.tsx" entry',
        "src/app/visitor/routes.tsx: selected route entry is not bundled",
        "src/app/analyst/routes.tsx: analyst module is bundled into the Visitor Build",
      ],
    },
    ...(["visitor", "analyst"] as const).map((mode) => ({
      name: `a ${mode} route entry that registers the retired /sources SourcesPage`,
      mode,
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, artifact.target.routeEntryPath, (sourceText) =>
          replaceOnce(
            replaceOnce(sourceText, "NotFoundPage,", "NotFoundPage,\n  SourcesPage,"),
            '<Route path="*"',
            '<Route path="sources" element={<SourcesPage />} />\n        <Route path="*"',
          ),
        ),
      }),
      expected: [
        "registers the retired public route descriptor /sources",
        "references the retired public SourcesPage",
      ],
    })),
    {
      name: "a runtime mode source in a bundled shared module",
      mode: "visitor",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(
          artifact,
          "src/shared/ui/AppShell.tsx",
          (sourceText) =>
            `${sourceText}\nexport const storedMode = window.localStorage.getItem("mode");\n`,
        ),
      }),
      expected: ["src/shared/ui/AppShell.tsx: uses runtime mode source localStorage"],
    },
    {
      name: "Shared Navigation items toggled from the query string",
      mode: "visitor",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, artifact.target.routeEntryPath, (sourceText) =>
          replaceOnce(
            sourceText,
            "navigationItems={VISITOR_NAV_ITEMS}",
            'navigationItems={new URLSearchParams(location.search).get("mode") === "analyst" ? ANALYST_NAV_ITEMS : VISITOR_NAV_ITEMS}',
          ),
        ),
      }),
      expected: [
        "src/app/visitor/routes.tsx: navigationItems is not a bare identifier",
        `src/app/visitor/routes.tsx: ${VISITOR_LAYOUT_VIOLATION}`,
        "uses runtime mode source URLSearchParams",
        "uses runtime mode source location.search",
        'contains the runtime mode token "analyst"',
      ],
    },
    {
      name: "a Visitor route entry whose navigationItems is a runtime-derived local value",
      mode: "visitor",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, artifact.target.routeEntryPath, (sourceText) =>
          replaceOnce(
            sourceText,
            VISITOR_SHELL_IMPORT,
            'import { AppShell } from "../../shared/ui/AppShell.js";\n\nconst VISITOR_NAV_ITEMS = JSON.parse(window.name || "[]");',
          ),
        ),
      }),
      expected: [
        "src/app/visitor/routes.tsx: VISITOR_NAV_ITEMS is not imported from the bundled src/shared/ui/AppShell.tsx",
      ],
    },
    {
      name: "the analyst navigation item put back into the shared AppShell module",
      mode: "visitor",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, SHARED_SHELL_MODULE, (sourceText) =>
          replaceOnce(
            sourceText,
            LAST_PUBLIC_NAV_ITEM,
            `${LAST_PUBLIC_NAV_ITEM}\n  { to: "/analyst/readiness", label: "分析状態", end: true },`,
          ),
        ),
      }),
      expected: [
        `${SHARED_SHELL_MODULE}: contains the analyst route string "/analyst/readiness" in the Visitor Build`,
        `${SHARED_SHELL_MODULE}: contains the analyst navigation label "分析状態" in the Visitor Build`,
      ],
    },
    {
      name: "a Visitor route entry that passes the analyst navigation items",
      mode: "visitor",
      mutate: (artifact: BuildArtifact, analyst: BuildArtifact) => {
        const routeEntryPath = artifact.target.routeEntryPath;
        const sources = new Map(
          withSource(artifact, routeEntryPath, (sourceText) =>
            replaceOnce(
              replaceOnce(
                sourceText,
                VISITOR_SHELL_IMPORT,
                `${VISITOR_SHELL_IMPORT}\nimport { ANALYST_NAV_ITEMS } from "../analyst/navigationItems.js";`,
              ),
              "navigationItems={VISITOR_NAV_ITEMS}",
              "navigationItems={ANALYST_NAV_ITEMS}",
            ),
          ),
        );
        sources.set(
          ANALYST_NAVIGATION_MODULE,
          analyst.sources.get(ANALYST_NAVIGATION_MODULE) ?? "",
        );
        return {
          manifest: {
            ...artifact.manifest,
            modules: [
              ...artifact.manifest.modules.map((entry) =>
                entry.path === routeEntryPath
                  ? { ...entry, importedPaths: [...entry.importedPaths, ANALYST_NAVIGATION_MODULE] }
                  : entry,
              ),
              moduleEntry(analyst, ANALYST_NAVIGATION_MODULE),
            ],
          },
          sources,
        };
      },
      expected: [
        `src/app/visitor/routes.tsx: ${VISITOR_LAYOUT_VIOLATION}`,
        "src/app/visitor/routes.tsx: navigationItems is ANALYST_NAV_ITEMS in the VISITOR build; expected VISITOR_NAV_ITEMS",
        `${ANALYST_NAVIGATION_MODULE}: analyst module is bundled into the Visitor Build`,
        `${ANALYST_NAVIGATION_MODULE}: contains the analyst route string "/analyst/readiness" in the Visitor Build`,
        `${ANALYST_NAVIGATION_MODULE}: contains the analyst navigation label "分析状態" in the Visitor Build`,
      ],
    },
    ...(["visitor", "analyst"] as const).map((mode) => ({
      name: `a ${mode} Shared Navigation item that links the retired /sources destination`,
      mode,
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, SHARED_SHELL_MODULE, (sourceText) =>
          replaceOnce(
            sourceText,
            LAST_PUBLIC_NAV_ITEM,
            `${LAST_PUBLIC_NAV_ITEM}\n  { to: "/sources", label: "出典一覧", end: true },`,
          ),
        ),
      }),
      expected: [`${SHARED_SHELL_MODULE}: contains the retired public destination "/sources"`],
    })),
    {
      name: "an auth dependency in the bundle",
      mode: "analyst",
      mutate: (artifact: BuildArtifact) => ({
        manifest: {
          ...artifact.manifest,
          packages: [...artifact.manifest.packages, "oidc-client-ts"],
        },
      }),
      expected: ["auth dependency oidc-client-ts is part of the web build"],
    },
    {
      name: "an Analyst Build without the /analyst/sources Source Manifest route",
      mode: "analyst",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, artifact.target.routeEntryPath, (sourceText) =>
          replaceOnce(
            sourceText,
            '<Route path="analyst/sources" element={<AnalystSourcesPage />} />',
            "",
          ),
        ),
      }),
      expected: ["/analyst/sources must render AnalystSourcesPage from src/app/analyst/pages.tsx"],
    },
    {
      name: "an evidence-bearing page that dropped its source-evidence field",
      mode: "analyst",
      mutate: (artifact: BuildArtifact) => ({
        sources: withSource(artifact, "src/app/public/pages.tsx", (sourceText) =>
          replaceOnce(sourceText, '"根拠リンク"', '"リンク"'),
        ),
      }),
      expected: ['ComparisonPage lost embedded source-evidence fields ["根拠リンク"]'],
    },
  ] as const)("rejects $name", ({ mode, mutate, expected }) => {
    const artifact = artifacts[mode];
    expect(evaluate(artifact)).toEqual([]);

    const violations = evaluate(artifact, mutate(artifact, artifacts.analyst));
    for (const fragment of expected) {
      expect(violations.some((violation) => violation.includes(fragment))).toBe(true);
    }
  });

  it("matches analyst literals exactly and never reports /analyst/sources as the retired /sources", () => {
    const artifact = artifacts.visitor;
    expect(evaluate(artifact)).toEqual([]);

    const violations = evaluate(artifact, {
      sources: withSource(artifact, SHARED_SHELL_MODULE, (sourceText) =>
        replaceOnce(
          sourceText,
          LAST_PUBLIC_NAV_ITEM,
          [
            LAST_PUBLIC_NAV_ITEM,
            '  { to: "/analyst", label: "分析状態", end: true },',
            '  { to: "/analyst/sources", label: "近似項目", end: true },',
            '  { to: "/analysts", label: "分析状態一覧", end: true },',
          ].join("\n"),
        ),
      ),
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        `${SHARED_SHELL_MODULE}: contains the analyst route string "/analyst" in the Visitor Build`,
        `${SHARED_SHELL_MODULE}: contains the analyst route string "/analyst/sources" in the Visitor Build`,
        `${SHARED_SHELL_MODULE}: contains the analyst navigation label "分析状態" in the Visitor Build`,
      ]),
    );
    // Exact normalized comparison: near misses are not analyst literals, and
    // `/analyst/sources` is never treated as the retired public `/sources`.
    expect(violations.filter((violation) => violation.includes("retired public"))).toEqual([]);
    expect(
      violations.filter(
        (violation) => violation.includes('"/analysts"') || violation.includes('"分析状態一覧"'),
      ),
    ).toEqual([]);
  });

  it("fails closed for a missing marker, a cross-mode marker, a missing output, or a missing module manifest", async () => {
    const cases = [
      {
        mode: "visitor",
        prepare: (root: string) => rm(path.join(root, "dist", WEB_BUILD_MARKER_FILENAME)),
        expected: "the expected build marker is missing or invalid JSON",
      },
      {
        mode: "visitor",
        prepare: (root: string) =>
          cp(
            path.join(root, "dist-analyst", WEB_BUILD_MARKER_FILENAME),
            path.join(root, "dist", WEB_BUILD_MARKER_FILENAME),
          ),
        expected: "the build marker does not exactly match the requested mode and directory",
      },
      {
        mode: "analyst",
        prepare: (root: string) =>
          rm(path.join(root, "dist-analyst"), { recursive: true, force: true }),
        expected: "the expected output directory is unavailable",
      },
      {
        mode: "analyst",
        prepare: (root: string) =>
          writeFile(path.join(root, "dist-analyst", WEB_MODULE_MANIFEST_FILENAME), "{}", "utf8"),
        expected: `the module manifest ${WEB_MODULE_MANIFEST_FILENAME} in "dist-analyst" is missing or invalid`,
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const root = path.join(workspace.path, `fail-closed-${index}`);
      await cp(outputRoot, root, { recursive: true });
      await testCase.prepare(root);

      const inspection = await inspectBuildArtifact({
        webRoot,
        outputRoot: root,
        requestedMode: testCase.mode,
      });
      expect(inspection.violations).toHaveLength(1);
      expect(inspection.violations[0]).toContain(testCase.expected);
    }
  });

  it("keeps the source evidence and provenance contract modules", async () => {
    const contractPaths = [
      "packages/contracts/src/models/sources.ts",
      "packages/contracts/src/models/policy.ts",
    ];
    const sources = new Map<string, string>();
    for (const contractPath of contractPaths) {
      sources.set(contractPath, await readFile(path.join(repositoryRoot, contractPath), "utf8"));
    }

    expect(evaluateSourceContractModules(sources)).toEqual([]);

    const policyPath = "packages/contracts/src/models/policy.ts";
    const withoutCitation = new Map(sources);
    withoutCitation.set(
      policyPath,
      replaceOnce(sources.get(policyPath) ?? "", "export const CitationSchema", "const CitationSchema"),
    );
    expect(evaluateSourceContractModules(withoutCitation)).toEqual([
      `${policyPath}: no longer exports ["CitationSchema"]`,
    ]);
  });

  it("refuses output roots that would overwrite repository build outputs", () => {
    for (const unsafeRoot of [
      repositoryRoot,
      webRoot,
      path.join(webRoot, "dist"),
      path.join(webRoot, "dist-analyst"),
    ]) {
      expect(() => assertIsolatedOutputRoot(unsafeRoot, repositoryRoot)).toThrow(
        "must be outside the repository",
      );
    }
    expect(() => assertIsolatedOutputRoot(workspace.path, repositoryRoot)).not.toThrow();
  });
});
