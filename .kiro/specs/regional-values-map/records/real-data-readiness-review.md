# 実データ整備と質問方式v2への接続の準備レビュー（Task 13.x の調査。提出版）

**状態: 提出版（人の承認待ち）。** 調査と設計案だけで、コード、既存のデータ、`requirements.md`、`design.md`、`tasks.md` は変更していない。タスクの完了扱いも変えていない。公式データの棚卸しは、同じ場所の `dataset-inventory.md` にある。

作成は Kiro（AI）で、調査日は2026-11-15（作業環境の日付）。実際の Bedrock と AWS の呼び出し、公式データの追加の取得、新しい依存の追加はしていない。

## 0. 調査時点の状態

| 項目 | 内容 |
| --- | --- |
| ブランチと作業ツリー | `nishi8`。`HEAD` は `84fbd68`（PR #15 のmerge）。調査の開始時は、作業ツリーがきれいだった |
| mainとの同期 | `git fetch origin` を実施。`origin/main` は `b4ffee3`（PR #16 `feat/regional-values-v2` のmerge）で、`HEAD` より2コミット先。差分は `apps/web/src/features/values-v2/**` と `apps/web/values-v2-preview.html` の16ファイルで、すべて追加。仕様書の差分はない。merge と pull はしていない。v2のファイルは `git archive` で `dist/` の一時領域に展開して読み、読み終えて削除した |
| 仕様書 | `HEAD` の3文書が最新（mainの差分に仕様書はない） |
| `data/real` | 公式データの原本は `open-data/ehime-catalog/pref-2/shelters.xlsx`（288,496バイト）だけ。ほかは選挙公報（`raw/koho.pdf`）とOCRの成果物。`data/real/regional-values/` と `data/real/raw/regional-values/` は存在しない |
| 契約 | `DatasetRecord`、`AggregationRecord`（`dataset.ts`）、`RealSource`、`RealFact`、`SourceConversion`（`content.ts`）、`IssueLinksFile`（`issues.ts`）は実装済み |
| 実装 | `aggregate`、`deriveFact`、`factComparison`、`factGroundingText`、下書き工程（`runDraft`、決定的検査、承認台帳）、`issues export/list/verify/receipt` は実装済み。`intake/`（取り込み）、`csvToText`、`verify-fact`、データセット台帳と `AggregationRecord` の書込みは**存在しない**（`apps/api/src/regional-values/` に `intake/` がない） |
| FIXTURE の `issues.json` | 3件（防災、教育・子育て、人口減少・地域活性化。いずれも版1）。`coverage` は6テーマで、ほかの3テーマ（地域交通、地域経済・雇用、医療・福祉）は0件。`meta` は `schemaVersion` 1、`kind` ISSUES、`dataKind` FIXTURE、`inputDigest`、`contentHash` |
| v2 | 画面の独立した試作。どのルートにも登録していない。`/values` はv1のまま |

## 1. Task 13.x の依存関係と実装順序

「状態」は、実装が**ない**ことと、人の**承認が要る**ことを分けて書いた。

| タスク | 内容 | 状態 | 依存 | 待つ条件 |
| --- | --- | --- | --- | --- |
| 13.1 | 検査用の語の一覧と、`neutrality.json`、`build.json`、`draft.json` | 案は作成済み（`word-lists-proposal.md`）。**承認待ち**。実ファイルなし | なし | 利用者の語の承認。3つの語の一覧の置き場所（設計は `neutrality.json`、実装は `--draft-settings` の設定）の決定 |
| 13.3 | `BIAS_SUSPECTED` の承認操作 | 未実装 | 11.6（済） | 【要確認23】 |
| 13.4 | 実データ用の固定文言 | 未実装 | なし | 【要確認18】、ライセンス表示の文面、「愛媛県」の名称の範囲 |
| 13.5〜13.8 | 結果画面の順序、診断セットの選択、日本語直書きの禁止、端末内保存 | 未実装 | なし | 【要確認19、20、22、21】など。実データとは独立で、本調査の対象外 |
| 13.9 | xlsxの読取りの依存 | 未実装 | 13.15 | 新しい依存の承認、【要確認3】。設計で承認済みの方針（人がCSVへ変換）で避けられる |
| 13.10 | 原本の取り込み（`intake`） | **未実装** | 13.15、16.1（済） | 取り込みの許可、Open Decisions (2)(3) |
| 13.11 | 事実項目の作成（`aggregate` の呼出し）と `verify-fact` | **未実装** | 13.10または13.15、16.x（済）、11.7（済） | 【要確認8】、人が原本の値と照合する作業 |
| 13.12 | 実データの読込みと門（G1〜G6）、`REAL` と `REAL_PREFERRED` のビルド | **未実装** | 13.1、13.4、13.11、13.14、13.16、16.9（済） | 【要確認2、16】、Open Decisions (3) |
| 13.13 | 公開版の出力条件と `release.json` | **未実装** | 13.12 | 【要確認10】、法務確認、承認者数の運用値 |
| 13.14 | 公式データの棚卸し | **調査を提出済み**（`dataset-inventory.md`）。完了ではない | なし | 利用者の確認（確認者名、確認日）と、3テーマの確定 |
| 13.15 | CSVの取り込み（`csv-lines-v1`）と出典記録 | **未実装** | 13.14、16.1（済） | 13.14の完了、利用者による取り込みの許可（原本は利用者が配置する）。新しい依存は不要。架空のCSVで、技術的には先行して作れる |
| 13.16 | 実データ用の質問バンク、結果解説、固定文言の複製と再承認 | 未実装 | 13.1、13.4、13.14 | 偏り確認と承認（人） |
| 13.17 | 実データ（クイック版の3テーマ）の完了確認 | 人の確認の記録 | 13.12、13.16 | 3テーマの `VERIFIED` の事実項目と、承認済みの課題カード |

