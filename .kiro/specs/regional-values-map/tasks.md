# Implementation Plan: Regional Values Map

## Overview

`requirements.md`と`design.md`（どちらも承認済み）に基づき、愛媛県の地域課題を通じて利用者の価値観を整理する「価値観マップ」を、既存実装への追加だけで実装する。既存のZod契約（`primitives.ts`、`sources.ts`の`Locator`・`UsageReview`）、`Result`、`canonicalJson`/`sha256Hex`、`validateDataBoundary`、`createSafeLogger`、`atomicReplaceFile`、`Pacer`、Bedrock Converseクライアント（fakeのみ）を再利用し、新しいコードは新しいファイルに置く。

### データ方針（公式データ優先）

利用者が承認した方針（D1〜D6）。`requirements.md`と`design.md`に反映済みで、各タスクは次に従う。

- 地域課題の情報源は、愛媛県の公式オープンデータ（愛媛県オープンデータカタログ）を優先する。データセットごとに利用条件（個別注記を含む）を確認し、公式資料の数値と出典を人が検証する。未検証の数値は公開用に使わない。
- `REAL`、`FIXTURE`、`REAL_PREFERRED`の設計は維持する。実データと架空データを1つのバンドルに混在させない。
- 架空データ（6.x）は基本方針ではなく、実データの利用条件や検証が完了しない場合の代替データと、テスト基盤として扱う。削除しない。`REAL_PREFERRED`の切替先でもある。
- AIの役割は、検証済み（`VERIFIED`）の事実項目を根拠にした課題候補の提案（D1）、要約、背景と用語の解説、中立な質問文の下書き、質問の偏りの点検とする。課題候補は事実と区別し、`PENDING`で保存し、順位・推奨の項目を持たせず、人が確認するまで公開バンドルに含めない。AIの提案を公式機関の見解として扱わない。AIは、利用者の価値観の判定にも、回答からの政治思想の推測にも使わない。
- 外部AIへの送信可否はAIが関与する出典に要求し、公開と加工に関する利用条件の確認はすべての実データに要求する（D2）。`ResultText`は`dataKind`を持つ（D3）。最初の取り込み形式はCSVとする（D4）。実データ用の質問バンク・結果解説・固定文言は、複製して再承認する（D5）。クイック版の3テーマは、公式データの棚卸しの結果で確定する（D6）。

### 分類の定義

すべてのsub-taskの見出しの先頭に分類を付ける。

- 【A】現在の仕様で実装可能。design.mdで確定しており、【要確認N】の解決、Open Decisionsの決定、要件の更新、新しい依存の承認を待たない。
- 【B】未決事項（design.mdの【要確認N】、Open Decisions、要件の更新、新しい依存の承認）の解決後に実装する。本文の「待つ条件」に、該当する【要確認N】または未決事項の名前と、必要な承認・要件更新を書く。待つ条件が解決するまで着手しない。
- 【C】共同開発者が担当するUI実装（`apps/web`配下）。本featureの実装者は着手しない。共同開発者の承認（承認者名、承認日）をタスクに記録してから、別タスクとして共同開発者が実施する（Req 10.9）。各【C】タスクに「共同開発者が使うAPI」（分類Aのタスク番号）を明記する。

### ユーザー指定の実装条件

- `apps/web`は変更しない。分類Cのタスクは共同開発者が担当し、本featureの実装者は着手しない。
- 既存の2022年関連のコードとテストを変更しない。OCR関連コード（`apps/api/src/ocr/`）を削除しない。既存のテストへ`skip`・`todo`を足さず、アサーションを削除も変更もしない（Req 10.7）。
- 既存の契約ファイルの変更は、新規exportの追加行だけにする（Req 10.8）。具体的には`packages/contracts/src/models/index.ts`と`packages/domain/src/index.ts`への各1行。`package.json`への追記は`scripts`と`exports`の追加行だけとする。
- 新しい依存パッケージを追加する場合は、事前に利用者の承認を求める（分類Bの「待つ条件」に「依存の追加承認」を書く）。
- 実データの取得・公開処理は行わない。Bedrockは呼び出さない（AI下書きはfakeだけ）。
- Git操作（commit、push、merge、reset、rebase）はしない。読み取りだけの`git status`・`git diff`は、変更範囲の確認に使ってよい。
- 通常のテストはfakeだけを使い、ネットワークとBedrockを呼ばず、watchなしで終了する。development serverとpreview serverは起動しない。
- 各タスクは焦点テストだけを実行する。全体の`npm.cmd test`は最初のタスク（1.1）と最終確認（12.2）で実行する。
- Windows PowerShellのコマンドは`npx.cmd`と`npm.cmd`を使う。長い出力はファイルへ書き（例: `dist/regional-values-records/`配下）、件数だけ報告する。認証キーは読まず、ログと会話へ出さない。
- property testはfast-check 4.10.2で`numRuns: 100`以上とし、各テストの先頭に`// Feature: regional-values-map, Property N: <title>`と`// **Validates: Requirements ...**`のコメントを付ける。期待値は実装から生成せず、手計算した固定値で持つ。

### 各タスクの冒頭規則

1. 着手前に、そのタスクの`_Requirements_`が指す`requirements.md`の基準と、`design.md`の該当節を読む。
2. 仕様の解釈が複数ある場合、実装者が勝手に決めず、解釈の候補を報告して停止する。
3. `requirements.md`と`design.md`の矛盾・不足が実装対象に関係する場合は、実装の前に整理して報告する（`requirements.md`と`design.md`は、利用者が承認した更新を除いて変更しない）。作成時点で把握している点は`## Notes`の「tasks.md作成時の解釈（要レビュー）」に載せている。
4. 分類Bは待つ条件の解決後、分類Cは共同開発者の承認後に着手する。
5. 1つのsub-taskが終わるごとに停止し、実行した焦点テストの件数（実行数、成功数、失敗数）と変更したファイルを報告する。続けて次のsub-taskへ進んでよいかは利用者が決める。
6. 実行順は`## Task Dependency Graph`のwaveに従う（番号順とは限らない）。

### ビルドの順序（このリポジトリ固有の注意）

`packages/domain`と`apps/api`のテストは、`@ehime-vote-navigator/contracts`と`@ehime-vote-navigator/domain`をパッケージ名で読み込み、`dist`を参照する（`dist`は`.gitignore`済み）。契約（`packages/contracts`）を変更したタスクは、焦点テストの前に`npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行する。`packages/domain`を変更し、`apps/api`のテストがそれを使うタスクは、`npm.cmd run build --workspace @ehime-vote-navigator/domain`も実行する。

### 実装の優先順位

1. 契約の土台（テーマID、回答値、質問、診断セット、回答、マップの入出力。Zod strict）。最初のsub-task 1.1は最も小さく自己完結し、1.1だけを実行して停止できる。
2. 設定ファイルのschemaと読込み（しきい値、`config/regional-values/map.json`）。
3. `generateValuesMap`（丸め関数、軸の状態、段階ごとのグループ、判断に迷ったテーマ、回答しなかったテーマ、未出題、最優先テーマの5状態、4つの状態の区別、件数、通知）と、金テストベクタ・属性テスト。
4. `diagnosticReducer`（状態の型、イベント、遷移）。
5. 固定文言の型、`presentQuestion`、`buildResultViewModel`。
6. 架空データ（クイック版の暫定3テーマ）と使用例のテスト。
7. バンドルの契約と検証（`verifyBundleText`、`loadBundle`、`contentHash`）。
8. 質問バンクの検査、課題カードと事実項目の検査（架空データ分）。
9. `dataMode`の判定と`FIXTURE`のビルド。
10. ブラウザ向けの入口（subpath export）と共同開発者向けの連携ガイド。
11. AI下書き工程（fakeだけ。要件更新を要する部分は分類B）。
12. 分類Aの完了確認 → 分類B（決定待ち）→ 分類C（共同開発者）。

## Tasks

- [x] 1. 契約の土台（質問・診断セット・回答・マップの入出力）を追加する
  - [x] 1.1 【A】テーマID・回答値・質問形式・質問・診断セットの基本契約（`core.ts`の前半）と、変更前のテスト基準を記録する
    - **手順0（他のファイルを変更する前に実行する）**: `npm.cmd test -- --reporter=json --outputFile=dist/regional-values-records/vitest-before.raw.json`を1回だけ実行し、完了まで待つ（オプション名がvitestの版で異なる場合は`npx.cmd vitest run --help`で確認する）。JSONの`numTotalTests`、`numPassedTests`、`numFailedTests`、`numPendingTests`（スキップ）、`numTodoTests`とテストファイル数を読み取り、`.kiro/specs/regional-values-map/records/test-baseline-before.json`（実行コマンド、取得日時、各件数、失敗したテストの完全名の一覧）へ書く。成功したテストの完全名は昇順で`test-baseline-before.passed.txt`へ書く（Req 10.11の(b)を12.2で判定するため）。生のJSONは`dist`配下に残し、報告は件数だけにする。
    - **手順1**: `packages/contracts/src/models/regional/core.ts`を新規作成する。`primitives.ts`だけをimportし、`sources.ts`・`content.ts`をimportしない。定義するもの: `THEME_IDS`（6テーマ。配列順が既定のテーマ定義順）、`QUESTION_KINDS`、`SET_KINDS`、`LevelSchema`（+2〜−2）、回答値の対応表（`IMPORTANCE_VALUE`、`TRADEOFF_VALUE`、`NON_OPINION`）、`ThemeDefSchema`、`QuestionApprovalSchema`、`QuestionSchema`（`IMPORTANCE`・`TRADEOFF`・`PRIORITY_PICK`の判別共用体）、`DiagnosticSetSchema`、`QuestionBankSchema`。すべてstrictにする。
    - refine: `approval.forVersion`が質問の版と一致、`approvedAt`が偏り確認の実施日時以後、`swapDirections`は`TRADEOFF`以外でtrue不可（【要確認17】は設計で解消済み）、解説は空白と改行を除き50〜200文字で各文60文字以内、質問IDの一意、6テーマが1回ずつ、全質問の`dataKind`が質問バンクと一致、診断セット種別の重複なし。診断セットの構成条件（`QUICK`は3テーマなど）は契約では見ず、8.4の検査で見る。
    - `regional/index.ts`を新規作成して`core.js`をexportし、`packages/contracts/src/models/index.ts`へ`export * from "./regional/index.js";`の**1行だけ**追加する。追加前に`packages/contracts/src`で同名のexportがないことを検索で確認し、衝突があれば何も変更せず報告して停止する。
    - 単体テスト`core.test.ts`: 正常例（3形式を1件ずつ）と拒否例（余剰項目、必須項目の欠落、重みが0と4、質問文61文字、解説49文字と201文字、`PRIORITY_PICK`のテーマが6件でない・重複、`forVersion`の不一致、承認日時が実施日時より前、`IMPORTANCE`で`swapDirections`がtrue、質問IDの重複、診断セット種別の重複）。
    - 手順の最後に`npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行して型を確認する。`git diff`（読み取りだけ）で、既存ファイルの差分が`models/index.ts`の1行だけであることを確認する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/core.test.ts packages/contracts/src/contracts.test.ts packages/contracts/src/index.test.ts`（既存の2ファイルは変更せず成功すること）
    - **このsub-taskで停止して報告する**（基準の件数、追加したファイル、既存ファイルの差分）。
    - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.2, 3.10, 10.8, 10.11_

  - [x] 1.2 【A】回答とマップの入出力の契約（`core.ts`の後半）を追加する
    - `core.ts`の末尾へ追記する: `PickAnswer`（`{ pick: ThemeId[] }`）、`AnswerValue`（意見回答10コード、`UNSURE`・`DECLINE`・`UNANSWERED`、`PickAnswer`）、`Answers`、`MapQuestionSchema`（`questionId`、`kind`、`themeId`（`PRIORITY_PICK`はnull）、`weight`）、`MapInputSchema`（`setKind`、`bank: { themeOrder, questions, sets }`、`answers`、`thresholds`）、`AxisStateSchema`（`DETERMINED`・`UNDETERMINED`・`NOT_ASKED`）、`PriorityStateSchema`（`NOT_ASKED`・`SELECTED`・`UNSURE`・`DECLINE`・`UNANSWERED`の5状態）、`ValuesMapSchema`、`MapErrorSchema`。
    - `ValuesMapSchema`はstrictで、`themes`は6件、`importanceGroups`は+2〜−2の5件、`score`は−200〜200の整数、`UNDETERMINED`は理由1件以上、`SELECTED`は1〜2件。候補者・政党・一致度・推奨・順位・思想・性格を表すキーを持たない。`MapInputSchema`は課題カード・事実項目・出典・質問文のキーを持たない（Req 7.22）。
    - 単体テスト`coreMap.test.ts`: 正常例と拒否例（`score`が201、`level`が3、`UNDETERMINED`の理由が空、`SELECTED`が0件と3件、`importanceGroups`が4件、`rank`・`candidateId`・`matchRate`・`recommendation`・`ideology`を足した出力、`cards`・`facts`・`sources`を足した入力）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/coreMap.test.ts packages/contracts/src/models/regional/core.test.ts`
    - _Requirements: 1.5, 1.6, 4.1, 4.3, 4.9, 4.14, 4.17, 5.11, 7.22_

