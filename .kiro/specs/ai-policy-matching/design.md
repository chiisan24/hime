# Design Document

## Overview

### 目的と範囲

本designは、`requirements.md`の15要件を最小の追加で実現する。中心機能を「公報をOCRで読んでAIが要約する」から「利用者が質問に答え、決定的な計算で政策上の近さを出し、根拠付きの説明カードで理由を示す」へ移す。

- 一致度は`packages/domain`の純関数で計算し、ブラウザ内で実行する。サーバーとAIは計算にも回答にも関与しない。
- AI（Bedrock）はオフラインの下書き作成に限る。出力は決定的検査と人間の承認を通ったものだけが静的バンドルに入る。
- 実行時の公開物は承認済みの静的JSON1ファイルと静的なWebアプリである。新しいHTTP routeは作らない（任意のデモ対話を除く）。
- 対象外: 実データの立場記録の作成（承認と利用条件の確認が前提）、公報の画像・PDF・全文の表示、OCR精度の改善、自動取得、ログインとサーバー側の回答保存。

### 新旧仕様の違い

| 観点 | 旧（multi-election-ai-analysis） | 新（ai-policy-matching） |
|---|---|---|
| 中心機能 | 公報PDFを解析して要約を表示 | 質問に答えて政策上の近さを可視化 |
| AIの役割 | 抽出、分類、要約、検証（実行の中心） | オフライン下書きと検査の補助（計算に不使用） |
| 利用者の入力 | なし（閲覧のみ） | 5段階の回答と重視テーマ |
| データの単位 | 公報のパッセージ | 質問×比較対象の立場記録と根拠 |
| 実データへの依存 | 公報の読取りが前提（OCRは不合格） | デモは架空データで完結。実データは承認後 |
| 外部送信 | 公報本文をBedrockへ送る設計 | 回答も公報も外部へ送らない |

## Architecture

### 全体フロー

```text
[オフライン / analystモード（開発者のPC）]
 資料(Source Manifest, 利用条件CONFIRMEDのみ)
   -> PolicyUnit / 引用候補
   -> (任意) Bedrock: 立場候補の抽出 ──> 引用実在検査 ──> PENDING
   -> 人間: 立場記録の承認(コードブックに基づく)
   -> (任意) Bedrock: 説明カード下書き ──> 決定的検査 ──> 人間承認
   -> 質問バンクの中立性検査 + 人間承認
   -> bundle build (--kind demo | public) ──> PublishedMatchingBundle(JSON, 内容ハッシュ付き)

[実行時 / visitorモード（利用者のブラウザ）]
 静的バンドルを読込み(スキーマ・ハッシュ・buildKind検証)
   -> 回答(メモリのみ) + 重視レベル
   -> computeMatch() 純関数 ──> 結果画面 + 説明カード(決定的に組立)
   (サーバー送信なし。AIなし)

[任意・デモ版のみ] 根拠限定の対話解説: 質問IDと自由入力だけを送信 -> 承認済みカードを根拠に回答
```

### 配置

| 層 | 追加するもの | 備考 |
|---|---|---|
| `packages/contracts/src/models/matching.ts` | Question, Theme, MatchingElectionConfig, Evidence, StanceRecord, ExplanationCard, PublishedMatchingBundle, UserAnswerSet | 新規ファイル。`models/index.ts`にexportだけ追加。既存契約は変更しない |
| `packages/domain/src/matching/` | `score.ts`（computeMatch）, `neutrality.ts`（質問検査）, `cardCheck.ts`（説明カード検査）, `bundleGate.ts`（公開ゲート） | 純関数。`Result`を再利用 |
| `packages/fixtures/src/matching/` | 架空の比較対象、質問、立場、カード | `dataKind: FIXTURE`。実在名を含めない |
| `config/matching/` | `themes.json`, `thresholds.json`, `neutrality-terms.json`, `election.demo.json` | 既存`config/themes.json`は変更しない |
| `apps/api/src/matching/` | analyst用CLI（`npm run matching -- ...`） | ローカル専用。Bedrock呼出しはここだけ |
| `apps/web/src/app/matching/` | 画面、ルート契約、状態管理 | 既存visitorルートへの組込みは別タスク（後述） |

実データの原資料と作業中の立場記録は`data/real/matching/`（Git管理外、既存の`data/real/**`規則に従う）。公開バンドルは既存の規則に合わせ`data/real/published/<electionId>/matching-bundle.json`へ出す。デモのソースは架空データなのでGit管理下の`packages/fixtures`に置く。