13.2は廃止（番号は再利用しない）。

**実装の順序（案）**

1. 人（並行）: 13.14の確認と3テーマの決定。13.1の語の承認と置き場所の決定。
2. 実装: 13.15（`csvToText`、`intake` の共通部分）。
3. 実装: 13.10（CSVの部分。xlsxは、人が変換したCSVを取り込む）。13.9は後回しでよい。
4. 人: 原本の配置、変換手順書、利用条件・個別注記・外部AIへの送信可否の記録。
5. 実装: 13.11。先に【要確認8】の要件更新を決める。
6. 人: `verify-fact` で `VERIFIED` にする。
7. 実装と人: 実データを入力にした課題候補の下書きと承認（実Bedrockを呼ぶかは別に判断）。
8. 実装: 13.16、13.12、13.13（13.1と13.4の承認が先）。
9. 人: 13.17。

**仕様の食い違い（要確認）**: 13.10の「待つ条件」は「13.9の完了（xlsxを扱う場合）」とし、xlsx固有の部分を実装するとしている。一方、設計は、xlsxは新しい依存を足さず、人がCSVに変換して取り込む（承認済みの方針）としている。`shelters.xlsx` を最初の原本にするなら、13.9なしで進められる。13.10の書き方を、どちらかにそろえる必要がある。

## 2. 再利用できる既存の機能

| 機能 | 場所 | 再利用 | 条件と制約 |
| --- | --- | --- | --- |
| `aggregate` | `packages/domain/src/regional-values/content/aggregate.ts` | そのまま使える | 入力はUTF-8・LFのCSVのテキストで、1行目が見出し。`COUNT_ROWS`、`COUNT_ROWS_WHERE`、`SUM_COLUMN`（条件は1列。`equals` は文字列の一致）。`dedupeColumns` は、明記したときだけ使う。完全に同じ行は `DUPLICATE_ROWS` で拒否。数値でない値、単位の混在、読めない基準日も拒否。出力は、値、単位、欠損数、重複除外数、行の範囲（`text-lines`）、入力のSHA-256、方法のハッシュ。文字コードの判定はしない（13.15）。複数列の条件と、グループごとの集計はできないので、グループごとに事実項目を1件ずつ作る |
| `deriveFact` | `.../content/deriveFact.ts` | そのまま使える | `RATIO`、`DIFFERENCE`、`PERCENT_CHANGE`。元は `VERIFIED` の `REAL_AI` の事実項目2件。単位、対象地域、基準日を検査する。小数2桁。**異なる単位の比は、「分子の単位/分母の単位」の単位になり、0.00に丸まる値は拒否される（`ROUNDS_TO_ZERO`）。そのため、「人口1万人あたり」のような換算は作れない。避難場所なら「1か所あたりの人口」（人/か所）の形にする** |
| `checkFactComparison` | `.../content/factComparison.ts` | そのまま使える | 単位、対象地域、調査年または基準日の条件（Req 7.26）。優劣の語（`SUPERIORITY`）を含む文を拒否する |
| `factGroundingText` | `.../content/factGroundingText.ts` | そのまま使える | 事実の文、値、地域、調査日（ISO形式と和文）を、根拠のテキストにする |
| `checkDraftInput` | `apps/api/src/regional-values/draft/checkDraftInput.ts` | そのまま使える | 実データの入力は、事実が `VERIFIED`、出典の利用条件が `CONFIRMED`、送信可否が `ALLOWED`、選挙公報でないことを要求する |
| `runDraft` と決定的検査 | `.../draft/` | そのまま使える（fake） | `--draft-settings` の語の一覧が要る（13.1）。実クライアントの配線はあるが、今回は呼ばない |
| 承認台帳、`draft review`、`approve ISSUE` | `.../draft/` | そのまま使える | 確認項目6つ、`requiredApprovers` |
| `loadIssueSnapshot`、`issues export/verify/receipt` | `.../issues/` | そのまま使える | `data/real/regional-values/` の `facts/<factId>.json`、`sources/<sourceId>/<revision>.json`、原本 `data/real/raw/regional-values/<sourceId>/<revision>/` の配置を前提にする（`inputs.ts`）。**この配置に書き込む取り込みがまだない**。受領記録が2件以上あると、`RECEIPT_LATEST_UNDECIDED` で拒否する（i-13） |
| `DatasetRecord`、`AggregationRecord` | `packages/contracts/.../dataset.ts` | 契約だけ | 書込み（台帳の更新、集計の記録）がない |
| 共通部品 | `Result`、正準JSON、`atomicWriteImmutableFile`、`validateDataBoundary` | 使える | 取り込みの書込みで使う |

