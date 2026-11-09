# Requirements Document

## Introduction

`bedrock-api-key-access`は、「えひめ投票ナビ」のAmazon Bedrock接続を、大学管理者が発行したBedrock専用APIキーによる方式へ整理する小規模な後続featureである。管理者の「Amazon BedrockのAPIキーでClaudeを呼ぶ：AIアシスタント向けの説明（EhimeVoteNavigator）」を優先する。AWS CLI、AWS IAM Identity CenterのSSO、AWSプロファイル、IAM、およびSTSによる接続方式は使用しない。

構成は現行のReact + Vite + Expressを維持する。管理者の説明書はNext.jsのRoute Handlerを例にしているが、本プロジェクトではBedrockを呼ぶ処理をサーバー側の`apps/api`（Express）だけに置く。`apps/web`（React画面）には、キーも、AWS設定も、Bedrockを呼ぶ処理も含めない。

本featureは、既存の`.kiro/specs/ehime-vote-navigator/`のRequirement 14のうち、AWSプロフィール、cross-Region inferenceの扱い、モデルIDの必須数、認証情報の取得元、認証情報の出力禁止対象、認証情報欠落時の案内、およびAWS読み取り診断に関する基準（14.1、14.3、14.5、14.6、14.9、14.11、14.12、14.15、14.16）と、Task 7.1、7.3、7.4、7.5の対応する記述だけを上書きする。リージョンの既定値とリージョン変更の承認（14.2、14.17から14.21）、モデルIDを環境設定から取得すること（14.4）、ローカルバックエンドだけからBedrockを呼ぶこと（14.7、14.8）、認証情報の手入力欄を設けないこと（14.10）、権限拒否とモデル利用不可の表示（14.13、14.14）、およびRequirement 15の実行履歴と有限再試行の上限は維持する。自動再試行を行わない本featureの方針は、Requirement 15.8の上限（初回1回と自動再試行2回の合計3回以下）の範囲内である。既存の`ehime-vote-navigator`文書は編集しない。

**未決事項（Open decisions）**

- `jp.`で始まるモデルIDは、東京と大阪のリージョンで処理される推論プロファイルである。管理者の説明書が指定するモデルIDのため許可するが、14.3の趣旨（日本国外へ送らないこと）に合致するかを管理者へ確認する。
- Vercelの環境変数へキーを登録するか。現在の公開サイトは静的画面でサーバー処理を持たないため、公開された呼出し窓口を作る場合に限り必要になる。管理者に確認するまで、公開されたBedrock窓口を作成しない。
- 未使用の`@aws-sdk/*`依存の削除時期。テスト用のネットワークガード（`tests/harness/network-guard.ts`）が参照しているため、削除する場合はガードの更新と同時に行う。
- Bedrock APIキーの期限は管理者の説明書によれば2027年3月31日である。期限前の更新手順を管理者に確認する。

## Glossary

- **Bedrock APIキー**: 管理者が発行したBedrock専用の認証用文字列。環境変数`AWS_BEARER_TOKEN_BEDROCK`に設定する。
- **Bearer認証**: HTTPの`Authorization: Bearer <キー>`ヘッダーによる認証。
- **許可モデル**: `jp.anthropic.claude-haiku-5-5`と`jp.anthropic.claude-opus-5-5`の2件。
- **日本国内処理**: `jp.`で始まる推論プロファイルにより、日本国内のAWSリージョン（東京と大阪）で処理すること。
- **サーバー側**: `apps/api`のNode.jsプロセス。ブラウザーで動くコードを含まない。
- **Bedrockクライアント**: `apps/api/src/aws/bedrockConverse.ts`のConverse API呼出し部。
- **設定検査**: Bedrock要求の前に環境設定を検査し、準備状態（ready）または未準備（not ready）を返す処理。
- **準備状態**: 設定検査がreadyを返した状態。
- **スモーク要求**: `RUN_BEDROCK_SMOKE=1`を明示したときだけ送る、短い入力1件の疎通確認。
- **`.env.local`**: Git管理外の、開発者のPC上の設定ファイル。

## Requirements

### Requirement 1: APIキーによる認証とサーバー側限定

