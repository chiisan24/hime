import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { AiContentState } from "../../shared/ui/AiContent.js";
import { AppLink } from "../navigation.js";

/*
 * 利用者向けの画面の共通部品。モックデータの画面（pages.tsx）と、過去の選挙の画面
 * （pastElection.tsx）の両方で使う。過去の選挙のデータは、このファイルに書かない
 * （このファイルは公開ビルドに入るため）。
 * 分析者向けの画面とテストは、pages.tsx から書き出された名前で参照する。
 */

/** 分析者向け画面の未接続項目で使う表示（分析者側の表示は変えない） */
const MISSING_VALUE = "no-data（今後の表示領域）";

/**
 * AI要約の表示状態。AIの処理は画面に接続していないため、今は全候補者で同じ「表示しない」状態。
 * 接続後は services/ から候補者ごとの状態を受け取る。
 */
export const AI_SUMMARY_STATE: AiContentState = {
  status: "unavailable",
  reason: "承認済みの情報がないため表示しません",
};

export const PRIMARY_LINK_CLASS =
  "inline-flex min-h-11 min-w-11 w-full items-center justify-center gap-1 rounded-full bg-primary px-5 py-3 font-bold text-white transition hover:bg-primary-dark";
export const SECONDARY_LINK_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-line bg-white px-5 py-2 text-sm font-bold text-ink-soft shadow-[var(--shadow-card)] transition hover:border-primary/50 hover:text-primary";

type PageIntroProps = Readonly<{
  /** 見出しの上の小さなラベル。利用者向けの画面では使わない */
  eyebrow?: string;
  title: string;
  description: string;
}>;

export function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <div className="max-w-3xl">
      {eyebrow === undefined ? null : (
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent-dark">
          {eyebrow}
        </p>
      )}
      <h1
        className={`${eyebrow === undefined ? "" : "mt-2 "}text-2xl font-black leading-tight tracking-tight text-primary-dark sm:text-3xl`}
      >
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base sm:leading-7">
        {description}
      </p>
    </div>
  );
}

type StatusCode = "NOT_READY" | "no-data" | "404";

type StatusPanelProps = Readonly<{
  statusCode: StatusCode;
  title: string;
  children: ReactNode;
  /** 上の余白。並べる側で間隔を決める画面では空文字を渡す */
  className?: string;
}>;

export function StatusPanel({
  statusCode,
  title,
  children,
  className = "mt-8",
}: StatusPanelProps) {
  const headingId = useId();
  const palette =
    statusCode === "404"
      ? "border-red-300 bg-red-50 text-red-900"
      : statusCode === "NOT_READY"
        ? "border-accent/40 bg-accent-light text-accent-dark"
        : "border-line bg-surface text-ink";

  return (
    <section
      aria-labelledby={headingId}
      className={`${className} rounded-[var(--radius-card)] border p-4 sm:p-5 ${palette}`}
      data-terminal-state={statusCode}
    >
      <h2 className="text-base font-bold sm:text-lg" id={headingId}>
        {title}
      </h2>
      <div className="mt-1 text-sm leading-6 sm:text-base sm:leading-7">{children}</div>
      {/* 状態コードは見出しより目立たせない。コードの文字だけを持つ要素はテストと共同開発者の確認で使う */}
      <p className="mt-2 text-xs opacity-80">
        状態コード: <span className="font-bold tracking-wide">{statusCode}</span>
      </p>
    </section>
  );
}

type FutureFieldListProps = Readonly<{
  fields: readonly string[];
  /** 値の表示。省略時は分析者向けの従来表示 */
  value?: string;
}>;

export function FutureFieldList({ fields, value = MISSING_VALUE }: FutureFieldListProps) {
  return (
    <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-white">
      {fields.map((field) => (
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]" key={field}>
          <dt className="font-semibold text-ink">{field}</dt>
          <dd>
            <span className="font-medium text-ink-soft">{value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type FeatureLink = Readonly<{
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}>;

/** リンクの一覧。分析者モードのホームで使う（見た目は変更していない） */
export function FeatureLinkGrid({ links }: Readonly<{ links: readonly FeatureLink[] }>) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2" role="list">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <li key={link.to}>
            <AppLink
              aria-label={link.label}
              className="flex min-h-24 h-full items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white px-5 py-4 shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              to={link.to}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-ink">{link.label}</span>
                <span className="mt-0.5 block text-sm leading-6 text-ink-soft">
                  {link.description}
                </span>
              </span>
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

/** ホームのカードに出す名前と説明 */
export type HomeTileDetail = Readonly<{
  /** カードに出す短い名前。リンク名（VISITOR_HOME_LINKS の label）に含まれる文字にする */
  title: string;
  description: string;
  /** 行き先の中身が資料待ちで準備中か */
  preparing: boolean;
}>;

type CandidatePhotoPlaceholderProps = Readonly<{
  className: string;
}>;

/** 全候補者で同一仕様の写真の仮枠（Req 12.8） */
export function CandidatePhotoPlaceholder({ className }: CandidatePhotoPlaceholderProps) {
  return (
    <div
      aria-label="候補者写真の共通プレースホルダー"
      className={`flex items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface px-2 text-center text-xs font-bold leading-5 text-ink-soft ${className}`}
      role="img"
    >
      候補者写真は未確認です
    </div>
  );
}

type ThemeSelectorProps<Theme extends string> = Readonly<{
  themes: readonly Theme[];
  selected: Theme;
  onSelect: (theme: Theme) => void;
}>;

/** 政策テーマの選択。選んでいるテーマは aria-pressed で伝える。過去の選挙とモックデータの両方の画面で使う */
export function ThemeSelector<Theme extends string>({
  themes,
  selected,
  onSelect,
}: ThemeSelectorProps<Theme>) {
  return (
    <div aria-label="比べるテーマ" className="mt-3 flex flex-wrap gap-2" role="group">
      {themes.map((theme) => {
        const active = theme === selected;
        return (
          <button
            aria-pressed={active}
            className={`inline-flex min-h-11 min-w-11 items-center rounded-full border px-4 text-sm font-bold transition ${
              active
                ? "border-primary bg-primary text-white"
                : "border-line bg-white text-ink-soft hover:border-primary/50 hover:text-primary"
            }`}
            key={theme}
            onClick={() => {
              onSelect(theme);
            }}
            type="button"
          >
            {theme}
          </button>
        );
      })}
    </div>
  );
}