## 3. 実データから `issues.json` までの不足

```
公式データ → CSV取込 → 事実項目の生成 → 人による検証 → AIによる課題候補の下書き → 人による採用・承認 → issues.json
```

| 段階 | 現状 | 不足 | 担当 | 承認と確認 |
| --- | --- | --- | --- | --- |
| 公式データ（原本） | `shelters.xlsx` だけ。ほかは未取得 | 取り込む原本を利用者が配置する | 利用者 | 取り込みの許可 |
| xlsxからCSVへの変換 | 方針だけ（人が変換し、1行を1行に対応させる） | 変換の手順書、`conversion` の記録、行数の一致の検査 | 人と本担当 | 手順書のSHA-256 |
| CSVの取り込み | **なし** | `csvToText`（UTF-8、BOM付き、Shift_JISの判定）、配置、SHA-256とrevision、`DUPLICATE_CONTENT`、`REAL_AI` の出典記録の作成（`catalog` つき） | 本担当（13.15、13.10） | 13.14の完了 |
| データセット台帳 | 契約だけ | 台帳の作成と更新。利用条件、個別注記、送信可否の確認記録を**安全に追記する手段**（手でJSONを編集するのか、専用のコマンドか）が決まっていない。記録の不変性の規則との整合を設計で決める必要がある | 本担当と人 | 確認者と日時の記録 |
| 事実項目の生成 | `aggregate`、`deriveFact` はある | 呼び出し側（原本を読み、方法を決め、固定のテンプレートで事実の文を作り、`PROVISIONAL` で保存する）。`AggregationRecord` の保存 | 本担当（13.11） | 方法（列名、`dedupeColumns`）は人が決める |
| 人による検証 | **なし** | `verify-fact`（再計算値、保存値、位置、欠損数、重複除外数を表示し、人が `y` と答えたときだけ `VERIFIED` にする） | 本担当と人 | 【要確認8】 |
| AIによる課題候補の下書き | fakeで実装済み | 実データ用の語の一覧（13.1）、`draft.json`、実Bedrockを呼ぶかの判断 | 人 | 13.1、送信可否の記録 |
| 人による採用と承認 | 実装済み | `requiredApprovers` の運用値の決定 | 人 | 承認者の人数 |
| `issues.json` | 実装済み（FIXTUREで確認） | 実データでの実行、受領記録の最新の判定（i-13） | 本担当 | i-13の決定 |

**既存の基盤でいま実行できる範囲**: FIXTUREでは、架空の資料から `issues.json` までを、fakeで通しで確認済み（`tests/regional-values/issueFlow.test.ts`）。実データでは、原本からCSVを取り込み、事実項目を作る前段がないため、実データを入力に課題候補の下書きを作れない。実Bedrockは呼んでいない。

**データから言えないことへの注意**: 課題候補の `notDeterminable`（データからは判断できないこと）に、次を必ず書く。

- 防災: 避難場所の安全性、収容できる人数、到達できるか。
- 人口: 人口が変わった理由、地域ごとの違いの原因。
- 教育・子育て: 児童数や学校数が変わった理由、子育て費用の負担、保育の需給。

因果の断定と効果の断定は、決定的検査（`DR_CAUSAL_CLAIMS`）が拒否する。語の一覧が未承認の間は、試験専用の語だけで検査される。

## 4. 質問方式v2との接続

