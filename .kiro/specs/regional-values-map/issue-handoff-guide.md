# 課題情報の受け渡し手引き（共同開発者向け）

人が確認して承認した地域課題を、公開バンドルとは別のファイル `issues.json` で受け渡すための手引きです。共同開発者は、これを材料に質問（質問文、A/B選択肢、解説、価値観との対応）を設計します。画面の連携は `ui-integration-guide.md` が説明します。本書はその続きではなく、別の契約（版1）です。

この手引きは、実装の契約と符号に追随します。`tests/regional-values/issueGuideSync.test.ts` が、本書の契約名、項目、符号、コマンドが実装と一致することを検査します。

## 1. 位置づけと前提

| 項目 | 内容 |
| --- | --- |
| 課題 | AIが提案した課題候補を、人が確認して承認したもの。**確認済みの提案であり、事実ではありません**。公式機関の見解でもありません |
| `issues.json` | 設計時の受け渡し用のファイル。ブラウザへ配布せず、公開版の成果物に含めません。ビルドの入力でも出力でもありません |
| 対応方向の候補 | 質問設計の参考です。常に `REFERENCE_ONLY` で、質問の選択肢、質問文、解説として自動では使いません |
| 対応の記録（`issue-links.json`） | 質問と課題カードが根拠とした課題を、課題IDと版で残す非公開のファイルです。`Question` と `IssueCard` には項目を足しません |

責務は次のとおりです。

| 領域 | 本担当 | 共同開発者 |
| --- | --- | --- |
| 公式データの選定、取得、検証、集計 | 担当 | 確認のみ |
| 課題候補の発見（AI）、検査、承認 | 担当 | 承認者の候補、レビュー |
| `issues.json` の契約と出力 | 担当 | 契約のレビュー、受入れの確認 |
| 対応の記録の契約と検査 | 担当（課題カードの分を書く） | 質問の分を書く |
| 質問文、A/B選択肢、スライダー、価値観6軸 | 検査の設定とレビュー | 担当 |
| 地域課題マップ、価値観レーダー、画面 | 表示モデルの契約 | 担当 |

## 2. 契約の読み方

契約は `packages/contracts/src/models/regional/issues.ts` にあります。ブラウザ向けの入口 `@ehime-vote-navigator/contracts/regional` から、**型として**（`import type` だけで）使います。契約の版は `ISSUES_SCHEMA_VERSION`（現在は `1`）で、質問方式の契約の版とは別です。項目の削除と型の変更は版を上げ、項目の追加は同じ版に入れて通知します。

| 契約 | 型 | Zodスキーマ |
| --- | --- | --- |
| `issues.json` 全体 | `IssuesFile` | `IssuesFileSchema` |
| 承認済みの課題 | `ApprovedIssue` | `ApprovedIssueSchema` |
| 無効になった課題 | `WithdrawnIssue` | `WithdrawnIssueSchema` |
| 対応の記録 | `IssueLinksFile` | `IssueLinksFileSchema` |
| 受領記録 | `IssuesReceipt` | `IssuesReceiptSchema` |
| 出力の状態記録 | `IssuesExportReport` | `IssuesExportReportSchema` |

`issues.json` の検証関数 `verifyIssuesText` は、ブラウザ向けの入口に**含めません**（Nodeだけ）。受け取ったファイルの検証は、コマンド `issues verify --file` を使います。

`IssuesFile` は、`meta`、`issues`、`withdrawn`、`coverage` を持ちます。`meta` の `kind` は常に `ISSUES`、`dataKind` はデータ種別、`generatedAt` は出力した時刻、`inputDigest` は入力のSHA-256（時刻を含まない）、`contentHash` はファイルの内容のSHA-256、`schemaVersion` は契約の版です。`coverage` は、6テーマを定義の順に、テーマごとの `themeId` と有効な課題の数 `issueCount` を持ちます。`withdrawn` の各件は、`issueId`、最大の `version`、理由 `reason` だけを持ちます（日時は持ちません）。事実の要約と背景の各文は、本文 `text` と根拠の事実項目 `groundFactIds` を持ちます。

### 承認済みの課題（`ApprovedIssue`）の項目と使い方

