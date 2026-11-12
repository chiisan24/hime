# Implementation Plan: AI Policy Matching

## Overview

既存のZod契約、`Result`、`canonicalJson`、`sha256Hex`、`validateDataBoundary`、`createBedrockConverseClient`、`stageRunner`/Pacer、`safeLogger`を再利用し、(1)契約と設定、(2)一致度計算（最優先）、(3)質問・カード検査、(4)立場記録と公開バンドル、(5)架空のデモデータ、(6)画面、(7)デモ/公開のビルド分離、(8)組込みと最終確認、(9)任意のオフラインAI、(10)実データ（承認後）の順に実装する。

既存のOCR実装、Bedrock接続、選挙レジストリ、`multi-election-ai-analysis`の未実装タスク、既存の`.kiro/specs/`の文書、既存テストは削除も変更もしない。新しいコードは新しいファイルに置き、既存ファイルへの変更はexportの追加に限る。通常のテストはfake（Bedrock client、`fetch`、clock、一時ディレクトリ）だけを使い、ネットワークとBedrockを呼ばず、watchなしで終了する。development serverとpreview serverは起動しない。property testはfast-check 4.10.2で`numRuns: 100`以上とし、各testへ`Feature: ai-policy-matching, Property N`のcommentを付ける。各タスクは焦点テストだけを実行し、全体の`npm.cmd test`は1.1と9.2で実行する。

コマンドは`npx.cmd`と`npm.cmd`を使う（Windows PowerShell）。AWSの認証キーは読まず、会話やファイルに出さない。Git操作（commit、push、merge、reset）は利用者の明示承認なしに行わない。

## MVP完成条件

次の7点がすべて成立したとき、MVPを完成とする（タスク1〜9。タスク10と11は含まない）。

1. 架空のデモデータ（12問、比較対象3、立場記録、説明カード）で、質問→重視テーマ→結果→詳細→比較の導線が動く。
2. 一致度が決定的な純関数で計算され、金テストベクタ10件以上とProperty 1〜8、13が通る。
3. 重視テーマを変えると結果が変わり、変更前後の差と理由が画面に表示される。
4. 立場が不明な比較対象が「情報不足」と表示され、順位に入らず、見かけ上の高一致が出ない。
5. 説明カードが根拠付きで、検査（Property 11）に通ったものだけが表示される。
6. 回答がブラウザ外へ送られず、保存もされないことをテストで確認でき、デモ版と公開版のビルドが分離される。
7. 既存の全テストの失敗が増えず、`lint`、`typecheck`、`build`、`check:build-boundary`が成功する。

## テスト計画

| 種類 | 対象 | 場所 |
|---|---|---|
| 金テストベクタ | `computeMatch`（G1 64%、G2 80%を含む10件以上） | `packages/domain/src/matching/score.golden.test.ts` |
| property test | Property 1〜8、13（計算）、9・11（検査）、10・12（立場と公開ゲート） | `packages/domain/src/matching/*.property.test.ts` |
| 例示テスト | 契約、質問検査、カード検査、バンドル読込み | 各ファイルの隣 |
| 画面テスト | 導線、戻る、情報不足、免責の常時表示、デモ表示 | `apps/web/src/app/matching/*.test.tsx` |
| 境界テスト | 計算中の`fetch`/ストレージ呼出し0回、公開ビルドの禁止文字列 | `privacy.test.tsx`、`check:build-boundary` |
| 回帰 | 既存の全テスト | `npm.cmd test`（開始時と終了時） |

## Tasks

- [ ] 1. 事前確認と基準の記録
  - [ ] 1.1 Git状態と既存テストの基準を確認する
    - `git status`でブランチ名と未コミット変更を確認し、変更があれば実装前に利用者へ報告する。`npm.cmd test`を実行して失敗件数を記録する（以後この件数を超えないことを基準にする）。既存ファイルは変更しない。
    - `apps/web/src/app/visitor/routeContracts.ts`、`apps/web/vite.config.ts`、`apps/web/scripts/check-build-boundary.mjs`、`apps/web/src/config/buildBoundary.test.ts`を読み、タスク7と8の既存の制約を確認する。
    - _Requirements: 13.1, 13.5_