### 4.1 v2の現状（`origin/main` の `apps/web/src/features/values-v2/`）

- **画面の独立した試作**である。`index.ts` に「どのルートにも登録していない。`/values` はv1のまま」と書かれている。開発用のプレビューは、`npm run dev` のあと `/values-v2-preview.html` で開く（`#radar-sample` でレーダーの部品だけを確認できる）。
- 型はすべて `Ui` で始まる**仮の型**で、`uiTypes.ts` が「正式な契約（`DilemmaQuestion`、`ValueAxisDef`、`ValuesProfile`、`generateValuesProfile`）はまだ実装されていない」と明記している。これらの名前（正式な契約の名前）は、`origin/main` のv2のファイルでは `uiTypes.ts` のコメントにだけ出てくる（`UiDilemmaQuestion` などの仮の型と、`DilemmaQuestionPage` などの画面の部品名は別）。`HEAD` の側にも、これらの名前はない。
- 質問は `demoDilemmas.ts` の6問（すべて `isDemo: true`）。状況文は「ある町で」とし、数値、実在の自治体名、愛媛県の名称を含まない（テストで検査）。
- レーダー（`ValueAxisRadar`）は表示部品だけで、計算に未接続。結果画面は、レーダーを「準備中」と表示している。
  - **2026-11-16 更新**: 上の記述は調査時点のもの。その後、結果画面はサンプル表示のレーダーになり（`d3491f3`）、さらに `records/values-v2-axis-analysis.md` の計算仕様で、回答から計算した値で描くようにした（v2の開発用プレビューのみ。共同開発者の承認は未記録）。
  - **更新（方針確認の反映。日付は記入しない）**: v2は、v1の `/values` とは別のルート `/values/v2` に登録した（一次審査のデモ。架空の質問で、中立性の点検前。`records/values-v2-axis-analysis.md` の10）。「どのルートにも登録していない」という上の記述は、当てはまらなくなった。開発用のプレビューは、`#radar-sample` の確認のために残している。
- 回答は、画面の状態（メモリー）にだけ持つ。URL、localStorage、サーバー、AIには入れない。

### 4.2 6問、6テーマ、価値観6軸、A/B

| 質問ID（仮） | テーマ | A側の軸 | B側の軸 |
| --- | --- | --- | --- |
| `demo-dilemma-transport` | 地域交通 `TRANSPORT` | 公平性 `FAIRNESS` | 暮らしの安定 `STABILITY` |
| `demo-dilemma-education` | 教育・子育て `EDUCATION_CHILDCARE` | 暮らしの安定 `STABILITY` | 個人の可能性 `OPPORTUNITY` |
| `demo-dilemma-economy` | 地域経済・雇用 `ECONOMY_EMPLOYMENT` | 将来への投資 `FUTURE` | 地域のつながり `COMMUNITY` |
| `demo-dilemma-healthcare` | 医療・福祉 `HEALTHCARE_WELFARE` | 公共基盤の充実 `INFRASTRUCTURE` | 公平性 `FAIRNESS` |
| `demo-dilemma-disaster` | 防災 `DISASTER_PREVENTION` | 地域のつながり `COMMUNITY` | 公共基盤の充実 `INFRASTRUCTURE` |
| `demo-dilemma-population` | 人口減少・地域活性化 `POPULATION_REVITALIZATION` | 個人の可能性 `OPPORTUNITY` | 将来への投資 `FUTURE` |

提示順は、テーマ定義順。各軸は2問に現れ、1回はA側、1回はB側になる（`demoDilemmas.test.ts` が検査する）。6軸の名称は暫定で、定義と計算方法は未確定（`uiTypes.ts`）。

### 4.3 FIXTURE の `issues.json` との対応

| v2の質問（仮） | FIXTUREの課題 | 版 |
| --- | --- | --- |
| `demo-dilemma-disaster` | `fixture-issue-disaster-v1`（避難場所の立地の確認） | 1 |
| `demo-dilemma-education` | `fixture-issue-education-v1`（子育て相談の機会と利用） | 1 |
| `demo-dilemma-population` | `fixture-issue-population-v1`（地域の集まりへの参加の変化） | 1 |
| `demo-dilemma-transport`、`-economy`、`-healthcare` | なし（`coverage` が0件） | — |

6テーマすべてでv2との接続を試すには、FIXTUREの課題が残り3テーマ分要る（本担当が追加できる。資料の入力記録から作る）。

### 4.4 課題と質問のIDの対応