| 項目 | 使い方 |
| --- | --- |
| `issueId`、`version` | 課題を指すキー。再承認でも `issueId` は維持し、内容を直すたびに `version` が1つ上がります |
| `themeId` | 6テーマのいずれか |
| `title`、`statement` | 課題の名前と、仮説の1文。状況の理解の材料で、質問文にそのまま使いません |
| `factSummary`、`background` | 根拠の事実項目（`groundFactIds`）つきの文。事実の要約と背景 |
| `notDeterminable`、`additionalChecks` | データからは判断できないことと、追加確認が必要な情報。解説で前提にしないことを書く材料 |
| `decisionScenes` | 質問の状況と制約を考える起点 |
| `responseDirections` | 対応方向の候補（`label`、`description`、`category`、`status`）。**参考で、選択肢として自動で使わず、AとBを対称に作り直します** |
| `provenance` | 起案の記録（AIの関与 `aiInvolvement`、`draftId`、`modelId`、`promptVersion`、`generatedAt`、`humanEdited`） |
| `approval` | 承認の記録（`approverId` は有効な承認のうち最も早いもの、`approvedAt`、`approverCount`）。非公開のファイルなので承認者IDを含みます |
| `issueHash` | 課題の記録のSHA-256。内容を識別する値として、対応の記録の備考に写してよい |
| `basisFacts`、`sources` | 根拠の事実項目と出典。既存の `FactItem` と `RegionalSource` の契約のまま |
| `dataKind` | `FIXTURE`（架空）か `REAL_AI`（実データ）。1つのファイルで混ぜません |

**`basisFacts` の数値と調査年を、質問文、解説、前提文、方向の説明に書かないでください**（Req 3.13、3.17、13.8）。ビルドの検査 `NO_FACT_NUMBERS` が、有効な課題の根拠の事実項目の値と調査年を、質問に書かれた数値として拒否します。

## 3. 最初に使うもの

架空データの見本が `packages/fixtures/src/regional-values/issues.json` にあります。手書きではなく、入力記録（同じディレクトリの `facts.json`、`drafts/`、`events/`、`issues/`、`approvals/`）に、次のコマンドを実行した出力と1バイトも違いません。3テーマ（人口減少・地域活性化、防災、教育・子育て）の課題が1件ずつあります。語の一覧は試験専用で、人の承認を経たものではありません。

```text
npm run regional-values -- issues export --data-mode FIXTURE --generated-at 2026-01-04T09:00:00Z --config-dir tests/harness/regional-values/test-config --draft-settings tests/harness/regional-values/test-config/draft-settings.json
```

見本の検証は、次のコマンドです（受領記録は要りません。Gitで渡します）。

```text
npm run regional-values -- issues verify --file packages/fixtures/src/regional-values/issues.json
```

## 4. 出力の手順（本担当）

| コマンド | 内容 |
| --- | --- |
| `issues export --data-mode FIXTURE\|REAL --draft-settings <ファイル> [--generated-at <ISO>] [--config-dir <ディレクトリ>]` | 課題を判定して `dist/regional-values/issues/<fixture又はreal>/issues.json` と状態記録 `issues-export-report.json` を出力する。ビルドとは独立で、`REAL_PREFERRED` と `--kind` は受け付けない |
| `issues list --data-mode FIXTURE\|REAL --draft-settings <ファイル>` | 現在の入力から導いた課題と無効になった課題を、IDと符号だけで表示する。先頭に出力の状態（`OK`、`STALE`、`INVALIDATED`、`NONE`）を出す。`issues.json` の中身は読まない |
| `issues verify --output --data-mode FIXTURE\|REAL [--current --draft-settings <ファイル>]` | 出力が使えるかを検査する（次節） |
| `issues verify --file <ファイル>` | 受け取ったファイルを検査する（次節） |
| `issues receipt --data-mode REAL --draft-settings <ファイル> --delivered-by <ID> --received-by <ID> --received-at <ISO> --received-sha256 <SHA-256>` | 実データの受領記録を書く（第7節） |

`issues export` と `issues list` の標準出力は検査の結果ではありません。使ってよいかの判断には、`issues verify` を使います。標準出力は固定の符号とIDと件数だけで、課題の文を含みません。

### 出力に失敗したとき（古い出力を使わない仕組み）

`issues.json` は、存在するだけでは有効としません。出力先の状態記録 `issues-export-report.json` が、そのファイルのSHA-256について `SUCCESS` と言うときだけ、正常な出力です。実行は、状態記録を `RUNNING` にし、古い `issues.json` を削除し、計算して検証し、書き、最後にだけ `SUCCESS` を書きます。失敗、削除の失敗、途中で止まった実行、`SUCCESS` の書込みの失敗のどれでも、状態記録は `SUCCESS` にならず、古い `issues.json` は `INVALIDATED` になります。