- [x] 2. 設定ファイル（しきい値）のschemaと読込みを追加する
  - [x] 2.1 【A】`MapConfigSchema`と`config/regional-values/map.json`、読込み関数を追加する
    - `packages/contracts/src/models/regional/config.ts`に`MapConfigSchema`をstrictで定義する: `thresholds.t1`・`thresholds.t2`は`0 < t1 < t2 ≤ 200`の整数、`guidanceMaxThemes`は1以上の整数。`regional/index.ts`へ`config.js`のexportを1行追加する。
    - `config/regional-values/map.json`を新規作成する（`t1: 50`、`t2: 150`、`guidanceMaxThemes: 3`）。既存の`config/themes.json`は変更しない。
    - `apps/api/src/regional-values/build/loadConfig.ts`に`loadMapConfig(configDir)`を追加する。ファイルの欠落、JSONの破損、契約違反を`CONFIG_UNREADABLE`（値や本文を含めず、ファイル名だけを返す）で返し、`node:fs/promises`だけを使う。
    - テスト: `config.test.ts`（T1=0、T1=T2、T2=201、50.5、文字列"50"、余剰キー）、`loadConfig.test.ts`（一時ディレクトリで欠落・破損・正常、実`config/regional-values/map.json`が適合すること）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/config.test.ts apps/api/src/regional-values/build/loadConfig.test.ts`
    - _Requirements: 4.18, 4.20, 6.6_

- [x] 3. 価値観マップの生成（`generateValuesMap`）を実装する
  - [x] 3.1 【A】丸め関数Rと水準の判定を実装する
    - `packages/domain/src/regional-values/map/rounding.ts`に`roundRatio(n, m)`（`R(n, m) = floor((200n + m) / (2m))`。整数どうしの床除算で、浮動小数点に依存しない）と`levelOf(score, t1, t2)`を実装する。前提（`n`は整数、`m`は正の整数）は呼出し側が保証する。
    - 例示テスト`rounding.test.ts`: V05〜V08の丸め（`R(5,4)=125`、`R(-1,3)=-33`、`R(1,8)=13`、`R(-1,8)=-12`）、`R(2,1)=200`、`R(-1,1)=-100`、`R(-2,1)=-200`、V09の水準の境界（49→0、50→+1、149→+1、150→+2、−49→0、−50→−1、−149→−1、−150→−2。しきい値100と200でのスコア100、200、−100、−200）。
    - **Property 2: 丸め関数R**（BigIntの有理数による参照計算と一致。`|n| ≤ 2m`で−200以上200以下）
    - **Validates: Requirements 4.5, 12.1**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/rounding.test.ts packages/domain/src/regional-values/map/rounding.property.test.ts`
    - _Requirements: 4.5, 4.6, 4.7, 12.1_

  - [x] 3.2 【A】属性テスト用のハーネス（テスト用質問バンク、生成器、参照実装）を追加する
    - `tests/harness/regional-values/testBanks.ts`にMapInputの水準で`TB-QUICK`（ED・DP・PRの6問）、`TB-FULL`（6テーマ×2問と`PRIORITY_PICK`、計13問）、`TB-W`（1テーマに複数の大切さ質問を持つ重み付き）を置く。`generators.ts`にfast-checkの生成器（全テーマ、全質問形式、全回答値、`QUICK`・`FULL`、有効・無効なしきい値、回答の列挙順の入替）を置く。
    - `referenceMap.ts`に仕様から独立に書いた参照実装を置く（BigIntによる丸め、素朴な全探索による分類。実装のコードと定数をimportしない）。`referenceMap.test.ts`で、設計書の例1〜3とV04〜V08の手計算値と一致することを確認する。
    - 焦点テスト: `npx.cmd vitest run tests/harness/regional-values/referenceMap.test.ts`
    - _Requirements: 12.1, 12.2_

  - [x] 3.3 【A】入力検査とエラーの優先順位を実装する
    - `map/validateInput.ts`に`validateMapInput`を実装する。順序は、(1)しきい値が`0<T1<T2≤200`の整数でない、または`setKind`が`bank.sets`にない → `INVALID_CONFIG`（診断セット種別の誤りを含めるのは設計の決定。【要確認6】は要件側の更新待ちだが、設計どおりに実装する）、(2)バンクにない、または診断セットにない質問ID → `UNKNOWN_QUESTION`、(3)質問形式に合わない値 → `INVALID_ANSWER`、(4)診断セットでキーのない質問を`UNANSWERED`にする、(5)診断セットの全質問が非意見回答 → `NO_OPINION_ANSWERS`。(2)と(3)の両方に該当すれば(2)を返す。該当IDは昇順で全件返す（列挙順に依存させない）。
    - 入力を変更しない（凍結した入力で確認する）。部分的な結果を返さない。
    - テスト: V12（バンクにないID、`MAYBE`、両方、診断セットにない質問への回答）、V13（T1=0、T1=T2、T2=201、50.5、NaN、−1などは`INVALID_CONFIG`。(1,2)、(100,200)、(50,150)は通る）、V03・V17（全て非意見回答）、`PRIORITY_PICK`の不正（重複、3件、バンクにないテーマID）。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/validateInput.test.ts`
    - _Requirements: 4.2, 4.3, 4.8, 4.15, 4.20_

  - [x] 3.4 【A】軸の状態とスコア・水準の計算を実装する
    - `map/axes.ts`に`computeAxes`を実装する。テーマごと・軸（大切さ、優先条件）ごとに、診断セットに質問がなければ`NOT_ASKED`、使える質問が0問なら`UNDETERMINED`（理由は`UNSURE`、`DECLINE`、`UNANSWERED`の順で重複なし）、それ以外は`score = R(Σ(w×s), Σw)`と`level`で`DETERMINED`にする。`PRIORITY_PICK`は軸の計算に使わない。
    - テスト: V04（重み1と3で非意見回答を分子・分母の両方から除く）、V05〜V08（TB-W）、設計書の例1の全スコアと水準、`UNDETERMINED`の理由の並び、優先条件の回答が大切さの値を変えないこと。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/axes.test.ts`
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 3.5 【A】グループ・分類・最優先テーマ・件数・通知を実装する
    - `map/classify.ts`に実装する: `importanceGroups`（5段階を常に返し、グループ内はテーマ定義順）、`hesitantThemes`（理由`UNSURE`と`PICK_CONFLICT`。最優先に選ばれ大切さが−1以下）、`declinedThemes`（`DECLINE`・`UNANSWERED`があり`UNSURE`がない）、`notAskedThemes`、`excludedQuestions`（質問バンクの定義順。`PRIORITY_PICK`を含む）、`priority`（クイック版は`NOT_ASKED`で、大切さから補わない）、`counts`、`notices`。出力に順番・順位・ランクの値を持たせない。
    - テスト: 設計書の例1〜3の分類部分、V10（`PICK_CONFLICT`は段階−1で付き、0では付かない）、V11（最優先の`UNSURE`が除外一覧に入り、スコアと段階が不変）、V14（大切さが中立・高い・低いで優先条件が別に返る）。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/classify.test.ts`
    - _Requirements: 4.10, 4.11, 4.12, 4.13, 4.14, 4.16, 4.17, 4.19, 4.21_

  - [x] 3.6 【A】`generateValuesMap`を組み立て、金テストベクタを実装する
    - `map/generateValuesMap.ts`で3.3〜3.5を組み立て、出力を`ValuesMapSchema`で検証して`Result<ValuesMap, MapError>`を返す。出力検証の失敗は実装の不具合なので例外を投げ、`MapError`の4種に符号を足さない。例外のメッセージには、スキーマ違反の位置だけを入れ、回答の値、質問ID、例外の内容を含めない。この例外は4.3の`diagnosticReducer`が捕捉する（`UNEXPECTED_ERROR`。Req 5.19）。`map/index.ts`と`regional-values/index.ts`を新規作成し、`packages/domain/src/index.ts`へ`export * from "./regional-values/index.js";`の**1行だけ**追加する。
    - 金テストベクタ`generateValuesMap.golden.test.ts`と固定値`goldenVectors.ts`に、V01〜V18のマップ出力（スコア、段階、グループ、分類、未出題、最優先テーマ、除外一覧、件数、エラーの種別）を手計算した固定値で持つ。各ベクタに手計算の式をコメントで書く。`ResultViewModel`の期待値（V15、V16、V18）は5.9で追加する。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行し、`npm.cmd run typecheck --workspace @ehime-vote-navigator/domain`で型を確認してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/generateValuesMap.golden.test.ts`
    - _Requirements: 4.1, 4.2, 4.15, 5.11, 12.1_

  - [x] 3.7 【A】スコア・水準・重み・非意見回答の属性テストを実装する
    - `generateValuesMap.scores.property.test.ts`に実装する。生成する入力に、全テーマ、全質問形式、全回答値（5段階、`UNSURE`、`DECLINE`、`UNANSWERED`）、`QUICK`と`FULL`を含める。
    - **Property 3: スコアと水準**（参照値`R(Σ(w×s), Σ(w))`と一致し、スコアは−200〜200の整数、水準は−2〜2の整数）
    - **Property 4: 水準の単調性**（大切さ質問の回答値を上げても、そのテーマの段階は下がらず、他のテーマは変わらない）
    - **Property 5: 重みの倍率不変**（重みを`k`倍にしてもスコアと段階が変わらない。上限を外したテスト用の型を使う）
    - **Property 6: 非意見回答の置換**（`UNSURE`・`DECLINE`・`UNANSWERED`を置き換えてもスコアと段階が変わらない）
    - **Validates: Requirements 4.5, 4.6, 4.7, 4.8, 12.2**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/generateValuesMap.scores.property.test.ts`

  - [x] 3.8 【A】独立性・段階のグループ・テーマ定義順の属性テストを実装する
    - `generateValuesMap.independence.property.test.ts`に実装する。Property 9の「活かし方の案内の対象テーマ」は5.8で検査し、ここでは大切さのスコアと段階、最優先テーマの不変を検査する。
    - **Property 7: 段階のグループと順位の不在**（グループは5件、スコアが等しいテーマは同じグループ、出力のどの階層にも順番・順位・ランクのキーがない）
    - **Property 8: テーマ間の独立**
    - **Property 9: 優先条件の回答の独立**
    - **Property 10: 大切さの回答の独立**
    - **Property 11: 最優先テーマの選択の独立**
    - **Property 12: テーマ定義順の入替**
    - **Property 15: 未出題側の変更の不変**
    - **Validates: Requirements 4.4, 4.10, 4.11, 4.21, 12.1, 12.2**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/generateValuesMap.independence.property.test.ts`

  - [x] 3.9 【A】決定性・最優先テーマ・分類・エラー・出力契約の属性テストを実装する
    - `generateValuesMap.contract.property.test.ts`に実装する。Property 1は、同じ入力の2回の出力と、回答の列挙順だけを入れ替えた入力の出力を既存の`encodeCanonicalJson`と`sha256Hex`で直列化し、3つのハッシュ（64文字の16進数）が一致することを確認する。
    - **Property 1: 決定性、列挙順への非依存、入力の不変**
    - **Property 13: 最優先テーマの状態**（クイック版は大切さにかかわらず`NOT_ASKED`）
    - **Property 14: 分類、件数、通知フラグ**（`referenceMap.ts`の参照実装と一致）
    - **Property 16: エラーの判定**（優先順位に従い、エラー時は部分的な結果を返さない）
    - **Property 17: 出力契約**
    - **Validates: Requirements 1.5, 1.6, 4.1, 4.2, 4.3, 4.8, 4.9, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.19, 4.20, 4.21, 5.11, 5.16, 12.1, 12.2, 12.3**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/generateValuesMap.contract.property.test.ts`

  - [x] 3.10 【A】マップ生成の依存関係の静的検査と、事実項目を受け取らないことの型検査を追加する
    - `tests/harness/regional-values/importGraph.ts`に、TypeScriptのコンパイラAPIで`map/index.ts`から到達するモジュールとimportする名前を集める補助を置く。`map/dependencyClosure.test.ts`で、`node:*`、Bedrockクライアント、ネットワーク（`fetch`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`）、現在時刻の取得（`Date.now`、引数なしの`new Date`、`performance.now`）、乱数（`Math.random`、`crypto.getRandomValues`、`randomUUID`）、課題カード・事実項目・出典のモジュールの取込みが0件であることを確認する。
    - `@ehime-vote-navigator/contracts`はパッケージ名で読み込まれ、バレル経由で`content.ts`に到達するため、`map/`がそこから取り込む名前は`core.ts`（と`primitives.ts`）で定義された名前だけであることを名前単位で検査する。`Date.parse`と引数付きの`new Date(...)`は現在時刻の取得ではないので許す（既存の`primitives.ts`が`Date.parse`を使うため）。
    - 型検査: `MapInput`に`cards`・`facts`・`sources`を渡すと型エラーになること（`@ts-expect-error`）を、`tsconfig.typecheck.json`の対象のテストで確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/map/dependencyClosure.test.ts`
    - _Requirements: 4.1, 7.22, 12.9_

- [x] 4. 診断の状態機械（`diagnosticReducer`）を実装する
  - [x] 4.1 【A】セッションの型と`toMapInput`、テスト用バンドルを追加する
    - `packages/domain/src/regional-values/session/sessionTypes.ts`に`Hint`、`Session`、`DiagnosticState`、`DiagnosticEvent`、`SessionBundle`を定義する。`SessionBundle`は読み取り専用の最小構造（`meta.dataKind`、`themes`、`questions`、`diagnosticSets`、`mapConfig.thresholds`、`cards: { cardId }[]`）とし、5.3の`ViewBundle`と7.3の`VerifiedBundle`が構造的に満たす（キャスト不要。このタスクのテストで`ViewBundle`が代入できることを、7.3のテストで`VerifiedBundle`が代入できることを型で確認する）。優先順位（reducerを先に作る）を保つため、`VerifiedBundle`を直接は使わない。
    - `session/toMapInput.ts`に`toMapInput(bundle, setKind, answers): MapInput`を実装する。質問は`questionId`・`kind`・`themeId`・`weight`だけを渡し、質問文・課題カード・事実項目・出典を渡さない。
    - `tests/harness/regional-values/testBundle.ts`に、`TB-QUICK`・`TB-FULL`、5.2の契約に適合する架空の課題カード、5.3の`testFixedTexts.ts`（キーごとの合成文言）から、テスト用の`ViewBundle`（5.3で定義。`SessionBundle`を含む）を作る関数を置く。後続のタスクはこのファイルを読むだけで、変更しない。
    - テスト: `toMapInput`が許可した4項目としきい値だけを含むこと、課題カードを変えても出力が同一であること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/toMapInput.test.ts`
    - _Requirements: 4.1, 7.22, 12.2_

  - [x] 4.2 【A】回答の編集規則（選択、最優先テーマの選択の閉包、解除）を実装する
    - `session/answerEditing.ts`に、`selectAnswer`、`togglePick`、`clearAnswer`、`isAnswered`、`matchesKind`を純関数で実装する。`togglePick`の組合せは「テーマ1つ」「テーマ2つ」「`UNSURE`のみ」「`DECLINE`のみ」「未選択」の5通りに限る。`UNSURE`または`DECLINE`は選択済みのテーマを解除し、テーマは選択済みの`UNSURE`または`DECLINE`を解除し、選択済みの項目をもう一度選ぶと解除する。2つ選択済みで3つ目を選ぶと選択を変えず`PICK_LIMIT`を返す。保存時のテーマの並びはテーマ定義順にそろえ、未選択になった質問は`answers`からキーを削除する。入力を変更しない。
    - 例示テスト`answerEditing.test.ts`で、各規則を1件以上確認する。属性は4.5で検査する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/answerEditing.test.ts`
    - _Requirements: 2.5, 2.8, 2.10, 2.12_

  - [x] 4.3 【A】`diagnosticReducer`の前半（読込みから出題、結果の生成、課題カードとAboutの往復）を実装する
    - `session/diagnosticReducer.ts`と`initialDiagnosticState`を実装する。設計書の遷移表のうち、`LOADING`、`LOAD_ERROR`、`INTRO`（診断セットが1つなら選択を求めず`QUESTION`、2つ以上なら`SET_SELECT`）、`QUESTION`（`SELECT_ANSWER`・`TOGGLE_PICK`・`CLEAR_ANSWER`・`NEXT`・`BACK`）、最後の質問の`NEXT`で`generateValuesMap`を呼んで`RESULT`、`OPEN_CARD`・`CLOSE_CARD`・`OPEN_ABOUT`・`CLOSE_ABOUT`を実装する。表にない組合せは、同じオブジェクトを返して無視する。乱数、時刻、通信を使わず、入力の状態を変更しない。`diagnosticReducer`は遷移の計算全体を`try/catch`で囲み、`MapError`以外の想定外の例外が起きたときは例外を投げず、終端の`UNEXPECTED_ERROR`（`bundle`と`setKind`だけを持ち、回答、結果、例外の内容を持たない）を返す。例外の内容を状態にも画面にもログにも書き出さない。テストで例外を投げる関数を注入できるよう、`createDiagnosticReducer({ generateValuesMap })`を実装し、既定の`diagnosticReducer`はそれに実装の`generateValuesMap`を渡したものとする。
    - 例示テスト`diagnosticReducer.navigation.test.ts`で、遷移表の対応する全行を確認する（診断セットが1つと2つの`START`、未選択での`NEXT`が`SELECT_REQUIRED`、`LOAD_ERROR`での無視を含む）。
    - 例外境界のテスト`diagnosticReducer.unexpected.test.ts`: 例外を投げる関数を注入して`UNEXPECTED_ERROR`へ遷移すること、その状態に回答、結果、例外のメッセージが残らないこと、`MapError`は`UNEXPECTED_ERROR`にならないこと、`UNEXPECTED_ERROR`では`RESTART`以外が無視されること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/diagnosticReducer.navigation.test.ts packages/domain/src/regional-values/session/diagnosticReducer.unexpected.test.ts`
    - _Requirements: 1.1, 2.2, 2.8, 2.9, 2.10, 2.13, 2.15, 5.13, 10.4, 11.10_

  - [x] 4.4 【A】`diagnosticReducer`の後半（回答の変更、やり直し、焦点テーマ）を実装する
    - 4.3の`diagnosticReducer.ts`へ追記する: `FOCUS_THEME`、`OPEN_EDIT`（`ALL`と`themeId`。`PICK_CONFLICT`の理由があれば`PRIORITY_PICK`を編集対象に加える）、`ANSWER_EDIT`中の`SELECT_ANSWER`・`TOGGLE_PICK`・`CLEAR_ANSWER`（`editable`の質問だけ）、`CONFIRM_EDIT`（`previous`は直前の成功したマップ1件。失敗が続いた場合は元の`previous`を保つ）、`CANCEL_EDIT`、`RESTART`（`bundle`だけ保持し、同じ診断セットの1問目へ戻る）。`UNEXPECTED_ERROR`での`RESTART`は、`setKind`があればその診断セットの1問目、なければ`INTRO`へ移り、回答、結果、変更前の結果をすべて破棄する。`current`が`INVALID_CONFIG`のときは`OPEN_EDIT`と`RESTART`を無視する。
    - 診断セットが2つのときの選び直し導線は追加しない（【要確認20】。13.6で扱う）。
    - 例示テスト`diagnosticReducer.edit.test.ts`で、遷移表の対応する全行を確認する（`NO_OPINION_ANSWERS`になる変更で、変更後の回答と変更前の結果を保持すること、`CANCEL_EDIT`が何も変えないことを含む）。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/diagnosticReducer.edit.test.ts`
    - _Requirements: 5.14, 6.2, 6.4, 6.5, 6.11_

  - [x] 4.5 【A】状態機械の属性テストを実装する
    - `diagnosticReducer.property.test.ts`に実装する。イベント列はfast-checkで生成し、`TB-QUICK`と`TB-FULL`のテスト用バンドルで動かす。
    - **Property 41: 回答の置換**（`answers`は質問IDごとに最新の1件だけで、診断セットの質問IDだけをキーに持つ）
    - **Property 42: 戻る操作と課題カードの往復**
    - **Property 43: 最優先テーマの選択**（組合せは常に5通りのいずれか。3つ目は`PICK_LIMIT`）
    - **Property 44: 未選択では進めない**
    - **Property 45: 最初からやり直す**
    - **Property 46: 回答の変更**（`CONFIRM_EDIT`後の`current`は変更後の回答だけから生成した結果と等しく、`previous`は直前の成功したマップ1件。全質問が非意見回答になる変更では回答と変更前の結果を保持する。差のセルの`changed`が文言の違いと一致する部分は、表示モデルを作る5.8の例示テストで確認する）
    - **Property 47: 診断セットの選択の省略**
    - **Property 56: 想定外の例外の捕捉**（例外を投げる関数を注入しても例外が呼出し元へ出ず、`UNEXPECTED_ERROR`は`bundle`と`setKind`だけを持つ。`RESTART`で回答が空の1問目または`INTRO`へ戻る）
    - **Validates: Requirements 2.5, 2.8, 2.9, 2.10, 2.12, 2.13, 2.15, 5.19, 6.2, 6.5, 6.11**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/diagnosticReducer.property.test.ts`