- 課題は `issueId`（維持される）と `version`（再承認で上がる）で表す。質問は、v2の正式な質問の `questionId`。**課題への参照は質問の契約に足さない**（design.mdの「質問方式v2との契約境界」）。
- 対応は、非公開の `issue-links.json`（`IssueLinksFile`、`schemaVersion` 1）に、`{ targetKind: "QUESTION" | "ISSUE_CARD", targetId, issueId, issueVersion }` の組で書く。質問の分は共同開発者、課題カードの分は本担当が書く。`(targetKind, targetId, issueId)` は重複できない。
- 検査 `checkIssueLinks` は、`questions` に `{ questionId }` の配列を受け取る作りなので、v2の質問が `questionId` を持てば、コードを変えずに使える。ただし、v2の質問がビルドの入力に載ることが前提である。
- 対応が壊れたとき: 記録が指す質問、課題カード、課題が存在しなければ契約違反（`CONTRACT_VIOLATION`）。課題が無効、または版が古ければ、`QUESTION_ISSUE_INVALID`（不足）。
- 現在のFIXTUREの `issue-links.json` は `links` が空で、v2の置き換えで壊れない。
- v2の質問は、数値や実在の事実を含めない設計なので、課題の事実（数値、調査年）は、質問ではなく**課題カード**（Req 7）が表示する。質問と課題カードは、画面側で並べて見せる。

### 4.5 正式な契約の案（共同開発者の承認が必要。コードは変更していない）

案A（推奨）: 新しい契約として足す。v1の `Question` は変えない。公開バンドルに載せるときは、`BUNDLE_SCHEMA_VERSION` を2にする移行を、共同開発者が決める。案B: v1の `TRADEOFF` の質問を拡張する。v1の質問と検査への影響が大きい。

```ts
// 案: packages/contracts/src/models/regional/dilemma.ts（新規。Zod strict）
VALUE_AXIS_IDS = ["FAIRNESS","STABILITY","FUTURE","OPPORTUNITY","COMMUNITY","INFRASTRUCTURE"]  // 暫定6軸。正式な軸は共同開発者が決める
ValueAxisDef    = { axisId, label /* 1〜20字 */, definition /* 1〜80字 */, approval }
DilemmaOption   = { text /* 1〜60字 */, valueAxisId }
DilemmaQuestion = {
  questionId,                    // 版を含めない。issue-links のキー
  dataKind: "REAL_AI" | "FIXTURE",
  version: int >= 1,
  themeId,                       // 6テーマ。UNCLASSIFIED は不可
  situation,                     // 数値と実在の事実を含めない（既存の質問の検査を流用）
  optionA, optionB,              // A と B は別の軸
  author: "HUMAN" | "AI_DRAFT", createdOn, approval,
}
DilemmaAnswer   = TradeoffCode | "SKIPPED"      // 未回答はキーを持たない
AxisResult      = { axisId, state: "DETERMINED", level: -2..+2, usableQuestions: 1 | 2 }
                | { axisId, state: "UNDETERMINED" }
ValuesProfile   = { setKind, axes: AxisResult[6], counts: { total, answered, skipped, unanswered } }
generateValuesProfile({ questions, axes, answers }): Result<ValuesProfile, ProfileError>
```

### 4.6 価値観の計算に必要なデータと、未回答・スキップの扱い

**必要なデータ**: 回答（5段階の `TradeoffCode`、または `SKIPPED`）、質問ごとのA側とB側の軸、軸の定義の一覧。**事実項目、出典、課題、対応の記録は入力にしない**（Req 7.22。既存の `dependencyClosure` の検査と同じ原則）。

**未回答とスキップ**

- v2の画面は、`SKIPPED`（スキップ）と、キーがない状態（未回答）を区別し、どちらも中立（`BALANCED`）や0点に変換しない。
- v1の契約（`core.ts`）は、無意見の回答を `UNSURE`（わからない）、`DECLINE`（回答しない）、`UNANSWERED`（未回答）の3つに分けている。v2の `SKIPPED` は、v1の `UNSURE` と `DECLINE` を1つにまとめる形になる。**契約でどう表すか（`SKIPPED` を足すか、既存の2つに対応づけるか）は、共同開発者が決める。**
- v2の結果画面は、v1の「判断に迷った、回答しなかった、判定できない、未出題」の4枚のカードを置かず、回答の状況を1行にまとめる。現在の要件（Req 5。Open Decisions (14)）は、4つの状態を別の欄で区別することを既定としているので、要件の更新が要る見込み。

**計算の案（共同開発者が決める）**

