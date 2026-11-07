import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin, UserConfig } from "vite";

import {
  createWebBuildMarker,
  resolveBuildTarget,
  WEB_BUILD_MARKER_FILENAME,
} from "./src/config/applicationMode.js";
import type { BuildTarget } from "./src/config/applicationMode.js";

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url));

function routeEntryPath(target: BuildTarget): string {
  return path.resolve(
    WEB_ROOT,
    "src",
    "app",
    target.routeEntry,
    "routes.tsx",
  );
}

function buildMarkerPlugin(target: BuildTarget): Plugin {
  return {
    name: "web-build-marker",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: WEB_BUILD_MARKER_FILENAME,
        source: `${JSON.stringify(createWebBuildMarker(target), null, 2)}\n`,
      });
    },
  };
}

export function createWebViteConfig(mode: unknown): UserConfig {
  const target = resolveBuildTarget(mode);

  return {
    plugins: [react(), tailwindcss(), buildMarkerPlugin(target)],
    resolve: {
      alias: {
        "#app-routes": routeEntryPath(target),
      },
    },
    build: {
      outDir: target.outputDirectory,
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
}

export default defineConfig(({ mode }) => createWebViteConfig(mode));
