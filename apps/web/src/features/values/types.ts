import type { Level, MapError, ThemeId, ValuesMap } from "./contractTypes.js";

/*
 * 価値観診断の画面だけで使う型。
 *
 * 質問・回答・価値観マップの型は、正式な契約（contractTypes.ts）をそのまま使い、ここでは定義しない。
 * ここにあるのは、契約がまだ用意されていない部分の「仮の型」だけ。
 * 契約側（tasks.md 5.1〜5.3 の content.ts・固定文言、5.5〜5.8 の表示モデル）ができたら置き換える。
 */

/** 価値観マップの2つの軸。大切さと優先条件は別々に決まり、互いに影響しない */
export type ValuesAxis = "IMPORTANCE" | "TRADEOFF";

/**
 * 結果解説（テーマ × 軸 × 段階の固定文言）。仮の型。
 * 正式には contracts の `ResultText`（tasks.md 5.1）で受け取る。
 */
export type ResultTextEntry = Readonly<{
  themeId: ThemeId;
  axis: ValuesAxis;
  level: Level;
  text: string;
}>;

/** 活かし方の案内の場面（Req 6.6 の順：選挙 → 移住や就職 → 日常生活） */
export type GuidanceScene = "ELECTION" | "MOVE_OR_JOB" | "DAILY_LIFE";

/**
 * 活かし方の問い（テーマ × 場面。文末が「か」の1文）。仮の型。
 * 正式には contracts の `GuidanceQuestion`（tasks.md 5.1）で受け取る。
 */
export type GuidanceEntry = Readonly<{
  themeId: ThemeId;
  scene: GuidanceScene;
  text: string;
}>;

/**
 * 用語の説明。仮の型。
 * 正式には課題カードの用語解説（`IssueCard`、tasks.md 5.2）と、
 * 表示モデルの注釈つきの文（`RichText`、tasks.md 5.4）で受け取る。
 */
export type GlossaryEntry = Readonly<{
  term: string;
  description: string;
}>;

/**
 * 結果画面に渡す結果。
 * - DEMO_FIXED: デモ用の固定結果。利用者の回答から計算していない（generateValuesMap が未実装のため）。
 * - ERROR: マップ生成のエラー（Req 5.14）。generateValuesMap の接続後に使う。
 * 接続後は `GENERATED`（回答から生成した結果）を足し、services/valuesData.ts の getValuesResult だけを替える。
 */
export type ValuesResultSource =
  | Readonly<{
      origin: "DEMO_FIXED";
      map: ValuesMap;
      /**
       * 活かし方の案内の対象テーマ（テーマ定義順）。選び方（Req 6.6）は表示モデル側の仕事のため、
       * 画面では選ばず、デモの固定値として受け取る。
       */
      guidanceThemeIds: readonly ThemeId[];
    }>
  | Readonly<{ origin: "ERROR"; error: MapError }>;