**User Story:** 共同開発者として、管理者が発行したBedrock APIキーだけでBedrockを呼びたい。AWS CLIのログインやプロファイルの設定なしに、キーを漏えいさせずに使うためである。

#### Acceptance Criteria

1. THE Bedrockクライアント SHALL Bedrock Converse APIの要求に、`Authorization: Bearer <Bedrock APIキー>`ヘッダーでBedrock APIキーを付与する
2. THE Bedrockクライアント SHALL Bedrock APIキーを要求の直前にサーバー側のプロセス環境変数`AWS_BEARER_TOKEN_BEDROCK`から読み取り、読み取った値を設定オブジェクト、戻り値、およびエラーに保持しない
3. THE えひめ投票ナビ SHALL AWS CLI、AWS IAM Identity CenterのSSO、AWSプロファイル、IAM、およびSTSの認証情報を読み取らず、これらの設定を要求しない
4. THE えひめ投票ナビ SHALL Bedrock APIキー、AWS設定、およびBedrockを呼び出す処理を、`apps/web`のソースコードとビルド成果物に含めない
5. IF Bedrock APIキーの前後の空白を除いた値が空である、または可視ASCII以外の文字を含む, THEN THE 設定検査 SHALL 準備状態をnot readyにし、Bedrock要求を0回にして、不足する設定名`AWS_BEARER_TOKEN_BEDROCK`だけを表示する
6. THE えひめ投票ナビ SHALL 開発者のPCでBedrock APIキーを保存する場所をGit管理外の`.env.local`だけと案内し、`.env.example`にはキーの設定名だけを空の値で置く

### Requirement 2: 許可モデルと日本国内処理

**User Story:** 共同開発者として、管理者が許可した2つのモデルだけを日本国内の処理で使いたい。許可外のモデルへの要求と、日本国外への送信を防ぐためである。

#### Acceptance Criteria

1. THE Bedrockクライアント SHALL モデルIDが`jp.anthropic.claude-haiku-5-5`または`jp.anthropic.claude-opus-5-5`のいずれかと完全一致する要求だけを送信する
2. IF 要求のモデルIDが許可モデルのいずれとも完全一致しない, THEN THE Bedrockクライアント SHALL Bedrock要求を0回にして`MODEL_NOT_ALLOWED`を返す
3. THE 設定検査 SHALL `jp.`以外の推論プロファイル形式（`us.`、`us-gov.`、`eu.`、`apac.`、`au.`、`ca.`、`in.`、`global.`で始まるモデルID、および推論プロファイルのARN）のモデルIDを拒否する
4. THE Bedrockクライアント SHALL 要求先をAWSリージョン`ap-northeast-1`のBedrock Runtimeに固定する
5. IF 設定のAWSリージョンが`ap-northeast-1`ではない, THEN THE 設定検査 SHALL 準備状態をnot readyにし、Bedrock要求を0回にする。リージョン変更の承認は`ehime-vote-navigator`のRequirement 14.17から14.21に従う
6. THE えひめ投票ナビ SHALL 既定のモデルに`jp.anthropic.claude-haiku-5-5`を使い、`jp.anthropic.claude-opus-5-5`を、共同開発者が精度の比較を目的として明示した実行だけに使う

### Requirement 3: 最小構成のモデル設定

**User Story:** 共同開発者として、管理者が許可した2モデルだけで動く最小構成にしたい。埋め込みモデルが無い状態でも、生成と検証を実行できるようにするためである。

#### Acceptance Criteria

1. THE 設定検査 SHALL 生成と意味判定の各モデルID（`BEDROCK_GENERATION_MODEL_ID`と`BEDROCK_VERIFICATION_MODEL_ID`）を必須とし、両方が許可形式で存在し、かつBedrock APIキーが存在するときだけ準備状態をreadyにする
2. THE 設定検査 SHALL 埋め込みモデルID（`BEDROCK_EMBEDDING_MODEL_ID`）を任意とし、未設定または空の場合は埋め込み機能を利用不可として扱い、準備状態には影響させない
3. IF 埋め込みモデルIDが設定されていて形式が不正である, THEN THE 設定検査 SHALL 準備状態をnot readyにし、設定名と違反コードだけを表示する
4. IF 必須の設定が1件以上欠けている, THEN THE 設定検査 SHALL Bedrock要求を0回にし、欠けた設定名（`AWS_BEARER_TOKEN_BEDROCK`を含む）だけを表示して、設定値を表示しない
5. WHERE AWSプロファイルの環境設定が存在しない, THE 設定検査 SHALL プロファイルを要求せず、準備状態に影響させない

