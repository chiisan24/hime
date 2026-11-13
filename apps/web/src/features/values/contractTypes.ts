/*
 * regional-values-map の正式な契約（packages/contracts/src/models/regional/）の型だけを受け取る窓口。
 *
 * - 型を定義し直さず、契約の型をそのまま使う。
 * - `import type` だけにする。verbatimModuleSyntax により実行時の import は残らず、
 *   契約パッケージの "." 入口（サーバー用の設定モジュールなどを含む）はブラウザ用の束に入らない。
 * - 契約の値（THEME_IDS、Zod のスキーマなど）は、ブラウザ向けの入口（`./regional`）が
 *   できるまで画面からは読み込まない（design.md「【要確認11】の決定」、tasks.md 10.1）。
 * - 入口ができたら、下の import 元を "@ehime-vote-navigator/contracts/regional" に替えるだけでよい。
 */
export type {
  AnswerValue,
  Answers,
  AxisState,
  DiagnosticSet,
  ImportanceCode,
  Level,
  MapError,
  NonOpinionCode,
  PriorityState,
  Question,
  QuestionBank,
  SetKind,
  ThemeDef,
  ThemeId,
  TradeoffCode,
  ValuesMap,
} from "@ehime-vote-navigator/contracts";