- [x] 5. 固定文言・課題カードの契約と、質問・結果の表示モデルを実装する
  - [x] 5.1 【A】承認・結果解説・固定文言・活かし方の問いの契約を追加する
    - `packages/contracts/src/models/regional/content.ts`を新規作成し、`ApprovalSchema`（`PENDING`、または承認者IDと承認日時を持つ`APPROVED`）、`ResultTextSchema`（テーマ×軸×5段階。1〜200文字で各文60文字以内）、`FixedTextSchema`、`FixedTextsSchema`（キーの重複と、閉じた一覧にないキーを拒否）、`GuidanceQuestionSchema`（テーマ×3場面。文末が「か」の1文、60文字以内）をstrictで定義する。`regional/index.ts`へ`content.js`のexportを1行追加する。
    - `fixedTextKeys.ts`に`FIXED_TEXT_KEYS`と、キーごとに許す差込み名（`{themeName}`、`{n}`、`{m}`、`{t1}`、`{t2}`、`{publisher}`、`{licenseName}`、`{totalQuestions}`、`{totalThemes}`）を定義する。設計書の群の表（注意と表示区分、ラベル、段階と状態、見出しと該当なし、説明と注記、件数と設定値、エラー、ライセンス、このアプリについて、画面の操作）のうち`section.*`などの具体的なキー名は、`ResultViewModel`・`QuestionPresentation`・`AboutView`の各項目から導き、導いたキーの一覧を完了報告に載せる。サービス名は案としてキー`ui.appName`を置く（未決事項(10)）。エラー群には`error.UNEXPECTED`（想定外の内部エラーの文）と`error.UNEXPECTED.restartNote`（最初からやり直すと入力済みの回答が消える旨）を含める（Req 5.19）。
    - 種別別の必須キー`requiredFixedTextKeys(dataKind)`を定義する。tasks.md作成時の解釈（要レビュー）: 共通キーに加え、`banner.<dataKind>`と`label.dataKind.<dataKind>`を必須とし、`license.*`は`REAL_AI`でだけ必須とする。設計書は「全キーを1件ずつ」とだけ書き、FIXTUREのバンドルに`banner.REAL_AI`を含めるかを書いていないため。
    - テスト`content.fixed.test.ts`: 正常例と拒否例（キーの重複、未知のキー、文末が「か」でない問い、61文字の文、空の本文、`requiredFixedTextKeys`の欠落）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/content.fixed.test.ts`
    - _Requirements: 3.2, 5.3, 5.12, 6.6, 6.7, 7.21, 8.20, 10.18_

  - [x] 5.2 【A】出典・事実項目・課題カードの契約を追加する
    - 5.1の`content.ts`へ追記する: `TransmissionReviewSchema`、`DatasetNoteReviewSchema`、`RegionalSourceSchema`（`REAL_AI`は既存の`LocatorSchema`・`UsageReviewSchema`・`UrlSourceReferenceSchema`・`Sha256Schema`を再利用。`FIXTURE`は架空の資料IDだけで、URLと実在の公開者名を持たない）、`FactMethodSchema`、`FactItemSchema`（`FIXTURE`は(a)〜(f)と架空の資料IDだけ。`VERIFIED`は検証記録が必須、`PROVISIONAL`は持たない）、`IssueCardSchema`（用語解説1〜10件、出典1〜10件、事実項目0〜10件、`APPROVED`は承認記録が必須で`PENDING`は持たない、カードと入れ子の出典・事実項目の`dataKind`が一致）。選挙IDと候補者IDを含む入力は拒否する（Req 7.7）。
    - 用語の見出し語`term`の上限（40文字）は設計書の仮の値であり、要件に記載がない。仮の値として実装し、完了報告に載せる。用語解説の件数（【要確認14】）は設計の既定（1〜10件）で実装する。
    - テスト`content.card.test.ts`: 合格例と拒否例（`electionId`の混入、`FIXTURE`の出典にURL、`REAL_AI`の出典でLocatorの欠落、`VERIFIED`で検証記録なし、`PROVISIONAL`で検証記録あり、`FIXTURE`の事実項目に(g)〜(o)、カードと出典の種別の不一致、`APPROVED`で承認記録なし、`PENDING`で承認記録あり）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/content.card.test.ts packages/contracts/src/models/regional/content.fixed.test.ts`
    - _Requirements: 7.1, 7.3, 7.5, 7.7, 7.17, 7.18, 10.10_

  - [x] 5.3 【A】固定文言の差込みと、表示モデルの型を追加する
    - `packages/domain/src/regional-values/view/fixedText.ts`に`lookupFixedText(bundle, key)`と`renderFixedText(key, values)`を実装する。キーごとに許す差込み名を固定し、不足と余分を拒否する。差込み値は、テーマ名、テーマ数、質問数、しきい値の数値などに限る（Req 5.12）。
    - `view/viewTypes.ts`に、設計書の型（`JaText`、`RichText`、`Entry`、`ThemeRef`、`FrameView`、`ResultViewModel`系、`QuestionPresentation`、`CardView`、`AboutView`、`ViewBundle`）を型のみで定義する。`ViewBundle`は、`meta`、`themes`、`questions`、`diagnosticSets`、`mapConfig`、`cards`（`IssueCard`）、`resultTexts`、`fixedTexts`、`guidance`、`aiContribution`を持つ読み取り専用の構造とし、4.1の`SessionBundle`（同じ項目名の部分集合）を構造的に満たす。7.3の`VerifiedBundle`が`ViewBundle`を構造的に満たすことは7.3で確認する。
    - `tests/harness/regional-values/testFixedTexts.ts`に、全キーの合成文言（`〈キー名〉`の形。文面ではなく、キーの経路を検証するための値）を作る関数を置く。
    - テスト`fixedText.test.ts`: 差込みの不足・余分の拒否、未知のキーの拒否、`requiredFixedTextKeys`に対する欠落の検出。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/fixedText.test.ts`
    - _Requirements: 5.12, 5.13, 6.7, 11.7_

  - [x] 5.4 【A】専門用語の注釈と日付の整形を実装する
    - `view/annotateTerms.ts`に、課題カードの用語解説に登録された語を、画面ごとの最初の出現箇所にだけ注釈つきの`RichText`にする関数を実装する。`view/formatDate.ts`に、日付を「YYYY年M月D日」、日時を日本標準時の「YYYY年M月D日 HH:mm」へ整形する関数を実装する（`Intl`に依存せず、整数演算で日本標準時へ換算する）。
    - テスト: 同じ語が2回出ても最初の1回だけ注釈がつくこと、語がない文は変わらないこと、日付の境界（うるう年、日付をまたぐ換算、`+09:00`と`Z`の入力）。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/annotateTerms.test.ts packages/domain/src/regional-values/view/formatDate.test.ts`
    - _Requirements: 7.13, 11.11_

  - [x] 5.5 【A】`presentQuestion`（質問画面の表示モデル）を実装する
    - `session/presentQuestion.ts`に`presentQuestion(session, hint): QuestionPresentation`を実装する。現在の問番号と全問数、テーマ名（`PRIORITY_PICK`は固定文言`reflection.crossTheme`）、質問文、注釈つきの解説、前提文、方向の表示順（`swapDirections`を反映し、各選択肢の回答値は入れ替えない）、7つの選択肢（`UNSURE`・`DECLINE`も同じ種別・同じ形で、押したときに渡すイベントを持つ。画面はイベントを作らない）、課題カードへの導線、データ種別とAIのラベル、`hintText`、`nav`（最後の質問は「結果を見る」）を返す。
    - テスト: クイック版の6問すべての表示（問番号1〜6、全問数6）、`swapDirections`が真の質問で方向と5段階の選択肢の並びだけが入れ替わり回答値が不変なこと、`PRIORITY_PICK`の6テーマ+`UNSURE`+`DECLINE`、未選択のときの`nextEnabled`と`SELECT_REQUIRED`。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/presentQuestion.test.ts`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.12, 7.4, 8.13_

  - [x] 5.6 【A】`buildResultViewModel`の前半（エラー表示、枠、注意書き、説明、最優先テーマ、段階のグループと図）を実装する
    - `view/errorView.ts`に`ResultErrorView`の生成を実装する（`NO_OPINION_ANSWERS`は回答を見直す導線、`UNKNOWN_QUESTION`・`INVALID_ANSWER`は最初からやり直す導線、`INVALID_CONFIG`は文言だけで導線なし。最優先テーマ・段階・分類・件数を一切含めない）。想定外の内部エラー（`UNEXPECTED_ERROR`）の表示モデル`UnexpectedErrorView`も実装する: 固定文言`error.UNEXPECTED`、導線は「最初からやり直す」だけ、導線の近くに`error.UNEXPECTED.restartNote`を置き、エラーの内容、回答値、質問IDを一切含めない（Req 5.19）。`view/frame.ts`に`FrameView`（`meta.dataKind`に従う常時表示の注記と「このアプリについて」への導線）を実装する。
    - `view/sections/importanceSection.ts`に、注意書き、整理の説明（3項目）、最優先テーマの欄（`NOT_ASKED`は「この診断では最優先テーマを聞いていません」、選ばれていない旨、1〜2テーマ）、大切さの欄（差なしの注記、5段階のグループ、該当なしの文、結果解説、図の`ChartBand`）を実装する。順位の数値を出さない。
    - 型・並びの決め方は設計書の`ResultViewModel`に従う。テスト`importanceSection.test.ts`: 設計書の例1・例2のクイック版で、4つの状態の欄が別の固定文言になること、最優先テーマが大切さから補われないこと、各段階の見出しが0件でも出ること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/sections/importanceSection.test.ts packages/domain/src/regional-values/view/errorView.test.ts`
    - _Requirements: 5.1, 5.2, 5.7, 5.8, 5.9, 5.14, 5.16, 5.17, 10.12, 10.18_

  - [x] 5.7 【A】`buildResultViewModel`の中盤（優先条件、迷い、回答しなかった、判定できない軸、未出題、件数）を実装する
    - `view/sections/statusSections.ts`に実装する: 優先条件の欄（「両立が難しい場面で、どちらを先に進めたいか」の条件付きの表現、段階の固定文言、大切さの段階または「判定できません」の併記）、判断に迷ったテーマ（理由ごとの固定文言とドリルダウン）、回答しなかったテーマ（「回答しない」と「未回答」の2小欄）、判定できない軸（理由つき。スコアと段階を出さない）、未出題のテーマ（「出題していません」）、件数（`n / m`）。該当するテーマがない欄も該当なしの文つきで返す。
    - テスト: 設計書の例1・例2・例3、V14（大切さが低い・判定できないテーマでも優先条件が併記される）、未出題のテーマが「判定できません」と別の文言になること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/sections/statusSections.test.ts`
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.15, 5.17, 6.4_

  - [x] 5.8 【A】`buildResultViewModel`の後半（振り返り、変更前後の差、活かし方）を実装し、全体を組み立てる
    - `view/sections/reflectionDiffGuidance.ts`に、回答の振り返り（提示順、`UNANSWERED`は「未回答」、未出題は出さない）、変更前後の差（`DiffCell`。値が変わった項目と変わらない項目を文言で区別）、活かし方の案内（対象テーマは出題されたテーマから、最優先テーマ、大切さ+2、+1の順に各区分内はテーマ定義順で上限まで。表示はテーマ定義順。0件なら案内を出さず該当なしの文）を実装する。公式情報へのリンクは出典の利用条件が`CONFIRMED`のものだけを出す。
    - `view/buildResultViewModel.ts`で5.6・5.7・本タスクの部品を組み立てる。`sectionOrder`は定数`defaultSectionOrder`の1か所にし、テストは要件で確定している相対順（注意書きは最優先テーマの欄より上、最優先テーマは段階のグループより前）だけを検査する。全体の順序の確定は【要確認19】（13.5）で行う。
    - **Property 51: 活かし方の案内の対象**（選定は優先条件の回答、日付、選挙の有無に依存しない）
    - **Validates: Requirements 6.6, 6.8, 6.12**
    - 例示テスト: 変更前後の差の`changed`が文言の違いと一致すること（4.5のProperty 46の残り）、振り返りの表示。Property 9のうち「活かし方の案内の対象テーマが優先条件の回答で変わらない」もここで確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/sections/reflectionDiffGuidance.test.ts packages/domain/src/regional-values/view/sections/guidance.property.test.ts`
    - _Requirements: 4.4, 6.1, 6.2, 6.6, 6.7, 6.8, 6.9, 6.12_

  - [x] 5.9 【A】表示モデルの属性テストと、金テストベクタの表示モデルを実装する
    - `view/buildResultViewModel.property.test.ts`に実装する。テスト用バンドルの合成固定文言（`testFixedTexts.ts`）で、欄と文言のキーの経路を検査する。
    - **Property 48: 欄の完全性と4つの状態の区別**（未出題、わからない、回答しない、未回答は別の固定文言と別の欄。順位の数値が出力にない）
    - **Property 49: 図と一覧の一致**（図に現れるテーマ名と文言が、文字の一覧にも同じ内容で現れる）
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.7, 5.15, 5.16, 5.17, 11.5, 12.16**
    - `goldenVectors.ts`に、V15・V16・V18の`ResultViewModel`の期待値（欄の有無、並び、該当なしの文のキー、固定文言のキー）を固定値で追加し、`buildResultViewModel.golden.test.ts`で確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/buildResultViewModel.property.test.ts packages/domain/src/regional-values/view/buildResultViewModel.golden.test.ts`

  - [x] 5.10 【A】課題カードと「このアプリについて」の表示モデルを実装する（`FIXTURE`分）
    - `view/cardView.ts`に`buildCardView`、`view/aboutView.ts`に`buildAboutView`を実装する。課題カードは、データ種別のラベル（常時表示）、AIのラベル、背景説明の用語注釈、出典（公開者、公開日、取得日時、リンクまたは資料ID）、更新日、事実項目（`FIXTURE`は文・対象地域・基準日だけ）を返し、日付は5.4の整形を使う。「このアプリについて」は、各質問の起案者区分と承認者ID、生成ルールの4項目、しきい値、データの区分、AIの利用範囲、全質問数・全テーマ数・限定された範囲の注記、AIの貢献を示す4つの数を返す。
    - `REAL_AI`専用の部分（ライセンス表示、`credit`、`unofficial`の非公式表示）は、文面の承認と要件更新が要るため13.4で実装する。このタスクでは`REAL_AI`のとき該当項目を`null`または空で返す。
    - テスト: `FIXTURE`のカードで出典が資料IDだけ、実在の公開者名がないこと、日付の整形、AIの貢献の4つの数が0以上の整数であること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/cardView.test.ts packages/domain/src/regional-values/view/aboutView.test.ts`
    - _Requirements: 5.13, 7.4, 7.13, 7.17, 8.13, 8.22, 10.19_

  - [x] 5.11 【A】`ResultText`にデータ種別（`dataKind`）を追加する
    - `packages/contracts/src/models/regional/content.ts`の`ResultTextSchema`へ`dataKind`（`REAL_AI`または`FIXTURE`）を追加する。バンドルの`meta.dataKind`との一致は7.1で検査する。実データ用の結果解説は、架空データ用のものを複製して別のレコードとして再承認する（13.16）。既存のテストの期待値は弱めない。
    - テスト: `content.fixed.test.ts`の結果解説の例に`dataKind`を足し、`dataKind`の欠落と未知の値の拒否、`FIXTURE`と`REAL_AI`の合格、同じ文面が2つのレコードになることを確認する。`tests/harness/regional-values/testViewBundle.ts`の結果解説に`dataKind: "FIXTURE"`を足す。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/content.fixed.test.ts`
    - _Requirements: 3.2, 8.20, 10.17_

  - [x] 5.12 【A】`RegionalSource`に公開データカタログの情報（`catalog`）を追加する
    - 5.2の`RegionalSourceSchema`の`REAL_AI`側へ、省略できる`catalog`（`name`と`datasetId`。どちらも空でない文字列。strict）を追加し、`CatalogRefSchema`をexportする。`FIXTURE`側には追加しない（架空の資料IDだけ）。
    - テスト: `content.card.test.ts`に、`catalog`ありとなしの合格、空の`datasetId`・空白の`name`・欠落・余剰項目の拒否、`FIXTURE`の出典に`catalog`を付けたときの拒否、`catalog`つきの出典を持つ`REAL_AI`のカードの合格を追加する。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/content.card.test.ts`
    - _Requirements: 7.5, 7.7, 10.15_

