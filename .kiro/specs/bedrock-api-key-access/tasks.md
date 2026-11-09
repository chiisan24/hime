# Implementation Plan: Bedrock API Key Access

## Overview

実装済みの設定検査、Converseクライアント、スモークコマンドを管理者のAPIキー方式に合わせて整理し、READMEを更新した。残りの作業は、Port分離、fake adapter契約テスト、未使用依存の整理、およびproperty testの拡張である。既存の`ehime-vote-navigator`の文書は編集しない。

## Tasks

- [x] 1. 設定検査をAPIキー方式へ合わせる
  - [x] 1.1 `jp.`の許可、APIキーの必須化、埋め込みの任意化を実装する
    - `packages/contracts/src/aws-config.ts`、`apps/api/src/config/aws.ts`、`aws.test.ts`、`aws.property.test.ts`。
    - _Requirements: 1.5, 2.3, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 1.2 `.env.example`と例ファイルの検証を更新する
    - `.env.example`、`apps/api/src/config/environment-example.ts`と`.test.ts`。キーは空の値で、AWSアクセスキー類の設定名を持たない。
    - _Requirements: 1.6, 5.4_

- [x] 2. サーバー側のConverseクライアントを実装する
  - [x] 2.1 許可モデル、入力・出力・同時実行・回数・時間の上限、再試行なしを実装する
    - `apps/api/src/aws/bedrockConverse.ts`、`bedrockConverse.test.ts`、`bedrockConverse.property.test.ts`（fake `fetch`のみ）。
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.4, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 3. スモークコマンドを実装する
  - [x] 3.1 `RUN_BEDROCK_SMOKE=1`のときだけ1回送るスモークを実装する
    - `apps/api/src/aws/bedrockSmoke.ts`、`smoke.ts`、`bedrockSmoke.test.ts`、`bedrock:smoke` script。
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 4. READMEを更新する
  - [x] 4.1 APIキーを`.env.local`にだけ置く手順と、スモークの実行方法を記載する
    - `README.md`。AWS CLI、SSO、AWSプロファイル、IAM、STSを使わないことを明記する。
    - _Requirements: 1.3, 1.6, 5.1_

- [ ] 5. 残りの作業
  - [ ] 5.1 GenerationPortとSemanticVerificationPortを分離する
    - `packages/domain/src/ports/bedrock.ts`と`apps/api/src/aws/adapters/`。`ehime-vote-navigator`のTask 7.4の残り。
    - _Requirements: 2.1, 6.1_
  - [ ] 5.2 fake adapterの契約テストと、同時実行・回数・秘密情報のproperty testを追加する
    - `apps/api/src/aws/`。fast-checkで100回以上実行する。
    - **Property 2: 許可外の要求は送信されない**
    - **Property 3: 秘密情報が出力されない**
    - **Validates: Requirements 1.2, 5.1, 5.2, 5.3, 6.3, 6.4**
  - [ ] 5.3 未使用の`@aws-sdk/*`依存を整理する（承認後に実施）
    - `apps/api/package.json`と`tests/harness/network-guard.ts`。ガードの更新と同時に行う。
    - _Requirements: 1.3_
  - [ ] 5.4 管理者への確認事項を解決する
    - `jp.`プロファイルの日本国内処理、Vercelでの扱い、キーの期限前の更新手順。
    - _Requirements: 2.3, 6.6, 6.7_

## Notes

- 本spec作成時点で、ネットワークとBedrockを呼ぶ通常テストはない。実際の呼出しは`npm run bedrock:smoke`の明示実行だけである。
- 公開された呼出し窓口は作成しない。作る場合は、サーバー側で上限をかけ、事前に管理者へ相談する。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["5.1", "5.3", "5.4"] },
    { "id": 5, "tasks": ["5.2"] }
  ]
}
```