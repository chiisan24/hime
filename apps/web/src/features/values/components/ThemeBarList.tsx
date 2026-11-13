import { THEME_ICONS } from "../themeIcons.js";
import type { LegacyTheme as ValuesTheme, LegacyThemeScore as ThemeScore } from "./legacyTypes.js";

type ThemeBarListProps = Readonly<{
  /** 表示順（固定）のテーマ */
  themes: readonly ValuesTheme[];
  scores: readonly ThemeScore[];
}>;

/** 棒の代わりに出す文。0として描かない（仕様 V-03 の状態） */
export function describeMissingScore(score: ThemeScore | undefined): string | null {
  if (score === undefined) {
    return "表示できません（結果がありません）";
  }
  switch (score.status) {
    case "scored":
      return null;
    case "skipped":
      return "回答なし";
    case "unsure":
      return "判断に迷った";
    case "unavailable":
      return `表示できません（${score.reason}）`;
  }
}

/**
 * 【非表示】正式な設計（design.md「図の形式の決定」）で横棒グラフは採用されなかったため、
 * 結果画面では使っていない。削除せず残している。代わりに LevelBands（段階の帯）を使う。
 *
 * テーマ別の重要度の横棒の一覧（C-07）。スマホでは価値観マップの主な表示。
 * 1行1テーマで、数値は文字でも出す。棒は飾り（aria-hidden）で、読み上げは文字で伝える。
 * 棒の色はテーマで変えず、1色で描く。
 */
export function ThemeBarList({ themes, scores }: ThemeBarListProps) {
  return (
    <ul className="grid gap-3" role="list">
      {themes.map((theme) => {
        const Icon = THEME_ICONS[theme.themeId];
        const score = scores.find((item) => item.themeId === theme.themeId);
        const missing = describeMissingScore(score);
        const scored = score?.status === "scored" ? score : null;
        const ratio =
          scored === null || scored.maxScore <= 0
            ? 0
            : Math.min(1, Math.max(0, scored.score / scored.maxScore));

        return (
          <li
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
            key={theme.themeId}
          >
            <span className="flex min-w-0 items-center gap-2 font-bold text-ink">
              <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
              <span className="min-w-0">{theme.name}</span>
            </span>
            <span className="text-right text-sm font-bold text-primary-dark">
              {scored === null ? (
                <span className="text-ink-soft">{missing}</span>
              ) : (
                <>
                  <span aria-hidden="true">
                    {scored.score}/{scored.maxScore}
                  </span>
                  <span className="sr-only">
                    重要度 {scored.maxScore}段階中{scored.score}
                  </span>
                </>
              )}
            </span>
            <span
              aria-hidden="true"
              className={`col-span-2 block h-3 overflow-hidden rounded-full ${
                scored === null ? "border border-dashed border-ink-soft/60 bg-white" : "bg-surface-2"
              }`}
            >
              {scored === null ? null : (
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${ratio * 100}%` }}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