- [ ] 6. 架空データ（クイック版の暫定3テーマ）と使用例のテストを追加する
  - [ ] 6.1 【A】架空の質問バンクと診断セットを追加する
    - `packages/fixtures/src/regional-values/question-bank.json`を新規作成する（`dataKind: FIXTURE`）。6テーマの定義と、クイック版の暫定3テーマ（人口減少・地域活性化、防災、教育・子育て）の大切さ質問3問・優先条件質問3問、`QUICK`の診断セット定義（3テーマはこのデータで決め、コードに固定しない）。`FULL`は定義しない。
    - 大切さ質問は「{テーマ名}は、あなたの暮らしにとってどのくらい大切ですか」の型、優先条件質問は前提文の初期案（「限られた予算や人手の中で、どちらかを先に進める場面を考えてください」）と、要件の表の方向A・方向B（肯定的な表現）を使う。方向の区分（`CHANGE`・`CONTINUE`・`NEUTRAL`）と表示位置の入れ替えは架空データ用の仮の割当てとして起案し、利用者のレビューを受ける。承認記録の承認者IDは架空の値（実在の人名・IDを使わない）にする。
    - テスト`packages/fixtures/src/regional-values/questionBank.test.ts`: 契約に適合すること、`QUICK`が3テーマ・6問であること、診断セット定義のテーマを差し替えると3テーマが変わること（コードに固定していない確認）。質問の検査（中立性など）は8.5と9.4で行う。
    - 焦点テスト: `npx.cmd vitest run packages/fixtures/src/regional-values/questionBank.test.ts`
    - _Requirements: 1.4, 2.1, 3.1, 3.2, 12.12_

  - [ ] 6.2 【A】架空の課題カード、事実項目、架空資料の本文を追加する
    - `packages/fixtures/src/regional-values/cards.json`と`sources/`配下の架空資料の本文（JSON）を新規作成する。3テーマ分の課題カード（`FIXTURE`、`APPROVED`、架空の承認者ID）。架空の自治体名と架空の数値を使い、背景説明に「架空」の語を含め、「愛媛県」の名称と実在の人名・政党名・団体名・自治体名を含めない。出典は架空の資料IDだけ。引用原文は架空資料の本文に部分文字列として含まれる。事実項目は`FIXTURE`の項目だけ（事実の文、数値と単位、基準日（架空）、対象地域（架空の自治体名）、架空の資料ID）。
    - テスト`cards.test.ts`: 契約に適合すること、3テーマそれぞれにカードが1件以上あること、実在名の語（「愛媛県」を含む試験用の一覧）を含まないこと、背景説明に「架空」があること、引用原文が架空資料の本文に含まれること。
    - 焦点テスト: `npx.cmd vitest run packages/fixtures/src/regional-values/cards.test.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.9, 7.17, 7.18_

  - [ ] 6.3 【A】架空の結果解説、固定文言、活かし方の問いを追加する
    - `packages/fixtures/src/regional-values/result-texts.json`（3テーマ×(大切さ5段階+優先条件5段階)の30件。各件に`dataKind: "FIXTURE"`を持たせる）、`fixed-texts.json`（`requiredFixedTextKeys('FIXTURE')`の全キー）、`guidance.json`（3テーマ×3場面の9件）を新規作成する。優先条件の固定文言は「どちらかを選ぶなら、◯◯では△△を先に進めたい考えに近い（やや／強く）」の型にし、段階0は両方向を同程度に述べる文にする。各文は60文字以内で、利用者の性格・思想を述べず、一方の軽視を述べない。
    - 文面は架空データ用の仮の文面として起案し、利用者のレビューを受ける。公開版の文面の承認は別（13.1と13.4）。
    - テスト`texts.test.ts`: 契約に適合すること、30件と9件がそろうこと、キーの欠落がないこと、各文が60文字以内であること。禁止語などの検査は8.8で行う。
    - 焦点テスト: `npx.cmd vitest run packages/fixtures/src/regional-values/texts.test.ts`
    - _Requirements: 5.3, 5.10, 5.12, 5.18, 6.6, 6.7, 8.20_

  - [ ] 6.4 【A】架空データを使った使用例のテストを追加する（クイック版が動くこと）
    - `tests/harness/regional-values/loadFixtureBundle.ts`に、6.1〜6.3のJSONを読み、`ViewBundle`を組み立てる関数を置く。`tests/regional-values/fixtureUsage.test.ts`で、診断の開始から6問の回答、`generateValuesMap`、`buildResultViewModel`、回答の変更、最初からやり直すまでを、`diagnosticReducer`のイベントで通しで動かす。V15、V16に相当する回答で、4つの状態が別の欄に出ること、最優先テーマが「聞いていません」になることを確認する。
    - `tests/regional-values/factIndependence.property.test.ts`に次を実装する。
    - **Property 55: 事実項目で変わらない**（課題カード、事実項目、出典だけが異なる2つのバンドルから`toMapInput`が作る入力は等しく、`generateValuesMap`の出力は同一）
    - **Validates: Requirements 7.22, 12.2**
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/fixtureUsage.test.ts tests/regional-values/factIndependence.property.test.ts`

- [ ] 7. バンドルの契約と検証（`verifyBundleText`、`loadBundle`、`contentHash`）を実装する
  - [ ] 7.1 【A】バンドル、メタ、指摘、ビルドレポートの契約を追加する
    - `packages/contracts/src/models/regional/bundle.ts`を新規作成し、`DATA_MODES`、`BUILD_KINDS`、`BUNDLE_SCHEMA_VERSION`（1）、`GATE_REASON_CODES`（前半の表と、後半で加えた`APPROVER_COUNT_INSUFFICIENT`・`FIXED_TEXT_NOT_APPROVED`・`FIXED_TEXT_INVALID`を含む全コード）と`GATE_REASON_CLASS`（`SHORTAGE`・`DEFECT`）、`BundleMetaSchema`、`RegionalBundleSchema`、`GateFindingSchema`（`targetKind`に`FIXED_TEXT`・`GUIDANCE_QUESTION`を含む）、`BuildReportSchema`をstrictで定義する。`regional/index.ts`へ`bundle.js`のexportを1行追加する。
    - refine: `meta.dataKind`と`dataModeResolved`の整合、`switched`と`switchReasonCodes`の整合（空⇔未切替、すべて`SHORTAGE`）、`buildKind: PUBLIC`のとき`REAL_AI`かつ`REAL`かつ未切替、`questions`・`cards`・`resultTexts`・`fixedTexts`と入れ子の項目の`dataKind`が`meta.dataKind`と一致（混在禁止。`resultTexts`の各件の`dataKind`は5.11で追加した項目）、`mapConfig`が`MapConfigSchema`に適合、`aiContribution`は0以上の整数で`rejectedByChecks + humanEdited + humanRejected ≤ drafted`。
    - **Property 36: バンドルとレポートのラウンドトリップ**（直列化、解析、再直列化の結果が元と深い等価で、文字列が同一）
    - **Validates: Requirements 12.6**
    - 例示テスト`bundle.test.ts`で、上記の各refineの拒否例を確認する。`npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/bundle.test.ts packages/contracts/src/models/regional/bundle.property.test.ts`
    - _Requirements: 7.10, 8.22, 10.1, 10.15, 10.16, 10.17, 11.9_

  - [ ] 7.2 【A】ブラウザ向けの正準JSONと`contentHash`の再計算を実装する
    - `packages/domain/src/regional-values/bundle/portableCanonicalJson.ts`に、`node:util`を使わない正準JSON（キー順固定、2スペース字下げ、末尾LF1つ）を実装し、`bundle/contentHash.ts`に、WebCrypto（`crypto.subtle.digest`、`digest`引数で差し替え可能）による`contentHash`（`meta.contentHash`を除いた正準JSONのSHA-256）の計算を実装する。`packages/domain/tsconfig.json`は変更しない。`crypto.subtle`の型が解決できない場合は、型だけの最小の宣言を`bundle/`内に置く。
    - **Property 38: 正準JSONの同値と`contentHash`の再計算**（`portableCanonicalJson`の文字列が既存の`formatCanonicalJson`と同一で、`contentHash`が既存の`sha256Hex`と一致する）
    - **Validates: Requirements 11.9, 11.10**
    - 例示テスト: 空白・改行・日本語・入れ子・キー順の異なる同値のオブジェクト。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bundle/portableCanonicalJson.test.ts packages/domain/src/regional-values/bundle/contentHash.property.test.ts`

  - [ ] 7.3 【A】`verifyBundleText`と`VerifiedBundle`を実装する
    - `bundle/verifyBundleText.ts`に、設計書の検証手順（JSON解析、メタ5項目、`generatedAt`、スキーマ・データ・ビルド種別の期待値、strict契約、`contentHash`の再計算、参照の整合、公開版の条件）を順に行い、最初に失敗した段階の符号（`NOT_JSON`、`META_MISSING`、`GENERATED_AT_INVALID`、`SCHEMA_VERSION_MISMATCH`、`DATA_VERSION_MISMATCH`、`BUILD_KIND_MISMATCH`、`SCHEMA_INVALID`、`HASH_MISMATCH`、`REFERENCE_BROKEN`、`PUBLIC_CONDITION_FAILED`）を返す。成功時だけ`VerifiedBundle`（ブランド付き）を返し、失敗時は内容を一切返さない。`BundleLoadErrorCode`と`ExpectedBundle`を定義する。
    - 参照の整合（`REFERENCE_BROKEN`）は、診断セットの質問が存在する、`QUICK`がある、診断セットのテーマの結果解説・活かし方の問い・課題カードがそろう、`requiredFixedTextKeys`のキーがそろうこと。
    - **Property 39: バンドルの検証**（1種類の不備ごとに対応する符号を返し、内容を返さない。不備がなければ合格する）
    - **Validates: Requirements 10.4, 11.10**
    - 型の確認: `VerifiedBundle`が4.1の`SessionBundle`と5.3の`ViewBundle`に構造的に代入できること（キャスト不要）を型のテストで確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bundle/verifyBundleText.test.ts packages/domain/src/regional-values/bundle/verifyBundleText.property.test.ts`

  - [ ] 7.4 【A】`loadBundle`と読み込み失敗時の固定文言を実装する
    - `bundle/loadBundle.ts`に`loadBundle({ httpGet, url, expected, digest? })`を実装する。取得はGET 1回だけ（`cache: "no-cache"`、`credentials: "omit"`、`redirect: "error"`、`referrerPolicy: "no-referrer"`）、再試行も別のバンドルへの切替もしない。本文の上限は2,000,000バイト（`TOO_LARGE`）。`fetch`を直接参照せず、`httpGet`を引数で受ける。`bundle/loadFailureTexts.ts`に`LOAD_FAILURE_TEXTS`（`DEMO`は読み込み失敗の旨、`PUBLIC`は「準備中」だけ）を定義する。
    - テスト: `httpGet`のfakeが1回だけ呼ばれること、HTTPエラーが`FETCH_FAILED`、上限超過が`TOO_LARGE`、成功時に`VerifiedBundle`を返すこと、`LOAD_FAILURE_TEXTS`が禁止語の試験用一覧の語を含まないこと。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bundle/loadBundle.test.ts`
    - _Requirements: 9.2, 10.4, 10.17, 11.10_

- [ ] 8. 質問バンク・課題カード・事実項目・固定文言の検査を実装する
  - [ ] 8.1 【A】検査用設定の契約と読込み関数を追加する
    - `packages/contracts/src/models/regional/config.ts`へ追記する: `NeutralityConfigSchema`（候補者名と政党名、現職か新人かを示す語、二重質問の語、誘導語（1語以上）、文字数差の設定値（ラベル、方向）、施策名、予算や賛否の語、大切さ質問の型、前提文の型、否定表現、排他的な語、軽視を表す語、禁止語、漢数字の免除語、`wordCategories`（`SUPERIORITY`・`RECOMMENDATION`・`VOTE_URGING`の各1語以上）、`guidanceNames`、`choiceEncouragingWords`、`userClaimPatterns`）と`BuildConfigSchema`（`dataVersion`は`^\d{4}-\d{2}-\d{2}\.\d+$`、`quoteMaxChars`、`realNames`、`properNouns`、`requiredApprovers`）。`bannedWords`と`loadedWords`が`wordCategories`の和集合を含むことを読込み時に検査する。
    - `apps/api/src/regional-values/build/loadConfig.ts`へ`loadNeutralityConfig`と`loadBuildConfig`を追記する（2.1のファイルを変更するため、2.1の完了後に行う）。読めない、誘導語が0語、検査に失敗した場合は`CONFIG_UNREADABLE`にする。
    - **このタスクは設定ファイルの実体（`neutrality.json`、`build.json`）を作らない。** 要件に書かれていない語の一覧の内容は人間の承認が要るため、13.1で扱う。テストは`tests/harness/regional-values/testConfig.ts`に置く試験専用の語（実在の人名・政党名を含めない）の設定を、一時ディレクトリへ書いて読む。
    - テスト: `config.neutrality.test.ts`（誘導語0語、カテゴリ不足、和集合の欠落、`dataVersion`の書式、余剰キー）、`loadConfig.test.ts`への追記（欠落・破損・正常）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/config.neutrality.test.ts apps/api/src/regional-values/build/loadConfig.test.ts`
    - _Requirements: 3.3, 3.5, 3.12, 4.18, 7.9, 7.11, 8.9_

  - [ ] 8.2 【A】文字数・文・数値表現の判定（`textMetrics`）を実装する
    - `packages/domain/src/regional-values/bank/textMetrics.ts`に、`lengthOf`（前後の空白を除いたコードポイント数）、`contentLength`（空白と改行を除いたコードポイント数）、`sentencesOf`（「。」「？」「！」と改行で区切った空でない文）、`numericTokens`（算用数字、全角数字、漢数字の連なり、年の表現（西暦、令和、平成、昭和）。免除語の一部なら数えない。免除語は引数で受ける）、`containsAny`（NFKC正規化して全角と半角を区別しない部分文字列の判定）を実装する。
    - テスト`textMetrics.test.ts`: 全角・半角の同一視、サロゲートペアの1文字計数、前提文の60文字と61文字、解説の49・50・200・201文字、「一方」「万全」の免除、年の表現。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bank/textMetrics.test.ts`
    - _Requirements: 3.1, 3.3, 3.17, 11.7_

  - [ ] 8.3 【A】質問バンクの検査（文字列系）を実装する
    - `bank/textChecks.ts`に、`NAME_FREE`、`SINGLE_ISSUE`、`LOADED_TERMS`、`IMPORTANCE_PATTERN`、`PREMISE`、`POSITIVE_FRAMING`、`NON_EXCLUSIVE`、`NO_FACT_NUMBERS`（バンドルの事実項目の数値・調査年と一致する表現を検出。事実の数値は`ReadonlySet<string>`で受け、事実項目の型を取り込まない）を実装する。AIを呼ばず、検査関数は質問形式と診断セットだけで分岐し、テーマ・データ種別・起案者区分で免除しない。
    - `tests/harness/regional-values/bankInjection.ts`に、合格する質問バンクの構築と、1種類の違反の注入、検査の基準から独立に計算した期待判定を置く（8.4・8.5が再利用する）。
    - **Property 18: 質問バンクの文字列の検査**（注入した検査IDと質問IDだけを返し、注入のない質問は違反にならない）
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.13, 3.14, 3.15, 3.16, 3.17, 12.4**
    - 例示テスト: 各検査の合格例と拒否例（前提文の60文字と61文字を含む）。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bank/textChecks.test.ts packages/domain/src/regional-values/bank/textChecks.property.test.ts`

  - [ ] 8.4 【A】質問バンクの検査（釣り合い・構成・承認系）を実装する
    - `bank/balanceChecks.ts`に、`LABEL_SYMMETRY`（固定5文言の完全一致、+2と−2・+1と−1の文字数差が設定値以下）、`DIRECTION_LENGTH`（方向A・Bの説明の文字数差が設定値以下）、`SWAP_BALANCE`（入れ替える質問と入れ替えない質問の数の差が1以下）、`DIRECTION_BALANCE`（方向Aの`CHANGE`と`CONTINUE`の数の差が1以下。`NEUTRAL`は数えない）、`SET_COMPOSITION`（`QUICK`は異なる3テーマ×各2問の計6問・`PRIORITY_PICK`なし、`FULL`は6テーマ×各2問と`PRIORITY_PICK`1問の計13問、重みはすべて1）、`REVIEW_APPROVAL`（版ごとの偏り確認と承認。版が変わった質問は前の版の記録を引き継がない）を実装する。
    - **Property 19: 釣り合いの検査**（文字数差の20と21、数の差の1と2などの境界を含む）
    - **Property 20: 診断セットの構成**（`QUICK`の3テーマは診断セット定義のデータで決まり、データを変えるとコードを変えずに3テーマが変わる）
    - **Property 21: 承認の版拘束**
    - **Validates: Requirements 2.1, 3.2, 3.6, 3.7, 3.8, 3.9, 3.10, 12.4, 12.12**
    - 例示テスト: 診断セットの拒否例（`QUICK`に`PRIORITY_PICK`、2テーマと4テーマ、優先条件の欠落、`FULL`のテーマの欠落、`PRIORITY_PICK`が0問と2問、重みが1以外）、各テーマの質問数0・1・2。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bank/balanceChecks.test.ts packages/domain/src/regional-values/bank/balanceChecks.property.test.ts`

  - [ ] 8.5 【A】`inspectQuestionBank`で検査を集約する
    - `bank/inspectQuestionBank.ts`に、8.3・8.4の検査を実行して違反を全件集める関数を実装する。順序は検査の定義順、次に質問バンクの定義順で決定的。1件でも違反があれば成功値を返さず、入力のバンクを変更しない。診断セットごとの扱い（`QUICK`の承認不足は拒否、`FULL`の未定義・承認不足は含めずエラーなし、構成違反は常に拒否）は、設計書の表どおりに9.2の`assembleBundleBody`が適用する。
    - **Property 22: 全違反の収集と非破壊**
    - **Property 23: 検査の免除なし**（テーマ、データ種別、起案者区分だけを変えても違反の集合が変わらない）
    - **Validates: Requirements 3.11, 3.12**
    - 例示テスト: 複数の違反の同時検出、順序の決定性。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bank/inspectQuestionBank.test.ts packages/domain/src/regional-values/bank/inspectQuestionBank.property.test.ts`

  - [ ] 8.6 【A】根拠の検査と引用の照合を実装する
    - `packages/domain/src/regional-values/content/checkGrounding.ts`に、文の数値表現・日付表現・固有名詞（固有名詞の一覧は引数）がすべて引用原文に含まれるかを判定する`checkGrounding`を実装する。課題カードの検査と、AI下書きの検査（11.3）が同じ関数を使う。`content/quoteMatch.ts`に、改行と連続する空白を半角空白1つにそろえた部分文字列の照合と、引用の長さ（改行を除く文字数）の上限判定を実装する。
    - **Property 24: 根拠の検査**（引用原文にある数値・日付・固有名詞だけなら合格し、ないものを1つ混入すると必ず不合格）
    - **Property 25: 引用の照合**（改行と連続する空白の挿入や置換を含む切出しは見つかり、1文字変えると見つからない。上限超過は必ず`QUOTE_TOO_LONG`）
    - **Validates: Requirements 7.6, 7.11, 8.9**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/content/checkGrounding.test.ts packages/domain/src/regional-values/content/grounding.property.test.ts`

  - [ ] 8.7 【A】課題カードと事実項目の検査（架空データ分）を実装する
    - `content/checkIssueCard.ts`に`checkFixtureIssueCard`、`content/checkFactItem.ts`に`checkFixtureFactItem`を実装し、指摘（`GateFinding`）を返す。引数の型を`FIXTURE`のカード・事実項目に限定する。検査は、契約、引用の実在と長さ、背景説明・用語解説の根拠、架空課題の検査（実在名の一覧に一致する語を含まない、背景説明に「架空」が1回以上、出典は架空の資料IDだけ）、承認状態、診断セットの網羅（含まれる全テーマに承認済みのカードが1件以上）。`FIXTURE`の事実項目は契約の検査のみ。
    - `REAL_AI`用の検査（利用条件、送信可否、ライセンス情報、原本の変化、事実の数値の算出値との一致）は、要件更新（【要確認1】【要確認2】【要確認8】）と実データの読込みが要るため、13.11と13.12で別の関数として追加し、`checkIssueCard`・`checkFactItem`が種別で振り分ける。このタスクの関数は`REAL_AI`の入力を型で受け付けず、検査を黙って省略しない。
    - テスト: 6.2の架空データが指摘0件になること、架空課題が「愛媛県」を含む・「架空」がない・実在名を含む・出典にURLがある・引用が資料にない・用語解説が引用にない数値を含む場合の拒否。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/content/checkIssueCard.test.ts packages/domain/src/regional-values/content/checkFactItem.test.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.9, 7.11, 7.15, 7.16, 7.17_

  - [ ] 8.8 【A】固定文言・結果解説・活かし方の問いの検査を実装する
    - `content/inspectFixedTexts.ts`に`inspectFixedTexts`・`inspectResultTexts`・`inspectGuidance`を実装する。禁止語を含まない（免除は`notice`だけ。`banner.REAL_AI`の免除は【要確認18】のため13.4で扱う）、優先条件の結果解説が型「どちらかを選ぶなら、◯◯では△△を先に進めたい考えに近い（やや／強く）」に一致（±1は「やや」、±2は「強く」、0は両方向を同程度に述べる文）し否定表現・軽視を表す語を含まない、利用者の性格・思想・属性を述べる型（`userClaimPatterns`）に一致しない、各文が60文字以内、差込みの名前がキーの許可と一致、活かし方の問いが名称の一覧（`guidanceNames`）と特定の選択を促す語を含まず文末が「か」の1文。違反は`FIXED_TEXT_INVALID`、未承認・キー欠落は`FIXED_TEXT_NOT_APPROVED`の指摘で返す。
    - **Property 50: 文言の出所と禁止語**（検査に合格するバンドルの表示モデルは、`notice`を除くすべての文が承認済みの固定文言と差込み値と質問文・選択肢ラベルだけで構成され、禁止語を含まず、各文が60文字以内）
    - **Validates: Requirements 5.3, 5.10, 5.12, 5.18, 6.7, 11.7, 12.2**
    - テスト: 6.3の架空データが試験専用の設定で指摘0件になること、各検査の拒否例。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/content/inspectFixedTexts.test.ts packages/domain/src/regional-values/content/inspectFixedTexts.property.test.ts`

