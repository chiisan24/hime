# 例外境界に関する仕様変更点の記録（3.6・4.3 向け）

状態: 反映済み（requirements.md の Req 5.19、design.md の画面状態と遷移・エラー処理・Property 56、tasks.md の 3.6・4.3・4.4・4.5・5.1・5.6）。

## 決定した方針（ユーザー承認済み）

- 通常のデータ起因のエラー（`INVALID_CONFIG`、`UNKNOWN_QUESTION`、`INVALID_ANSWER`、`NO_OPINION_ANSWERS`）は、これまでどおり `Result<ValuesMap, MapError>` で返す。`MapError` は4種のままで、符号を足さない。
- `roundRatio`・`levelOf`（3.1）の `RangeError`、3.6 の出力検証の失敗による例外は「実装の不具合」である。検証済みの入力では起きない（3.1 のテストで、`levelOf` が受理するしきい値の組が `MapConfigSchema` と一致することを確認）。
- 想定外の例外は UI へ直接届けない。`diagnosticReducer` が捕捉し、安全なエラー状態へ遷移する。

## 後続タスクで必要になる仕様変更点

| 対象 | 変更 |
| --- | --- |
| design.md の遷移表とエラー表（「結果エラーの画面表示」、約1930〜1940行） | 終端のエラー状態を1つ追加する（仮称 `UNEXPECTED_ERROR`）。表示する固定文言のキー（仮 `error.UNEXPECTED`）。この状態での操作（再読み込みのみか、`RESTART` を許すか）は【要判断】。`INVALID_CONFIG` は `OPEN_EDIT` と `RESTART` を受け付けない扱いなので、それに合わせる案が第一候補 |
| requirements.md（結果を表示できない場合の要件、Req 5.14 付近） | 「想定外の内部エラー」の場合の表示と操作を追加する【要確認】 |
| tasks.md 3.6 | 方針は変更なし。例外のメッセージに回答内容や質問IDを含めない、を追記する |
| tasks.md 4.3 | `generateValuesMap` と `buildResultViewModel` の呼出しを `try/catch` で囲み、例外のとき状態を上記のエラー状態へ遷移させる。状態に例外オブジェクト、メッセージ、スタックを持たせず、固定のコードだけを持たせる。テスト: 例外を投げる関数を注入した遷移、入力した状態を変更しないこと、回答内容が状態や出力に残らないこと |
| 固定文言（`fixedTextKeys.ts`） | `error.UNEXPECTED` のキーと文面を追加し、固定文言の承認の流れ（Req 5.12、5.18）に載せる |
| 純関数性 | 乱数、時刻、通信を使わない方針は維持する。例外のログ出力は `diagnosticReducer` の外（呼出し側）で行う |

## 3.1 で確認したこと

- 先例: `packages/domain/src/analysis/passages.ts` は、呼出し側の前提違反に `RangeError` を使う。データ依存の失敗は `Result`（`packages/domain/src/result.ts`）で返す。
- 3.1 の2関数は `map/index.ts` と domain の公開 export に出していない（3.6 の担当）。