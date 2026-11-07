import type { Plugin } from "vite";

export type BuildBoundaryMode = "visitor" | "analyst";

export type EvidenceComponentContract = Readonly<{
  modulePath: string;
  component: string;
  fields: readonly string[];
}>;

/** The immutable Shared Navigation items a mode's route entry must pass to AppShell. */
export type NavigationItemsContract = Readonly<{
  identifier: "VISITOR_NAV_ITEMS" | "ANALYST_NAV_ITEMS";
  modulePath: string;
}>;

export type BuildBoundaryTarget = Readonly<{
  requestedMode: BuildBoundaryMode;
  viteMode: "production" | "analyst";
  applicationMode: "VISITOR" | "ANALYST";
  outputDirectory: "dist" | "dist-analyst";
  routeEntryPath: string;
  routePaths: readonly string[];
  navigationItems: NavigationItemsContract;
  evidenceComponents: readonly EvidenceComponentContract[];
}>;

export type NormalizedModuleId =
  | Readonly<{ kind: "virtual" }>
  | Readonly<{ kind: "package"; name: string }>
  | Readonly<{ kind: "project"; path: string }>;

export type WebModuleManifestEntry = Readonly<{
  path: string;
  sha256: string;
  importedPaths: readonly string[];
  renderedExports: readonly string[];
}>;

export type WebModuleManifest = Readonly<{
  schemaVersion: 1;
  modules: readonly WebModuleManifestEntry[];
  packages: readonly string[];
}>;

export type RouteDescriptor = Readonly<{
  path: string | null;
  index: boolean;
  component: string | null;
}>;

export type LayoutDescriptor = Readonly<{
  path: string | null;
  component: string | null;
  /** Bare identifier passed as `navigationItems`; `null` for any other expression. */
  navigationItems: string | null;
}>;

export type BuildArtifactInspection = Readonly<{
  target: BuildBoundaryTarget;
  moduleCount: number;
  packages: readonly string[];
  violations: readonly string[];
}>;

export type BuildBoundaryReport = Readonly<{
  ok: boolean;
  artifacts: readonly BuildArtifactInspection[];
  sourceContractViolations: readonly string[];
}>;

export const WEB_MODULE_MANIFEST_FILENAME: "web-module-manifest.json";

export const BUILD_BOUNDARY_TARGETS: Readonly<
  Record<BuildBoundaryMode, BuildBoundaryTarget>
>;

export function resolveBuildBoundaryTarget(requestedMode: unknown): BuildBoundaryTarget;

export function normalizeModuleId(id: unknown, webRoot: string): NormalizedModuleId;

export function createModuleManifestPlugin(webRoot: string): Plugin;

export function parseWebModuleManifest(value: unknown): WebModuleManifest | null;

export function extractRouteDescriptors(
  fileName: string,
  sourceText: string,
): Readonly<{
  layouts: readonly LayoutDescriptor[];
  routes: readonly RouteDescriptor[];
}>;

export function extractAnalystHomeTexts(
  fileName: string,
  sourceText: string,
): readonly string[];

export function evaluateBuildBoundary(
  input: Readonly<{
    target: BuildBoundaryTarget;
    manifest: WebModuleManifest;
    sources: ReadonlyMap<string, string>;
    analystHomeTexts: readonly string[];
    webDependencies: readonly string[];
  }>,
): readonly string[];

export function evaluateSourceContractModules(
  sources: ReadonlyMap<string, string>,
): readonly string[];

export function assertIsolatedOutputRoot(
  outputRoot: string,
  repositoryRoot: string,
): void;

export function inspectBuildArtifact(
  input: Readonly<{
    webRoot: string;
    outputRoot: string;
    requestedMode: unknown;
  }>,
): Promise<BuildArtifactInspection>;

export function buildBoundaryArtifacts(
  input: Readonly<{ webRoot: string; outputRoot: string }>,
): Promise<void>;

export function runBuildBoundaryCheck(
  input: Readonly<{ webRoot: string; outputRoot?: string }>,
): Promise<BuildBoundaryReport>;

export function formatBuildBoundaryReport(
  report: BuildBoundaryReport,
): readonly string[];
