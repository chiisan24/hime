import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { testBuildSettings } from "../../../../../tests/harness/regional-values/buildWorkspace.js";
import { loadBuildConfig, loadMapConfig, loadNeutralityConfig } from "./loadConfig.js";

/**
 * 13.1 の承認前に、共同開発者が `--config-dir` へ渡して検証用バンドルを作るための試験専用設定。
 * ファイルはハーネスの `testBuildSettings()` と同じ内容でなければならず、実際の読込み関数で読める必要がある。
 * リポジトリの本番設定（`config/regional-values/`）ではない。
 */

const TEST_CONFIG_DIR = fileURLToPath(new URL("../../../../../tests/harness/regional-values/test-config/", import.meta.url));

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(TEST_CONFIG_DIR, name), "utf8")) as unknown;
}

describe("test-only settings files for --config-dir", () => {
  it("hold the same values as the settings of the test harness", async () => {
    const settings = testBuildSettings();
    expect(await readJson("map.json")).toEqual(settings.map);
    expect(await readJson("neutrality.json")).toEqual(settings.neutrality);
    expect(await readJson("build.json")).toEqual(settings.build);
  });

  it("are read by the loaders of the build", async () => {
    expect((await loadMapConfig(TEST_CONFIG_DIR)).ok).toBe(true);
    expect((await loadNeutralityConfig(TEST_CONFIG_DIR)).ok).toBe(true);
    expect((await loadBuildConfig(TEST_CONFIG_DIR)).ok).toBe(true);
  });
});