- [ ] 2. 契約と設定を追加する
  - [ ] 2.1 `packages/contracts/src/models/matching.ts`を追加する
    - `Question`、`Theme`、`MatchingElectionConfig`（`comparisonMode`と比較対象一覧）、`Evidence`、`StanceRecord`、`ExplanationCard`、`PublishedMatchingBundle`、`UserAnswerSet`をZod strictで定義し、`models/index.ts`へexportだけを追加する。既存の契約（`electionRegistry.ts`、`sources.ts`）は変更せず、`Locator`、`DataKind`、`ISOInstant`は参照する。
    - refine: 立場が−2〜+2なら根拠1件以上かつ全`CONFIRMED`、`APPROVED`なら承認者と日時が必須、`CONFLICT`は`resolution`なしで数値にできない、比較対象の空と重複ID、解説50〜200文字を拒否する。
    - 例示テスト`matching.test.ts`で、正常系と各拒否を確認する。焦点テスト: `npx.cmd vitest run packages/contracts/src/models/matching.test.ts`
    - _Requirements: 2.1, 6.1, 6.4, 9.1, 9.2, 9.5, 14.5_

  - [ ] 2.2 `config/matching/`の設定ファイルと読込み関数を追加する
    - `themes.json`（教育・子育て、経済・雇用、防災、医療・福祉、地域交通、環境）、`thresholds.json`（`minQuestions: 3`、`minCoveragePercent: 50`、`quoteMaxChars: 200`）、`neutrality-terms.json`（固定語、二重質問の兆候語、誘導語、推奨語）をZod strictで検証して読み込む関数を`packages/domain/src/matching/config.ts`に追加する。既存の`config/themes.json`は変更しない。誘導語と推奨語の一覧は利用者が追加できる前提の初期案とする。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/config.test.ts`
    - _Requirements: 2.3, 4.7, 10.6_

- [ ] 3. 一致度計算を実装する（MVPの中核）
  - [ ] 3.1 `computeMatch`と共通質問モードを実装する
    - `packages/domain/src/matching/score.ts`にdesign.mdの定義どおり`computeMatch`を純関数で実装する（整数演算、四捨五入`floor((200N+D)/(2D))`、網羅率、下限は切り捨て、上限は切り上げ、`byTheme`、除外理由、`NO_SCORE`、`INSUFFICIENT`）。`computeCommonMatch`（共通質問モード、`NO_COMMON`）と、並び順関数（届出順、近い順は`OK`のみで`INSUFFICIENT`は末尾）を追加する。`Date`、`Math.random`、`fetch`、ストレージを使わない。`packages/domain/src/index.ts`へexportを追加する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/score.test.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.5, 6.3_

  - [ ] 3.2 金テストベクタを実装する
    - `score.golden.test.ts`に手計算した10件以上を置く: G1（64%、網羅率78%、範囲50〜73）、G2（防災を`NORMAL`にして80%）、全一致100、全反対0、`UNKNOWN`のみ、`CONFLICT`含む、`UNSURE`/`DECLINE`含む、`EXCLUDE`テーマ含む、丸め境界（x.5が切り上げ）、情報不足、`NO_COMMON`。期待値は実装から生成せず、設計書の式で手計算して書く。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/score.golden.test.ts`
    - _Requirements: 15.1_

  - [ ] 3.3 計算のproperty testを実装する
    - `packages/domain/src/matching/score.property.test.ts`に実装する。
    - **Property 1: 範囲と丸め**
    - **Property 2: 順序と倍率の不変**
    - **Property 3: 完全一致と完全反対**
    - **Property 4: 除外の不変**
    - **Property 5: 範囲の包含**
    - **Property 6: 情報不足と見かけ上の高一致の防止**
    - **Property 7: 共通質問モード**
    - **Property 8: 決定性**
    - **Property 13: 重視レベル変更の整合**（全`EXCLUDE`の拒否を含む）
    - **Validates: Requirements 3.1〜3.9, 4.1〜4.6, 5.2, 5.4, 15.2, 15.3**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/score.property.test.ts`

- [ ] 4. 質問バンクとカードの検査を実装する
  - [ ] 4.1 質問バンクの中立性検査を実装する
    - `packages/domain/src/matching/neutrality.ts`に`NAME_FREE`、`SINGLE_ISSUE`、`LOADED_TERMS`、`BALANCE`、`THEME_EVEN`、`LABELS`、`LENGTH`を実装し、違反の種類を全て返す。決定的な質問順ランダム化（`seed`指定）を追加し、順序が計算結果に影響しないことを例示で確認する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/neutrality.test.ts`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 4.2 説明カードの検査とテンプレート組立を実装する
    - `packages/domain/src/matching/cardCheck.ts`に、根拠IDの実在、引用に含まれない数値・固有名詞・日付、推奨語、承認記録の有無、文数と文字数の検査を実装する。`cardTemplate.ts`に、立場の差`d`に応じた`MATCH`/`MISMATCH`/`UNKNOWN`のテンプレート文（「〜と書かれています」の形で引用を差し込む。推測や評価を含めない）を実装する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/cardCheck.test.ts packages/domain/src/matching/cardTemplate.test.ts`
    - _Requirements: 8.1, 8.2, 8.4, 8.7_

  - [ ] 4.3 検査のproperty testを実装する
    - `neutrality.property.test.ts`と`cardCheck.property.test.ts`に実装する。
    - **Property 9: 質問バンクの検査**
    - **Property 11: 説明カードの検査**
    - **Validates: Requirements 2.2〜2.5, 8.2, 8.7, 10.5, 15.4**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/neutrality.property.test.ts packages/domain/src/matching/cardCheck.property.test.ts`

