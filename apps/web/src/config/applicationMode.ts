export type ApplicationMode = "VISITOR" | "ANALYST";

export type BuildTarget = Readonly<{
  applicationMode: ApplicationMode;
  outputDirectory: "dist" | "dist-analyst";
  routeEntry: "visitor" | "analyst";
}>;

export type WebBuildMarker = Readonly<{
  schemaVersion: 1;
  applicationMode: ApplicationMode;
  outputDirectory: BuildTarget["outputDirectory"];
}>;

export const WEB_BUILD_MARKER_FILENAME = "web-build-marker.json";

const VISITOR_BUILD_TARGET: BuildTarget = Object.freeze({
  applicationMode: "VISITOR",
  outputDirectory: "dist",
  routeEntry: "visitor",
});

const ANALYST_BUILD_TARGET: BuildTarget = Object.freeze({
  applicationMode: "ANALYST",
  outputDirectory: "dist-analyst",
  routeEntry: "analyst",
});

export function resolveApplicationMode(mode: unknown): ApplicationMode {
  return mode === "analyst" ? "ANALYST" : "VISITOR";
}

export function resolveBuildTarget(mode: unknown): BuildTarget {
  return resolveApplicationMode(mode) === "ANALYST"
    ? ANALYST_BUILD_TARGET
    : VISITOR_BUILD_TARGET;
}

export function createWebBuildMarker(target: BuildTarget): WebBuildMarker {
  return {
    schemaVersion: 1,
    applicationMode: target.applicationMode,
    outputDirectory: target.outputDirectory,
  };
}

const WEB_BUILD_MARKER_KEYS = [
  "applicationMode",
  "outputDirectory",
  "schemaVersion",
] as const;

export function parseWebBuildMarkerForTarget(
  value: unknown,
  expectedTarget: BuildTarget,
): WebBuildMarker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== WEB_BUILD_MARKER_KEYS.length ||
    keys.some((key, index) => key !== WEB_BUILD_MARKER_KEYS[index])
  ) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.applicationMode !== expectedTarget.applicationMode ||
    candidate.outputDirectory !== expectedTarget.outputDirectory
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: 1,
    applicationMode: expectedTarget.applicationMode,
    outputDirectory: expectedTarget.outputDirectory,
  });
}
