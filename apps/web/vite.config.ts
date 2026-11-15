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

/**
 * 過去の選挙（data/electionDataSource.ts の "PAST_REAL"）の表示データと画面（#past-election）の実体。
 * 過去の選挙を含めるのは、分析者モード（analyst）と Vitest（test）だけにする。
 * 利用者向けのビルドと開発サーバー（production・development・その他のモード）は、過去の選挙を
 * 含まない差し替え（PAST_ELECTION が null）を使い、過去の選挙のデータを公開成果物に入れない
 * （scripts/build-boundary.mjs で確認する）。
 * 型の確認（tsc）は、tsconfig の paths で pastElection.tsx を見る。どちらの実体も同じ型で書き出す。
 */
function pastElectionEntryPath(mode: unknown): string {
  const includesPastElection = mode === "analyst" || mode === "test";

  return path.resolve(
    WEB_ROOT,
    "src",
    "app",
    "public",
    includesPastElection ? "pastElection.tsx" : "pastElectionExcluded.ts",
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
        "#past-election": pastElectionEntryPath(mode),
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
