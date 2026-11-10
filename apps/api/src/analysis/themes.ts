import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "@ehime-vote-navigator/domain";
import { z } from "zod";

export const THEMES_RELATIVE_PATH = "config/themes.json";

/** Reserved for passages that match no theme; it cannot be a theme name. */
export const UNCLASSIFIED_THEME = "未分類";

const MAX_THEME_LENGTH = 30;
const MAX_THEME_COUNT = 50;

const ThemeNameSchema = z
  .string()
  .min(1)
  .max(MAX_THEME_LENGTH)
  .refine((value) => value === value.trim(), "Must not start or end with whitespace")
  .refine((value) => !/\p{Cc}/u.test(value), "Must not contain control characters");

const ThemeListFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    themes: z.array(ThemeNameSchema).max(MAX_THEME_COUNT),
  })
  .strict()
  .superRefine((file, context) => {
    const seen = new Set<string>();
    for (const [index, theme] of file.themes.entries()) {
      const normalized = theme.normalize("NFKC");
      if (normalized === UNCLASSIFIED_THEME) {
        context.addIssue({
          code: "custom",
          message: "The reserved name cannot be a theme",
          path: ["themes", index],
        });
      }
      if (seen.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "Theme names must be unique",
          path: ["themes", index],
        });
      }
      seen.add(normalized);
    }
  });

export type ThemeListError = Readonly<{
  code: "THEME_LIST_EMPTY" | "THEME_LIST_UNREADABLE";
}>;

export type ThemeListOptions = Readonly<{
  /** Test seam; the real filesystem is the default. */
  readFile?: (path: string) => Promise<string>;
  workspaceRoot: string;
}>;

const UNREADABLE: Result<never, ThemeListError> = {
  ok: false,
  error: Object.freeze({ code: "THEME_LIST_UNREADABLE" as const }),
};
const EMPTY: Result<never, ThemeListError> = {
  ok: false,
  error: Object.freeze({ code: "THEME_LIST_EMPTY" as const }),
};

/** Validates the text of `config/themes.json`. Error details never include the text. */
export function parseThemeList(text: string): Result<readonly string[], ThemeListError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return UNREADABLE;
  }

  const parsed = ThemeListFileSchema.safeParse(data);
  if (!parsed.success) {
    return UNREADABLE;
  }
  if (parsed.data.themes.length === 0) {
    return EMPTY;
  }
  return { ok: true, value: Object.freeze([...parsed.data.themes]) };
}

/** Reads `config/themes.json`. A missing or invalid file is a stop, not an empty list. */
export async function readThemeList(
  options: ThemeListOptions,
): Promise<Result<readonly string[], ThemeListError>> {
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));
  let text: string;
  try {
    text = await read(join(options.workspaceRoot, ...THEMES_RELATIVE_PATH.split("/")));
  } catch {
    return UNREADABLE;
  }
  return parseThemeList(text);
}