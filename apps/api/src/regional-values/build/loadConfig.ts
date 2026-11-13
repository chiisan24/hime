import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BuildConfigSchema,
  MapConfigSchema,
  NeutralityConfigSchema,
  type BuildConfig,
  type MapConfig,
  type NeutralityConfig,
} from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

/** The map settings file, below the settings directory (`config/regional-values/`). */
export const MAP_CONFIG_FILE_NAME = "map.json";
export const NEUTRALITY_CONFIG_FILE_NAME = "neutrality.json";
export const BUILD_CONFIG_FILE_NAME = "build.json";

/**
 * A settings file that could not be used: missing, not readable, not JSON, or
 * not matching its contract. The error carries the base file name and nothing
 * else: no directory, no value, no part of the file text.
 */
export type ConfigUnreadable = Readonly<{
  code: "CONFIG_UNREADABLE";
  file: string;
}>;

function unreadable(file: string): Result<never, ConfigUnreadable> {
  return { ok: false, error: Object.freeze({ code: "CONFIG_UNREADABLE" as const, file }) };
}

/**
 * Reads and validates `map.json` in `configDir`. Fail closed: any read, JSON
 * or contract problem yields `CONFIG_UNREADABLE`, never a default value.
 */
export async function loadMapConfig(
  configDir: string,
): Promise<Result<MapConfig, ConfigUnreadable>> {
  let text: string;
  try {
    text = await readFile(join(configDir, MAP_CONFIG_FILE_NAME), "utf8");
  } catch {
    return unreadable(MAP_CONFIG_FILE_NAME);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return unreadable(MAP_CONFIG_FILE_NAME);
  }

  const parsed = MapConfigSchema.safeParse(data);
  if (!parsed.success) {
    return unreadable(MAP_CONFIG_FILE_NAME);
  }

  return { ok: true, value: parsed.data };
}

/** Reads a JSON settings file and returns only its stable base name on any failure. */
async function readConfigJson(configDir: string, file: string): Promise<Result<unknown, ConfigUnreadable>> {
  let text: string;
  try {
    text = await readFile(join(configDir, file), "utf8");
  } catch {
    return unreadable(file);
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return unreadable(file);
  }
}

function categoryWords(config: NeutralityConfig): string[] {
  return Object.values(config.wordCategories).flat();
}

/**
 * Reads `neutrality.json`, including the cross-list rule: bannedWords and
 * loadedWords each contain every word in the three required categories.
 */
export async function loadNeutralityConfig(configDir: string): Promise<Result<NeutralityConfig, ConfigUnreadable>> {
  const raw = await readConfigJson(configDir, NEUTRALITY_CONFIG_FILE_NAME);
  if (!raw.ok) {
    return raw;
  }
  const parsed = NeutralityConfigSchema.safeParse(raw.value);
  if (!parsed.success) {
    return unreadable(NEUTRALITY_CONFIG_FILE_NAME);
  }
  const categories = categoryWords(parsed.data);
  if (categories.some((word) => !parsed.data.bannedWords.includes(word) || !parsed.data.loadedWords.includes(word))) {
    return unreadable(NEUTRALITY_CONFIG_FILE_NAME);
  }
  return { ok: true, value: parsed.data };
}

/** Reads the strict build settings. The actual repository file remains approval-gated (13.1). */
export async function loadBuildConfig(configDir: string): Promise<Result<BuildConfig, ConfigUnreadable>> {
  const raw = await readConfigJson(configDir, BUILD_CONFIG_FILE_NAME);
  if (!raw.ok) {
    return raw;
  }
  const parsed = BuildConfigSchema.safeParse(raw.value);
  return parsed.success ? { ok: true, value: parsed.data } : unreadable(BUILD_CONFIG_FILE_NAME);
}