- [ ] 9. `dataMode`の判定と`FIXTURE`のビルドを実装する
  - [ ] 9.1 【A】`resolveDataMode`と判定表、公開版の出力条件を実装する
    - `packages/domain/src/regional-values/gate/resolveDataMode.ts`に、`resolveDataMode(requested, buildKind, findings)`を純関数で実装する。判定表（状況A〜E × `REAL`・`FIXTURE`・`REAL_PREFERRED`）どおりに、採用するデータ種別、終了コード、`switched`、切替の理由コードを返す。`REAL_PREFERRED`が切り替えるのは`SHORTAGE`だけで、`DEFECT`は切り替えず失敗する。公開版は`dataMode`が`REAL`以外なら`PUBLIC_REQUIRES_REAL`で失敗し、指摘が1件でもあれば失敗する。
    - 指摘（`GateFinding`）は引数で受け、実データから指摘を作る処理は13.12で行う。ここでは合成した指摘で検査する。
    - **Property 32: `dataMode`の判定**（判定表と一致し、全域で決定的。`REAL`の5条件に対応する指摘を1つずつ加えると失敗する）
    - **Property 40: 公開版の出力条件**（`REAL`で指摘なし、かつ4つの記録（利用条件、送信可否、法務確認、公開承認）の不足の指摘がないときに限り出力される）
    - **Validates: Requirements 10.2, 10.5, 10.13, 10.15, 10.16, 12.13**
    - 例示テスト: 判定表の全セル（A〜E × 3モード）を1件ずつ。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/gate/resolveDataMode.test.ts packages/domain/src/regional-values/gate/resolveDataMode.property.test.ts`

  - [ ] 9.2 【A】`assembleBundleBody`と`contentHash`の付与を実装する
    - `packages/domain/src/regional-values/bundle/assembleBundleBody.ts`に、検査済みの質問バンク、課題カード、結果解説、固定文言、活かし方の問い、設定値、AIの貢献を示す数（この段階では0）から、公開バンドルの本体を作る純関数を実装する。含めるのは、現在の版に承認記録のある質問、`APPROVED`のカード、承認済みの結果解説と固定文言、構成条件と承認がそろった診断セットだけ。除外した項目は`GateFinding`に記録する。診断セットの扱いは設計書の表に従う（`QUICK`の承認不足は拒否、`FULL`は未定義・承認不足なら含めない）。質問・結果解説・課題カードを`{ dataKind, recordId, payload }`にして既存の`validateDataBoundary`へ渡し、混在を検出する。
    - `bundle/finalizeBundle.ts`に、`contentHash`の計算（7.2）、`RegionalBundleSchema`による検証、ハッシュの再計算による自己検査を実装する。
    - **Property 35: バンドルの不変条件**（`dataKind`の一致、承認済み・検証済みだけが入ること、メタの整合、メタ5項目。反する入力からはバンドルが出力されない）
    - **Validates: Requirements 7.8, 7.10, 7.15, 7.19, 8.12, 10.1, 10.17, 11.9**
    - 例示テスト: `REAL_AI`の質問が1件混じる`FIXTURE`の入力で混在が検出されること、承認記録のない質問・`PENDING`のカードが除外され指摘に残ること。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/bundle/assembleBundleBody.test.ts packages/domain/src/regional-values/bundle/assembleBundleBody.property.test.ts`

  - [ ] 9.3 【A】ビルドレポートとビルドログを実装する
    - `apps/api/src/regional-values/build/report.ts`に、`BuildReport`を作る関数（自由文を持たず、固定のコードとIDだけ。失敗時は`output`が`null`で`exitCode`が1）、`build/buildLog.ts`に、`createSafeLogger`で`BUILD_START`・`REAL_DATA_INSUFFICIENT`・`DATA_MODE_SWITCHED`・`BUILD_DONE`を出す関数を実装する。回答データ、認証キー、本文を出力に含めない。
    - テスト: 設計書のレポートとログの例と同じ形になること、`BuildReportSchema`に適合すること、ログに目印の文字列（認証キーに見立てた値）が現れないこと。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/build/report.test.ts apps/api/src/regional-values/build/buildLog.test.ts`
    - _Requirements: 7.8, 7.15, 7.19, 9.9, 10.16_

  - [ ] 9.4 【A】`runBuild`（`FIXTURE`のビルド）を実装する
    - `apps/api/src/regional-values/build/runBuild.ts`に、設計書の手順を実装する: 設定の読込み、出力先の古い`bundle.json`の削除（削除できなければ失敗）、`FIXTURE`なら実データを読まない、架空データ（`packages/fixtures/src/regional-values/`）の読込み（パスで読み、`@ehime-vote-navigator/fixtures`をimportしない）、検査（8.5、8.7、8.8）、`resolveDataMode`、`assembleBundleBody`、`bundle.json`と`build-report.json`の原子的な書込み（既存の`atomicReplaceFile`）。`REAL`と`REAL_PREFERRED`のための`RealDataLoader`の差込み口を用意し、既定の実装は`data/real/regional-values/`が存在しない場合に`REAL_DATA_ABSENT`（不足）を返す。ディレクトリが存在し空でない場合は、実データの読込みが未実装（13.12）であることを示して終了コード1にする（黙って架空データへ切り替えない）。
    - `build/loadFixtureData.ts`と`build/writeOutputs.ts`を分け、時計は`--generated-at`で固定でき、テストは時計を注入する。
    - **Property 33: 切替の理由コードの一致**（`meta`、レポート、ログの理由コードが同じ集合で、空でなく、すべて不足の区分。切り替えないときは3か所とも空）
    - **Property 34: 失敗時に成果物を残さない**（失敗する入力で`bundle.json`を残さず、古い`bundle.json`は削除され、レポートの`output`は`null`）
    - **Property 37: 出力の決定性**（同じ入力と同じ`generatedAt`で同一のバイト列と`contentHash`。`generatedAt`だけを変えると`contentHash`が変わる）
    - **Validates: Requirements 7.16, 10.13, 10.15, 10.16, 11.9, 12.13**
    - 例示テスト（一時ディレクトリ、試験専用の設定）: `FIXTURE`に`REAL_AI`のデータを1件混ぜるとビルドが失敗すること、`FIXTURE`が`REAL_DATA_ABSENT`でも成功すること、`REAL_PREFERRED`で実データがない場合に架空データへ切り替わり理由が記録されること、`REAL`で実データがない場合に失敗すること。
    - `npm.cmd run build --workspace @ehime-vote-navigator/domain`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/build/runBuild.test.ts apps/api/src/regional-values/build/runBuild.property.test.ts`

  - [ ] 9.5 【A】CLI（`regional-values build`）と`package.json`のscriptを追加する
    - `apps/api/src/regional-values/cli.ts`に`runRegionalValuesCli(argv, deps)`、`main.ts`にエントリを実装する（`apps/api/src/analysis/main.ts`と同じ方式。ポートを開かず、エラーの詳細を出力しない）。引数は`build --kind demo|public --data-mode REAL|FIXTURE|REAL_PREFERRED [--generated-at <ISO>] [--config-dir <path>]`。`--data-mode`の既定はデモ版が`REAL_PREFERRED`、公開版が`REAL`で、公開版は`REAL`以外を受け付けない。書き出したバンドルをブラウザ向けの`verifyBundleText`（7.3）で自己検査し、合格しなければ失敗にする。
    - 根の`package.json`と`apps/api/package.json`の`scripts`へ、`regional-values`を1行ずつ追加する（`analysis`と同じ形）。これ以外の変更はしない。
    - 例示テスト: 引数の誤りで終了コード1、`--data-mode FIXTURE`でバンドルが書かれること、書かれたバンドルが`verifyBundleText`に合格すること（Property 38のビルド側）、`--config-dir`に試験専用の設定を渡せること。
    - `npm.cmd run build --workspace @ehime-vote-navigator/domain`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/cli.test.ts`
    - _Requirements: 7.16, 10.1, 10.3, 10.13, 10.16, 11.10_

- [ ] 10. ブラウザ向けの入口と共同開発者向けの連携ガイドを追加する
  - [ ] 10.1 【A】ブラウザ向けの入口（subpath export）を追加する
    - `packages/domain/src/regional-values/browser.ts`を新規作成し、`map/`、`session/`、`view/`、`bundle/`（取得と検証）だけをexportする（`bank/`、`content/`、`gate/`、ビルドの組立ては公開しない。`storage/`は13.8で追加）。`packages/domain/package.json`の`exports`へ`"./regional-values"`（`types`と`import`）、`packages/contracts/package.json`の`exports`へ`"./regional"`を追加する。既存の`"."`は変更しない。
    - **Property 52: 依存閉包**（`map/index.ts`から到達するモジュールに、`node:*`、Bedrock、ネットワークの識別子、現在時刻の取得、乱数、課題カード・事実項目・出典のモジュールの取込みが0件。`browser.ts`から到達するモジュールに、`node:*`、`Buffer`、`process`、`require`、現在時刻の取得、乱数が0件）
    - **Validates: Requirements 4.1, 9.6, 12.9**
    - 3.10の`importGraph.ts`を再利用して`browser.dependencyClosure.test.ts`を作る。`exports.test.ts`で、`package.json`の既存`"."`の値が変わっていないことと、新しい2つの入口が追加されていることを確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/browser.dependencyClosure.test.ts packages/domain/src/regional-values/exports.test.ts`

  - [ ] 10.2 【A】subpath exportが既存のビルドとテストに影響しないことを確認する
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`、続けて`npm.cmd run build --workspace @ehime-vote-navigator/domain`を実行し、`packages/contracts/dist/models/regional/index.js`と`packages/domain/dist/regional-values/browser.js`が生成されることを確認する（`dist`の存在確認はテストに含めない）。`npm.cmd run typecheck`を実行する。
    - 既存の`npm.cmd run build`（ワークスペース全体）と`npm.cmd run check:build-boundary`を1回ずつ実行して結果を確認する。`apps/web`は変更しない。失敗した場合は、この変更が原因かを切り分け（`exports`の追加行だけの差分であること）、原因が既存の状態にある場合は変更せず報告して停止する。
    - 既存の契約テストと入口テストが変更なしで成功することを確認する: `npx.cmd vitest run packages/contracts/src/contracts.test.ts packages/contracts/src/index.test.ts packages/domain/src/index.test.ts`
    - 焦点テスト: 上記の1行
    - _Requirements: 10.7, 10.8_

  - [ ] 10.3 【A】共同開発者向けの連携ガイドを作成する
    - `.kiro/specs/regional-values-map/ui-integration-guide.md`を新規作成する（実装済みの型と関数から書く）。内容: UIが使う型と関数の一覧（`AnswerValue`、`Answers`、`ValuesMap`、`MapError`、`DiagnosticState`、`DiagnosticEvent`、`diagnosticReducer`、`QuestionPresentation`、`presentQuestion`、`ResultViewModel`、`buildResultViewModel`、`CardView`、`AboutView`、`loadBundle`、`ExpectedBundle`、`LOAD_FAILURE_TEXTS`）、質問と回答のデータ形式、価値観マップの出力形式、診断の状態遷移の表、架空データによる使用例（6.4のテストへの参照）、ブラウザ向けのimport方法（`@ehime-vote-navigator/domain/regional-values`と`@ehime-vote-navigator/contracts/regional`。`apps/web`は現在ワークスペースのパッケージをimportしておらず、`dependencies`への宣言の要否は共同開発者が決める）、バンドルの取得URL`/regional-values/bundle.json`と`__RV_EXPECTED__`、画面からの禁止事項（表示文字列の自作、スコア・並び順の再計算、保存領域への書込み、バンドルのGET以外の通信、ドメインの内部モジュールの取込み、`AnswerValue`の自作）、検証用バンドルの作り方（9.5の`--config-dir`と、13.1の承認前は試験専用の設定を使う手順）。
    - 同期テスト`tests/regional-values/guideSync.test.ts`で、ガイドが`browser.ts`のexport名と`DiagnosticEvent`のすべての`type`、`DiagnosticState`のすべての`phase`を挙げていることを確認する。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/guideSync.test.ts`
    - _Requirements: 10.9_

