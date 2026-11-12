import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAP_CONFIG_FILE_NAME, loadMapConfig } from "./loadConfig.js";

const UNREADABLE = { ok: false, error: { code: "CONFIG_UNREADABLE", file: "map.json" } };

const VALID_TEXT = JSON.stringify({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 });

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "regional-values-config-"));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

async function writeMapFile(text: string): Promise<void> {
  await writeFile(join(configDir, MAP_CONFIG_FILE_NAME), text, "utf8");
}

describe("loadMapConfig", () => {
  it("reads map.json from the given directory", async () => {
    await writeMapFile(
      JSON.stringify({ thresholds: { t1: 20, t2: 80 }, guidanceMaxThemes: 2 }),
    );

    expect(await loadMapConfig(configDir)).toEqual({
      ok: true,
      value: { thresholds: { t1: 20, t2: 80 }, guidanceMaxThemes: 2 },
    });
    expect(MAP_CONFIG_FILE_NAME).toBe("map.json");
  });

  it("accepts a valid file that has surrounding whitespace and line breaks", async () => {
    await writeMapFile(`\n  ${VALID_TEXT}\n\n`);

    expect(await loadMapConfig(configDir)).toEqual({
      ok: true,
      value: { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 },
    });
  });

  it("reports CONFIG_UNREADABLE when map.json is missing from an existing directory", async () => {
    expect(await loadMapConfig(configDir)).toEqual(UNREADABLE);
  });

  it("reports CONFIG_UNREADABLE when the directory does not exist", async () => {
    expect(await loadMapConfig(join(configDir, "no-such-directory"))).toEqual(UNREADABLE);
  });

  it("reports CONFIG_UNREADABLE when map.json is a directory", async () => {
    await mkdir(join(configDir, MAP_CONFIG_FILE_NAME));

    expect(await loadMapConfig(configDir)).toEqual(UNREADABLE);
  });

  it.each([
    ["an empty file", ""],
    ["truncated JSON", '{ "thresholds": { "t1": 50, "t2": 150 }, "guidanceMaxThemes": '],
    ["text that is not JSON", "thresholds: t1=50"],
    ["a trailing comma", '{ "thresholds": { "t1": 50, "t2": 150 }, "guidanceMaxThemes": 3, }'],
  ])("reports CONFIG_UNREADABLE for %s", async (_name, text) => {
    await writeMapFile(text);

    expect(await loadMapConfig(configDir)).toEqual(UNREADABLE);
  });

  it.each([
    ["T1 = 0", { thresholds: { t1: 0, t2: 150 }, guidanceMaxThemes: 3 }],
    ["T1 = T2", { thresholds: { t1: 50, t2: 50 }, guidanceMaxThemes: 3 }],
    ["T2 = 201", { thresholds: { t1: 50, t2: 201 }, guidanceMaxThemes: 3 }],
    ["a fractional T1", { thresholds: { t1: 50.5, t2: 150 }, guidanceMaxThemes: 3 }],
    ["a string T1", { thresholds: { t1: "50", t2: 150 }, guidanceMaxThemes: 3 }],
    ["guidanceMaxThemes = 0", { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 0 }],
    ["a missing guidanceMaxThemes", { thresholds: { t1: 50, t2: 150 } }],
    ["a missing thresholds", { guidanceMaxThemes: 3 }],
    ["an extra key", { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3, extra: 1 }],
    ["an array", [{ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 }]],
    ["null", null],
  ])("reports CONFIG_UNREADABLE for a contract violation: %s", async (_name, content) => {
    await writeMapFile(JSON.stringify(content));

    expect(await loadMapConfig(configDir)).toEqual(UNREADABLE);
  });

  it("returns only the code and the base file name, with no value, text or path", async () => {
    const marker = "SECRET-MARKER-7f3a";
    const files: readonly string[] = [
      `{ "thresholds": { "t1": 50, "t2": 150 }, "guidanceMaxThemes": 3, "${marker}": "${marker}"`,
      JSON.stringify({ thresholds: { t1: marker, t2: 150 }, guidanceMaxThemes: 3 }),
      JSON.stringify({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3, note: marker }),
    ];

    for (const text of files) {
      await writeMapFile(text);

      const result = await loadMapConfig(configDir);
      const serialized = JSON.stringify(result);

      expect(result).toEqual(UNREADABLE);
      expect(Object.keys(result.ok ? {} : result.error).sort()).toEqual(["code", "file"]);
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain(configDir);
      expect(serialized).not.toContain("\\");
      expect(serialized).not.toContain("/");
    }

    await rm(join(configDir, MAP_CONFIG_FILE_NAME));
    expect(JSON.stringify(await loadMapConfig(configDir))).not.toContain(configDir);
  });
});

describe("config/regional-values/map.json", () => {
  it("matches the contract and holds the initial values 50, 150 and 3", async () => {
    const repositoryConfigDir = fileURLToPath(
      new URL("../../../../../config/regional-values", import.meta.url),
    );

    expect(await loadMapConfig(repositoryConfigDir)).toEqual({
      ok: true,
      value: { thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 },
    });
  });
});
