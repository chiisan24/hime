import type { ThemeId } from "../contractTypes.js";

/*
 * 非表示にしている旧部品（ThemeBarList、ValuesRadarChart）だけが使う型。
 *
 * design.md「図の形式の決定」で、レーダーチャートと横棒グラフは
 * 「長さや面積がスコアの大きさと順位を連想させる」として採用されなかった。
 * 正式な結果画面では使わないが、削除せず残している（再検討する場合に備える）。
 * 正式な契約の ValuesMap には「5点満点の点数」がないため、この型は契約と対応しない。
 */

export type LegacyTheme = Readonly<{
  themeId: ThemeId;
  name: string;
  shortName: string;
}>;

export type LegacyThemeScore =
  | Readonly<{ themeId: ThemeId; status: "scored"; score: number; maxScore: number }>
  | Readonly<{ themeId: ThemeId; status: "skipped" }>
  | Readonly<{ themeId: ThemeId; status: "unsure" }>
  | Readonly<{ themeId: ThemeId; status: "unavailable"; reason: string }>;