- [ ] 11. AI下書き工程（Bedrockのfakeだけ。実Bedrockは呼ばない）を実装する
  - [ ] 11.1 【A】下書きの契約を追加する
    - `packages/contracts/src/models/regional/draft.ts`を新規作成し、`EvidenceUnit`、`GroundedSentence`、`IssueCandidateOutput`、`IssueSummaryOutput`、`BackgroundDraftOutput`、`TermGlossOutput`、`QuestionDraftOutput`、`NeutralityReviewOutput`、`ThemeClassifyOutput`、`DraftRunKey`、`DraftRecord`（`disposition`は`PENDING`・`ADOPTED`・`REJECTED`）、`DraftEvent`（`DRAFTED`・`REJECTED_BY_CHECKS`・`HUMAN_EDITED`・`HUMAN_REJECTED`）をstrictで定義する。`regional/index.ts`へ`draft.js`のexportを1行追加する。
    - テスト`draft.test.ts`: 各出力の合格例と拒否例（根拠IDの欠落、文が61文字、テーマ分類が6テーマと`UNCLASSIFIED`以外、保存時の`disposition`が`PENDING`以外、課題候補の根拠の事実項目IDの欠落、順位・スコア・推奨の項目の混入）。
    - `npm.cmd run build --workspace @ehime-vote-navigator/contracts`を実行してから焦点テストを実行する。
    - 焦点テスト: `npx.cmd vitest run packages/contracts/src/models/regional/draft.test.ts`
    - _Requirements: 8.8, 8.9, 8.10, 8.22_

  - [ ] 11.2 【A】下書きの入力の門（`checkDraftInput`）を実装する（入力長の判定を除く）
    - `apps/api/src/regional-values/draft/checkDraftInput.ts`に実装する。`FIXTURE`は利用条件と送信可否の確認を要求しない。`REAL_AI`は出典の`usage.status`が`CONFIRMED`、`transmission.status`が`ALLOWED`（記録なしと`UNKNOWN`を拒否）、入力の事実項目がすべて`VERIFIED`でなければ拒否し、満たされなかった条件をすべて理由に並べる。`ISSUE_CANDIDATE`の入力は`VERIFIED`の事実項目に限り（`FIXTURE`の事実項目は検証状態を持たないため、架空の資料IDを持つ事実項目を入力にできる）、`PROVISIONAL`の事実項目、未集計の本文、利用者の回答、最優先テーマ、価値観マップを含めない（`FACT_NOT_VERIFIED`）。共通で、入力に区切り文字列がないこと、種別が1つであること、入力資料のSHA-256が既存の選挙公報の取り込み記録に登録されていないこと（既存の取り込み記録の照会関数を読み取りだけで使う）を確認する。
    - 入力長（20,000文字）の事前判定は、数え方が【要確認24】で未決のため、このタスクでは実装しない（13.2）。クライアントが実行時に強制する制約は緩めない。
    - **Property 28: 入力の門**（長さの条件を除く。判定が参照判定と一致し、`REAL_AI`で3条件のどれかを欠くとBedrockのfakeの呼出しが0回で保存が0件、`PROVISIONAL`の事実項目は入力に現れない）
    - **Validates: Requirements 7.12, 7.19, 8.6, 8.7, 12.5, 12.14**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/checkDraftInput.test.ts apps/api/src/regional-values/draft/checkDraftInput.property.test.ts`

  - [ ] 11.3 【A】下書きの決定的検査（`DR_*`）を実装する
    - `draft/checks.ts`に、`DR_JSON`、`DR_GROUND_EXISTS`、`DR_GROUND_MATCH`（8.6の`checkGrounding`を再利用）、`DR_FORBIDDEN_WORDS`（禁止語と誘導語の一覧）、`DR_SENTENCE_LENGTH`、`DR_THEME_RANGE`、`DR_QUESTION_RULES`（質問の下書きに8.3〜8.5の検査を同じ条件で適用し、起案者区分を`AI_DRAFT`にする）、`DR_CANDIDATE_FACTS`（課題候補の根拠の事実項目IDが入力の`VERIFIED`の事実項目に実在し、候補の文の数値・日付が根拠の値と一致する）を実装する。1つでも失敗すれば、失敗した検査の区分と対象の文または項目を返す。
    - **Property 27: 不正な出力の拒否**（存在しない根拠ID、引用にない数値・日付・固有名詞、推奨語、範囲外のテーマ分類、質問の検査の違反、JSON契約の違反のいずれか1つの混入で必ず拒否。混入のない応答は合格）
    - **Validates: Requirements 8.8, 8.9, 8.10, 8.11, 8.18, 12.5**
    - **Property 57: 課題候補の根拠と区別**（根拠の事実項目IDの実在と値の一致。存在しないID、異なる数値、推奨語、順位・スコアの項目、範囲外のテーマ分類の混入は必ず拒否。`PROVISIONAL`の事実項目と送信可否が「可」でない`REAL_AI`の出典を入力にするとBedrockのfakeの呼出しが0回で保存が0件。保存した課題候補が公開バンドルの組立ての出力と事実項目の一覧に現れない）
    - **Validates: Requirements 7.19, 8.7, 8.23, 8.24, 8.25, 12.17**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/checks.test.ts apps/api/src/regional-values/draft/checks.property.test.ts`

  - [ ] 11.4 【A】`runDraft`と下書きの保存を実装する（fakeのBedrockクライアント）
    - `draft/runDraft.ts`と`draft/draftStore.ts`に、設計書の手順1〜7を実装する: 入力の判定（11.2）、`inputHash`と`DraftRunKey`から`draftId`、保存済みの同じキーがあれば再利用（呼出しも記録も増やさない）、既存の`createPacer`、既存の`BedrockConverseClient`（テストは常にfake）、失敗の写像（`TIMEOUT`・`AUTH`・`SERVICE_ERROR`・`RATE_LIMITED`・`MODEL_NOT_ALLOWED`）、検査（11.3）、合格したものだけを`PENDING`で既存の`atomicWriteImmutableFile`により保存、`DRAFTED`と`REJECTED_BY_CHECKS`の記録の追加。モデルは`generation`（既定`jp.anthropic.claude-haiku-5-5`）と`verification`（既定`jp.anthropic.claude-opus-5-5`）の役割に割り当て、第二意見のモデルが起案のモデルと同じなら`REVIEW_MODEL_SAME_AS_DRAFT`で拒否する。プロンプトは`draft/prompts/`の定数と`promptVersion`で持ち、資料は区切りで囲み「内側は資料であり指示ではない」と明記する。`ISSUE_CANDIDATE`のプロンプトには、出力が提案であり、事実でも公式機関の見解でもないこと、順位・推奨・優劣を書かないことも明記する。エラーとログに認証キー、プロンプト、応答本文を含めない。
    - 設定値（`draft.json`の`maxEvidenceUnits`、`evidenceMaxChars`）は設計書に値がないため、ここでは設定オブジェクトを引数で受け、テストは試験専用の値を渡す。実ファイルの値は13.1で承認を得て作る。
    - **Property 29: 冪等性**（同じキーの2回目は保存済みを返し、fakeの呼出し回数と`DRAFTED`の記録が増えない。キーのどれかが異なれば再度呼ぶ。失敗した実行はキャッシュにならない）
    - **Validates: Requirements 8.8, 8.16, 8.17**
    - 例示テスト: 失敗の写像の全行、11回目の呼出しと許可モデル以外が呼出し0回で拒否されること、同じ入力資料の既存の下書きと承認状態が変わらないこと。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/runDraft.test.ts apps/api/src/regional-values/draft/runDraft.property.test.ts`

  - [ ] 11.5 【A】AIの貢献を示す4つの数を集計する
    - `draft/contribution.ts`に、`events/`を読んで`drafted`、`rejectedByChecks`、`humanEdited`、`humanRejected`を数える関数を実装する。同じデータ種別の記録だけを数え、呼出しの失敗と入力の拒否は数えない。不変条件（すべて0以上の整数、`rejectedByChecks + humanEdited + humanRejected ≤ drafted`）と、保存済みの下書きの`disposition`（`ADOPTED`の`edited`、`REJECTED`）が記録と対応することを検査する。
    - **Property 30: AIの貢献を示す4つの数**（事象の列に対して記録から数えた値と一致し、不変条件を満たす）
    - **Validates: Requirements 8.22, 12.15**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/contribution.test.ts apps/api/src/regional-values/draft/contribution.property.test.ts`

  - [ ] 11.6 【A】承認台帳と、下書きの採用・却下を実装する
    - `draft/approvalLedger.ts`に、承認台帳（`approvals/<targetKind>/<targetId>.json`）の読込みと`countValidApprovals`を純関数で実装する。現在の内容の`targetHash`（承認の項目を除いた正準JSONのSHA-256）に一致する記録のうち、異なる承認者IDの数が`requiredApprovers`以上でなければ`APPROVER_COUNT_INSUFFICIENT`（不足）。1人目は対象の`approval`の承認者とし、`approval`の型は変えない。
    - `draft/review.ts`に、採用（修正なしは記録なし、人が直した場合は`HUMAN_EDITED`）、却下（`HUMAN_REJECTED`）、採用した内容への再検査（人が書いたものと同じ条件）、`approve`（承認台帳への追記）を実装する。`approve`は、現在の版の偏り確認が`BIAS_SUSPECTED`の質問を承認せず拒否する（扱いは【要確認23】の決定まで保留し、13.3で実装する）。
    - **Property 31: 承認者数**（現在の内容に一致する記録のうち異なる承認者IDの数が`requiredApprovers`以上のときに限り足りる。内容を変えると2人目以降の記録は無効になる）
    - **Validates: Requirements 3.10, 7.1, 10.5**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/approvalLedger.test.ts apps/api/src/regional-values/draft/approvalLedger.property.test.ts apps/api/src/regional-values/draft/review.test.ts`

  - [ ] 11.7 【A】下書き工程のCLIコマンドを配線する
    - `apps/api/src/regional-values/cli.ts`（9.5で作成）へ、`draft run`、`draft list`、`draft review`、`draft counts`、`approve`の各コマンドを追記する。`draft run`は`ISSUE_CANDIDATE`を含むすべてのtaskを扱い、`draft list`は課題候補を事実項目とは別の一覧で表示する。`draft run`は実クライアントを組み立てる配線までを実装し、このfeatureの範囲では実行しない（実Bedrockの呼出しは利用者が別途判断する手動の作業）。テストは常にfakeを注入する。
    - 例示テスト: 引数の誤りで終了コード1、`draft list`・`draft counts`・`draft review`の出力、`approve`が承認台帳に追記すること。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draftCli.test.ts`
    - _Requirements: 8.2, 8.4, 8.21_

  - [ ] 11.8 【A】架空資料でAI下書きの流れを再現する統合テストを追加する
    - `tests/regional-values/draftFlow.test.ts`に、架空資料の入力、`ISSUE_CANDIDATE`（`VERIFIED`の事実項目だけを入力にし、公開バンドルに含まれないこと）、`ISSUE_SUMMARY`と`QUESTION_DRAFT`の下書き、検査、`PENDING`での保存、検査に失敗する応答（存在しない根拠ID、資料にない数値、推奨語）が保存されず不合格の件数に加算されること、採用と承認、`assembleBundleBody`への収録（`APPROVED`だけ）、バンドルの`aiContribution`が一時ディレクトリの記録の集計と一致することを、Bedrockのfakeで通しで確認する。`fetch`が1回も呼ばれないこと（既存のネットワーク遮断）も確認する。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/draftFlow.test.ts`
    - _Requirements: 8.21, 12.5, 12.10, 12.15_

  - [ ] 11.9 【A】AI下書き工程が価値観マップの計算に触れないことを静的に検査する
    - `tests/regional-values/draftIndependence.test.ts`に、`apps/api/src/regional-values/draft/`のモジュールと、それが直接または間接に取り込むすべてのモジュールに、`packages/domain/src/regional-values/`の`map/`、`session/`、`view/`のモジュールの取込みが0件であることを、3.10の`importGraph.ts`で確認する。下書き工程の入力の型（`EvidenceUnit`、課題候補の入力の事実項目）が、`Answers`、`ValuesMap`、`DiagnosticState`を受け取らないことを、`// @ts-expect-error`を使う型のテストで確認する。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/draftIndependence.test.ts`
    - _Requirements: 8.2, 8.3, 12.18_

- [ ] 12. Checkpoint - 分類A（MVP）の完了確認
  - [ ] 12.1 【A】既存資産の保全を静的検査と差分で確認する
    - `tests/regional-values/preservation.test.ts`を新規作成する。本featureの新規ファイル（`packages/*/src/**/regional*`、`apps/api/src/regional-values/**`、`tests/regional-values/**`）が、旧マッチング機能のモジュール、`apps/api/src/ocr/`、`apps/web`をimportせず、関数を呼び出さないこと、新規テストに`skip`・`todo`・`only`がないことを静的に検査する（Req 10.6、10.7）。画面に一致度・立場記録・候補者比較を出す固定文言のキーがないことも確認する。
    - 読み取りだけの`git status --short`と`git diff --stat`、`git diff --diff-filter=D --name-only`で、次を確認して件数だけ報告する: 追跡済みの既存ファイルの変更が、`packages/contracts/src/models/index.ts`と`packages/domain/src/index.ts`の各1行、ルートと`apps/api`の`package.json`の`scripts`1行ずつ、`packages/contracts`と`packages/domain`の`package.json`の`exports`追記だけであること、削除されたファイルが0件、既存のテストファイルの変更が0件、`apps/web`・`data/`・他のspec・`package-lock.json`の変更が0件であること。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/preservation.test.ts`
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.10_

  - [ ] 12.2 【A】全体のテスト・lint・型検査・ビルドを実行し、開始前と比較する
    - 実行順: `npm.cmd test -- --reporter=json --outputFile=dist/regional-values-records/vitest-after.raw.json`（全体のテストは1.1と本タスクでだけ実行する）、`npm.cmd run lint`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run check:build-boundary`。development serverは起動せず、実Bedrockは呼ばない。結果は件数だけ報告する。
    - 1.1の`test-baseline-before.json`と同じ形で`.kiro/specs/regional-values-map/records/test-baseline-after.json`を書き、Req 10.11の判定を行う: (a)失敗数が開始前以下、(b)開始前に成功していたテストがすべて成功（`test-baseline-before.passed.txt`との照合）、(c)実行数が開始前以上、(d)スキップ数が開始前以下。1つでも満たさなければ完了と扱わず、原因を報告して停止する。
    - 分類Aの完了条件（MVP）を確認する: 6.4の使用例のテストと9.5の`FIXTURE`ビルドのテストが成功し、クイック版の価値観マップが架空データ（代替データ）で動くこと。実データでの完了は13.17で確認する。
    - Ensure all tests pass, ask the user if questions arise.
    - 分類Bまたは分類Cのタスクを実施した場合は、その完了後にこのタスクをもう一度実行する。
    - _Requirements: 10.11, 12.10, 12.11_

