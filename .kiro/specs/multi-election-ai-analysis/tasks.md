# Implementation Plan: Multi-Election AI Analysis

## Overview

TypeScriptと既存のZod契約、`createBedrockConverseClient`、`atomicWriteImmutableFile`、`writeContentAddressedFile`、`sha256Hex`、`Result`、`safeLogger`を再利用し、(1)複数選挙レジストリ、(2)取り込みとSHA-256/revision、(3)PDF抽出とパッセージ、(4)段階基盤と試験実行、(5)検証・根拠付与・判定、(6)承認と公開ゲート、(7)境界テスト、の順にローカルCLI（`npm.cmd run analysis -- <command>`）として段階的に実装する。HTTP routeとポートは追加せず、`apps/web`、既存の`.kiro/specs/ehime-vote-navigator/`と`.kiro/specs/visitor-analyst-mode-separation/`、各`tasks.meta.json`は変更しない。既存の2022年テストの期待値は変更も緩和もしない。

通常のテストはfake（`SourceSupplier`、`PdfTextExtractor`、Bedrock client/`fetch`、fake clock、一時ディレクトリ）だけを使い、ネットワークとBedrockを呼ばない。すべてのtestはwatchなしで終了させ、development serverとpreview serverは起動しない。property testはfast-check 4.10.2で`numRuns: 100`以上とし、各testへ`Feature: multi-election-ai-analysis, Property N`のcommentを付ける。各タスクは対象ファイルの焦点テストだけを実行し、全体の`npm.cmd test`は最終確認で1回だけ実行する。

## Tasks

- [ ] 1. 選挙レジストリを複数選挙へ汎用化する
  - [x] 1.1 既存2022年テストの基準を確認し、レジストリschemaと検証・切替の純関数を追加する
    - 変更前に既存テストを実行して基準を確認する: `npx.cmd vitest run packages/contracts/src/contracts.test.ts packages/domain/src/index.test.ts`（選挙・候補者を扱う既存テストのみ。`packages/fixtures`側に選挙・候補者を参照するテストがあれば同じコマンドへ追加する）。失敗0件を確認する。
    - `packages/contracts/src/models/electionRegistry.ts`へ`ELECTION_STATUSES`、`CandidateDefinitionSchema`、`ElectionDefinitionSchema`、`ElectionRegistryFileSchema`をstrictで追加し、`models/index.ts`へexportだけを足す。既存の`ElectionSchema`、`CandidateSchema`、`primitives.ts`は変更せず、ID形式とコードポイント数のrefineは`electionRegistry.ts`側で重ねる。
    - `packages/domain/src/election/registry.ts`へ`loadRegistry`（解析済みデータを受け取りbrand型`ValidatedRegistry`を返す。`CONTRACT_VIOLATION`、`DUPLICATE_CANDIDATE_ID`、`DUPLICATE_ELECTION_ID`、`INVALID_CURRENT_COUNT`を重複なく全て返す）、`proposeChange`、`decideChange`を副作用のない関数で実装し、`packages/domain/src/index.ts`からexportする。
    - 追加後に基準コマンドを再実行し、`git diff --exit-code -- packages/contracts/src/contracts.test.ts packages/domain/src/index.test.ts`で既存テストが無変更であることと失敗0件を確認する。続けて新規の例示テスト`electionRegistry.test.ts`と`registry.test.ts`を実行する: `npx.cmd vitest run packages/contracts/src/models/electionRegistry.test.ts packages/domain/src/election/registry.test.ts`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 レジストリのファイル入出力、atomic replace、2022年だけの`elections.json`、`election`コマンドを実装する
    - `apps/api/src/store/atomicReplaceFile.ts`を追加し、既存`atomicFiles.ts`の`allowedRoot`検証と予約名拒否を再利用する（再利用に必要な場合だけ既存関数へexportを足す）。一時ファイルへ書いてから改名し、失敗時は元のファイルを残す。
    - `apps/api/src/election/registryFile.ts`で`config/election/elections.json`の読込みと、承認済み変更の1回置換書込みを実装する。`config/election/elections.json`は既存の2022年定義（選挙ID`ehime-governor-2022-20`、投票日2022-11-20、状態`CURRENT`、既存コードと同じ候補者IDと氏名、「林のりこ」の氏名表記）だけで作り、候補者IDと氏名は既存コードから確認して転記する（推測しない）。
    - `apps/api/src/analysis/cli.ts`へ`election show`と`election change <id>`を追加し、`apps/api/package.json`へ既存の`bedrock:smoke`と同じ実行方式の`analysis` scriptを足す。変更前後の選挙名と選挙IDを表示して`y/N`の承認を求め（承認入力は注入可能にする）、`REJECTED`、`TARGET_INVALID`、`UPDATE_FAILED`の理由を固定文で表示し、成功は終了コード0、拒否・失敗は1とする。ポートを開かない。
    - 例示テストで、実`config/election/elections.json`が契約に適合し2022年の定義が仕様どおりであること、一時ファイル上の架空の2026年`PLANNED`定義（実在候補者名を推測しない）を足したデータも読めることを確認する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/store/atomicReplaceFile.test.ts apps/api/src/election/registryFile.test.ts`
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.7_

  - [ ] 1.3 レジストリ検証と選挙切替のproperty testを実装する
    - `packages/domain/src/election/registry.property.test.ts`と`apps/api/src/election/registryChange.property.test.ts`（fakeの書込み失敗を注入）に実装する。
    - **Property 1: レジストリの検証とfail closed**
    - 任意のレジストリデータで、`ValidatedRegistry`が返るのは契約適合・候補者ID重複なし・選挙ID重複なし・`CURRENT`ちょうど1件のときに限り、それ以外は該当する違反の種類を全て返して入力を変更しないことを検査する。
    - **Validates: Requirements 1.1, 1.7**
    - **Property 2: 選挙切替の状態機械**
    - 提案、承認、拒否、未登録または既に`CURRENT`の対象、書込み失敗の任意の操作列で、`CURRENT`が常にちょうど1件であり、承認は旧`CURRENT`を`PAST`、新しい選挙を`CURRENT`にする変更だけを1回で行い（2022年の定義と候補者を含む他の値は不変）、拒否・対象不正・更新失敗ではレジストリが完全に元のままで理由の区分が返ることを検査する。
    - **Validates: Requirements 1.2, 1.4, 1.5, 1.6**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/election/registry.property.test.ts apps/api/src/election/registryChange.property.test.ts`