- [ ] 5. 立場記録の公開ゲートとバンドルを実装する
  - [ ] 5.1 公開ゲート、バンドルの生成と読込みを実装する
    - `packages/domain/src/matching/bundleGate.ts`に、`APPROVED`かつ全根拠`CONFIRMED`の立場だけを集める公開ゲート、`quote`長の検査、`buildKind`と`dataKind`の整合検査、`validateDataBoundary`による混在拒否を実装する。`bundle.ts`に、`canonicalJson`と`sha256Hex`による`contentHash`の付与と、読込み時の検証（strict、ハッシュ、整合）を実装する。資料更新（`sourceChecksum`の変更）で立場記録を`PENDING`へ戻す関数を追加する。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/bundleGate.test.ts packages/domain/src/matching/bundle.test.ts`
    - _Requirements: 9.2, 9.7, 12.2, 14.5_

  - [ ] 5.2 立場記録と公開ゲートのproperty testを実装する
    - `bundleGate.property.test.ts`と`stance.property.test.ts`に実装する。
    - **Property 10: 立場記録の契約**
    - **Property 12: 公開ゲートとデータ境界**
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 10.6, 12.2, 12.3, 14.5**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/matching/bundleGate.property.test.ts packages/domain/src/matching/stance.property.test.ts`