## Components and Interfaces

### 1. 画面構成と導線（Requirement 1, 5, 7, 10）

| パス | 画面 | 内容 |
|---|---|---|
| `/match` | はじめに | 目的、所要時間（約3分）、「投票先の推奨ではない」注意、開始ボタン、デモ版の表示 |
| `/match/q/:n` | 質問 | 質問文、解説（折りたたみ可）、7つの選択肢（5段階+わからない+回答しない）、戻る、進捗 |
| `/match/themes` | 重視テーマ | テーマごとに4段階。計算への影響の説明。結果画面からも開ける |
| `/match/result` | 結果 | 比較対象のカード（一致度、網羅率、範囲、使った質問数）、テーマ別、情報不足の表示、並び順切替、共通質問モード切替 |
| `/match/result/:subjectId` | 詳細 | テーマ別、近い/遠い質問、説明カード、出典と更新日時 |
| `/match/compare` | 比較 | 質問×比較対象の表（回答、立場、近さ）、重視テーマ変更前後の差 |
| `/about` | このアプリについて | 計算式と計算例、質問の作り方と承認者、データ出典、更新日時、情報不足の説明、AI利用の範囲、免責 |

導線は「はじめに→質問（10〜12問）→重視テーマ（既定すべて`NORMAL`で省略可）→結果→詳細/比較」。結果画面から質問と重視テーマへ戻って再計算できる。回答は`useReducer`相当のメモリ状態だけで持つ。

スマホ中心の設計: 1画面1質問、親指で押せる大きさの選択肢（高さ44px以上）、結果は縦積みカード、表は横スクロールではなくカード展開に変換する。色は補助で、数値と文言を必ず併記する。

### 2. 一致度計算（Requirement 3, 4）

```ts
type Opinion = -2 | -1 | 0 | 1 | 2;
type Answer = Opinion | "UNSURE" | "DECLINE";
type Stance = Opinion | "UNKNOWN" | "CONFLICT";
type Importance = 0 | 1 | 2 | 3;

computeMatch(input: {
  questions: { id: string; theme: string }[];
  answers: Record<string, Answer>;
  importance: Record<string, Importance>;      // テーマ→重視レベル
  stances: Record<string, Stance>;             // 1比較対象分: 質問ID→立場
  thresholds: { minQuestions: number; minCoveragePercent: number };
}): MatchResult
```

定義（`i`は質問）:

- `w_i = importance[theme(i)]`
- 回答済み集合`A`: 意見回答があり`w_i ≥ 1`の質問。`Aw = Σ w_i`（`i∈A`）
- 使える質問`K`: `i∈A`かつ立場が−2〜+2。`Kw = Σ w_i`（`i∈K`）
- 未知集合`U = A \ K`、`Uw = Aw − Kw`
- `d_i = |s_i − c_i|`、`N = Σ w_i (4 − d_i)`（`i∈K`）、`D = 4 Kw`
- 一致度`S = floor((200N + D) / (2D))`（`K`が空なら`NO_SCORE`）
- 網羅率`C = floor((200 Kw + Aw) / (2 Aw))`（`A`が空なら`NO_SCORE`）
- 下限`L = floor(100 N / (4 Aw))`、上限`H = ceil(100 (N + 4 Uw) / (4 Aw))`（`ceil(a/b)`は整数の`floor((a + b − 1)/b)`）
- 状態: `|K| < minQuestions`または`C < minCoveragePercent`なら`INSUFFICIENT`。それ以外は`OK`

`L ≤ S ≤ H`の証明: `Kw ≤ Aw`なので`N/(4Aw) ≤ N/(4Kw)`、かつ`(N + 4Uw)/(4Aw) ≥ N/(4Kw)`（右辺を`1 − (Kw − N/4)/Kw`、左辺を`1 − (Kw − N/4)/Aw`と書き直して比較）。丸めは単調で、`floor ≤ round ≤ ceil`なので順序が保たれる。

共通質問モード: 全比較対象の`K`の共通部分`Kc`を求め、各比較対象で`K := Kc`として同じ式で計算する（`C`は元の`A`を分母に使う）。`Kc`が空なら`NO_COMMON`。

計算例（手計算の金テストベクタ G1/G2）:

