import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { Plugin, UserConfig } from "vite";

import { createWebViteConfig } from "../../vite.config.js";
import { WEB_BUILD_MARKER_FILENAME } from "./applicationMode.js";

function aliasFor(config: UserConfig, name: string): string | undefined {
  const aliases = config.resolve?.alias;
  if (aliases === undefined || Array.isArray(aliases)) {
    return undefined;
  }

  const replacement = (aliases as Record<string, string>)[name];
  return typeof replacement === "string" ? replacement : undefined;
}

function topLevelPlugins(config: UserConfig): Plugin[] {
  return (config.plugins ?? []).filter(
    (plugin): plugin is Plugin =>
      plugin !== false &&
      plugin !== null &&
      plugin !== undefined &&
      !Array.isArray(plugin) &&
      typeof plugin === "object" &&
      "name" in plugin,
  );
}

function findPlugin(config: UserConfig, name: string): Plugin | undefined {
  return topLevelPlugins(config).find((plugin) => plugin.name === name);
}

function pluginNames(config: UserConfig): string[] {
  return topLevelPlugins(config).map((plugin) => plugin.name);
}

describe("createWebViteConfig", () => {
  const webRoot = path.dirname(fileURLToPath(new URL("../../vite.config.ts", import.meta.url)));

  it.each([undefined, "development", "production", "test", "unknown"])(
    "uses the visitor entry and dist for mode %s",
    (mode) => {
      const config = createWebViteConfig(mode);

      expect(aliasFor(config, "#app-routes")).toBe(
        path.resolve(webRoot, "src/app/visitor/routes.tsx"),
      );
      expect(config.build?.outDir).toBe("dist");
      expect(config.server).toMatchObject({
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
      });
      expect(config.preview).toMatchObject({
        host: "127.0.0.1",
        port: 4173,
        strictPort: true,
      });
      expect(pluginNames(config)).toContain("web-build-marker");
    },
  );

  it("uses the analyst entry and isolated dist-analyst output only for analyst", () => {
    const config = createWebViteConfig("analyst");

    expect(aliasFor(config, "#app-routes")).toBe(
      path.resolve(webRoot, "src/app/analyst/routes.tsx"),
    );
    expect(config.build?.outDir).toBe("dist-analyst");
    expect(config.server).toMatchObject({
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    });
    expect(config.preview).toMatchObject({
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    });
    expect(pluginNames(config)).toContain("web-build-marker");
  });

  it.each([
    {
      mode: undefined,
      applicationMode: "VISITOR",
      outputDirectory: "dist",
    },
    {
      mode: "analyst",
      applicationMode: "ANALYST",
      outputDirectory: "dist-analyst",
    },
  ] as const)(
    "emits the $applicationMode build marker into $outputDirectory",
    ({ mode, applicationMode, outputDirectory }) => {
      const markerPlugin = findPlugin(
        createWebViteConfig(mode),
        "web-build-marker",
      );
      const emittedFiles: unknown[] = [];
      const generateBundle = markerPlugin?.generateBundle;

      expect(typeof generateBundle).toBe("function");
      if (typeof generateBundle !== "function") {
        return;
      }

      generateBundle.call(
        {
          emitFile(file: unknown) {
            emittedFiles.push(file);
            return "web-build-marker-reference";
          },
        } as never,
        {} as never,
        {} as never,
        false,
      );

      expect(emittedFiles).toHaveLength(1);
      expect(emittedFiles[0]).toMatchObject({
        type: "asset",
        fileName: WEB_BUILD_MARKER_FILENAME,
      });

      const emittedMarker = emittedFiles[0] as { source: string };
      expect(JSON.parse(emittedMarker.source)).toEqual({
        schemaVersion: 1,
        applicationMode,
        outputDirectory,
      });
    },
  );
});
