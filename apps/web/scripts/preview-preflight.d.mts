export type PreviewTarget = Readonly<{
  requestedMode: "visitor" | "analyst";
  applicationMode: "VISITOR" | "ANALYST";
  outputDirectory: "dist" | "dist-analyst";
  rebuildCommand: "npm run build" | "npm run build:analyst";
}>;

export const WEB_BUILD_MARKER_FILENAME: "web-build-marker.json";

export function resolvePreviewTarget(requestedMode: unknown): PreviewTarget;

export function createVitePreviewArguments(
  target: PreviewTarget,
): readonly string[];

export function inspectPreviewBuild(
  webRoot: string,
  requestedMode: unknown,
): Promise<PreviewTarget>;