| 質問 | テーマ | 回答`s` | 立場`c` | `d` | 備考 |
|---|---|---|---|---|---|
| Q1 | 教育（`NORMAL`=1） | +2 | +2 | 0 | |
| Q2 | 教育（1） | +1 | 0 | 1 | |
| Q3 | 防災（`TOP`=3） | −2 | +1 | 3 | |
| Q4 | 経済（`IMPORTANT`=2） | 0 | `UNKNOWN` | - | 未知 |
| Q5 | 経済（2） | −1 | −1 | 0 | |

G1: `Aw=9`, `Kw=7`, `N=4+3+3+8=18`, `D=28`。`S=floor((3600+28)/56)=64`（厳密値64.29）、`C=floor((1400+9)/18)=78`（厳密値77.78）、`L=floor(1800/36)=50`、`H=ceil(2600/36)=73`。
G2（防災を`NORMAL`=1に変更）: `Aw=7`, `Kw=5`, `N=4+3+1+8=16`, `D=20`、`S=80`。重視テーマの変更で64→80へ変わる。画面には「防災を重視するほど、防災で意見が違うこの比較対象の一致度は下がります」を差分とともに表示する。

比較の公平性: 全比較対象に同じ質問集合・同じ重み・同じ式を適用する。比較対象ごとに`K`が違い得る点は、(a)使った質問数と網羅率の併記、(b)`INSUFFICIENT`の除外、(c)範囲表示、(d)共通質問モードの4つで扱う。並びの既定は届出順で、「近い順」は`OK`の比較対象だけを対象にし、`INSUFFICIENT`は末尾に別枠で置く。

### 3. 質問バンクと中立性検査（Requirement 2）

`neutrality.ts`が公開前に実行する決定的検査（結果は`PASS`/`FAIL`と理由の区分）:

| 検査 | 内容 |
|---|---|
| NAME_FREE | 質問文に比較対象名・政党名・`neutrality-terms.json`の固定語（「現職」「新人」など）を含まない |
| SINGLE_ISSUE | 「かつ」「および」「と同時に」などの二重質問の兆候語を含まない |
| LOADED_TERMS | 誘導語一覧（「当然」「無駄」「ばらまき」など。一覧は設定ファイル）を含まない |
| BALANCE | 方向`CHANGE`と`CONTINUE`の数の差が1以下 |
| THEME_EVEN | 簡易診断で各テーマの質問数が同数 |
| LABELS | 選択肢ラベルが全質問で共通の対称な5段階 |
| LENGTH | 解説が50〜200文字、質問文が60文字程度以内 |

AI第二意見（任意）は検査の置換ではなく追加の指摘であり、採否は人間が決める。順序ランダム化は`seed`を明示した決定的な並べ替えで、計算結果は提示順に依存しない。

愛媛特化の質問候補（立場は設定しない）: 原子力発電の扱い、南海トラフ地震への備え、柑橘など農業の支援、人口減少と移住支援、松山市一極集中の是正、島しょ部と公共交通の維持。これらは中立な主張文に起案し直した後、人間が承認する。

### 4. 立場データと根拠（Requirement 9）

```ts
Evidence = {
  evidenceId; sourceId; revision; sourceChecksum;       // 既存Source Manifestを参照
  publisher; electionId; retrievedAt; sourceUrl?;
  quote: string;  // quoteMaxChars以下
  locator: Locator; // 既存のpdf-page / html-paragraph / text-lines
  usageStatus: "CONFIRMED" | "UNKNOWN" | "RESTRICTED";
}
StanceRecord = {
  stanceId; subjectId; questionId;
  stance: Opinion | "UNKNOWN" | "CONFLICT";
  evidenceIds: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  proposedBy: "HUMAN" | "AI"; reviewerId?; reviewedAt?;
  resolution?: { chosenEvidenceId; reason };            // CONFLICTを人間が解決した場合のみ
}
```

契約の制約（refine）: `stance`が−2〜+2なら`evidenceIds`は1件以上かつ全`usageStatus`が`CONFIRMED`、`status=APPROVED`なら`reviewerId`と`reviewedAt`が必須、`CONFLICT`は`resolution`なしで−2〜+2へ変更できない。

コードブック（`Question.stanceGuide`）: 質問ごとに、+2〜−2が何を意味するかの基準を1行ずつ決め、承認者が同じ基準で付ける。公式資料が質問の論点に明示的に触れていなければ`UNKNOWN`にする。