- [ ] 2. 資料供給インターフェースと取り込み（SHA-256・revision）を実装する
  - [ ] 2.1 取り込み契約、SourceSupplier、手動配置アダプタ、取り込み処理、導出状態、`ingest`コマンドを実装する
    - `packages/contracts/src/models/analysis.ts`へ後続タスクが再利用する契約を一括で追加する: `AssignmentSchema`、`ANALYSIS_STATUSES`、`IngestRecordSchema`、`PassageSchema`、`ExtractionOutputSchema`、`ANALYSIS_STAGES`、`StageRunSchema`（すべてstrict、design.mdのData Modelsどおり）。`models/index.ts`へexportを足す。
    - `apps/api/src/ingest/sourceSupplier.ts`（`SuppliedSource`、`SourceSupplier` port、`SupplyError`）と`manualPlacementSupplier.ts`を追加する。手動配置アダプタは`data/real/raw/`直下のファイル名だけを受け付け（`..`と区切り文字は拒否）、公式URLは必須、取得日時は省略時に実行時刻（UTCオフセット付き）を使う。
    - `apps/api/src/ingest/ingest.ts`へ`decideIngest`（同一SHA-256なら`UNCHANGED`、異なれば`r{n+1}`の新規記録。旧revisionは変更しない）、`ingest`、`toManifestDraft`を実装する。供給元の種類と取り込み時刻は記録に保存せず、割当は`--candidate`または`--shared`を明示した場合だけ設定し、それ以外は`UNASSIGNED`で`candidateId`を持たない。
    - `apps/api/src/ingest/ingestStore.ts`で生PDFを`data/real/raw/_objects/<shard>/<sha256>.pdf`へ`writeContentAddressedFile`で保存し、記録を`data/real/ingest/<sourceId>/<revision>.json`へ`atomicWriteImmutableFile`で保存する。`apps/api/src/ingest/deriveStatus.ts`へ`deriveAnalysisStatus`（`NOT_READY`、`NOT_ANALYZED`、`FAILED`、`COMPLETED`、`IN_PROGRESS`）と`deriveApprovalStatus`（公開対象ごとの`SATISFIED`/`REJECTED`/`OPEN`の列から`APPROVED`/`REJECTED`/`PENDING`を導出。0件は`PENDING`）を純関数で実装する。
    - `cli.ts`へ`ingest <file> --election --source [--candidate|--shared] --url [--retrieved-at]`を追加する。選挙ID未登録、候補者ID不在、供給項目欠落では何も書かず、不備の項目を固定文で表示する。
    - 焦点テスト（例示テスト）: `npx.cmd vitest run packages/contracts/src/models/analysis.test.ts apps/api/src/ingest/ingest.test.ts apps/api/src/ingest/deriveStatus.test.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 5.4_

  - [ ] 2.2 取り込みのproperty testを実装する
    - `apps/api/src/ingest/ingest.property.test.ts`に実装する（fake供給元と手動配置アダプタ、一時ディレクトリを使用）。
    - **Property 3: 取り込みの記録、冪等性、revision**
    - 任意の本体・公式URL・取得日時と任意の供給元で作られる記録が同一で、`sha256`が`sha256Hex`と一致し、初期状態が`NOT_ANALYZED`/`PENDING`であること、同一SHA-256の再取り込みでは記録が増えず、異なるSHA-256ではrevisionが1つ増えた記録がちょうど1件増え、旧revisionがバイト単位で不変であることを検査する。
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.7**
    - **Property 4: 取り込みの拒否と候補者の非推測**
    - 候補者を単一に指定しなければ`SHARED`または`UNASSIGNED`で`candidateId`を持たないこと、選挙ID未登録・候補者ID不在・供給項目欠落では記録を作らず既存記録を変えず不備の項目を返すことを検査する。
    - **Validates: Requirements 2.3, 2.6**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/ingest/ingest.property.test.ts`