1. 回答を符号つきの値にする: `A_STRONG` を+2、`A_LEAN` を+1、`BALANCED` を0、`B_LEAN` を−1、`B_STRONG` を−2。
2. 質問が軸のA側なら+値、B側なら−値を、その軸への寄与とする。
3. 軸の水準は、回答のある質問（`SKIPPED` と未回答を除く）の寄与の平均を、0から遠い側へ丸めた整数（−2〜+2）。回答のある質問が0件なら `UNDETERMINED`。
4. 1つの軸の根拠は最大2問。1問だけのときは `usableQuestions` を1とし、画面に「（1問から）」と出す（v2の部品はすでにそう表示する）。

決めるべき点: 平均と丸めの規則、1問だけの軸の扱い、`BALANCED` を回答として数えるか（案は数える）、水準の文言の承認、中立性の点検（Req 3）。検査すべき性質（案）: スキップは0にならない、回答の順序に依存しない、AとBを入れ替えると符号が反転する、同じ入力から同じ出力。

**2026-11-16 更新（計算仕様の採用）**: 上の案を `records/values-v2-axis-analysis.md` で具体化し、`apps/web/src/features/values-v2/axisAnalysis.ts` の `computeValueAxes` に実装した。上の案との違いは、丸めを「0から遠い側へ丸める」から、既存の価値観マップと同じ R(n, m) と段階の境目（t1 = 50、t2 = 150）に替えたこと。1問だけの軸は計算して「（1問から）」と示し、`BALANCED` は回答として数える。スキップ、未回答、未出題を区別する。採用はUI担当の指示によるもので、**共同開発者の承認は未記録**（承認者名と承認日は未記入）。上の「決めるべき点」のうち、水準の文言の承認、中立性の点検、スキップの契約上の表し方は残っている。

**更新（方針確認の反映。日付は記入しない）**: 西原さんの方針確認（正式な承認の記録ではない。`records/values-v2-axis-analysis.md` の10）で、計算方法は現在の方式を採り、6軸の名称・説明文・A/Bへの割り当ては中立性の点検の後に正式に確定する、とされた。水準0の文は「どちらとも同じくらいだった」をやめ、差し引きで0になったことと、中立という意味ではないことを示す文にした（同書の6）。スキップは、v2では `SKIPPED` を独立した値として扱う。水準の文言の承認、中立性の点検、スキップの契約上の表し方は、引き続き残っている。

### 4.7 レーダーの接続条件

1. 6軸の定義（名称と説明）が、人の承認を経て正式な契約になる。
2. `generateValuesProfile` が実装され、性質の検査（上記）が通る。
3. `ValuesProfile.axes` を、v2の部品の `UiAxisDisplayValue`（`DETERMINED` は `level` と `usableQuestions`、`UNDETERMINED`）へ写す。
4. 結果画面の「準備中」の表示を、レーダーに切り替える（共同開発者の `apps/web` の作業）。
5. 表示の規則: 部品は、面を塗らず、軸の順序を固定にしている（値の大きい順に並べ替えない）。結果画面は、帯の位置が順位や点数ではないと説明している。この規則を、正式な契約の検査（順位や点数の項目を持たないこと）と合わせる。

**2026-11-16 更新**: 次の点が、上の記述から変わった（詳細は `records/values-v2-axis-analysis.md` の6と7）。

- 「面を塗らず」: `d3491f3` で、値の多角形を半透明の青で塗る形に変わった（コミットの記録では利用者の指示）。図の下で「面積の大きさに意味はなく、順位でもない」と説明する。軸の順序の固定は変わらない。
- 「準備中」の表示: 2の計算を v2 専用の `computeValueAxes`（web）として実装し、結果画面の既定にした。分析の結果が `ANALYZED` のときだけ回答から計算した値で描き、`INVALID` のときは図を描かない。サンプル表示は、差し替えた分析の関数が `PENDING` を返したときと、開発用プレビューの `#radar-sample` だけに使い、分析結果と同じ画面に並べない。
- 1〜3の条件のうち、満たしたのは「計算が実装され、性質の検査が通る」ことと、結果を `UiAxisDisplayValue` へ写すことだけ。6軸の定義の人の承認、正式な契約（`generateValuesProfile`）、共同開発者の承認は済んでいない。`design.md`「図の形式の決定」（レーダーは採らない）との食い違いも残っている。

**更新（方針確認の反映。日付は記入しない）**: 西原さんの方針確認（`records/values-v2-axis-analysis.md` の10の3）で、レーダーはv2に限って採り、v1のレーダー不採用の決定は維持する、とされた。`design.md`「図の形式の決定」に、v2の採用方針と、面積・順位・傾き0の誤解を防ぐ規則を追記した（v1の表は変えていない）。正式な承認の記録（徳永さんとの合意を含む）は未了。

