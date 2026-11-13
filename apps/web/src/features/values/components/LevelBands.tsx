import type { Level, ThemeId } from "../contractTypes.js";
import { LEVEL_ORDER } from "../labels.js";
import { THEME_ICONS } from "../themeIcons.js";

export type LevelBandTheme = Readonly<{
  themeId: ThemeId;
  name: string;
  /** そのテーマの結果解説（固定文言）。ない場合は null */
  explanation: string | null;
}>;

export type LevelBandGroup = Readonly<{
  level: Level;
  /** 段階の文言（「とても大切」など） */
  heading: string;
  themes: readonly LevelBandTheme[];
}>;

type LevelBandsProps = Readonly<{
  /** +2 から −2 の5段階。受け取った順に並べる（並べ替えない） */
  groups: readonly LevelBandGroup[];
  emptyText: string;
}>;

/** 5つの区切りのうち、その段階の位置だけを塗る（長さで量を表さない。飾り） */
function LevelPosition({ level }: Readonly<{ level: Level }>) {
  const position = LEVEL_ORDER.indexOf(level);
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {LEVEL_ORDER.map((candidate, index) => (
        <span
          className={`block h-3 w-3 rounded-sm border ${
            index === position ? "border-primary bg-primary" : "border-line bg-white"
          }`}
          key={candidate}
        />
      ))}
    </span>
  );
}

/**
 * 大切さの段階ごとのグループ（段階の帯）。design.md「図の形式の決定」の「段階の帯」にあたる。
 * - 5段階の見出しを +2 から −2 の順にすべて出し、テーマがない段階も「該当なし」を出す（Req 5.2）。
 * - 順位の数値・順番・ランクを出さない。同じ段階の中はテーマ定義順（受け取った順）。
 * - 帯の位置の印は飾りで、意味は見出しの文字で伝える（色だけに頼らない。Req 11.4）。
 * - 図と文字の一覧を1つにまとめ、同じ内容を二重に読み上げないようにしている（Req 11.5）。
 */
export function LevelBands({ groups, emptyText }: LevelBandsProps) {
  return (
    <ul className="grid gap-2" role="list">
      {groups.map((group) => (
        <li
          className={`rounded-[var(--radius-btn)] border px-3 py-2.5 ${
            group.themes.length > 0 ? "border-primary/40 bg-primary-light/50" : "border-line bg-white"
          }`}
          key={group.level}
        >
          <div className="flex items-center gap-2">
            <LevelPosition level={group.level} />
            <h3 className="text-sm font-bold text-primary-dark">{group.heading}</h3>
          </div>
          {group.themes.length === 0 ? (
            <p className="mt-1 text-xs leading-5 text-ink-soft">{emptyText}</p>
          ) : (
            <ul className="mt-2 grid gap-2" role="list">
              {group.themes.map((theme) => {
                const Icon = THEME_ICONS[theme.themeId];
                return (
                  <li key={theme.themeId}>
                    <p className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-bold text-ink">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                      {theme.name}
                    </p>
                    {theme.explanation === null ? null : (
                      <p className="mt-1 text-sm leading-6 text-ink">{theme.explanation}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
