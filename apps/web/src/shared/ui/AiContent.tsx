import { AlertCircle, ExternalLink } from "lucide-react";

import { Badge } from "./Badge.js";

/*
 * AI要約・AI回答の表示用部品（見た目だけ）。
 * AI処理・API呼び出しは持たない。呼び出し側が状態を決めて渡す。
 * 下の型は API 仕様が決まるまでの仮のインターフェース。接続時に services/ でこの形へ変換する。
 */

/** AIの内容に付ける出典 */
export type AiSource = Readonly<{
  label: string;
  /** 原文・公式資料のURL。ない場合はリンクにしない */
  url?: string;
}>;

/** AI要約・AI回答の表示状態 */
export type AiContentState =
  /** AIに接続していない、または表示してよい承認済みの情報がない */
  | Readonly<{ status: "unavailable"; reason: string }>
  /** 取得中（呼び出し側が実際に取得しているときだけ使う。見せかけには使わない） */
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; text: string; sources: readonly AiSource[] }>;

type AiContentProps = Readonly<{
  state: AiContentState;
  /** 枠の上に出す種別名（「AI要約」「AI回答」など） */
  kindLabel?: string;
}>;

export function AiSourceList({ sources }: Readonly<{ sources: readonly AiSource[] }>) {
  if (sources.length === 0) {
    return <p className="text-xs text-red-800">出典がありません。この内容は確認できません。</p>;
  }
  return (
    <div>
      <p className="text-xs font-bold text-ink-soft">出典</p>
      <ul className="mt-1 space-y-1" role="list">
        {sources.map((source) => (
          <li className="text-sm" key={`${source.label}-${source.url ?? ""}`}>
            {source.url === undefined ? (
              <span className="text-ink">{source.label}</span>
            ) : (
              <a
                className="inline-flex min-h-11 items-center gap-1 font-bold text-primary underline-offset-2 hover:underline"
                href={source.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {source.label}
                <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">（新しいタブで開きます）</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * AI要約・AI回答の枠。状態ごとに表示を変える。
 * AI の内容は薄い青の枠に入れ、原文・出典（白い枠）と見分けられるようにする。
 */
export function AiContent({ state, kindLabel = "AI要約" }: AiContentProps) {
  return (
    <div
      aria-busy={state.status === "loading" ? true : undefined}
      className="rounded-xl bg-primary-light p-4"
    >
      <Badge tone="primary">{kindLabel}</Badge>
      <div className="mt-2 text-sm leading-6">
        {state.status === "unavailable" ? (
          <p className="text-ink-soft">{state.reason}</p>
        ) : null}
        {state.status === "loading" ? (
          <p className="text-ink-soft" role="status">
            読み込み中です…
          </p>
        ) : null}
        {state.status === "error" ? (
          <p className="flex gap-1.5 text-red-800" role="alert">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{state.message}</span>
          </p>
        ) : null}
        {state.status === "ready" ? (
          <div className="flex flex-col gap-3">
            <p className="whitespace-pre-wrap text-ink">{state.text}</p>
            <p className="text-xs text-ink-soft">
              AIが作った文章です。正確な内容は出典の原文で確認してください。
            </p>
            <AiSourceList sources={state.sources} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