- [ ] 3. ページ単位のテキスト抽出とパッセージ割当を実装する
  - [ ] 3.1 パッセージ分割・割当、PdfTextExtractor port、EXTRACT段階、`extract`コマンド（fake）を実装する
    - `packages/domain/src/analysis/passages.ts`へ`normalizeForMatch`（NFKC正規化と空白除去）、`splitIntoPassages(pages, maxChars = 1000)`（改行と「。」「！」「？」の直後で区切り、貪欲に結合し、ページをまたがず、文字を足さず落とさない）、`attributePassage`（登録された`name`/`nameForms`だけで照合し、ちょうど1名なら`ASSIGNED`と根拠、0名または2名以上なら`UNASSIGNED`）、`resolveEffectiveCandidate`を実装し、`packages/domain/src/index.ts`からexportする。
    - `apps/api/src/extract/pdfTextExtractor.ts`に`PdfTextExtractor` portと`PdfError`区分を定義し、`extractStage.ts`にEXTRACT段階を実装する。50MB超、200ページ超、0ページ、破損、パスワード保護、全ページ画像を`NOT_READY`（OCRなし、パッセージ0件、原因区分と人間確認が必要な旨）にし、一部だけ画像の場合は画像ページ番号を記録して文字層のあるページだけを扱う。pdf-page locatorは物理順の1始まりで付与する。
    - `apps/api/src/extract/defaultExtractor.ts`は実アダプタ導入前は固定文の「抽出器未導入」で終了コード1を返し、`cli.ts`へ`extract --source --revision`を追加する。出力は件数、画像ページ番号、`NOT_READY`の原因区分だけで、ページ本文を表示しない。
    - 焦点テスト（fake extractorの例示テスト）: `npx.cmd vitest run packages/domain/src/analysis/passages.test.ts apps/api/src/extract/extractStage.test.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 3.2 抽出・パッセージ・割当のproperty testを実装する
    - `packages/domain/src/analysis/passages.property.test.ts`（Property 6, 8）と`apps/api/src/extract/extractStage.property.test.ts`（Property 7、OCR呼出しとBedrock呼出しのカウンターをfakeで確認）に実装する。
    - **Property 6: ページlocatorとパッセージ分割**
    - ページ番号が1からページ数までの整数で、パッセージが(ページ番号, ページ内の出現順)の昇順に並び、ページをまたがず`maxChars`以下で、連結から空白を除いた文字列が元のページ本文から空白を除いた文字列と一致することを検査する。
    - **Validates: Requirements 3.1, 3.4**
    - **Property 7: 画像ページ判定とNOT_READY**
    - 画像ページ一覧が空白と改行を除いた文字数0のページと一致し、全ページ画像または処理できないPDFではパッセージとページテキストを保存せず`NOT_READY`と原因区分を返し、OCRとBedrockを0回しか呼ばないことを検査する。
    - **Validates: Requirements 3.2, 3.3, 3.7**
    - **Property 8: 氏名表記による候補者割当**
    - 一致する候補者がちょうど1名（同一候補者の複数出現は1名）なら`ASSIGNED`と根拠、0名または2名以上なら`UNASSIGNED`で`candidateId`なしとなり、出所の候補者は明示的な氏名の根拠または資料の指定だけから決まり、両者が食い違えば候補者なしとなることを検査する。
    - **Validates: Requirements 3.5, 3.6**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/analysis/passages.property.test.ts apps/api/src/extract/extractStage.property.test.ts`

  - [ ] 3.3 PDFライブラリ追加の利用者承認と実PDF配置を確認する（承認ゲート）
    - 利用者へ`pdfjs-dist`（legacy build、バージョン固定、CVE-2024-4367修正済みの4.2.67以降、repoのNode版と照合済みのもの）の`apps/api`への追加承認を求める。比較表の代替案は`unpdf`である。あわせて、実際の選挙公報PDFが`data/real/raw/`に置かれたことを確認する。
    - 承認と実PDFの配置が確認されるまで、`npm install`も依存追加も行わない。承認されない場合は3.4と、3.4に依存する4.4を実行せず、fakeによる検証までで本featureを進める。
    - _Requirements: 3.1, 3.2, 3.7_

  - [ ] 3.4 `pdfjs-dist`アダプタを実装し、実PDFの抽出結果を原本と照合する（3.3の承認後のみ）
    - 承認済みの`pdfjs-dist`を正確なバージョンで`apps/api/package.json`へ追加する。`apps/api/src/extract/pdfjsTextExtractor.ts`にlegacy buildを使う`PdfTextExtractor`を実装する（`isEvalSupported: false`、`cMapUrl`と`standardFontDataUrl`を指定、`getPage(n).getTextContent()`でページ別に取得、パスワード保護と破損を`PDF_ENCRYPTED`/`PDF_CORRUPT`へ対応付け）。`defaultExtractor.ts`をこのアダプタへ切り替える。
    - `apps/api/src/extract/fixtures/`へ架空文面の小さなPDF（文字層あり、画像のみ、破損、パスワード付き）を置き、例示テストで期待する区分を確認する。実際の選挙公報は置かない。焦点テスト: `npx.cmd vitest run apps/api/src/extract/pdfjsTextExtractor.test.ts`
    - 手動の照合（Bedrockは呼ばない）: `npm.cmd run analysis -- extract --source <sourceId> --revision r1`を実行し、CLIにはページ本文が出ないため、保存された`data/real/stages/<sha256>/r1/EXTRACT/`配下のEXTRACT出力ファイル（Git管理外）を開いて原本PDFと目視で比較する。ページ順、氏名途中の空白や改行、縦書き・段組みの読み順を確認し、結果を利用者へ報告する。
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7_