### Requirement 4: 診断をSTSに依存させない

**User Story:** 共同開発者として、AWSの権限が無くても接続を確認したい。STSやBedrock管理APIが使えないAPIキー方式でも、動作を確かめるためである。

#### Acceptance Criteria

1. THE えひめ投票ナビ SHALL 接続確認を、設定の準備状態の検査と、`RUN_BEDROCK_SMOKE=1`を明示したときだけ送る1回のスモーク要求の2つに限定する
2. THE えひめ投票ナビ SHALL STSの`GetCallerIdentity`、およびBedrock管理APIの一覧・取得操作を、接続確認に使用しない
3. IF 環境変数`RUN_BEDROCK_SMOKE`が`1`ではない, THEN THE スモーク SHALL Bedrock要求を0回にして実行を拒否する
4. WHEN スモーク要求が成功したとき, THE スモーク SHALL 成否、HTTPステータス、モデルID、所要時間、および応答の冒頭100文字以内だけを表示する
5. IF スモーク要求が失敗した, THEN THE スモーク SHALL 固定の失敗コードとHTTPステータスだけを表示し、終了コード1で終了する
6. THE 通常のテスト SHALL fake `fetch`だけを使い、ネットワークとBedrockを呼び出さない

### Requirement 5: 秘密情報とログの保護

**User Story:** 共同開発者として、APIキーと資料の内容を漏らしたくない。公開リポジトリ、ログ、ブラウザー、チャットへ秘密情報が出ることを防ぐためである。

#### Acceptance Criteria

1. THE えひめ投票ナビ SHALL Bedrock APIキーを、Git追跡ファイル、`.env.local`以外のアプリケーション設定ファイル、ブラウザー保存領域、URL、画面、ログ、実行履歴、およびチャット出力へ出力しない
2. THE Bedrockクライアント SHALL リクエスト本文、プロンプト、および応答本文をログへ出力しない
3. IF Bedrock要求が失敗した, THEN THE Bedrockクライアント SHALL 固定の失敗コードとHTTPステータスだけを返し、キー、リクエスト本文、および応答本文を含めない
4. THE `.env.example` SHALL Bedrock APIキーの設定名を空の値で持ち、AWSアクセスキー、シークレットキー、およびセッショントークンの設定名を持たない
5. THE テスト SHALL 資格情報のダミー値に、AWSアクセスキーの形式（`AKIA`または`ASIA`で始まる文字列）に似た値や実際のキーの断片を使わない
6. THE えひめ投票ナビ SHALL `.env.local`、生PDF、および生成物をGitの追跡対象にしない

### Requirement 6: 利用制限

**User Story:** 共同開発者として、料金とAPIキーの不正利用を防ぎたい。管理者が定めた入力・出力・回数の上限を、サーバー側で必ず守るためである。

#### Acceptance Criteria

1. THE Bedrockクライアント SHALL 1要求あたりのシステム指示と本文の合計を20000文字以下に制限し、超える要求を切り詰めずに失敗として扱ってBedrockへ送信しない
2. THE Bedrockクライアント SHALL 最大出力トークン数を2000にする
3. THE Bedrockクライアント SHALL 同時に処理する要求を1件以下にし、処理中の要求がある間の追加要求を待機させず`BUSY`として失敗させる
4. THE Bedrockクライアント SHALL 呼出し回数を直近60秒の窓で10回以下にし、超える要求を`RATE_LIMITED`として失敗させる
5. THE Bedrockクライアント SHALL 応答待ち時間を30秒以下にし、自動再試行を行わない
6. THE えひめ投票ナビ SHALL インターネットから呼び出せるBedrock呼出しの窓口を作成せず、公開サイトに配置する成果物にBedrockを呼び出す処理を含めない
7. IF 将来、公開された呼出し窓口を作る, THEN THE えひめ投票ナビ SHALL サーバー側で本要件の文字数、出力長、および回数の上限を適用し、作成前に管理者へ相談する