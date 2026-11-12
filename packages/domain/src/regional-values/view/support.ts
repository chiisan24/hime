import type { FixedTextKey, Level, ThemeId } from "@ehime-vote-navigator/contracts";

import { renderFixedText, type FixedTextValues } from "./fixedText.js";
import type { Entry, JaText, RichText, ThemeRef, ViewBundle } from "./viewTypes.js";

/** Small helpers that the view builders share. None of them decides what to show. */

export function say(bundle: ViewBundle, key: FixedTextKey, values?: FixedTextValues): JaText {
  return renderFixedText(bundle, key, values);
}

export function entryOf(bundle: ViewBundle, code: string, key: FixedTextKey): Entry {
  return { code, text: say(bundle, key) };
}

export function themeName(bundle: ViewBundle, themeId: ThemeId): JaText {
  const theme = bundle.themes.find((candidate) => candidate.themeId === themeId);
  if (theme === undefined) {
    throw new Error(`The theme ${themeId} is not defined in the bundle`);
  }
  return theme.label;
}

export function themeRef(bundle: ViewBundle, themeId: ThemeId): ThemeRef {
  return { themeId, name: themeName(bundle, themeId) };
}

/** The items in the theme definition order of the bundle (not a ranking). */
export function inThemeOrder<T>(
  bundle: ViewBundle,
  items: readonly T[],
  idOf: (item: T) => ThemeId,
): T[] {
  const order = bundle.themes.map((theme) => theme.themeId);
  return [...items].sort((a, b) => order.indexOf(idOf(a)) - order.indexOf(idOf(b)));
}

export function plainText(value: string): RichText {
  return [{ t: "text", v: value }];
}

export function levelKey(level: Level): FixedTextKey {
  switch (level) {
    case 2:
      return "level.importance.+2";
    case 1:
      return "level.importance.+1";
    case 0:
      return "level.importance.0";
    case -1:
      return "level.importance.-1";
    case -2:
      return "level.importance.-2";
  }
}

/** The approved result text of the theme, the axis and the level; empty when the bundle has none. */
export function resultTextOf(
  bundle: ViewBundle,
  themeId: ThemeId,
  axis: "IMPORTANCE" | "TRADEOFF",
  level: Level,
): RichText {
  const found = bundle.resultTexts.find(
    (candidate) => candidate.themeId === themeId && candidate.axis === axis && candidate.level === level,
  );
  return found === undefined ? [] : plainText(found.text);
}