AI抽出の経路: Bedrockに厳格なJSON（`stance`、`quote`、`locator`、または`UNKNOWN`）を要求し、(1) JSON契約、(2) `quote`が対応するPolicyUnitの本文に実在、(3) locatorの一致、を決定的に検査して`PENDING`で保存する。検査失敗は保存しない。承認は人間が行い、承認時点の`sourceChecksum`と`revision`を記録する。資料が更新されたら（SHA-256変更）、該当`StanceRecord`を`PENDING`へ戻す。

### 5. AI（Bedrock）の役割（Requirement 8）

| 用途 | 実行場所 | 入力 | 出力 | 検査 | 採用条件 |
|---|---|---|---|---|---|
| 質問の中立性の第二意見 | オフライン | 質問文のみ | 指摘の一覧（JSON） | 契約検査 | 参考。人間が判断 |
| 立場候補の抽出 | オフライン | 利用条件`CONFIRMED`の資料テキスト+質問 | 立場、引用、locator | 引用実在、locator一致 | `PENDING`→人間承認 |
| 説明カードの下書き | オフライン | 質問、承認済み立場、根拠の引用 | 文と根拠IDの組 | `cardCheck`（下記） | 人間承認 |
| 根拠限定の対話解説（ストレッチ） | デモのサーバー | 質問IDと自由入力のみ | 承認済みカードに基づく回答 | 出力検査と推奨の拒否 | デモ版のみ。予算上限つき |

既存の`createBedrockConverseClient`（テキスト専用、許可モデルは`jp.anthropic.claude-haiku-5-5`と`jp.anthropic.claude-opus-5-5`）を再利用し、`stageRunner`の冪等性キャッシュとPacer（10回/60秒、同時1件）を流用する。画像入力は本featureでは使わない。公報の画像をAIに読ませる方式は、利用条件の確認後に別featureで扱う。

`cardCheck`の決定的検査: (1) 各文の`evidenceId`が当該`StanceRecord`の根拠に実在、(2) 説明文中の数値・固有名詞・日付が引用原文に存在（含まれないものは未出典として拒否）、(3) `neutrality-terms.json`の推奨語（「おすすめ」「投票すべき」「ふさわしい」など）を含まない、(4) 文数と文字数の上限。通常のカードは、AIを使わず、立場の差`d`と型ごとのテンプレート文に引用を差し込んで組み立てる（AI下書きは、テンプレートで表せない補足説明にだけ使う）。

### 6. 公開バンドルと実行時の読込み（Requirement 11, 12, 14）

```ts
PublishedMatchingBundle = {
  schemaVersion: 1; dataVersion: string; generatedAt: ISOInstant;
  buildKind: "DEMO" | "PUBLIC"; dataKind: "FIXTURE" | "REAL_AI";
  election: { electionId; name; comparisonMode: "CANDIDATE" | "PARTY" };
  subjects: { subjectId; displayName; order: number }[];       // 届出順
  themes: { id; label; description }[];
  questions: Question[];                                         // 承認済みのみ
  stances: StanceRecord[];                                       // APPROVEDのみ(UNKNOWN含む)
  evidences: Evidence[]; cards: ExplanationCard[];
  thresholds: { minQuestions; minCoveragePercent; quoteMaxChars };
  contentHash: string;                                           // sha256Hex(canonicalJson(本体))
}
```

読込み時に、スキーマ（strict）、`contentHash`、`buildKind`と`dataKind`の整合（`DEMO`⇔`FIXTURE`、`PUBLIC`⇔`REAL_AI`）を検査し、不一致なら画面を出さない。`PUBLIC`ビルドの公開ゲートは、`APPROVED`で全根拠が`CONFIRMED`の立場だけを含め、`quote`の長さが`quoteMaxChars`以下であることを確認する。既存の`validateDataBoundary`を、バンドル単位の混在拒否に使う。

ビルド種別は、既存の`vite --mode analyst`と同様にViteの`--mode demo`と`--mode public`で切り替え、`check:build-boundary`を拡張して、`public`の成果物にデモデータ、analystの画面、承認ツール、`bedrock`の文字列、公報原本が含まれないことを検査する（具体的な実装は、着手時に既存の`vite.config.ts`と`scripts/check-build-boundary.mjs`を読んで決める）。

### 7. API構成

