import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MapConfigSchema, type MapConfig } from "@ehime-vote-navigator/contracts";
import type { Result } from "@ehime-vote-navigator/domain";

/** The map settings file, below the settings directory (`config/regional-values/`). */
export const MAP_CONFIG_FILE_NAME = "map.json";

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