### 4.8 `/values` の切り替え状況

- 現在: `/values` はv1（固定のデモデータ。回答に関係なく同じ結果が出る）。v2はルートに未登録。
- v2への切り替えに要るもの: (a) v2の正式な契約と質問バンク（承認済み）、(b) `/values` の画面をv2に差し替える変更（ルートの契約と、既存のルートのテストで、v1の画面を前提にしている部分の更新。**既存の期待値の削除と緩和は不可**）、(c) 2022年選挙の表示を出さない既存の規則の維持、(d) v1の削除は、対象と理由を示した利用者の承認が先（Req 10.10）。
- 14章の案Bの承認は、`/values` の追加までを範囲にしている。v2への切り替えは、別の承認が要る。
- **2026-11-16 更新**: 計算仕様は実装したが、(a) の承認と、v2への切り替えの承認がないため、`/values` はv1のままとした（`records/values-v2-axis-analysis.md` の8）。
- **更新（方針確認の反映。日付は記入しない）**: 西原さんの方針確認（B案。`records/values-v2-axis-analysis.md` の10の5）で、`/values` はv1のまま、v2を別のルートで公開する、とされた。v2は `/values/v2` に登録し、ホームに入口カードを置いた。(c) の規則（2022年選挙の表示を出さない）は、`/values/v2` にも当てた（`AppShell`）。ルートの契約、`PUBLIC_ROUTE_PATHS`、既存のルートのテストには `/values/v2` の期待値を足しただけで、既存の期待値は削除も緩和もしていない。`/values` のv2への切り替えは、引き続き別の承認が要る。`/values/v2` の追加の正式な承認の記録（徳永さんとの合意を含む）は未了。

### 4.9 影響を受ける既存の要件（精査は未了）

v2は、質問の種類（大切さと優先条件から、ジレンマのA/Bへ）、結果の構成（地域課題マップとレーダー）、無意見の回答の扱いを変える。次の要件に影響する見込みで、影響の範囲は、v2の契約が決まってから精査する。

- 診断セットと質問（Req 2、3。質問の検査は、優先条件質問の数値、大切さ質問の施策名を対象にしている）
- 価値観マップの生成（Req 4。`generateValuesMap`、`MapInput`、`ValuesMap`）
- 結果画面（Req 5。4つの状態の区別）
- 活かし方の案内（Req 6。最優先テーマと、大切さが+2、+1のテーマで選ぶ規則）
- `BUNDLE_SCHEMA_VERSION`（v2が公開バンドルの契約を変える場合）

## 5. 共同開発者へ渡す情報

1. **課題情報**: `packages/fixtures/src/regional-values/issues.json`（3件）と、手引き `issue-handoff-guide.md`。実データの `issues.json` は、取り込みと承認が済んでからで、現時点ではない。
2. **対応の記録**: `issue-links.json` の契約と使い方（4.4）。質問の `questionId` は、版を含めない。
3. **課題が先に出るテーマ（予定）**: 人口減少・地域活性化、防災、教育・子育て（`dataset-inventory.md` の推奨。承認待ち）。ほかの3テーマは、公式データの条件から、実データの課題が当面出ない見込み（地域交通は、公共交通のデータがカタログにない）。
4. **課題の性質**: 課題は「仮説」で、因果や効果は述べない。各課題に、`notDeterminable`（判断できないこと）と `additionalChecks`（追加で確認すること）がある。対応方向（`responseDirections`）は「参考のみ」で、質問の選択肢や解説に自動では使わない（Req 13）。
5. **質問の文面への制約**: 質問、解説、前提文、方向の説明が、有効な課題の根拠の事実の数値や調査年と一致する数値表現を含むと、検査が違反にする（Req 13.8）。v2の質問は数値を含めない設計なので、衝突しない。
6. **共同開発者に決めてほしいこと**: 4.5の契約（案Aか案Bか）、6軸の正式な定義、計算の規則（4.6）、スキップの契約上の表し方、要件への影響（4.9）、`BUNDLE_SCHEMA_VERSION`、`/values` の切り替えの時期。
7. **同じファイルを変更する可能性**: `bundle.ts` の `GATE_REASON_CODES`（`QUESTION_ISSUE_INVALID` の追加が済んでいる）、`content.ts`（事実項目と出典の任意項目）、`regional/index.ts`、`domain/src/regional-values/index.ts`。マージの順序を調整する。

## 6. 人による承認待ち事項

**完了条件**（人の確認を記録して初めて満たされるもの）と、**承認**（人が決めるもの）を分けた。