- [ ] 13. 未決事項の解決後に実装する（分類B）
  - [ ] 13.1 【B】検査用の語の一覧を確定し、`neutrality.json`・`build.json`・`draft.json`を作成する
    - **待つ条件**: 利用者による語の一覧の承認。対象は、design.mdのOpen Decisionsの「(7)(18) 否定表現、前提文の型、排他的な語、予算や賛否の語、施策名の一覧」、「固有名詞の検査用一覧と実在名の設定一覧」、【要確認7】の漢数字の免除語、`wordCategories`（`SUPERIORITY`・`RECOMMENDATION`・`VOTE_URGING`）の語、誘導語（1語以上）、候補者名と政党名の一覧、`guidanceNames`、`dataVersion`の初期値、`draft.json`の`maxEvidenceUnits`と`evidenceMaxChars`。要件に書かれていない語・値は、実装者が決めず、案を作って承認を求める。
    - 内容: 承認された値で`config/regional-values/neutrality.json`、`build.json`、`draft.json`を作り、8.1の読込み関数で読めること、6.1〜6.3の架空データ（質問、課題カード、固定文言、結果解説、活かし方の問い）がこの設定で8.5・8.7・8.8の検査に通ることを`tests/regional-values/repoConfigFixtures.test.ts`で確認する。通らない場合は架空データの文面を直す（要件の更新ではない）。
    - このタスクが済むまで、リポジトリの設定だけで`regional-values build`は実行できない（`CONFIG_UNREADABLE`で止まる）。共同開発者の動作確認は、9.5の`--config-dir`に試験専用の設定を指定して行える。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/repoConfigFixtures.test.ts`
    - _Requirements: 3.3, 3.4, 3.5, 3.12, 3.13, 3.15, 3.16, 7.9, 8.9_

  - [ ] 13.2 【B】下書きの入力長の数え方を確定し、`INPUT_TOO_LONG`の事前判定を実装する
    - **待つ条件**: 【要確認24】（Req 8.5の「文字」の数え方を、既存クライアントのUTF-16コード単位に合わせるか、コードポイントに合わせるかの要件更新）の決定。
    - 内容: 決定した数え方で、11.2の`checkDraftInput`に事前判定を追加する。20,000と20,001、基本多言語面の外の文字の境界例を、11.2のProperty 28のテストに追加する。クライアントが実行時に強制する制約は緩めない。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/checkDraftInput.test.ts apps/api/src/regional-values/draft/checkDraftInput.property.test.ts`
    - _Requirements: 8.5_

  - [ ] 13.3 【B】偏りの疑い（`BIAS_SUSPECTED`）がある質問の承認操作を実装する
    - **待つ条件**: 【要確認23】（偏りの疑いの判定が付いた質問を承認して公開してよいか。設計の既定は、承認を妨げず、承認の操作に「指摘事項を確認した」旨の確認を挟む）についての利用者の判断。
    - 内容: 11.6の`approve`が`BIAS_SUSPECTED`の質問を拒否している状態を、決定どおりに変更する（確認の入力を注入できるようにし、確認がなければ承認しない）。拒否・確認あり・確認なしの例示テストを追加する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/draft/review.test.ts`
    - _Requirements: 3.10_

  - [ ] 13.4 【B】実データ用の固定文言（非公式表示、ライセンス表示）と、カード・Aboutの`REAL_AI`の分岐を実装する
    - **待つ条件**: 【要確認18】（Req 5.12の禁止語の検査から、Req 10.18の非公式表示の文言を免除する要件更新）、Open Decisionsの「(6) ライセンス表示の文面」の人間の承認、「画面と文書全体で『愛媛県』の名称を使う範囲」の決定。
    - 内容: `banner.REAL_AI`の禁止語検査の免除（8.8）、`license.*`の固定文言、`buildCardView`の`license`・`credit`・加工の有無（CC BY 4.0のときは出典・ライセンス・変更の有無の表示）、`buildAboutView`の`unofficial`（Req 10.18の文言）を、5.10と8.8のファイルへ追記する。`FIXTURE`の表示が変わらないことを既存の例示テストで確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/cardView.test.ts packages/domain/src/regional-values/view/aboutView.test.ts packages/domain/src/regional-values/content/inspectFixedTexts.test.ts`
    - _Requirements: 5.12, 5.13, 7.4, 7.21, 10.18_

  - [ ] 13.5 【B】結果画面の表示順を確定する
    - **待つ条件**: 【要確認19】（Req 1.3の導線の順序と、Req 5.1・5.8・5.9の結果画面の構成の関係。設計の既定は説明をマップより前に置く案）についての利用者の判断。
    - 内容: 5.8の`defaultSectionOrder`を決定どおりに更新し、全体の順序と相対順（注意書き、最優先テーマ、段階のグループ、整理の説明）を固定値で確認するテストに差し替える。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/view/buildResultViewModel.golden.test.ts`
    - _Requirements: 1.3, 5.1, 5.8, 5.9_

  - [ ] 13.6 【B】診断セットが2つのときの選択UIと、やり直し後の選び直しを実装する
    - **待つ条件**: 【要確認20】（Req 6.5の「診断の1問目」が、診断セットが2つのときに同じ診断セットの1問目か選び直しか）の要件更新、および完全版（`FULL`）を提供する決定（Open Decisionsの「(13) 完全版の提供条件」。質問13問と6テーマの結果解説の承認が前提）。
    - 内容: 4.4の`RESTART`の遷移先を決定どおりに変更し、`presentQuestion`と表示モデルの全問数の扱いを確認する。4.5のProperty 45とProperty 47の期待値を更新する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/session/diagnosticReducer.edit.test.ts packages/domain/src/regional-values/session/diagnosticReducer.property.test.ts`
    - _Requirements: 2.15, 6.5_

  - [ ] 13.7 【B】`values-map`の日本語直書きを禁止する静的検査を追加する
    - **待つ条件**: 【要確認22】（日本語の表示文字列をバンドルの固定文言にする範囲。設計は診断アプリの全画面に適用するが、Req 5.12は結果画面だけを求める）の共同開発者との合意、および14.2〜14.4の完了（検査対象のファイルがあること）。
    - 内容: `tests/regional-values/noHardcodedJapanese.test.ts`が、`apps/web/src/app/values-map/**`の文字列リテラルに日本語が含まれないことを読み取りだけで検査する。合意した範囲に合わせて対象を決める。`apps/web`は変更しない。
    - 焦点テスト: `npx.cmd vitest run tests/regional-values/noHardcodedJapanese.test.ts`
    - _Requirements: 5.12_

  - [ ] 13.8 【B】端末内への回答の保存（形式とインターフェース）を実装する
    - **待つ条件**: Open Decisionsの「回答のlocalStorage保存と結果の共有」（提供するかどうかが未決）の決定、【要確認21】（既存の`check:build-boundary`が`localStorage`・`sessionStorage`・`indexedDB`を一律に違反とすることとの関係。保存用の1ファイルだけを許可する変更を共同開発者と決める）。
    - 内容: `packages/domain/src/regional-values/storage/storedAnswers.ts`と`storageAdapter.ts`に、`StoredAnswers`、`serializeStoredAnswers`、`parseStoredAnswers`（`EMPTY`・`RESTORED`・`UNUSABLE`）、`StorageAdapter`、`NullStorageAdapter`を実装し、`browser.ts`へexportを追加する。画面側の保存の実装は14系で扱う。
    - **Property 53: 保存形式のラウンドトリップと不一致の扱い**（直列化、解析、再直列化が同一。`dataVersion`・`dataKind`・`setKind`の不一致、読めない、質問に合わない保存済みの回答は必ず`UNUSABLE`）
    - **Validates: Requirements 9.4, 9.5, 12.6**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/regional-values/storage/storedAnswers.test.ts packages/domain/src/regional-values/storage/storedAnswers.property.test.ts`

  - [ ] 13.9 【B】xlsxの読取り依存の追加とxlsxの決定的なテキスト展開を実装する
    - **待つ条件**: CSVで足りない場合に限る（D4。13.15を先に行う）。新しい依存パッケージ（xlsxを読むライブラリ）の追加承認（候補の比較表を実装前に提示し、バージョンを固定する）、【要確認3】（xlsxの位置情報を、既存の`text-lines`への決定的な展開で代替するか、専用の`Locator`種別を足すか。Req 7.7）の利用者の判断。
    - 内容: 承認された依存で、シート順・行順・タブ区切り・UTF-8・LFに展開する`xlsxToText`（展開手順の識別子`xlsx-tsv-v1`）を`apps/api/src/regional-values/intake/xlsxToText.ts`に実装する。テストは架空の小さなxlsx（実データを使わない）。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/intake/xlsxToText.test.ts`
    - _Requirements: 7.5, 7.6, 7.7, 7.18_

  - [ ] 13.10 【B】実データの原本の取り込み（`intake`）を実装する
    - **待つ条件**: 13.9の完了（xlsxを扱う場合）。取り込みの共通部分（配置、SHA-256、revision、出典記録）は13.15で実装したものを使い、このタスクはxlsx固有の部分だけを実装する。利用者が実データの取り込みを許可すること（実データの取得・ダウンロードは行わず、既に`data/real/open-data/ehime-catalog/pref-2/shelters.xlsx`にある原本だけを対象にする）、Open Decisionsの「(2) 取得済みの指定緊急避難場所一覧」（取り込み時に、サイズ288,496バイトとSHA-256 `41df5967e75eafd82fee0a2a211bb1fa8699d936011247ef5c4f5b76bce8b3c6`を再照合し、一致しなければ取り込まない）、「(3) 利用条件が未確認の公式データ」（利用条件・個別注記・送信可否は`UNKNOWN`または未確認で始め、推測しない）。
    - 内容: `apps/api/src/regional-values/intake/`に、原本の配置（`data/real/raw/regional-values/<sourceId>/<revision>/`。単純なファイル名のみ、上書きしない）、SHA-256とrevision（同一なら`UNCHANGED`、異なれば`r{n+1}`）、`REAL_AI`の出典記録の作成を実装する。テストは一時ディレクトリと架空の小さなファイルだけを使う。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/intake/intake.test.ts`
    - _Requirements: 7.5, 7.14, 10.15_

  - [ ] 13.11 【B】事実項目の集計と人による検証（`aggregate`、`verify-fact`）を実装する
    - **待つ条件**: 13.10または13.15の完了、【要確認8】（原本のSHA-256が変わったときの降格と保存データの書換えの規則を、Req 7.14・7.19に明記する要件更新）、人が原本の値と照合する作業（コードでは代替できない。`PROVISIONAL`から`VERIFIED`への変更は人の操作だけで行う）。
    - 内容: `aggregate`（`COUNT_ROWS`・`COUNT_ROWS_WHERE`で原本から決定的に集計し、`PROVISIONAL`で作る。AIを使わない）、`verify-fact`（再計算値、保存値、位置情報を表示し、人が`y`を答えたときだけ`VERIFIED`と検証者ID・日時を書く）、8.7へ追加する`REAL_AI`の事実項目の検査（`FACT_VALUE_MISMATCH`、`FACT_SOURCE_MISMATCH`、`SOURCE_CHANGED`）を実装する。
    - **Property 26: 事実の数値**（事実の文の数値が算出値と一致すれば合格し、異なる値に変えると必ず`FACT_VALUE_MISMATCH`で拒否）
    - **Validates: Requirements 7.20, 12.14**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/intake/aggregate.test.ts apps/api/src/regional-values/intake/factValue.property.test.ts`

  - [ ] 13.12 【B】実データの読込みと門（G1〜G6）を実装し、`REAL`・`REAL_PREFERRED`のビルドを完成させる
    - **待つ条件**: 【要確認2】（項目単位の除外と、バンドル単位の失敗・切替の関係を明記する要件更新）、【要確認16】（承認の不足を`REAL_PREFERRED`の切替の対象にする要件更新）、Open Decisionsの「(3) 利用条件が未確認の公式データ」の確認（人）、13.1・13.4・13.11・13.14・13.16の完了（【要確認1】と【要確認5】は解消済み）。
    - 内容: 9.4の`RealDataLoader`の実装（`data/real/regional-values/`の質問バンク、課題カード、出典記録、結果解説、固定文言）、8.7へ追加する`REAL_AI`のカードの検査（利用条件、個別注記、送信可否、ライセンス情報、引用の実在、原本の変化）、G1〜G6の指摘への変換（G6は`aiInvolvement`が`AI_DRAFT`の課題カードの出典だけに要求し、G2の公開と加工の可否の確認はすべての実データの出典に要求する）、`REAL`・`REAL_PREFERRED`のビルドを実装する。9.4の「実データのディレクトリが空でない場合は未実装で失敗」の暫定動作をこのタスクで置き換える。
    - テスト（fakeのデータだけ。Req 12.13）: `REAL`は5条件（種別が`FIXTURE`、利用条件が`CONFIRMED`でない、個別注記の確認記録がない、ライセンス表示に必要な情報の欠落、検証記録がない、承認記録がない）を1つずつ欠くとビルドが失敗し公開バンドルを出力しない、`FIXTURE`に`REAL_AI`が混じると失敗、`REAL_PREFERRED`は条件をすべて満たすと実データ、1つでも欠くと全体を架空データにして理由を記録、いずれの場合も混在させない。AIが関与した出典で送信可否が`ALLOWED`でないとビルドが失敗し、AIが関与していない出典では送信可否が`UNKNOWN`でも失敗しないことも確認する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/build/realData.test.ts apps/api/src/regional-values/build/dataMode.integration.test.ts`
    - _Requirements: 7.2, 7.5, 7.8, 7.14, 7.15, 7.16, 7.19, 10.15, 10.16, 10.17, 12.13_

  - [ ] 13.13 【B】公開版（`--kind public`）の出力条件と`release.json`を実装する
    - **待つ条件**: 【要確認10】（法務確認と公開承認の記録の置き場所を、Req 10.5に明記する要件更新）、法務確認の記録（確認者ID、確認日時。人が行う）、承認者の人数（`requiredApprovers`の運用値。目標は2人）の確定、13.12の完了。
    - 内容: `data/real/regional-values/release.json`の読込み（法務確認と公開承認）、`LEGAL_REVIEW_MISSING`・`RELEASE_APPROVAL_MISSING`の指摘、承認台帳（11.6）との結合、公開版の出力条件の統合テスト（4つの記録のどれかが欠けると非ゼロの終了コードで欠けた種類を返す）。実データの公開処理自体は行わない。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/build/publicBuild.test.ts`
    - _Requirements: 10.2, 10.4, 10.5, 10.13_

  - [ ] 13.14 【B】公式データの棚卸し（人の作業）を行い、クイック版の3テーマを確定する
    - **待つ条件**: なし。利用者（人）の作業で、すぐに着手してよい。コードは書かない。実データの取得はしない（カタログのページの確認は人が行う）。
    - 内容: `.kiro/specs/regional-values-map/records/dataset-inventory.md`に、愛媛県オープンデータカタログの候補データセットを、テーマごとに記録する。項目は、カタログ名とデータセットID、データセット名、形式（CSV、XLSX、PDFなど）、文字コード（分かる場合）、更新日、ライセンス名、個別注記の有無と内容、利用条件の確認（確認者、確認日）、公開と加工の可否、外部AIへの送信可否（確認者、確認日。AIを使う場合）、対応するテーマ、採否と理由。取得したデータの中身は記録しない。
    - 棚卸しの結果から、クイック版の3テーマ（Open Decisionsの(1)）を利用者が確定する。確定した3テーマが、13.16の実データ用の診断セット定義になる。CSVで取得できるデータセットを優先する（13.15）。
    - 完了条件: 3テーマそれぞれに、利用条件が確認できた候補データセットが1件以上あることを、利用者が確認する（確認者名と確認日を記録に残す）。
    - _Requirements: 7.5, 7.8, 10.15_

  - [ ] 13.15 【B】CSVの取り込み（`csv-lines-v1`）と出典記録の作成を実装する
    - **待つ条件**: 13.14の完了（CSVの候補データセットが決まること）、利用者が実データの取り込みを許可すること（実データの取得・ダウンロードは行わず、利用者が`data/real/raw/regional-values/`へ配置した原本だけを対象にする）。新しい依存は追加しない。
    - 内容: `apps/api/src/regional-values/intake/csvToText.ts`に、文字コード（UTF-8、BOM付きのUTF-8、Shift_JIS）を判定して、UTF-8・LFのテキストへ決定的に展開する関数を実装する（`TextDecoder`だけを使う。判定できない文字コードは取り込まない。展開手順の識別子は`csv-lines-v1`）。`intake/`に、原本の配置、SHA-256とrevision（同一なら`UNCHANGED`、異なれば`r{n+1}`）、`catalog`つきの`REAL_AI`の出典記録の作成（`usage`は`UNKNOWN`、`datasetNote`は`null`、`transmission`は`UNKNOWN`で始め、人が追記する）、位置情報（`text-lines`）を実装する。テストは一時ディレクトリと、架空の小さなCSV（実データを使わない）だけを使う。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/intake/csvToText.test.ts apps/api/src/regional-values/intake/intake.test.ts`
    - _Requirements: 7.5, 7.7, 7.14, 7.18_

  - [ ] 13.16 【B】実データ用の質問バンク・結果解説・固定文言を複製して再承認する
    - **待つ条件**: 13.1（語の一覧の承認）、13.4（実データ用の固定文言の承認）、13.14（3テーマの確定）の完了。複製したレコードの偏り確認と承認（人の作業）。
    - 内容: `apps/api/src/regional-values/content/duplicateForReal.ts`に、架空データ用の質問バンク（6.1）・結果解説（6.3）・固定文言（6.3）から、データ種別を`REAL_AI`にした複製を作る関数を実装する。複製は、版を1に戻し、承認記録を空にし、起案者区分を保ち、診断セット定義のテーマを13.14で確定した3テーマに差し替える。承認は引き継がない。複製先は`data/real/regional-values/`（Git管理外）。固定文言は`requiredFixedTextKeys(\u0027REAL_AI\u0027)`の全キーとする。
    - テスト: 複製が`REAL_AI`の契約に適合し、承認記録が空で、診断セットが`QUICK`の構成条件（Req 3.2）を満たし、元のレコードを変更しないこと。複製した質問が8.5の検査を架空データ用と同じ結果で通ること。一時ディレクトリと試験専用の設定だけを使う。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/regional-values/content/duplicateForReal.test.ts`
    - _Requirements: 3.1, 3.2, 3.10, 8.20_

  - [ ] 13.17 【B】実データ（クイック版の3テーマ）の完了を確認する
    - **待つ条件**: 13.12と13.16の完了、3テーマそれぞれに`VERIFIED`の事実項目と承認済みの課題カードがあること（人の作業）。
    - 内容: `REAL_PREFERRED`で、3テーマがすべての条件を満たすと実データのバンドルが出ること、1テーマでも欠くと全体が架空データに切り替わり理由が記録されること、実データのバンドルに架空データが混ざらないことを、利用者が用意した検証済みのデータで確認し、結果を`records/`に記録する。自動テストは13.12のfakeのデータで済ませる。12.2の確認（代替データ）とは別の、実データでの完了条件とする。
    - 焦点テスト: なし（人の確認の記録）。13.12の焦点テストが成功していること。
    - _Requirements: 7.2, 10.15, 10.16, 10.17_