| 対象 | 方式 |
|---|---|
| 一致度計算、回答、重視テーマ | ブラウザ内。APIなし |
| バンドルの配布 | 静的ファイル（Vercel等）。承認済みの静的データだけを配置 |
| analystのCLI | `npm run matching -- questions validate` / `stances propose` / `stances review` / `cards draft` / `cards verify` / `bundle build --kind demo|public` / `bundle verify`。ポートを開かない |
| デモの対話解説（任意） | `POST /api/demo/explain`、デモ用サーバーのみ。入力は`{ questionId, text }`だけ。既存の`session` routeとは別。公開版には含めない |

### 8. 既存コードとの接続（Requirement 13）

| 分類 | 対象 | 扱い |
|---|---|---|
| 再利用 | `packages/contracts`のprimitives（ID、`ISODate`、`ISOInstant`、`DataKind`）、`sources.ts`（Source Manifest、Locator、PolicyUnit、Usage） | 参照し、置き換えない |
| 再利用 | `packages/domain`の`Result`、`canonicalJson`、`sha256Hex`、`validateDataBoundary`、レジストリの二段階承認の考え方（`proposeChange`/`decideChange`） | 立場の承認と公開ゲートに流用 |
| 再利用 | `apps/api`の`bedrockConverse.ts`、`safeLogger`、`atomicWriteImmutableFile`、`writeContentAddressedFile`、`stageStore`/`stageRunner`/Pacer、`ingest`（SourceSupplier、SHA-256/revision） | オフライン下書きと証拠の記録 |
| 再利用 | `apps/web`のvisitor/analyst分離、`check:build-boundary`、shell safety/source boundaryの属性テスト | 拡張（デモ/公開の分離） |
| 保留 | `apps/api/src/ocr/*`、`ocr`のCLI、`data/real/models/ocr/`、`extract`の文字層検査 | 削除しない。実データで画像から読む必要が出たときの選択肢 |
| 保留 | `multi-election-ai-analysis`のCLASSIFY/SUMMARISE/判定/承認ゲート/publish（未実装） | 着手せず、本featureの承認後に置換か継続かを決める |
| 保留 | `config/themes.json`（教育、経済、防災の3件）、`StructuredPolicy`/`BeginnerSummary` | 変更しない。新テーマは`config/matching/themes.json` |
| 不要の可能性（未確認、削除しない） | 要約ベースの`/comparison`と`/candidates/:candidateId`の表示、`analyst/p0`、`analyst/evaluation`のうち公報OCR中心の部分 | 利用状況を確認してからユーザーが判断する |

既存の`/candidates`や`/comparison`のルート表には、visitorとanalystのルート契約を厳密に検査する既存テストがある。`/match`系ルートの組込みは、ルート表テストへの**追加**だけを行い（削除と緩和をしない）、共同開発者の承認を得た別タスク（タスク9.1）として扱う。それまでは`apps/web/src/app/matching/`の単体のルート契約とテストで検証する。

### 9. 承認フロー

1. 質問: 起案（人間またはAI提案）→ `neutrality`検査 → 人間承認（承認者ID、日時）
2. 立場: 資料の登録（利用条件`CONFIRMED`）→ 立場記録の起案（人間またはAI）→ 引用実在検査 → 人間承認
3. 説明カード: 決定的組立または下書き → `cardCheck` → 人間承認
4. バンドル: `bundle build`が`APPROVED`だけを集めて生成 → `bundle verify` → 公開（実データは法務確認の完了後）

承認者数は設定値（既定1、目標2）とし、`multi-election-ai-analysis`の「必要承認者数」と同じ規則（`/^[1-9][0-9]*$/u`）で検証する。

## Data Models

TypeScriptは要点のみ。すべて`z.object(...).strict()`で`packages/contracts/src/models/matching.ts`に置く。

```ts
Question = {
  questionId; theme; text; explanation;            // 50〜200文字
  direction: "CHANGE" | "CONTINUE" | "NEUTRAL";
  scope: "EHIME" | "GENERAL";                       // 愛媛の地域課題か
  stanceGuide: Record<"+2"|"+1"|"0"|"-1"|"-2", string>;
  reviewedBy; reviewedAt; version;
}
ExplanationCard = {
  cardId; subjectId; questionId; kind: "MATCH" | "MISMATCH" | "UNKNOWN";
  sentences: { text: string; evidenceIds: string[] }[];
  draftedBy: "TEMPLATE" | "AI"; approvedBy; approvedAt;
}
UserAnswerSet = { answers: Record<questionId, Answer>; importance: Record<themeId, Importance> }  // ブラウザ内のみ。保存しない
```