| # | 事項 | 決める人 | 種類 | 関連 |
| --- | --- | --- | --- | --- |
| 1 | 13.14: 3テーマそれぞれの、利用条件と個別注記の確認（確認者名、確認日） | 利用者 | 完了条件 | `dataset-inventory.md` の9 |
| 2 | クイック版の3テーマの確定（人口減少・地域活性化、防災、教育・子育ての推奨） | 利用者 | 承認 | Open Decisions (1) |
| 3 | データセットごとの外部AIへの送信可否（`ALLOWED` または `DENIED`。根拠、確認者、日時） | 利用者 | 承認 | Req 7.23、10.15 |
| 4 | 13.1: 語の一覧の承認と、3つの語の一覧の置き場所の決定 | 利用者 | 承認 | `word-lists-proposal.md` |
| 5 | 実データの取り込みの許可と、原本の配置 | 利用者 | 承認 | 13.15、13.10 |
| 6 | xlsxからCSVへの変換の手順書と、変換者の確認 | 利用者（人の作業） | 完了条件 | Req 7.24 |
| 7 | 【要確認8】原本のSHA-256が変わったときの降格と、保存データの書換えの規則 | 利用者 | 承認（要件の更新） | 13.11 |
| 8 | 事実項目の `verify-fact`（原本の値との照合） | 利用者（人の作業） | 完了条件 | 13.11 |
| 9 | 受領記録の最新の判定（i-13。案B） | 利用者 | 承認 | design.md |
| 10 | 旧承認の復活への対応（承認の記録に根拠のSHA-256を持たせる契約の追加） | 利用者 | 承認 | tasks.md (e) |
| 11 | `requiredApprovers` の運用値（目標は2人） | 利用者 | 承認 | 13.13 |
| 12 | 【要確認18、23、19、20、22、21、3、2、16、10】 | 利用者、共同開発者 | 承認 | 13.3〜13.13 |
| 13 | v2の正式な契約、6軸の定義、計算の規則、スキップの表し方 | 共同開発者 | 承認 | 4.5〜4.7 |
| 14 | `/values` をv2へ切り替える時期と方法 | 共同開発者と利用者 | 承認 | 4.8 |
| 15 | 13.10の記述（13.9の扱い）の整合 | 利用者 | 承認（仕様の整理） | 1 |
| 16 | 実Bedrockを呼ぶかの判断（課題候補の下書きを実データで作る前） | 利用者 | 承認 | 13.1、送信可否 |
| 17 | 方針確認（`values-v2-axis-analysis.md` の10）の正式な承認の記録と、`/values/v2` の追加の範囲 | 西原さん（10の1、2、4）。西原さんと徳永さん（10の3、5） | 承認 | 4.6〜4.8、`values-v2-axis-analysis.md` の10 |
| 18 | v2の新しい文言（水準0の文、図の下の説明、傾き0の注記、中立性の点検前の表示、ホームの入口カード）の承認と、中立性の点検（質問の文面、6軸の名称と説明文、A/Bの割り当て）の実施と確定 | 未定 | 承認と完了条件 | `values-v2-axis-analysis.md` の9の7と8 |

## 7. 次に実装可能なタスク

承認が不要で、すぐに着手できるものと、承認の後に着手するものを分けた。今回は実装していない。

**承認を待たずに着手できる（コードの追加のみ。実データは使わない）**

1. FIXTUREの課題を、地域交通、地域経済・雇用、医療・福祉の3テーマに足し、6テーマ分の `issues.json` の見本にする（v2の6問との接続の試験用。資料の入力記録から作る）。
2. 13.15の先行実装: `csvToText`（UTF-8、BOM付き、Shift_JISの判定）と `intake` の共通部分を、架空の小さなCSVで作る。新しい依存はない。ただし、13.15の「待つ条件」は13.14の完了と取り込みの許可なので、着手の可否は利用者が決める。
3. `deriveFact` の制約（0.00に丸まる比）に合わせて、事実の文のテンプレートの案を作る（コードの変更なし）。

**承認の後に着手する**

4. 13.14の確認が済んだら: 13.15 → 13.10（CSVの部分）→ 13.11（【要確認8】の後）。
5. 13.1の承認が済んだら: 実データの設定ファイル（`neutrality.json`、`build.json`、`draft.json`）と、`repoConfigFixtures.test.ts`。
6. v2の契約が決まったら: `dilemma.ts` の契約の追加、`generateValuesProfile`、対応の記録の検査へのv2の質問の接続（本担当は契約のレビューと受入れの確認）。

**推奨する次の1つ**: 利用者が `dataset-inventory.md` の9を確認し、3テーマと送信可否の方針を決める。決まれば、13.15（CSVの取り込み）から着手する。
