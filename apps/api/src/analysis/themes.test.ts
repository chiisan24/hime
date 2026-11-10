import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { THEMES_RELATIVE_PATH, UNCLASSIFIED_THEME, parseThemeList, readThemeList } from "./themes.js";

function file(themes: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, themes, ...extra });
}

describe("parseThemeList", () => {
  it("accepts a list of unique theme names", () => {
    expect(parseThemeList(file(["教育", "経済", "防災"]))).toEqual({ ok: true, value: ["教育", "経済", "防災"] });
  });

  it("reports an empty list as THEME_LIST_EMPTY", () => {
    expect(parseThemeList(file([]))).toEqual({ ok: false, error: { code: "THEME_LIST_EMPTY" } });
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["a different schema version", JSON.stringify({ schemaVersion: 2, themes: ["教育"] })],
    ["an unknown property", file(["教育"], { extra: true })],
    ["a missing list", JSON.stringify({ schemaVersion: 1 })],
    ["a non-string name", file([1])],
    ["an empty name", file([""])],
    ["a name with surrounding space", file([" 教育"])],
    ["a name with a control character", file(["教\u0007育"])],
    ["a name that is too long", file(["あ".repeat(31)])],
    ["a duplicated name", file(["教育", "教育"])],
    ["a name that duplicates after NFKC normalisation", file(["ＡＢ", "AB"])],
    ["the reserved name", file(["教育", UNCLASSIFIED_THEME])],
  ])("reports %s as THEME_LIST_UNREADABLE", (_label, text) => {
    expect(parseThemeList(text)).toEqual({ ok: false, error: { code: "THEME_LIST_UNREADABLE" } });
  });

  it("does not echo the file text in an error", () => {
    expect(JSON.stringify(parseThemeList(file(["secret-marker", "secret-marker"])))).not.toContain("secret");
  });
});

describe("readThemeList", () => {
  it("reads config/themes.json below the workspace root", async () => {
    let requested = "";

    const result = await readThemeList({
      workspaceRoot: "/workspace",
      readFile: async (path) => {
        requested = path;
        return file(["教育"]);
      },
    });

    expect(result).toEqual({ ok: true, value: ["教育"] });
    expect(requested.replaceAll("\\", "/")).toMatch(/workspace\/config\/themes\.json$/u);
    expect(THEMES_RELATIVE_PATH).toBe("config/themes.json");
  });

  it("stops with THEME_LIST_UNREADABLE when the file is missing", async () => {
    const result = await readThemeList({
      workspaceRoot: "/workspace",
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });

    expect(result).toEqual({ ok: false, error: { code: "THEME_LIST_UNREADABLE" } });
  });

  it("accepts the committed config/themes.json", async () => {
    const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

    expect(await readThemeList({ workspaceRoot })).toEqual({ ok: true, value: ["教育", "経済", "防災"] });
  });
});