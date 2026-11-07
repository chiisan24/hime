import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createVitePreviewArguments,
  inspectPreviewBuild,
  resolvePreviewTarget,
  WEB_BUILD_MARKER_FILENAME,
} from "../../scripts/preview-preflight.mjs";

const temporaryRoots: string[] = [];

async function createTemporaryWebRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ehime-preview-"));
  temporaryRoots.push(root);
  return root;
}

async function writeMarker(
  webRoot: string,
  outputDirectory: "dist" | "dist-analyst",
  marker: unknown,
): Promise<void> {
  const outputPath = path.join(webRoot, outputDirectory);
  await mkdir(outputPath, { recursive: true });
  await writeFile(
    path.join(outputPath, WEB_BUILD_MARKER_FILENAME),
    JSON.stringify(marker),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true })),
  );
});

describe("preview build preflight", () => {
  it.each([
    {
      requestedMode: "visitor",
      applicationMode: "VISITOR",
      outputDirectory: "dist",
      rebuildCommand: "npm run build",
    },
    {
      requestedMode: "analyst",
      applicationMode: "ANALYST",
      outputDirectory: "dist-analyst",
      rebuildCommand: "npm run build:analyst",
    },
  ] as const)(
    "accepts a strict $applicationMode marker in $outputDirectory",
    async ({ requestedMode, applicationMode, outputDirectory, rebuildCommand }) => {
      const webRoot = await createTemporaryWebRoot();
      await writeMarker(webRoot, outputDirectory, {
        schemaVersion: 1,
        applicationMode,
        outputDirectory,
      });

      await expect(inspectPreviewBuild(webRoot, requestedMode)).resolves.toEqual({
        requestedMode,
        applicationMode,
        outputDirectory,
        rebuildCommand,
      });
    },
  );

  it.each([
    { requestedMode: "visitor", outputDirectory: "dist" },
    { requestedMode: "analyst", outputDirectory: "dist-analyst" },
  ] as const)(
    "launches $requestedMode preview only against $outputDirectory on loopback",
    ({ requestedMode, outputDirectory }) => {
      expect(
        createVitePreviewArguments(resolvePreviewTarget(requestedMode)),
      ).toEqual([
        "preview",
        "--outDir",
        outputDirectory,
        "--host",
        "127.0.0.1",
        "--strictPort",
      ]);
    },
  );

  it("rejects unknown preview modes", () => {
    expect(() => resolvePreviewTarget(undefined)).toThrow(
      'Preview mode must be exactly "visitor" or "analyst".',
    );
    expect(() => resolvePreviewTarget("production")).toThrow(
      'Preview mode must be exactly "visitor" or "analyst".',
    );
  });

  it("fails when the expected directory is absent without using the opposite build", async () => {
    const webRoot = await createTemporaryWebRoot();
    await writeMarker(webRoot, "dist-analyst", {
      schemaVersion: 1,
      applicationMode: "ANALYST",
      outputDirectory: "dist-analyst",
    });

    await expect(inspectPreviewBuild(webRoot, "visitor")).rejects.toThrow(
      'VISITOR build in "dist": the expected output directory is unavailable. Run "npm run build"',
    );
  });

  it.each([
    {
      name: "missing marker",
      prepare: async (webRoot: string) => {
        await mkdir(path.join(webRoot, "dist"));
      },
      expected: "the expected build marker is missing or invalid JSON",
    },
    {
      name: "invalid JSON",
      prepare: async (webRoot: string) => {
        const outputPath = path.join(webRoot, "dist");
        await mkdir(outputPath);
        await writeFile(
          path.join(outputPath, WEB_BUILD_MARKER_FILENAME),
          "not-json",
          "utf8",
        );
      },
      expected: "the expected build marker is missing or invalid JSON",
    },
    {
      name: "opposite mode marker",
      prepare: async (webRoot: string) => {
        await writeMarker(webRoot, "dist", {
          schemaVersion: 1,
          applicationMode: "ANALYST",
          outputDirectory: "dist-analyst",
        });
      },
      expected: "the build marker does not exactly match",
    },
    {
      name: "unknown marker field",
      prepare: async (webRoot: string) => {
        await writeMarker(webRoot, "dist", {
          schemaVersion: 1,
          applicationMode: "VISITOR",
          outputDirectory: "dist",
          unknown: true,
        });
      },
      expected: "the build marker does not exactly match",
    },
  ])("rejects a $name", async ({ prepare, expected }) => {
    const webRoot = await createTemporaryWebRoot();
    await prepare(webRoot);

    await expect(inspectPreviewBuild(webRoot, "visitor")).rejects.toThrow(
      expected,
    );
  });
});