| 失敗の符号（`issues export`） | 意味 |
| --- | --- |
| `EXPORT_STATE_NOT_RECORDED` | 最初の状態記録を書けなかった。何も変えず、古い出力も無効にできていない（`issues verify --output --current` が入力の違いを `STALE` で知らせる） |
| `EXPORT_STATE_NOT_FINALIZED` | `issues.json` は書いたが、最後の状態記録を書けなかった。状態記録は `RUNNING` のままで、書いたファイルも有効として扱わない |
| `EXPORT_FAILED reason=DELETE_FAILED` | 古い `issues.json` を削除できなかった。ファイルは残るが `INVALIDATED` |
| `EXPORT_FAILED reason=INPUT_UNREADABLE` | 記録、事実、出典、設定のどれかを読めなかった |
| `EXPORT_FAILED reason=DATA_KIND_MIXED` | 架空データと実データが混ざっていた |
| `EXPORT_FAILED reason=CONTRACT_INVALID` | 組み立てた内容が契約に合わなかった |
| `EXPORT_FAILED reason=WRITE_FAILED` | `issues.json` を書けなかった |

## 5. 使う前の検査

`issues verify` の結果は、次のとおりです。最初に満たさなかった項目の結果になります（状態記録、ファイルのSHA-256、契約と契約の版と `contentHash`、`meta` と状態記録の一致、現在の入力の順）。

| 場面 | コマンド | 結果 |
| --- | --- | --- |
| 出力の直後と、渡す前（本担当） | `issues verify --output --data-mode <m> --current --draft-settings <ファイル>` | `OK`、`STALE`（出力の後に承認、取消し、検証、課題の記録、語の一覧が変わった）、`INVALIDATED`、`CONTRACT_INVALID`。`OK` 以外は終了コード1 |
| 受け取ったとき、使う前（共同開発者） | `issues verify --file <ファイル>` | 先に `fileSha256=` を表示する。契約の不適合は `CONTRACT_INVALID`（`detail` は `SCHEMA`、`SCHEMA_VERSION`、`CONTENT_HASH`）。架空データのファイルは契約に適合すれば `OK` |

実データのファイルは、契約に適合しても、受領記録との照合が済むまで使えません。

| 符号 | 意味 |
| --- | --- |
| `RECEIPT_MISSING` | 受領記録がない。使ってはいけません。本担当に受領記録を依頼します |
| `RECEIPT_MISMATCH` | ファイルが受領記録（`fileSha256`、`contentHash`、`inputDigest`、`generatedAt`、`issuesSchemaVersion`）と1項目でも違う。古いファイルか、書き換えられたファイル |
| `RECEIPT_INVALID` | 受領記録の置き場所に、受領記録でないファイルか、自分のSHA-256で名付けられていないファイルがある |
| `RECEIPT_LATEST_UNDECIDED` | 受領記録が2件以上ある。どれが最新かの判定は未決（design.md の(i-13)）なので、推測で選ばず、拒否します |

失敗した出力と古い出力は、使われません。(1)失敗の後は状態記録が `SUCCESS` でなく、`INVALIDATED`。(2)入力が変わった後は `--current` が `STALE`。(3)受領記録は `OK` の出力にだけ書くので、失敗した出力と古い出力には受領記録がなく `RECEIPT_MISSING`。(4)新しい受領記録の後は、古いファイルが `RECEIPT_MISMATCH`。(5)契約の版が上がった後は `CONTRACT_INVALID`。

## 6. 無効になった課題と再承認

課題が `withdrawn` に入る理由は7種類です。複数に該当するときは、次の順で最初のものが `reason` です。`issues list` は該当する理由をすべて表示します。承認の記録が1件もない課題は、`issues` にも `withdrawn` にも入りません。

| 理由 | 起きたこと |
| --- | --- |
| `REVOKED` | 承認が取り消された |
| `CONTENT_CHANGED` | 課題の内容が変わり（新しい版）、現在の版に有効な承認がない。以前の版の承認は引き継がない |
| `APPROVAL_INSUFFICIENT` | 現在の版の有効な承認の、異なる承認者IDの数が足りない |
| `SOURCE_CHANGED` | 根拠の事実項目の原本のSHA-256が変わった、または原本を確認できない |
| `FACT_UNVERIFIED` | 根拠の事実が `VERIFIED` でなくなった（または事実項目が見つからない） |
| `USAGE_CHANGED` | 出典の利用条件が `CONFIRMED` でなくなった、または外部AIへの送信可否が `ALLOWED` でなくなった |
| `CHECK_FAILED` | 決定的検査に、現在の語の一覧で合格しなくなった |

