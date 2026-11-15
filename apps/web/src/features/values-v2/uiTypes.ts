import type { Level, ThemeId, TradeoffCode } from "../values/contractTypes.js";

/*
 * 地域課題ジレンマ診断（v2）の画面専用の仮の型。
 *
 * 【正式な契約ではない】共同開発者の v2 の契約（DilemmaQuestion、ValueAxisDef、ValuesProfile、
 * generateValuesProfile）はまだ実装されていない。正式な契約ができたら、この型を置き換える。
 * 名前の先頭に Ui を付け、正式な契約の名前と混同しないようにしている。
 * 回答値は、既存の契約の優先条件の5段階（TradeoffCode）をそのまま使う。
 */

/** 価値観の暫定6軸（定義と計算方法は未確定） */
export type UiValueAxisId =
  | "FAIRNESS"
  | "STABILITY"
  | "FUTURE"
  | "OPPORTUNITY"
  | "COMMUNITY"
  | "INFRASTRUCTURE";

export type UiValueAxis = Readonly<{
  axisId: UiValueAxisId;
  label: string;
  /** 画面に出す説明文の案（未承認） */
  definition: string;
}>;

export type UiDilemmaOption = Readonly<{
  text: string;
  /** この考え方に割り当てた暫定の価値観軸。画面には出さず、レーダーの接続に備えて持つだけ */
  valueAxisId: UiValueAxisId;
}>;

export type UiDilemmaQuestion = Readonly<{
  questionId: string;
  themeId: ThemeId;
  themeLabel: string;
  /** 具体的な状況。数値や実在の事実を含めない */
  situation: string;
  optionA: UiDilemmaOption;
  optionB: UiDilemmaOption;
  /** デモ用の仮の質問なら true */
  isDemo: boolean;
}>;

/**
 * 1問への回答。5段階のどれか、または「スキップ」。
 * スキップは中立（BALANCED）や0点として扱わない。未回答の質問はキーを持たない。
 */
export type DilemmaAnswer = TradeoffCode | "SKIPPED";

export type DilemmaAnswers = Readonly<Record<string, DilemmaAnswer>>;

/** 価値観レーダーに渡す、軸ごとの表示用の値（計算処理とは未接続） */
export type UiAxisDisplayValue =
  | Readonly<{ axisId: UiValueAxisId; state: "DETERMINED"; level: Level; usableQuestions: number }>
  | Readonly<{ axisId: UiValueAxisId; state: "UNDETERMINED" }>;