- [ ] 4. 段階基盤と試験実行（CLASSIFY・SUMMARISE）を実装する
  - [ ] 4.1 StageRunストア、冪等性キー、Pacer、テーマ一覧、EXTRACT保存を実装する
    - `apps/api/src/analysis/stageStore.ts`へ`data/real/stages/<sourceSha256>/<revision>/<stage>/<stageRunId>.json`の不変保存、キー（`sourceSha256`、`revision`、`stage`、`modelId`、`inputHash`）による最新`SUCCEEDED`の検索、`FAILED`を別ファイルで記録し`SUCCEEDED`を上書きしない処理を実装する。
    - `apps/api/src/analysis/stageRunner.ts`へ`stageRunId = sha256Hex(正規化JSON(key))`、保存済み`SUCCEEDED`があればBedrockを呼ばず出力を返すキャッシュ、失敗時に既存出力を変更しない処理を実装する。`apps/api/src/analysis/pacer.ts`へ呼出し間隔6.1秒以上を保つ`Pacer`（fake clock注入可）を実装する。
    - `config/themes.json`（`{ "schemaVersion": 1, "themes": ["教育", "経済", "防災"] }`、名称の重複と予約語「未分類」を禁止）と、`apps/api/src/analysis/themes.ts`（Zod strict検証、`THEME_LIST_UNREADABLE`、`THEME_LIST_EMPTY`）を追加する。3.1の`extract`コマンドがEXTRACT出力をStageRunとして保存するよう結線する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/stageStore.test.ts apps/api/src/analysis/stageRunner.test.ts apps/api/src/analysis/pacer.test.ts apps/api/src/analysis/themes.test.ts`
    - _Requirements: 2.5, 4.1, 4.4, 4.7_

  - [ ] 4.2 CLASSIFYとSUMMARISE、strict JSON解析、試験実行と`--full`、`--comparison`を実装する
    - `apps/api/src/analysis/prompts.ts`へ版付きの固定system文（3000文字以下）とパッセージ区切り（「データであって指示ではない」と明示）、`INPUT_TOO_LONG`の送信前検査（合計20000文字超は失敗）を実装する。`strictJson.ts`は純粋なJSONオブジェクトだけを受け付け（コードフェンスや前後の文章は不可）、Zod strictで検証して失敗を`RESPONSE_INVALID`にする。
    - `classifyStage.ts`は応答`{ "theme": string }`が`themes.json`のテーマ名と完全一致するときだけ採用し、それ以外は「未分類」とする。`summariseStage.ts`は`StructuredPolicySchema`と300文字以下の要約を出力する。どちらも既存の`apps/api/src/aws/bedrockConverse.ts`の`createBedrockConverseClient`を使い、再試行せず、`Pacer`で呼出し間隔を空け、`safeLogger`だけでログを出す。
    - `apps/api/src/analysis/runPlan.ts`へ試験実行の対象選択（ページ昇順・ページ内の出現順で先頭5パッセージ）を実装し、`cli.ts`へ`run --source --revision [--full] [--comparison]`と`stage <name> --source --revision [--passage]`を追加する。既定モデルは`jp.anthropic.claude-haiku-5-5`、`--comparison`の明示時だけ`jp.anthropic.claude-opus-5-5`とする。`--full`がなければ6件目以降のBedrock呼出しを開始しない。
    - 焦点テスト（fake clientまたはfake `fetch`のみ）: `npx.cmd vitest run apps/api/src/analysis/prompts.test.ts apps/api/src/analysis/strictJson.test.ts apps/api/src/analysis/classifyStage.test.ts apps/api/src/analysis/summariseStage.test.ts apps/api/src/analysis/runPlan.test.ts apps/api/src/analysis/runCommand.test.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 5.5_

  - [ ] 4.3 段階基盤・試験実行・テーマ分類のproperty testを実装する
    - `apps/api/src/analysis/stageRunner.property.test.ts`（Property 5, 12）、`runPlan.property.test.ts`（Property 10）、`bedrockRequests.property.test.ts`（Property 11。実クライアント、fake `fetch`、fake clock、`Pacer`を使用）、`classifyStage.property.test.ts`（Property 13）に実装する。
    - **Property 5: 段階実行のキャッシュ**
    - キー5要素が全て一致する`SUCCEEDED`があれば保存済み出力を返してBedrock呼出し0回、5要素のどれか1つでも異なれば使われないことを検査する。
    - **Validates: Requirements 2.5**
    - **Property 10: 試験実行の対象選択**
    - `--full`なしの`run`の対象が(ページ昇順、ページ内の出現順)の先頭`min(5, n)`件で、他のパッセージへのBedrock呼出しが0回であることを検査する。
    - **Validates: Requirements 4.6**
    - **Property 11: 送信リクエストの制約とモデル選択**
    - 送信される全リクエストが入力20000文字以下、最大出力トークン数2000、同時処理1件以下、任意の60秒窓で10回以下で、上限超過は送信されず再試行もなく、`--comparison`なしでは`modelId`が全て`jp.anthropic.claude-haiku-5-5`であることを検査する。
    - **Validates: Requirements 4.3, 4.4**
    - **Property 12: 段階の独立性と失敗時の不変**
    - 段階の再実行で他の段階の保存済み出力がバイト単位で不変であり、入力欠落、テーマ一覧の読込み失敗、テーマ0件、Bedrockエラーでは当該段階の既存出力が不変で、失敗した段階名と原因区分が返ることを検査する。
    - **Validates: Requirements 4.1, 4.7**
    - **Property 13: テーマの完全一致**
    - 割り当てられるテーマは応答がテーマ名と完全一致するときだけで、部分一致、空白や大文字小文字の違い、解析できない応答は全て「未分類」になることを検査する。
    - **Validates: Requirements 4.2**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/stageRunner.property.test.ts apps/api/src/analysis/runPlan.property.test.ts apps/api/src/analysis/bedrockRequests.property.test.ts apps/api/src/analysis/classifyStage.property.test.ts`

  - [ ] 4.4 【手動】実PDFでの試験実行（5パッセージ以下）を利用者と確認する（`npm test`には含めない）
    - 前提: 3.3の承認と3.4の完了、実PDFの`ingest`済み、利用者のシェルに`AWS_BEARER_TOKEN_BEDROCK`が設定済みであること。キーはファイル、ログ、会話へ出さない。エージェントは自動実行せず、利用者の実行結果（件数と状態のみ）を確認する。
    - コマンド: `npm.cmd run analysis -- run --source <sourceId> --revision r1`（Haiku、先頭5パッセージ以下）。このタスク時点ではCLASSIFYとSUMMARISEまで（最大10回）で、タスク5の後は同じコマンドがVERIFYを含む最大15回（約95秒）になる。
    - 結果を人間が確認するまで`--full`を指示しない。Opusとの比較（`--comparison`）は利用者が明示的に指示したときだけ実行する。
    - _Requirements: 4.3, 4.4, 4.6_

- [ ] 5. 検証・根拠付与・判定（VERIFY・GROUND・JUDGE）を実装する
  - [ ] 5.1 `judge`関数、決定的検査、GROUNDの純関数を実装する
    - `packages/domain/src/analysis/judge.ts`へ全域関数`judge`（FAIL > REVIEW > PASS。決定的検査に`FAIL`または意味判定に`DETECTED`が1件以上なら`FAIL`、両方1件以上で全件`PASS`かつ全件`NOT_DETECTED`なら`PASS`、それ以外は`REVIEW`）を実装する。
    - `deterministicChecks.ts`へ`QUOTE_EXISTS`（`evidenceQuote`が3.1の`normalizeForMatch`後のパッセージ本文に含まれれば`PASS`、含まれなければ`FAIL`、引用なしは`UNVERIFIABLE`）と`PROVENANCE_MATCH`（ページ、候補者、SHA-256の一致で`PASS`、不一致は`FAIL`、候補者なしは`UNVERIFIABLE`）を実装する。`ground.ts`へ、モデルが返したlocatorではなくパッセージのページから`{ kind: "pdf-page", page }`を設定して`PolicyUnit`と`Citation`を作る関数を実装する（候補者なしのパッセージには作らない）。`packages/domain/src/index.ts`へexportを足す。
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/analysis/judge.test.ts packages/domain/src/analysis/deterministicChecks.test.ts packages/domain/src/analysis/ground.test.ts`
    - _Requirements: 4.1, 4.5_

  - [ ] 5.2 VERIFY（別要求の意味判定）、GROUND、JUDGE段階とAnalysisArtifact契約を実装する
    - `packages/contracts/src/models/analysisArtifact.ts`へ`AnalysisModelIdsSchema`（`ModelIdsSchema.omit({ embedding: true })`）、`AnalysisPromptVersionsSchema`（`PromptVersionsSchema`に`classification`を追加）、`AnalysisArtifactSchema`（`AiArtifactSchema.extend({ modelIds, promptVersions, theme })`、`humanStatus`は常に`PENDING`）を追加し、`models/index.ts`へexportを足す。
    - `apps/api/src/analysis/verifyStage.ts`は決定的検査に加え、SUMMARISEのプロンプトと応答を渡さない別のBedrock要求で`meaningChange`、`meaningReversal`、`unsupportedAddition`を`DETECTED`/`NOT_DETECTED`/`UNDETERMINED`で受け取る（同じ`Pacer`を通す）。`groundStage.ts`と`judgeStage.ts`（`VerificationRecord`と`AnalysisArtifact`を出力）を追加し、`run`をCLASSIFY→SUMMARISE→VERIFY→GROUND→JUDGEの連鎖へ拡張する（1パッセージ最大3回のBedrock呼出し。有効な候補者がないパッセージは解析できるが、GROUND以降の成果物は作らない）。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/verifyStage.test.ts apps/api/src/analysis/groundStage.test.ts apps/api/src/analysis/judgeStage.test.ts apps/api/src/analysis/runCommand.test.ts packages/contracts/src/models/analysisArtifact.test.ts`
    - _Requirements: 4.1, 4.5, 4.7_

  - [ ] 5.3 判定関数のproperty testを実装する
    - `packages/domain/src/analysis/judge.property.test.ts`に実装する。
    - **Property 9: 判定関数**
    - 任意の決定的検査の結果列と意味判定の結果列で`judge`が全域関数であり、`FAIL`が1件以上または`DETECTED`が1件以上なら`FAIL`、そうでなく両方1件以上で全件`PASS`かつ全件`NOT_DETECTED`なら`PASS`、それ以外は`REVIEW`を返すことを検査する。
    - **Validates: Requirements 4.5**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/analysis/judge.property.test.ts`