有効に戻すには、原本の変化なら新しい revision の取り込み、再集計、人による再検証、課題の文への決定的検査のやり直し、そして、版を1つ上げた課題の記録に、確認項目6つの確認と、必要な人数の異なる承認者の新しい承認を付けます。課題IDは維持します。判定は保存データを書き換えず、同じ入力から同じ結果になります。

## 7. 質問との接続（対応の記録）

`Question` にも `IssueCard` にも項目を足しません。質問が根拠とした課題は、対応の記録に書きます。置き場所は、架空データが `packages/fixtures/src/regional-values/issue-links.json`（Git管理）、実データが `data/real/regional-values/issue-links.json`（Git管理外）です。

```json
{
  "schemaVersion": 1,
  "dataKind": "FIXTURE",
  "links": [{ "targetKind": "QUESTION", "targetId": "<質問ID>", "issueId": "<課題ID>", "issueVersion": 1 }]
}
```

ファイルは `schemaVersion`、`dataKind`、`links` を持ち、`links` の各件は `targetKind`、`targetId`、`issueId`、`issueVersion` を持ちます（`targetKind`、`targetId`、`issueId` の組は一意）。`targetKind` は `QUESTION` か `ISSUE_CARD` です。質問の分は共同開発者、課題カードの分は本担当が書きます。`issueVersion` は `issues.json` の `version` を写します。ビルドは、次のとおり検査します（ビルドは `issues.json` のファイルを読みません）。

| 状況 | 符号 | 区分 |
| --- | --- | --- |
| 記録が契約に適合しない、存在しない質問・課題カード・課題を指す、課題の記録にない版を指す | `CONTRACT_VIOLATION` | 欠陥。直すべき誤りで、記録を足して解消できません |
| 質問が指す課題が `withdrawn` にある、または版が現在の有効な版より小さい | `QUESTION_ISSUE_INVALID` | 不足。質問を再確認して対応の記録を更新すれば解消できます。質問は自動では除外されません |
| 課題カードが指す課題が無効、または版が古い | （指摘なし） | カードの承認を `PENDING` として扱い、公開バンドルに含めません |

`QUESTION_ISSUE_INVALID` は、公開バンドルの `meta.switchReasonCodes` が取りうる値として、版1に1件加わりました。`--data-mode REAL_PREFERRED` のビルドは、この不足で架空データへ切り替わります。

## 8. 実データの受け渡し経路

実データの `issues.json` は、`data/real` と `dist`（どちらも `.gitignore` 済み）にでき、公開もしません。リポジトリ、PR、課題トラッカーなど、公開されうる場所に置かないでください。

1. 本担当が `issues export --data-mode REAL` を実行し、`issues verify --output --data-mode REAL --current` が `OK` であることを確認する。
2. 本担当が、Git管理外の方法で `issues.json` を共同開発者へ渡す。
3. 共同開発者が `issues verify --file <ファイル>` を実行する。受領記録がまだないので `RECEIPT_MISSING` になるが、契約の検査の結果とファイル全体のSHA-256が表示される。契約の検査が合格であることを確認し、SHA-256を本担当へ伝える。
4. 本担当が `issues receipt` を実行する。出力が `OK`（現在の入力と一致）で、伝えられたSHA-256が出力と一致するときだけ、受領記録を `.kiro/specs/regional-values-map/records/issues-receipts/<記録のSHA-256>.json` に書く。不一致や拒否では何も書かない。
5. 受領記録をGitに入れる（commitは人が行う）。共同開発者は、`issues verify --file` を再び実行し、`OK` のときだけファイルを使う。
6. 出力が古くなったら、出力し直して渡し直し、新しい受領記録を作る。古い受領記録は消さない。

受領記録は本文を含みません。渡した人、受け取った人、受領日時は、コマンドの引数で受ける**自己申告の値**で、`attestation` に固定値 `SELF_REPORTED` を持ちます。本人確認や署名の証明ではありません。ファイルが渡されたことの確認は、SHA-256の一致だけです。

## 9. 共同レビューと変更の通知

| 項目 | 内容 |
| --- | --- |
| 共同レビュー | 課題と質問の対応、方向の対称性（Req 3.7〜3.9）、中立性、課題データと価値観分析の整合、契約の版と通知 |
| 受け渡しの段階 | M1: 契約と架空データの `issues.json`。M2: `issues export` と、fakeの下書き工程の一巡。M3: 実データ（取り込み、検証、承認、実Bedrockの呼出し、受領記録の作成が前提） |
| 変更の通知 | `issues.json` の契約の項目の追加は、同じ版に入れて通知します。削除と型の変更は版を上げます。質問方式の契約の版とは別に扱い、通知は同じ時期にまとめます |