`MatchResult`は`{ status: "OK" | "INSUFFICIENT" | "NO_SCORE" | "NO_COMMON", score?, coverage?, lower?, upper?, usedQuestionIds, excluded: { questionId; reason }[], byTheme }`とする。

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 範囲と丸め
For any 有効な入力で`K`が空でないとき、`S`は0以上100以下の整数で、`floor((200N + D)/(2D))`と一致する。`K`が空なら`NO_SCORE`を返し、数値を返さない。
**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

### Property 2: 順序と倍率の不変
For any 入力について、質問の並びを任意に並べ替えても、全テーマの重視レベルを同じ正の整数倍にしても、`S`は変わらない。
**Validates: Requirements 3.8**

### Property 3: 完全一致と完全反対
For any 入力について、使える質問のすべてで`d=0`なら`S=100`、すべてで`d=4`なら`S=0`である。
**Validates: Requirements 3.9**

### Property 4: 除外の不変
For any 入力について、`UNSURE`、`DECLINE`、立場`UNKNOWN`、立場`CONFLICT`、`EXCLUDE`のテーマに属する質問の回答値や根拠の内容を変えても`S`は変わらない（`UNSURE`と`DECLINE`の入れ替えでは全出力が同じ）。除外された質問は除外理由とともに返る。
**Validates: Requirements 3.6, 3.7**

### Property 5: 範囲の包含
For any `OK`または`INSUFFICIENT`の結果について、`L ≤ S ≤ H`で、`0 ≤ L`、`H ≤ 100`である。`U`が空なら`L=S=H`である。
**Validates: Requirements 4.3**

### Property 6: 情報不足と見かけ上の高一致の防止
For any 入力について、`|K| < minQuestions`または`C < minCoveragePercent`なら状態は`INSUFFICIENT`で、「近い順」の並びに現れない。`minQuestions ≥ 2`のとき、使える質問が1問で`d=0`の比較対象が`OK`で100になることはない。
**Validates: Requirements 4.1, 4.2, 4.6**

### Property 7: 共通質問モード
For any 比較対象の集合について、共通質問モードの各`S`は`Kc`だけで計算され、比較対象の並び順を変えても各比較対象の結果は変わらない。`Kc`が空なら全員が`NO_COMMON`である。
**Validates: Requirements 4.5**

### Property 8: 決定性
For any 入力について、同じ入力で`computeMatch`を2回呼ぶと、正規化JSONが完全に一致する。計算中に`fetch`、`Date`、`Math.random`、ストレージを呼ばない。
**Validates: Requirements 3.1, 11.1**

### Property 9: 質問バンクの検査
For any 質問バンクについて、比較対象名の含有、二重質問の兆候語、誘導語、方向の偏り（差が2以上）、テーマごとの質問数の不一致、非対称な選択肢ラベルのいずれかがあれば、公開は拒否され、違反の種類が全て返る。
**Validates: Requirements 2.2, 2.3, 2.4, 2.5**

### Property 10: 立場記録の契約
For any 立場記録について、立場が−2〜+2で根拠が0件、または根拠の`usageStatus`が`CONFIRMED`でない、または`APPROVED`で承認者がない場合は契約違反である。`CONFLICT`は`resolution`なしで−2〜+2に変えられない。
**Validates: Requirements 9.1, 9.2, 9.4, 9.5**

### Property 11: 説明カードの検査
For any 説明カードについて、実在しない根拠ID、引用に含まれない数値・固有名詞・日付、推奨語のいずれかを含めば公開は拒否される。承認記録がないカードも拒否される。
**Validates: Requirements 8.2, 8.7, 10.5**

### Property 12: 公開ゲートとデータ境界
For any 候補データについて、`PUBLIC`バンドルに含まれる立場記録は`APPROVED`かつ全根拠が`CONFIRMED`のものだけで、`FIXTURE`のデータを含まず、`quote`は`quoteMaxChars`以下で、余剰項目は拒否される。`buildKind`と`dataKind`が不整合ならバンドルは読み込まれない。
**Validates: Requirements 12.2, 12.3, 10.6, 14.5**

### Property 13: 重視レベル変更の整合
For any 入力について、重視レベルを変更して再計算した結果は、変更後の入力で新規に計算した結果と一致し、差分は`新 − 旧`である。全テーマを`EXCLUDE`にする変更は拒否される。
**Validates: Requirements 5.2, 5.4**