- [ ] 6. 人間承認と公開ゲートを実装する
  - [ ] 6.1 承認・公開データの契約、必要承認者数の解析、公開ゲートの純関数を実装する
    - `packages/contracts/src/models/analysisApproval.ts`へ`AnalysisApprovalSnapshotSchema`（`ApprovalSnapshotSchema.extend`で`automaticStatus`を`PASS`/`REVIEW`、`modelIds`、`promptVersions`を持つ）と、`ApprovalRecordSchema.extend({ snapshot })`の承認記録を追加する。却下は既存の`RejectionRecordSchema`を使う。`published.ts`へ`PublishedItemSchema`と`PublishedElectionBundleSchema`（strict、引用原文とlocator以外の資料本文を持たない）を追加し、`models/index.ts`へexportを足す。
    - `packages/domain/src/analysis/requiredApprovers.ts`へ`parseRequiredApprovers`（未指定は1、`/^[1-9][0-9]*$/u`に一致する安全な整数だけを許し、それ以外は`INVALID_REQUIRED_APPROVERS`）、`publishGate.ts`へ`buildPublishedBundle`（資料ごとに最新revisionだけを対象にし、判定が`FAIL`でなく、承認者ごとの最新決定が`APPROVED`かつ`snapshot`（SHA-256、revision、モデルID、内容ハッシュ）が現在の結果と一致する異なる承認者が必要承認者数以上の結果だけを含める。該当0件は`items: []`）を実装し、`packages/domain/src/index.ts`へexportを足す。
    - 焦点テスト（例示テスト）: `npx.cmd vitest run packages/contracts/src/models/analysisApproval.test.ts packages/contracts/src/models/published.test.ts packages/domain/src/analysis/requiredApprovers.test.ts packages/domain/src/analysis/publishGate.test.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.7_

  - [ ] 6.2 決定記録ストア、`decide`、`publish`コマンドを実装する
    - `apps/api/src/analysis/decisionStore.ts`へ`data/real/approvals/<artifactId>/<seq>.json`への追記専用の決定記録（`previousRecordHash`で連鎖、`atomicWriteImmutableFile`）を実装し、`cli.ts`へ`decide --artifact --approver --approve|--reject --reason`（承認時点のsnapshotを現在の結果から作る）を追加する。
    - `publish --election`は環境変数`REQUIRED_APPROVER_COUNT`を`parseRequiredApprovers`で解析し、`buildPublishedBundle`の結果を1.2の`atomicReplaceFile`で`data/real/published/<electionId>/bundle.json`だけへ書く。設定不正（`INVALID_REQUIRED_APPROVERS`）と書込み失敗（`STORE_WRITE_FAILED`）では`bundle.json`を書かず、既存の公開用データと決定記録を変更せず、固定文と終了コード1を返す。`apps/api/src/ingest/ingestView.ts`の`buildIngestRecordView`で、公開ゲートの結果から`deriveApprovalStatus`を使って承認状態を導出する。
    - このタスクの範囲は`data/real/published/`の生成までである。生成したバンドルを`apps/web`またはVercelへ渡す作業はこのspecに含めない（共同開発者の承認を得た別タスク。Vercelへ認証キーを登録するか静的データだけを置くかは管理者への確認事項であり、確認までは公開Bedrockエンドポイントを作らない）。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/decisionStore.test.ts apps/api/src/analysis/publish.test.ts apps/api/src/ingest/ingestView.test.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.7_

  - [ ] 6.3 公開ゲート・必要承認者数・公開データ最小性のproperty testを実装する
    - `packages/domain/src/analysis/publishGate.property.test.ts`（Property 14, 16）と`apps/api/src/analysis/publish.property.test.ts`（Property 15。一時ディレクトリで既存の公開用データと決定記録の不変を確認）に実装する。
    - **Property 14: 公開ゲート**
    - 公開用データに含まれる結果が、各資料の最新revisionのうち判定が`FAIL`でなく、最新決定が`APPROVED`で`snapshot`が現在の結果と一致する異なる承認者が必要承認者数以上のものと一致し、該当0件なら`items`が空で決定記録が不変であることを検査する。
    - **Validates: Requirements 5.1, 5.7**
    - **Property 15: 必要承認者数の設定**
    - 未指定なら1、`/^[1-9][0-9]*$/u`に一致する安全な整数ならその値、それ以外（空文字列、0、負数、小数、数値以外）なら設定エラーで、設定エラー時は公開用データが生成されず既存の公開用データと決定記録が不変であることを検査する。
    - **Validates: Requirements 5.2**
    - **Property 16: 公開データの最小性**
    - 公開用データのシリアライズ結果が、`Citation`の引用原文に含まれない資料本文（ページ本文とパッセージ本文の目印文字列）を含まず、strict schemaが余剰項目を持つバンドルを拒否することを検査する。
    - **Validates: Requirements 5.3**
    - 焦点テスト: `npx.cmd vitest run packages/domain/src/analysis/publishGate.property.test.ts apps/api/src/analysis/publish.property.test.ts`

- [ ] 7. セキュリティと公開境界のテストを実装する
  - [ ] 7.1 生資料の配置境界のproperty testを実装する
    - `apps/api/src/ingest/rawBoundary.property.test.ts`に実装する（一時ワークスペースでfake供給元と手動配置アダプタを使い、`..`と区切り文字を含むファイル名の拒否も例示で確認）。
    - **Property 17: 生資料の配置**
    - 任意の資料本体について、取り込み後に本体のバイト列を含むファイルが一時ワークスペースの`data/real/raw`配下だけに存在することを検査する。
    - **Validates: Requirements 5.4**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/ingest/rawBoundary.property.test.ts`

  - [ ] 7.2 機密情報の非出力のproperty testを実装する
    - `apps/api/src/analysis/noSecretOutput.property.test.ts`に実装する。認証キー、プロンプト、応答本文、ページ本文の目印文字列をfakeの環境変数・`fetch`・extractorから注入し、`ingest`、`extract`、`run`、`decide`、`publish`を成功と失敗の両方で実行する。
    - **Property 18: 機密情報の非出力**
    - 捕捉した標準出力、標準エラー出力、`safeLogger`の出力、CLIの表示、エラー、公開用データに目印が現れないこと（StageRunにもプロンプト本文と応答本文が保存されないこと）を検査する。
    - **Validates: Requirements 5.5**
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/noSecretOutput.property.test.ts`

  - [ ] 7.3 公開境界のSMOKEテストを実装する
    - `apps/api/src/analysis/boundary.test.ts`を、既存の`apps/api/src/config/repository-boundaries.test.ts`の方式に倣って追加する。既存の`apps/api/src/app.ts`のroute一覧にBedrockを呼ぶ経路が増えていないこと、`apps/api/src/analysis`、`election`、`ingest`、`extract`が`express`、`node:http`、`listen`を使わずCLIがポートを開かないこと、`git ls-files data/real`が0件であること、`git check-ignore data/real/raw/x.pdf`が成功することを検査する。
    - 焦点テスト: `npx.cmd vitest run apps/api/src/analysis/boundary.test.ts`
    - _Requirements: 5.4, 5.6_

- [ ] 8. 最終確認
  - [ ] 8.1 lint、型検査、焦点テスト、全体テスト、ビルドを実行する
    - 次の順で実行し、失敗は本feature内で修正する（既存の2022年テストは変更しない）。`npm.cmd run lint`、`npm.cmd run typecheck`、本featureの新規テストの焦点実行（`npx.cmd vitest run packages/contracts/src/models packages/domain/src/election packages/domain/src/analysis apps/api/src/election apps/api/src/ingest apps/api/src/extract apps/api/src/analysis apps/api/src/store`）、その後に全体の`npm.cmd test`を1回だけ、最後に`npm.cmd run build`。
    - development serverとpreview serverは起動せず、実Bedrockは呼ばない。
    - _Requirements: 1.3, 5.4, 5.6_

  - [ ] 8.2 変更範囲とGit追跡を確認する
    - `git status --short`に`data/real`配下のファイルがなく、`git ls-files data/real`が0件であることを確認する。
    - `git status --short -- apps/web .kiro/specs ':!.kiro/specs/multi-election-ai-analysis'`が空であること（`apps/web`、既存spec、`.kiro/specs/*/tasks.meta.json`に変更がないこと）を確認する。変更が許されるのは`packages/contracts`、`packages/domain`、`apps/api`、`config/`、およびPDFライブラリ承認後の`apps/api/package.json`とlockファイルだけである。結果を利用者へ報告する。
    - _Requirements: 5.4, 5.6_

## Notes

- スコープ外: 自動取得の実装、OCR、`apps/web`の変更、公開Bedrockエンドポイント、候補者の手動割当UI。バンドルを`apps/web`またはVercelへ渡す作業は、共同開発者の承認を得た別タスクとする。
- 未決事項と、それが止めるタスク:
  - PDFライブラリ（`pdfjs-dist`推奨）の追加承認: 3.3で確認するまで3.4と4.4を実行しない。
  - 必要承認者数: 既定値は1。チームが決めた値は`REQUIRED_APPROVER_COUNT`の設定だけで反映し、6.1と6.2のコードは変更しない。
  - 2026年の候補者定義: 開発者が公式ページ（https://senkyo.pref.ehime.jp/kouhosya/）から転記して`PLANNED`で追加し、`election change`で切り替える。本タスク一覧の対象外のデータ作業で、転記まで2022年が`CURRENT`のままである。
  - Vercelの扱い（認証キーの登録か、承認済み静的データだけの配置か）: 管理者への確認事項。確認までは公開Bedrockエンドポイントを作らない。
  - 採用モデル: 既定はHaiku。Opusとの比較（`--comparison`）の後に決める。
- 実Bedrockを呼ぶのは4.4の手動コマンドだけで、`npm test`には含めない。生PDFは`data/real/raw/`だけに置き、コミットしない。
- クレジット節約: 各タスクで焦点テストだけを実行し、全体の`npm.cmd test`は8.1で1回だけ実行する。各トップレベルタスクの完了ごとに停止して利用者のレビューを受ける。
- property testは各propertyをちょうど1つのsub-taskへ割り当てている（Property 1-2: 1.3、3-4: 2.2、6-8: 3.2、5・10-13: 4.3、9: 5.3、14-16: 6.3、17: 7.1、18: 7.2）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "4.1", "5.1"] },
    { "id": 5, "tasks": ["3.4", "4.2"] },
    { "id": 6, "tasks": ["4.3", "4.4"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["5.3", "6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["6.3", "7.1", "7.2", "7.3"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["8.2"] }
  ]
}
```
