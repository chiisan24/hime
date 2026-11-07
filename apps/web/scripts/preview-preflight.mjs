import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const WEB_BUILD_MARKER_FILENAME = "web-build-marker.json";

const PREVIEW_TARGETS = Object.freeze({
  visitor: Object.freeze({
    requestedMode: "visitor",
    applicationMode: "VISITOR",
    outputDirectory: "dist",
    rebuildCommand: "npm run build",
  }),
  analyst: Object.freeze({
    requestedMode: "analyst",
    applicationMode: "ANALYST",
    outputDirectory: "dist-analyst",
    rebuildCommand: "npm run build:analyst",
  }),
});

const MARKER_KEYS = Object.freeze([
  "applicationMode",
  "outputDirectory",
  "schemaVersion",
]);

export function resolvePreviewTarget(requestedMode) {
  if (requestedMode === "visitor") {
    return PREVIEW_TARGETS.visitor;
  }
  if (requestedMode === "analyst") {
    return PREVIEW_TARGETS.analyst;
  }

  throw new Error(
    "Preview mode must be exactly \"visitor\" or \"analyst\".",
  );
}

function preflightError(target, reason) {
  return new Error(
    `Preview preflight failed for ${target.applicationMode} build in ` +
      `"${target.outputDirectory}": ${reason} ` +
      `Run "${target.rebuildCommand}" before retrying.`,
  );
}

async function requireOutputDirectory(webRoot, target) {
  try {
    const output = await stat(path.join(webRoot, target.outputDirectory));
    if (output.isDirectory()) {
      return;
    }
  } catch {
    // Emit the same finite, path-safe error for missing and unreadable outputs.
  }

  throw preflightError(target, "the expected output directory is unavailable.");
}

async function readMarker(webRoot, target) {
  const markerPath = path.join(
    webRoot,
    target.outputDirectory,
    WEB_BUILD_MARKER_FILENAME,
  );

  try {
    return JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw preflightError(target, "the expected build marker is missing or invalid JSON.");
  }
}

function markerMatchesTarget(marker, target) {
  if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
    return false;
  }

  const keys = Object.keys(marker).sort();
  if (
    keys.length !== MARKER_KEYS.length ||
    keys.some((key, index) => key !== MARKER_KEYS[index])
  ) {
    return false;
  }

  return (
    marker.schemaVersion === 1 &&
    marker.applicationMode === target.applicationMode &&
    marker.outputDirectory === target.outputDirectory
  );
}

export function createVitePreviewArguments(target) {
  return Object.freeze([
    "preview",
    "--outDir",
    target.outputDirectory,
    "--host",
    "127.0.0.1",
    "--strictPort",
  ]);
}

export async function inspectPreviewBuild(webRoot, requestedMode) {
  const target = resolvePreviewTarget(requestedMode);
  await requireOutputDirectory(webRoot, target);
  const marker = await readMarker(webRoot, target);

  if (!markerMatchesTarget(marker, target)) {
    throw preflightError(
      target,
      "the build marker does not exactly match the requested mode and directory.",
    );
  }

  return target;
}