## Error Handling

エラーは`Result`で返し、メッセージは固定文と原因区分だけにする。

| 区分 | 場面 | 利用者への表示 |
|---|---|---|
| `BUNDLE_INVALID` | スキーマ、ハッシュ、`buildKind`の不一致 | 「データを読み込めませんでした」。結果を出さない |
| `NO_SCORE` | 意見回答がない、使える質問がない | 「意見回答がないため計算できません」 |
| `INSUFFICIENT` | 情報不足 | 数値の代わりに理由を表示 |
| `NO_COMMON` | 共通質問がない | 「共通して比べられる質問がありません」 |
| `PUBLIC_NOT_READY` | 公開バンドルなし、または利用条件が`CONFIRMED`でない | 「準備中」 |
| `AI_REFUSED` | 対話解説で根拠がない、推奨要求、出力検査の失敗 | 中立の定型文 |

CLIは成功で終了コード0、拒否または失敗で1を返す。認証キー、プロンプト、応答本文、回答、自由入力はログに出さない。

## Testing Strategy

純関数が中心なのでPBTを適用する（fast-check 4.10.2、`numRuns: 100`以上、各テストに`Feature: ai-policy-matching, Property N`のコメント）。通常のテストはfakeだけを使い、ネットワークとBedrockを呼ばず、watchなしで終了する。

- 金テストベクタ10件以上（G1とG2を含む。全`OK`、`INSUFFICIENT`、`NO_SCORE`、`NO_COMMON`、重視レベルの変更、`UNKNOWN`と`CONFLICT`、丸め境界（x.5）を網羅）。
- 属性テスト: Property 1〜13。
- 例示テスト: 質問バンク検査、カード検査、バンドル読込み、画面（質問→結果の導線、戻る、情報不足の表示、免責の常時表示、色だけに依存しない）。
- 境界テスト: ブラウザの計算中に`fetch`/XHR/`localStorage`の呼出しが0回、`public`ビルド成果物に禁止文字列がない、デモ版に「デモ用の架空データです」が出る。
- 既存テスト: 実装前後に`npm.cmd test`を実行し、失敗が増えないことを確認する。

## Implementation Order

1. 契約と設定（`matching.ts`、`thresholds.json`、`neutrality-terms.json`）
2. `computeMatch`と金テストベクタ、属性テスト（最優先。他に依存しない）
3. 質問バンク検査、`cardCheck`
4. 架空のデモデータ（質問12問、比較対象3、立場、カード）とバンドル生成・読込み
5. 画面（質問、重視テーマ、結果、詳細、比較、このアプリについて）
6. デモ/公開のビルド分離と境界検査
7. ルート組込み（共同開発者の承認後）と最終確認
8. （任意）オフラインAI下書きのCLI、根拠限定の対話解説
9. （実データ）資料の利用条件確認と法務確認の完了後に立場記録の登録

## Risks and Open Decisions

| リスク | 内容 | 対応 |
|---|---|---|
| 実データの不足 | 公報は画像中心でOCRは不合格。立場記録は約36件（3名×12問）に根拠が必要 | デモは架空データ。実データは人間が公式資料を読んで起案し、AIは提案のみ |
| 法的制約 | 公報の転載・外部送信は利用条件の確認まで不可 | `usageStatus`が`CONFIRMED`でない資料は、AI送信、バンドル、表示のすべてから除く |
| 中立性への批判 | 質問の選択や立場の付与に主観が入る | コードブック、検査、承認者の記録、「このアプリについて」の公開 |
| 見かけ上の高一致 | 情報の少ない比較対象が高く見える | 情報不足、範囲、共通質問モード、既定は順位なし |
| web変更の調整 | `apps/web`は共同開発者の担当で、ルート表テストが厳密 | 追加のみ、承認後の別タスク |
| 予算 | AI対話は費用と安全の負担が大きい | ストレッチ項目。オフライン用途に限定 |
| 日程 | コンテストの期限が未確定 | MVP（タスク1〜7）を最小単位にする |

`requirements.md`の未決事項に加え、次を決める必要がある。(1) デモの架空比較対象の数（3を既定）、(2) 解説文の作成者と確認者、(3) 実データの質問数と詳細診断の範囲、(4) 説明カードの文面の型（`MATCH`/`MISMATCH`/`UNKNOWN`）の数、(5) デモの公開先（Vercelの静的配信）。