- [ ] 14. `apps/web`への画面実装（分類C。共同開発者が担当し、本featureの実装者は着手しない）
  - [ ] 14.1 【C】リリース用のビルド基盤（`demo`・`public`）を追加する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）をここに記録するまで着手しない（Req 10.9）。
    - **共同開発者が使うAPI**: 7.3・7.4（`ExpectedBundle`、`verifyBundleText`）、9.5（`regional-values build`が出す`dist/regional-values/<kind>/bundle.json`）、10.1（ブラウザ向けの入口）、10.3（連携ガイド）。
    - 内容: `apps/web/src/config/releaseTarget.ts`に`resolveReleaseTarget`（`"demo"`と`"public"`の完全一致だけを受け付ける）を新規に足し、`applicationMode.ts`と`vite.config.ts`は変更しない。`apps/web/vite.release.config.ts`に、`define`による`__RV_EXPECTED__`の埋込み（`dataVersion`は`config/regional-values/build.json`から、`buildKind`はターゲットから）、バンドルの複製（`<outDir>/regional-values/bundle.json`。`meta.buildKind`または`meta.dataVersion`が期待と違う、存在しない、`verifyBundleText`に不合格ならビルドを失敗させる）、`release-build-marker.json`を実装する。`apps/web/package.json`に`build:demo`・`build:public`、根の`package.json`に`build:regional-demo`・`build:regional-public`、`.gitignore`に`dist-demo`・`dist-public`を追加する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/config/releaseTarget.test.ts apps/web/src/config/releaseVite.test.ts`
    - _Requirements: 10.3, 10.9, 11.9, 11.10_

  - [ ] 14.2 【C】バンドルの取得と診断画面を実装する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 4.1〜4.4（`diagnosticReducer`、`DiagnosticState`、`DiagnosticEvent`）、5.5（`presentQuestion`、`QuestionPresentation`）、7.4（`loadBundle`、`LOAD_FAILURE_TEXTS`）、10.1。
    - 内容: `apps/web/src/app/values-map/`に、`expected.ts`（`__RV_EXPECTED__`）、`bundleLoader.ts`（`fetch`の薄い包みを`httpGet`として渡す）、`ValuesMapApp.tsx`（`useReducer(diagnosticReducer)`）、`QuestionScreen.tsx`を実装する。画面は`options[].event`を渡すだけで、状態の判断・値の再計算・日本語の直書きをしない。読み込み失敗の画面はデモ版が失敗の旨、公開版が「準備中」だけ。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/bundleLoader.test.ts apps/web/src/app/values-map/QuestionScreen.test.tsx`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10, 10.4, 11.10_

  - [ ] 14.3 【C】結果画面を実装する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 5.6〜5.9（`buildResultViewModel`、`ResultViewModel`、`ChartBand`）、4.4（`OPEN_EDIT`、`CONFIRM_EDIT`、`RESTART`）。
    - 内容: `ResultScreen.tsx`、`ChartBands.tsx`、`ResultError.tsx`を実装する。`sectionOrder`の順に描画し、図（段階の帯）と同じ内容を文字の一覧でも表示する。注意書きは折りたたみも閉じる操作もなく常時表示し、360px以上480px以下で横スクロールを出さない。判断に迷ったテーマの選択でドリルダウンと回答の変更導線を出す。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/ResultScreen.test.tsx`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 5.14, 5.15, 5.17, 6.1, 6.2, 6.4, 6.5, 11.5, 11.6_

  - [ ] 14.4 【C】課題カード、「このアプリについて」、常時表示の注記を実装する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 5.10（`buildCardView`、`buildAboutView`、`CardView`、`AboutView`）、5.6（`FrameView`）、13.4の完了後は`REAL_AI`の表示。
    - 内容: `CardScreen.tsx`、`AboutScreen.tsx`、`FrameBanner.tsx`を実装する。データ種別のラベルを種別ごとに形の違うアイコンと文言で表示し（色だけで区別しない）、AIのラベルを常時表示する。「デモ用の架空データです」（`FIXTURE`）と非公式表示（`REAL_AI`）は、診断・結果・カード・「このアプリについて」の全画面で、スクロール位置と360px以上の幅にかかわらず表示領域内に出し、閉じる操作を持たせない。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/CardScreen.test.tsx apps/web/src/app/values-map/AboutScreen.test.tsx`
    - _Requirements: 5.13, 7.4, 7.13, 7.21, 8.13, 10.12, 10.18, 10.19_

  - [ ] 14.5 【C】ルート入口を実装する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 4.3・4.4（`OPEN_CARD`、`OPEN_ABOUT`）、14.2〜14.4の画面。
    - 内容: ルート案Aに従い、`apps/web/src/app/values-map/routes.tsx`に`/`（診断アプリ）と`*`（見つからない）の2つだけを置き、リリース用のターゲット（14.1）の入口にする。「このアプリについて」と課題カードは`/`の中の状態として扱い、URLに診断の状態や回答由来の値を持たせない。既存の`visitor`・`analyst`のルート表、`applicationMode.ts`、`PUBLIC_ROUTE_PATHS`は変更しない。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/routes.test.tsx`
    - _Requirements: 9.2, 10.3, 10.7, 10.9_

  - [ ] 14.6 【C】アクセシビリティと表示条件の画面テストを追加する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 5.5・5.6〜5.10の表示モデル。
    - 内容: キーボードだけの完了、すべての入力の空でないラベル、選択状態・段階・未出題・ラベルの色以外の区別、選択肢の操作領域44 CSSピクセル以上、コントラスト比4.5:1以上（使用する色の組を定数化して計算で確認）、360〜480pxの横スクロールなし、常時表示の注記が閉じられないことを確認する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/a11y.test.tsx`
    - _Requirements: 2.6, 7.4, 8.13, 10.12, 10.18, 11.3, 11.4, 11.6, 11.12_

  - [ ] 14.7 【C】プライバシー境界と結果画面の描画のテストを追加する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。
    - **共同開発者が使うAPI**: 4.1〜4.4、5.6〜5.9、6.4（V15、V16、V18の表示モデルを入力に使う）。
    - 内容: 既定の状態（保存を選ばない）で、診断の開始、全問の回答、結果の表示、回答の変更を自動操作し、質問IDと回答値または最優先テーマを含むネットワーク要求が0件、`localStorage`・`sessionStorage`・cookie・`IndexedDB`の内容が診断の開始前と同一であること（バンドルのGET 1回は除く）を確認する。結果画面の描画（4つの状態が別の文言と別の欄、「この診断では最優先テーマを聞いていません」、順位の数値なし、優先条件が条件付きの表現で別の欄に出て大切さと併記される、型に適合し否定表現を含まない）を確認する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/values-map/privacy.test.tsx apps/web/src/app/values-map/resultRender.test.tsx`
    - _Requirements: 9.1, 9.2, 9.3, 9.8, 12.7, 12.16_

  - [ ] 14.8 【C】`check:build-boundary`を拡張し、公開版の成果物の禁止対象とサイズを検査する
    - **着手条件**: 共同開発者の承認（承認者名: ＿＿、承認日: ＿＿）を記録するまで着手しない。`apps/web/scripts/`を変更するため、承認が必須である（Req 10.9）。
    - **共同開発者が使うAPI**: 7.3（`verifyBundleText`）、14.1のリリースビルド。
    - 内容: 新しいファイル`apps/web/scripts/release-boundary.mjs`に`evaluateReleaseArtifact`と`runReleaseBoundaryCheck`を実装し、既存の`check-build-boundary.mjs`がこれも実行して結果を合算する（`build-boundary.mjs`、`BUILD_BOUNDARY_TARGETS`、既存のテストの期待値は変更しない）。禁止対象(a)`FIXTURE`のデモデータ、(b)analystモードの画面、(c)承認ツール、(d)Bedrock呼出しのコード、(e)選挙公報の原本を検出して記号で報告し終了コード1にする。追加の検査として、外部スクリプトの不在、初回に読むJSと`bundle.json`のgzip後の合計500,000バイト以下、認証情報の値の不在、`bundle.json`の`meta.buildKind`と対象の一致を行う。
    - **Property 54: 禁止対象の検出**（禁止対象を含まない成果物は違反0件。(a)〜(e)のうち1種類を混入すると、その記号だけを報告して終了コード1）
    - **Validates: Requirements 7.12, 10.3, 10.14, 12.8**
    - 焦点テスト: `npx.cmd vitest run apps/web/scripts/release-boundary.test.ts apps/web/scripts/release-boundary.property.test.ts`
    - _Requirements: 9.8, 9.10, 11.8_

## Notes

### (a) 分類別のタスク番号

- 【A】65件: 1.1〜1.2、2.1、3.1〜3.10、4.1〜4.5、5.1〜5.12、6.1〜6.4、7.1〜7.4、8.1〜8.8、9.1〜9.5、10.1〜10.3、11.1〜11.9、12.1〜12.2
- 【B】17件: 13.1〜13.17
- 【C】8件: 14.1〜14.8
- 実行順は`## Task Dependency Graph`のwaveに従う。waveは依存と同じファイルへの書込みの競合から決めており、番号順とは一致しない箇所がある（例: 5.1〜5.4は3.xより先に着手できる）。分類Cは、決定待ちの分類Bに止められないよう、13.1を除く分類Bより前のwaveに置いた。待つ条件が解決済みの分類Bは、依存するタスクが終わっていればwaveより先に実施してよい。

### (b) 分類Bの待つ条件の一覧

- 13.1: 検査用の語の一覧（Open Decisionsの(7)(18)、固有名詞・実在名の一覧、【要確認7】、`wordCategories`、誘導語、候補者名・政党名、`dataVersion`、`draft.json`の値）の利用者の承認。デモ版のバンドルをリポジトリの設定で生成するための前提なので、最初に解決することを勧める。
- 13.2: 【要確認24】（入力長の「文字」の数え方の要件更新）。
- 13.3: 【要確認23】（`BIAS_SUSPECTED`の質問の承認の扱い）の利用者の判断。
- 13.4: 【要確認18】（非公式表示の文言を禁止語検査の免除に加える要件更新）、「(6) ライセンス表示の文面」の承認、「愛媛県」の名称を使う範囲の決定。
- 13.5: 【要確認19】（結果画面の表示順）の利用者の判断。
- 13.6: 【要確認20】（診断セットが2つのときのやり直しの扱いの要件更新）と、完全版（`FULL`）を提供する決定。
- 13.7: 【要確認22】（日本語の直書きを禁止する範囲）の共同開発者との合意と、14.2〜14.4の完了。
- 13.8: 回答の端末内保存を提供するかの決定と、【要確認21】（`check:build-boundary`との関係）の共同開発者との合意。
- 13.9: CSVで足りない場合に限る。新しい依存（xlsxを読むライブラリ）の追加承認と、【要確認3】（xlsxの位置情報の扱い）の判断。
- 13.10: 13.9の完了（xlsx固有の部分だけ。共通部分は13.15）、実データの取り込みの許可、「(2)」の再照合、「(3)」の利用条件が未確認のデータを採用しないこと。
- 13.11: 13.10または13.15の完了、【要確認8】（原本の変化時の降格と保存データの書換えの要件明記）、人による原本との照合。
- 13.12: 【要確認2】【要確認16】（要件更新）、「(3)」の公式データの利用条件の確認、13.1・13.4・13.11・13.14・13.16の完了（【要確認1】と【要確認5】は解消済み）。
- 13.13: 【要確認10】（法務確認・公開承認の記録の置き場所の要件明記）、法務確認の記録、承認者の人数の確定、13.12の完了。
- 13.14: なし（人の作業。すぐに着手してよい）。
- 13.15: 13.14の完了、実データの取り込みの許可（利用者が配置した原本だけを対象にする）。新しい依存は不要。
- 13.16: 13.1・13.4・13.14の完了、複製したレコードの偏り確認と承認（人の作業）。
- 13.17: 13.12と13.16の完了、3テーマの`VERIFIED`の事実項目と承認済みの課題カード（人の作業）。

### (c) 分類Cの共同開発者との受け渡し点

- ブラウザ向けの入口は10.1（`@ehime-vote-navigator/domain/regional-values`、`@ehime-vote-navigator/contracts/regional`）、型と使い方は10.3の連携ガイド、使用例は6.4のテスト。
- 画面は、`diagnosticReducer`（4.3・4.4）、`presentQuestion`（5.5）、`buildResultViewModel`（5.6〜5.8）、`buildCardView`・`buildAboutView`（5.10）、`loadBundle`（7.4）の戻り値を描画し、イベントを渡すだけにする。表示文字列の自作、値の再計算、保存領域への書込み、バンドルのGET以外の通信、ドメインの内部モジュールの取込みをしない。
- 画面テストの入力には、5.9の金テストベクタ（V15、V16、V18）の`ResultViewModel`を使う。
- バンドルは`regional-values build`（9.5）が`dist/regional-values/<kind>/bundle.json`に出す。13.1の承認前は、9.5の`--config-dir`に試験専用の設定を指定して検証用のバンドルを作る。
- 契約と関数の版は1。項目の削除・型の変更は版を上げ、項目の追加は同じ版に入れて共同開発者へ通知する。`.gitignore`と`packages/*/package.json`の`exports`の変更は`apps/web`の外だが、共同開発者へ通知する。
- 14.1〜14.8は、共同開発者の承認（承認者名、承認日）を各タスクに記録してから着手する。

### (d) 本featureの完了条件（MVP。分類Aの範囲）

- クイック版（`QUICK`、3テーマ6問）の診断が、架空データ（代替データとテスト基盤）で、`diagnosticReducer`（回答、戻る、変更、やり直し）から`generateValuesMap`、`buildResultViewModel`まで通しで動き（6.4）、価値観マップが大切さの段階ごとのグループ、優先条件、未出題のテーマ、「最優先テーマを聞いていません」を含んで返る。
- 金テストベクタ（V01〜V18）と属性テスト（Property 1〜25、27〜52、55のうち分類Aに割り当てたもの）が成功する。
- `FIXTURE`のビルド（9.5）が、試験専用の設定でバンドルを生成し、`verifyBundleText`に合格する。リポジトリの設定での実行は13.1の承認後。
- 既存資産が保全され（12.1）、全体のテストが開始前と比べて悪化していない（12.2、Req 10.11）。
- 画面（分類C）、実データ（分類B）、実Bedrockの呼出しは、MVPの完了条件に含めない。実データでの完了は13.17で確認する。

### tasks.md作成時の解釈（要レビュー）

設計書が明記しておらず、このtasks.mdで前提を置いた点。実装者が変更する場合は、報告して停止する。

- 固定文言の必須キー（5.1）: 設計書は「全キーを1件ずつ」とだけ書く。`FIXTURE`のバンドルに`banner.REAL_AI`と`license.*`を含めるかが不明なため、種別別の必須キーとした。
- マップ生成の依存検査（3.10）: 設計書は「`Date`を取り込まない」と書くが、`core.ts`が取り込む既存の`primitives.ts`は`Date.parse`を使う。要件12.9の文言に合わせ、禁止は「現在時刻の取得」と乱数に限った。また、パッケージ名での取込みはバレル経由で`content.ts`に届くため、取り込む名前が`core.ts`で定義されていることを名前単位で検査する。
- 質問の型の受け口（4.1）: reducerを先に作る優先順位を保つため、`Session.bundle`は構造的な最小型`SessionBundle`とし、`VerifiedBundle`は7.3で構造的に満たすことを確認する。
- 検査用設定（8.1、13.1）: 設定の契約と読込みは分類A、設定の実体（語の一覧）は分類Bとした。要件に値のない語を実装者が決めないため。
- AI下書き工程（11）: 実Bedrockを呼ばず、設計で確定した部分（契約、入力の門、決定的検査、冪等性、4つの数、承認台帳）を分類Aとした。要件更新を要する入力長の数え方（13.2）と偏りの疑いの承認（13.3）だけを分類Bにした。承認者数は設計で決定済みで、要件更新を要さない。
- 診断セット種別の誤り（3.3）は設計どおり`INVALID_CONFIG`にする（【要確認6】は要件側の更新待ちだが、設計の決定で実装できる）。`UNKNOWN_QUESTION`・`INVALID_ANSWER`の質問IDは、列挙順に依存させないため昇順で返す。
- `term`（用語の見出し語）の上限40文字は設計書の仮の値（5.2）。`ui.appName`は未決事項(10)の案（5.1）。
- 例外境界（承認済み。`records/exception-boundary-notes.md`）: `diagnosticReducer`が想定外の例外を捕捉して終端の`UNEXPECTED_ERROR`へ遷移し、固定文言だけを表示する。`RESTART`で回答を破棄し、そのことを固定文言で明示する。この決定により、利用者の指示でrequirements.md（Req 5.19）とdesign.mdを更新した。`MapError`の4種は変更しない。

### その他

- テストはoptional（`*`）にしない（既存の2つのtasks.mdに合わせる）。property testは各propertyをちょうど1つのsub-taskへ割り当てた（Property 1・13・14・16・17: 3.9、2: 3.1、3〜6: 3.7、7〜12・15: 3.8、18: 8.3、19〜21: 8.4、22〜23: 8.5、24〜25: 8.6、26: 13.11、27: 11.3、28: 11.2、29: 11.4、30: 11.5、31: 11.6、32・40: 9.1、33・34・37: 9.4、35: 9.2、36: 7.1、38: 7.2、39: 7.3、41〜47: 4.5、48〜49: 5.9、50: 8.8、51: 5.8、52: 10.1、53: 13.8、54: 14.8、55: 6.4、57: 11.3）。
- スコープ外: 完全版（`FULL`）の質問の起案と承認、クイック版の3つ目のテーマの最終決定、実データの質問バンクと結果解説の起案、利用条件・個別注記・送信可否・法務の確認（人の作業）、実Bedrockを呼ぶ`draft run`の実行、性能計測（Req 11.1）と利用者テスト（Req 11.2）、市町別の集計。
- ドキュメントの新規作成は10.3の連携ガイドだけとする。`requirements.md`と`design.md`は、利用者が承認した更新（D1〜D6）を除いて変更しない。他のspec、`.kiro/specs/**/tasks.meta.json`は変更しない。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "7.2", "8.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "4.2", "5.1", "8.1"] },
    { "id": 3, "tasks": ["3.3", "5.2", "5.3", "6.1", "8.3", "8.6"] },
    { "id": 4, "tasks": ["3.4", "5.4", "5.11", "6.2", "6.3", "8.4", "8.7"] },
    { "id": 5, "tasks": ["3.5", "5.10", "5.12", "7.1", "8.5", "9.1", "9.3"] },
    { "id": 6, "tasks": ["3.6", "7.3"] },
    { "id": 7, "tasks": ["3.7", "3.8", "3.9", "3.10", "4.1", "7.4"] },
    { "id": 8, "tasks": ["4.3", "5.5", "5.6"] },
    { "id": 9, "tasks": ["4.4", "5.7"] },
    { "id": 10, "tasks": ["4.5", "5.8"] },
    { "id": 11, "tasks": ["5.9", "6.4", "8.8", "10.1"] },
    { "id": 12, "tasks": ["9.2", "10.2", "10.3", "11.1"] },
    { "id": 13, "tasks": ["9.4", "11.2", "11.3", "11.5"] },
    { "id": 14, "tasks": ["9.5", "11.4"] },
    { "id": 15, "tasks": ["11.6", "11.9"] },
    { "id": 16, "tasks": ["11.7"] },
    { "id": 17, "tasks": ["11.8"] },
    { "id": 18, "tasks": ["12.1"] },
    { "id": 19, "tasks": ["12.2"] },
    { "id": 20, "tasks": ["13.1", "13.14"] },
    { "id": 21, "tasks": ["14.1"] },
    { "id": 22, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 23, "tasks": ["14.5"] },
    { "id": 24, "tasks": ["14.6", "14.7", "14.8"] },
    { "id": 25, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.7", "13.8", "13.9", "13.15"] },
    { "id": 26, "tasks": ["13.6", "13.10", "13.16"] },
    { "id": 27, "tasks": ["13.11"] },
    { "id": 28, "tasks": ["13.12"] },
    { "id": 29, "tasks": ["13.13", "13.17"] }
  ]
}
```