- [ ] 6. 架空のデモデータとバンドル生成を実装する
  - [ ] 6.1 デモデータを作成する
    - `packages/fixtures/src/matching/`に、6テーマ×2問=12問の質問（`CHANGE`と`CONTINUE`が各6問、愛媛の地域課題を2問以上含む。論点は設計書の候補から中立な主張文として起案し、実在の人物・政党の立場を示さない）、架空の比較対象3（実在しない名称。例: 「比較対象A」「比較対象B」「比較対象C」）、架空の立場記録（1名は`UNKNOWN`を多く含み情報不足になる）、架空の出典、説明カードを作る。`dataKind: FIXTURE`。全件を`neutrality`と`cardCheck`に通す。
    - 焦点テスト: `npx.cmd vitest run packages/fixtures/src/matching/demo.test.ts`
    - _Requirements: 1.1, 2.8, 12.1_

  - [ ] 6.2 `matching` CLIの`bundle build/verify`を実装する
    - `apps/api/src/matching/cli.ts`を追加し、`apps/api/package.json`と根`package.json`に`matching` scriptを追加する（既存の`analysis` scriptと同じ方式）。`bundle build --kind demo`は検査を全て実行して`apps/web/public/data/matching-bundle.demo.json`（Git管理するのは架空データのみ）を生成し、`bundle verify`は`contentHash`と契約を検査する。`--kind public`は承認済みの実データが無ければ`PUBLIC_NOT_READY`で終了コード1を返す。ポートを開かない。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/matching/cli.test.ts`
    - _Requirements: 12.1, 12.4, 14.5_

- [ ] 7. 画面を実装する（`apps/web/src/app/matching/`）
  - [ ] 7.1 状態管理とバンドル読込みを実装する
    - 回答と重視レベルをメモリ内の状態（`useReducer`）で持ち、バンドルを読み込んで検証し、失敗時は`BUNDLE_INVALID`を表示する。回答の変更、前の質問へ戻る操作を実装する。ストレージとネットワークへ書き込まない。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/state.test.tsx`
    - _Requirements: 1.3, 1.4, 11.1, 11.2_

  - [ ] 7.2 はじめに画面と質問画面を実装する
    - `/match`と`/match/q/:n`を実装する。質問文、解説（折りたたみ）、7つの選択肢（高さ44px以上）、進捗、戻る、免責の常時表示、デモ版の「デモ用の架空データです」を表示する。全質問が`UNSURE`/`DECLINE`のときは「意見回答がないため計算できません」を表示する。質問順ランダム化のオプションを提供する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/questions.test.tsx`
    - _Requirements: 1.1, 1.2, 1.6, 2.6, 10.1, 12.1_

  - [ ] 7.3 重視テーマ画面を実装する
    - `/match/themes`を実装する。4段階の選択、既定すべて`NORMAL`、計算への影響の説明と計算例1件、全`EXCLUDE`の拒否、変更前後の差の表示を行う。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/themes.test.tsx`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 7.4 結果・詳細・比較画面を実装する
    - `/match/result`、`/match/result/:subjectId`、`/match/compare`を実装する。一致度、網羅率、範囲、使った質問数、テーマ別、近い/遠い質問、説明カード（根拠、出典、更新日時）、情報不足の理由、並び順切替（既定は届出順）、共通質問モード切替を表示する。順位の数字や「おすすめ」を既定で表示せず、色だけに依存しない。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/result.test.tsx`
    - _Requirements: 4.4, 4.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.4, 10.1, 10.2_

  - [ ] 7.5 「このアプリについて」画面を実装する
    - `/about`を実装する。計算式と計算例（G1/G2）、質問の作り方と承認者、データの出典と更新日時、情報不足の説明、AIの利用範囲、免責、プライバシー（回答を送らない・保存しない）を表示する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/about.test.tsx`
    - _Requirements: 10.3, 10.4, 10.5, 11.1_

  - [ ] 7.6 スマホ幅とアクセシビリティの例示テストを追加する
    - 360px幅で横スクロールがないこと（要素の幅の検査）、ラベル、キーボード操作、数値と文言の併記を例示テストで確認する。コントラスト比4.5:1は、使用する色の組を定数化して計算テストで確認する。一致度の再計算が100ミリ秒以内（比較対象10、質問50）であることを`computeMatch`の計測テストで確認する（目標値、環境差があるため緩い上限で判定）。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/a11y.test.tsx`
    - _Requirements: 7.7, 14.1, 14.2, 14.3_

- [ ] 8. デモ/公開のビルド分離とプライバシー境界を実装する
  - [ ] 8.1 `demo`と`public`のビルド種別と境界検査を実装する
    - 1.1で読んだ既存の`vite.config.ts`と`check-build-boundary.mjs`に合わせ、`--mode demo`と`--mode public`を追加する（既存の`analyst`モードの挙動は変更しない）。`check:build-boundary`に、`public`の成果物へデモデータ、analystの画面、承認ツール、`bedrock`の文字列、公報原本、`AWS_BEARER_TOKEN_BEDROCK`が含まれないことの検査を追加する。公開バンドルが無い`public`ビルドは「準備中」を表示する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/config/buildBoundary.test.ts apps/web/src/app/matching/buildKind.test.tsx`（既存の`buildBoundary.test.ts`は期待値を変更しない）
    - _Requirements: 11.7, 12.2, 12.3, 12.4, 14.4_

  - [ ] 8.2 プライバシー境界テストを追加する
    - `privacy.test.tsx`で、質問→結果の一連の操作中に`fetch`/`XMLHttpRequest`/`sendBeacon`/`localStorage`/`sessionStorage`/`indexedDB`/`document.cookie`の書込みが0回であること（バンドルの読込み`fetch`1回を除く）を検査する。ログに回答が出ないことを確認する。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/matching/privacy.test.tsx`
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 15.5_

- [ ] 9. 既存アプリへの組込みと最終確認
  - [ ] 9.1 【共同開発者の承認後】`/match`系ルートを既存のvisitorルートへ組み込む
    - 前提: 共同開発者の承認。`apps/web/src/app/visitor/routeContracts.ts`と`routes.tsx`へ`/match`系の契約を追加し、既存のルート表テストへは期待値の**追加**だけを行う（削除、緩和、スキップをしない）。analystルートと`/analyst/*`は変更しない。
    - 焦点テスト: `npx.cmd vitest run apps/web/src/app/visitor apps/web/src/app/routes.test.tsx`
    - _Requirements: 13.1, 13.4_

  - [ ] 9.2 全体の確認を行う
    - 実行順: `npm.cmd test`（失敗件数が1.1の基準を超えないこと）、`npm.cmd run lint`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run check:build-boundary`。development serverは起動しない。結果を件数だけで報告する。
    - _Requirements: 13.5, 15.6_

- [ ]* 10. （任意）オフラインAIの補助を実装する
  - [ ]* 10.1 質問の中立性の第二意見CLIを実装する
    - `matching questions review-ai`が質問文だけを`createBedrockConverseClient`（Haiku）へ送り、指摘の一覧を厳格なJSONで受け取って保存する。結果は参考であり、承認の代替にならない。通常テストはfake clientで行う。
    - _Requirements: 2.7, 8.3_

  - [ ]* 10.2 立場候補の抽出CLIを実装する
    - 利用条件が`CONFIRMED`の資料テキストだけを入力にし、`stance`、`quote`、`locator`の厳格なJSONを受け取り、引用実在とlocator一致を決定的に検査して`PENDING`で保存する。`stageRunner`の冪等性キャッシュとPacerを流用する。利用条件が`CONFIRMED`でない資料は送信前に拒否する。実Bedrockの実行は利用者が手動で行う。
    - _Requirements: 8.3, 9.3, 9.6_

  - [ ]* 10.3 説明カードの下書きCLIを実装する
    - テンプレートで表せない補足説明だけをAIで下書きし、`cardCheck`に通ったものを`draftedBy: "AI"`で保存する。承認者の画面（analystモード）にAI下書きの表示を出す。
    - _Requirements: 8.3, 8.7_

  - [ ]* 10.4 根拠限定の対話解説をデモ版に追加する
    - `POST /api/demo/explain`（デモ用サーバーのみ、`questionId`と`text`だけを受け付ける）を追加し、承認済みカードと質問の解説だけを根拠に回答する。根拠がない問い、推奨の要求、出力検査の失敗は定型文を返す。送信前に送信内容を表示する。呼出し回数の上限（予算）を設定値にする。公開版のビルドに含めない。
    - _Requirements: 8.5, 8.6, 11.3, 12.3_

- [ ]* 11. （実データ・承認後）実データの立場記録と公開版を用意する
  - [ ]* 11.1 【人間の作業】利用条件と法務を確認する
    - 県選管へ選挙公報の利用条件を問い合わせる。候補者の公式サイトの利用条件を確認する。公職選挙法に関する法務確認を行う。結果を各資料の`usage`（`CONFIRMED`/`RESTRICTED`）へ記録する。確認が完了するまで11.2以降へ進まない。
    - _Requirements: 12.4, 12.5_

  - [ ]* 11.2 実データの立場記録を登録して承認する
    - 公式資料を人間が読み、コードブックに基づき立場記録と根拠を作る（AIは提案のみ）。矛盾は`CONFLICT`にし、人間が優先を明示した場合のみ解決する。画像のみの公報は、Bedrock画像入力の実機確認の後に別途方法を決める。
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 11.3 公開版のバンドルを生成して公開する
    - `matching bundle build --kind public`と`bundle verify`を実行し、承認者の承認と公開判断を経て静的配信する。
    - _Requirements: 12.2, 12.4, 12.5_

## Notes

- スコープ外: OCR精度の改善、公報の画像・PDF・全文の表示、自動取得、ログインとサーバー側の回答保存、実データの立場記録（タスク11は利用条件と法務の確認後）。
- `multi-election-ai-analysis`の未実装タスク（CLASSIFY、SUMMARISE、判定、承認ゲート、publish）には着手しない。本specの承認後に、保留か置換かを決める。
- `apps/web`は共同開発者の担当である。9.1は共同開発者の承認を得てから行う。9.1が未承認の間も、タスク1〜8は`apps/web/src/app/matching/`の単体で検証できる。
- 各propertyはちょうど1つのsub-taskへ割り当てている（Property 1〜8、13: 3.3、9・11: 4.3、10・12: 5.2）。
- `packages/domain/src/index.ts`へのexport追加は、各タスクで必要な行だけを足す。並列に実行したときは、9.2で重複と欠落を確認する。
- 未決事項（デモデータの基礎、質問数、しきい値、並び順、実データの公開条件など）は`requirements.md`と`design.md`に記載している。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "4.1", "4.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["7.6", "8.1", "8.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["10.1", "10.2", "10.3", "11.1"] },
    { "id": 11, "tasks": ["10.4", "11.2"] },
    { "id": 12, "tasks": ["11.3"] }
  ]
}
```