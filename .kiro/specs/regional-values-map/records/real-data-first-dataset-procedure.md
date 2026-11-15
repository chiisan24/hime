# 実データ1件の取込と検証の手順（最初の1件。Task 13.14 の次の段階）

**状態: 手順の整理（実データの取込みも、決定の記録も、AWSの呼出しも、していない）。** 人の決定が要る段階は【人】、人の承認を待つ段階は【保留】で示す。この文書が使う道具は、すでにある`real`コマンド群（D43）、`verify-fact`、`draft run`だけで、コードを足していない。

| 項目 | 内容 |
| --- | --- |
| 作成日 | 2026-11-15（作業環境の日付） |
| 元にした記録 | `dataset-inventory.md`（13.14の棚卸し）、`real-data-readiness-review.md`（古い。取込みと`verify-fact`はその後できた）、`design.md`のD42〜D46 |
| 稽古 | 架空のデータ・ファイル・架空のモデルで、同じ順序を通すテストがある: `tests/regional-values/realDataProcedure.test.ts`。ネットワークを使わず、リポジトリに何も書かない |
| 実際にした確認 | 手元の原本1件について、`real original verify-file`（読むだけ）を実行した。結果は「9. 実行した確認」 |
| していないこと | 原本の取得（ダウンロード）、取込み、事実項目の作成、決定の記録、AWSの呼出し、公式データの外部AIへの送信 |

## 0. 要点

1. **最初の1件は DIS-01（愛媛県の指定緊急避難場所一覧）を推奨する（経路A）。** 原本のXLSXがすでに手元にあり（追加の取得がない）、基準日が決まっており、防災テーマの主データで、行を数えるだけの集計で最初の事実項目を作れる見込みである。表の構造は未確認なので、確認で合わなければ経路Bに切り替える。
2. **コマンドは何も決めない。** 取込みは資料集合を候補（`CANDIDATE`）とし、利用条件、個別注記、外部AIへの送信可否はすべて「未確認」で始める。事実項目は`PROVISIONAL`で作る。決定は人が行い、記録する。
3. **人の決定がないと、AI下書きの入力の関門（`draft run`）は通らない。** 稽古のテストで確かめた: 取込み、事実項目の作成のあと、`verify-fact`の前は`FACT_NOT_VERIFIED`、`USAGE_NOT_CONFIRMED`、`TRANSMISSION_NOT_ALLOWED`で拒否され、モデルは呼ばれない。3つが人の決定で解けて初めて通る。
4. **コマンドがない手順が3つある（「7. 道具の欠け」）。** 決定の記録、`draft run`の入力JSONの組立て、実データでの送信の承認である。人が決めた方法で行う。
5. **13.1の語の一覧は未承認のままである。** `real fact create|status`と`verify-fact`は、設定の置き場所`config/regional-values/`の`build.json`と`neutrality.json`を読む（事実の文の検査に使う固有名詞と数値の例外語）。リポジトリにあるのは`map.json`だけなので、今は`--config-dir tests/harness/regional-values/test-config`（試験専用。承認済みの設定ではない）を渡す必要がある。一覧は13.1で承認されたあとに、`real fact status`で再判定できる。
6. **実データのAI下書きは、この手順の最後の段階で、保留にした。** 外部AIへ送る決定、13.1の一覧、送る内容の確認が要る。

## 1. 最初の1件の選び方

| | 経路A（推奨） | 経路B（代替） |
| --- | --- | --- |
| データセット | DIS-01 指定緊急避難場所一覧（県。カタログID `pref-2`） | POP-02 地域・年齢別人口（松山市。令和8年版のカタログID `3636`） |
| テーマ | 防災（`DISASTER_PREVENTION`） | 人口減少・地域活性化（`POPULATION_REVITALIZATION`） |
| 原本 | **手元にある**: `data/real/open-data/ehime-catalog/pref-2/shelters.xlsx`（288,496バイト。SHA-256 `41df5967e75eafd82fee0a2a211bb1fa8699d936011247ef5c4f5b76bce8b3c6`。基準日 2026-07-27） | ない。ダウンロードが要る【保留: 取得の許可】 |
| 形式 | XLSX。人がCSVへ変換する（`conversion`の記録が要る） | CSV（UTF-8と記載。BOMは未確認）。変換は要らない |
| 利用条件 | カタログの既定（CC BY 4.0）。ページにライセンス欄の表示なし。規約PDFは未読 | 市のメタデータにCC-BY。規約PDFは未読 |
| 弱み | 表の構造（見出しが1行か、結合セルがないか）が未確認。個人情報の列がないかを確かめる必要がある | 取得の許可が要る。地域の粒度、列名は未確認 |

経路Aで原本の構造が合わないとき、または個人情報が見つかったときは、そこで止めて経路Bに切り替える。

## 2. 手順の一覧

記号: **[コマンド]** は機械がする。**【人】** は人が行い、人が記録する。**【保留】** は人の承認があるまで行わない。コマンドは`npm run regional-values -- <引数>`の形で、リポジトリのルートで実行する（先頭の`npm run regional-values --`は、以降の表では省く）。引数のファイルのパスは、リポジトリのルートからの相対パスで書く。

| 手順 | 種別 | することと、見るもの | 成功の印 | 中止する条件 |
| --- | --- | --- | --- | --- |
| 1 | [コマンド] | 原本が、期待するファイルであることを確かめる（読むだけ）。`real original verify-file --file <原本のパス> --expected-sha256 <小文字の16進> --expected-bytes <バイト数>` | `code=ORIGINAL_MATCH` | `ORIGINAL_MISMATCH fields=sha256`または`byteLength`。ファイルが違う。取込みへ進まない |
| 2 | 【人】 | 原本を開いて確かめる。(a) 1行目だけが見出しで、1行が1件の平らな表か（見出しが複数行、結合セル、複数の表は、取込みの集計に向かない）。(b) 個人の氏名、住所、電話番号の列がないか（県には名簿の誤公開の前例がある）。(c) 見出しを含む行数を数える（手順4で使う） | 平らな表で、個人情報の列がなく、行数が分かる | 平らでない、または個人情報がある。経路Bに切り替える。見つかった内容は記録に書かない |
| 3 | 【人】 | CSVへ変換する。**1行を1行に対応させる**（行を足さない、消さない、並べ替えない）。UTF-8またはShift_JISで保存する。手順書（何を開き、どう保存し、どの行を照合したか）を書く。変換は機械で代替できない | CSVと手順書がある | 行が対応しない。変換をやり直す |
| 4 | 【人】 | 取込み要求のJSONを書く（雛形は「3. 取込み要求の雛形」）。公表者、公表日、取得日時、ライセンスの名称とURLは、**人が公開ページで確かめた値を書く**。機械は推測しない | JSONがスキーマに通る | 値が分からない。空欄のまま進まない |
| 5 | [コマンド] | CSVを取り込む。`real intake csv --request <要求のJSON>`。続けて`real original verify-stored`、`real dataset check`、`real dataset list`で、置いた原本と台帳を見る | `code=INTAKE_OK status=CREATED ...`、`ORIGINALS_OK`、`DATASET_CHECK_OK`。台帳は`adoption=CANDIDATE usage=UNKNOWN note=UNCHECKED transmission=UNKNOWN` | 「5. 中止の条件と符号」の各符号。何も書かれない（失敗した取込みは何も残さない） |
| 6 | [コマンド] | 事実項目を`PROVISIONAL`で作る。`real fact create --request <要求のJSON> --config-dir <設定>`（雛形は「4. 事実項目の要求の雛形」）。`real fact status --config-dir <設定>`で状態を見る | `code=FACT_CREATED ... verification=PROVISIONAL amount=<値>`。`fact status`は、この時点では`FACT_STATUS_NOT_VERIFIED`（終了コード1）で正しい | `REQUEST_INVALID`、`FACT_CREATE_FAILED`の各符号。`CONFIG_UNREADABLE`は、設定の置き場所がない |
| 7 | 【人】 | 事実項目を検証する。**人が端末で実行する**: `verify-fact <factId> --verifier <人のID> --config-dir <設定>`。保存値、原本から再計算した値、原本の該当箇所、空欄の数が出る。原本（Excelなど）を開いて見比べ、2つの質問に`y`と答えたときだけ`VERIFIED`になる | `code=VERIFY_OK factId=<ID>`。続けて`real fact status`が`FACT_STATUS_OK` | 値が一致しない。`n`と答える（何も書かれない）。`SOURCE_CHANGED`（原本が変わっている） |
| 8 | 【人・保留】 | 利用条件、個別注記、外部AIへの送信可否、データセットの採否を**決めて記録する**。決める前に、規約PDF（県、松山市）を読む。記録の項目は「6. 決定の記録の項目」。**現在、記録するコマンドはない**（「7. 道具の欠け」の1） | 出典の記録で、`usage`が`CONFIRMED`、`transmission`が`ALLOWED`（送ってよいと決めたときだけ） | 規約が読めない、第三者のサービスによる処理が制限されている、送信可否が決められない。`UNKNOWN`または`DENIED`のままにする |
| 9 | [コマンド] | AI下書きの前に、毎回、再確認する。`real original verify-stored`と`real fact status --config-dir <設定>` | `ORIGINALS_OK`、`FACT_STATUS_OK` | `CHANGED`、`MISSING`、`SOURCE_CHANGED`。`draft run`は、原本の現在のSHA-256を確かめない（「7. 道具の欠け」の2）ので、この再確認が代わりになる |
| 10 | 【人】 | `draft run`の入力JSONを作る。事実項目と出典の記録（`facts/<ID>.json`、`sources/<出典ID>/<revision>.json`）を、`dataKind: "REAL_AI"`、`facts`、`factRegistry`、`evidence: []`、`sources`にまとめる。**作るコマンドはない**（「7. 道具の欠け」の3）。稽古のテストの`putDraftRequest`が、同じ内容を作る例である | JSONが`DraftRequestSchema`に通る | 事実項目が`VERIFIED`でない、出典の送信可否が`ALLOWED`でない（次の手順で拒否される） |
| 11 | 【保留】 | 実データのAI下書き: `draft run --task ISSUE_CANDIDATE --input <JSON> --draft-settings <13.1の設定>`。入力の関門を通ると、**そのまま実サービスを呼ぶ**（計画の表示と承認のダイジェストはない）。この手順の作成では実行しない | `code=DRAFT_OK ...`。下書きは`PENDING`で、採用と承認（確認項目6つ）は人が別に行う | 関門の拒否（`INPUT_REFUSED reasons=...`）。拒否では呼出しも保存もない |

## 3. 取込み要求の雛形（経路A。値の`<...>`は人が確かめて書く）

`inbox/`のような作業用の場所に置く。置き場所の決まりはなく、`data/real/`の下に置くとGit管理に入らない。

```json
{
  "sourceId": "ehime-pref-2-shelters",
  "file": "data/real/open-data/ehime-catalog/pref-2/shelters.csv",
  "reference": { "kind": "url", "url": "https://www.pref.ehime.jp/opendata-catalog/dataset/pref-2.html" },
  "publisher": "愛媛県",
  "publishedOn": "<公表者が示すファイルの日付。YYYY-MM-DD>",
  "retrievedAt": "<原本を取得した日時。ISO 8601（例 2026-07-30T09:00:00Z）>",
  "license": { "name": "<利用規約が示す条件の名称>", "url": "https://www.pref.ehime.jp/opendata-catalog/policy.html" },
  "catalog": { "name": "愛媛県オープンデータカタログ", "datasetId": "pref-2" },
  "expectedOriginal": { "sha256": "41df5967e75eafd82fee0a2a211bb1fa8699d936011247ef5c4f5b76bce8b3c6", "byteLength": 288496 },
  "conversion": {
    "originalFile": "data/real/open-data/ehime-catalog/pref-2/shelters.xlsx",
    "procedureId": "xlsx-to-csv-by-hand-v1",
    "procedureFile": "<人が書いた手順書のパス>",
    "convertedBy": "<変換した人のID>",
    "convertedAt": "<ISO 8601>",
    "correspondence": "ROWS_PRESERVED",
    "originalRowCount": 0
  },
  "dataset": {
    "title": "指定緊急避難場所一覧",
    "publisher": "愛媛県",
    "sourceUrl": "https://www.pref.ehime.jp/opendata-catalog/dataset/pref-2.html",
    "surveyDate": "2026-07-27",
    "updatedOn": "2026-07-29",
    "coverageArea": "愛媛県",
    "themeIds": ["DISASTER_PREVENTION"]
  }
}
```

注意:

- `expectedOriginal`は、**変換した原本（XLSX）**のSHA-256とバイト数である。CSVのものではない。CSVを渡すと`ORIGINAL_MISMATCH fields=sha256,byteLength`で拒否される（稽古のテストで確かめた）。
- `originalRowCount`は、**見出しの行を含む**原本の行数（0は雛形の仮の値）。機械はCSVの行数を、空行を除いて数え、一致しなければ`ROW_COUNT_MISMATCH originalRows=<人の数> convertedRows=<機械の数>`で拒否する。
- SHA-256は、**小文字**の16進で書く。PowerShellの`Get-FileHash -Algorithm SHA256 <パス>`は大文字で出すので、`.Hash.ToLower()`で直す。大文字は`REQUEST_INVALID`になる。
- `retrievedAt`は、ファイルの更新時刻ではなく、原本を公式の場所から取得した日時を、人が確かめて書く。
- `license`の値は、カタログのページにライセンスの欄がないため、利用規約（PDFは未読）を読んで、人が決める。この雛形の名称は空にしてある。
- 同じCSVを同じ`sourceId`でもう一度取り込むと`status=UNCHANGED`で何も変わらない。別の内容は次のrevision（`r2`）になる。別の`sourceId`が同じ内容を持つと`DUPLICATE_CONTENT`で拒否される。

## 4. 事実項目の要求の雛形（最初の事実項目: 行数）

```json
{
  "kind": "COMPUTED",
  "factId": "ehime-pref-2-rows",
  "sourceId": "ehime-pref-2-shelters",
  "method": { "kind": "COMPUTED", "aggregation": "COUNT_ROWS", "column": null, "equals": null, "description": "データ行の数" },
  "surveyDate": "2026-07-27",
  "area": "愛媛県",
  "subject": "指定緊急避難場所の記録の数",
  "unit": "件"
}
```

- 単位は「件」にする。1行が1か所を表すかは、手順2で確かめるまで分からない（同じ場所が災害の種類ごとに複数行にある場合がある）。確かめて「か所」に変えるときは、その根拠を`description`に書く。
- 災害の種類ごとの件数は、`COUNT_ROWS_WHERE`（`column`に列名、`equals`に値）で作る。列名と値の形は、変換したCSVを見て決める（未確認）。
- 文は機械が作る（調査年、地域、数値、単位から）。人が文を書かない。数値を計算して書く文は作れない。割合や差は、検証済みの2つの事実項目から`DERIVED`で作る（検証は人が行う）。

## 5. 中止の条件と符号

次の符号が出たら、その場で止める。取込みの失敗は何も残さない（途中の書込みは取り除かれる）。

| 場面 | 符号 | 意味と次の行動 |
| --- | --- | --- |
| 原本の照合 | `ORIGINAL_MISMATCH fields=sha256` / `byteLength` / `sha256,byteLength` | 期待するファイルではない。ファイルを取り直す、または期待値を人が確かめ直す。取り込まない |
| 取込み | `INTAKE_FAILED reason=ORIGINAL_MISMATCH` | 上と同じ。何も書かれない |
| 取込み | `INTAKE_FAILED reason=ROW_COUNT_MISMATCH originalRows=<人> convertedRows=<機械>` | 変換が行を保っていない、または行数の数え方が違う（見出しを含む）。変換か数え直す |
| 取込み | `INTAKE_FAILED reason=CSV_TEXT_REFUSED` / `CSV_TABLE_REFUSED` | 文字コードが読めない、表の形に合わない。変換のやり直し |
| 取込み | `INTAKE_FAILED reason=DUPLICATE_CONTENT existingSourceId=<ID>` | 同じ内容を別の出典IDが持つ。出典IDを使い分けない |
| 取込み | `REQUEST_INVALID fields=<項目名>` / `FILE_UNREADABLE field=<項目名>` | 要求のJSONか、指したファイルが読めない。出力は値とパスを出さない |
| 取込み後 | `ORIGINALS_NOT_MATCHING changed=<n> missing=<n>` | 置いた原本が、記録のSHA-256と違う、またはない。ファイルを触っていないか確かめる。事実項目と承認が無効になる |
| 事実項目 | `FACT_CREATE_FAILED reason=ORIGINAL_CHANGED` / `SOURCE_NOT_FOUND` / `FACT_EXISTS` | 原本が変わっている、出典がない、同じ事実項目IDが別の内容で存在する |
| 事実項目の状態 | `findings=SOURCE_CHANGED` | 検証したあとに原本が変わった。`effective=PROVISIONAL`に戻る。再取込み、再集計、再検証が要る |
| 検証 | `VERIFY_FAILED reason=CANCELLED` | `y`が2つ揃わなかった（質問が出ない、`n`、入力がない）。何も書かれない |
| AI下書きの入力 | `INPUT_REFUSED reasons=...` | `FACT_NOT_VERIFIED`、`USAGE_NOT_CONFIRMED`、`TRANSMISSION_NOT_ALLOWED`、`CONVERSION_RECORD_MISSING`、`FACT_SOURCE_MISMATCH`ほか。満たされなかった条件がすべて並ぶ。呼出しも保存もない |

## 6. 決定の記録の項目（手順8。人が決め、人が記録する）

出典の記録（`data/real/regional-values/sources/<出典ID>/<revision>.json`）の`usage`、`datasetNote`、`transmission`を、`draft run`の関門が読む。データセット台帳（`data/real/regional-values/datasets/<datasetKey>.json`）の同じ3項目と`adoption`は、採否と公開側の判定（D44）が読む。**同じ決定を両方に記録する**（片方だけでは食い違う）。

| 項目 | 記録する内容 | 決める前に確かめること |
| --- | --- | --- |
| `usage`（利用条件） | `{ "status": "CONFIRMED", "checkedAt": "YYYY-MM-DD", "checkedTarget": "確認した規約のURLまたは文書名", "evidence": "根拠の文言（要約でよい）" }`。確認できなければ`UNKNOWN`、制限があれば`RESTRICTED` | 規約PDFの本文（未読）。個別注記 |
| `datasetNote`（個別注記の確認） | `{ "hasSpecificNote": false, "checkedBy": "人のID", "checkedAt": "ISO 8601" }`（注記があれば`true`と`noteSummary`）。未確認は`null` | データセットのページの注記、県の訂正通知 |
| `transmission`（外部AIへの送信可否） | `{ "status": "ALLOWED" または "DENIED", "checkedBy": "人のID", "checkedAt": "ISO 8601", "evidence": "根拠の文言" }`。決められなければ`{ "status": "UNKNOWN" }` | 規約が第三者のサービスによる処理を制限していないこと。AWSのBedrockへ送ることを、データセットごとに決める。公開されていること、CC BYであることは、許可ではない |
| `adoption`（データセットの採否。台帳だけ） | `{ "status": "ADOPTED" または "REJECTED", "decidedBy": "人のID", "decidedAt": "ISO 8601", "reason": "理由" }`。`ADOPTED`は`usage`が`CONFIRMED`で`datasetNote`が確認済みのときだけ契約が許す | 棚卸しの提案は、決定ではない |

## 7. 道具の欠け（決定待ち。この文書では作っていない）

1. **決定の記録のコマンドがない。** 関数`recordSourceReview`、`recordDatasetReview`（`apps/api/src/regional-values/intake/sourceReview.ts`）はあるが、コマンドにつながっていない。決定をコマンドの引数にしない方針は、これまでの決定のままである。選択肢: (a) 対話の確認（`verify-fact`と同じ形で、人が`y`と答えたときだけ書く）を足す。(b) 人が使い捨てのスクリプトで関数を呼ぶ。(c) 記録のJSONを人が直接編集する（契約に通る形で）。稽古のテストは(b)の形で、同じ関数を呼んでいる。
2. **`draft run`は、原本の現在のSHA-256を確かめない。** 入力の関門は、現在のSHA-256を与えられたときだけ「原本が変わったら検証済みでない」と判定できるが、`draft run`はそれを与えていない。ビルドの実データの読込み（D44）と`real fact status`は判定する。手順9の再確認が、人の手でこの穴を塞ぐ。直すなら、`draft run`が実データのときに、原本の現在のSHA-256を読んで関門に渡す変更になる（小さな変更だが、挙動を変えるので、決定を待つ）。
3. **実データのAI下書きの入力JSONを作るコマンドがない。** 手順10は人が組み立てる。
4. **実データのAI下書きに、承認制の計画の表示がない。** 架空データの確認コマンド（`bedrock:draft-check`）には、送る内容の計画とダイジェストの承認があるが、`draft run`にはない。入力の関門（人が記録した`ALLOWED`）を通ると、そのまま呼ぶ。実データで使う前に、同じ形の承認を足すかどうかを決める。

## 8. 保留にしたこと（人の承認が要る）

| 保留 | 理由 | 承認する人が決めること |
| --- | --- | --- |
| 手順8の決定すべて | 利用条件、個別注記、送信可否、採否は人の決定（Req 7.14、7.20） | 規約を読んだ上での記録。記録の方法（「7」の1） |
| 手順11（実データのAI下書き） | 外部AIへ公式データを送る | 送信の可否（手順8）、13.1の語の一覧、実データでの承認の方法（「7」の4）、第二意見のモデル（下記） |
| 13.1の語の一覧 | 因果語、仮説の語尾、比較語は案のまま（`word-lists-proposal.md`）。この文書は確定していない | 語の承認 |
| 経路Bの原本の取得 | 公式サイトからのダウンロード | 取得の許可 |
| 設定の置き場所（`config/regional-values/`の`neutrality.json`、`build.json`、`draft.json`の実ファイル） | 13.1の承認の結果として作る。いまは試験専用の設定だけがある | 13.1のあと |

補足: 第二意見（`NEUTRALITY_REVIEW`）は、起案とは別のモデルで行う規則（`REVIEW_MODEL_SAME_AS_DRAFT`）がある。いまの`.env.local`は、2つの役割に同じHaiku 5.5を設定しているので、第二意見は拒否される。Opus 5.5を`BEDROCK_VERIFICATION_MODEL_ID`に設定する必要がある（課題候補の下書きには影響しない）。

## 9. 実行した確認

読むだけの確認を1つ行った（2026-11-15。取込み、書込み、ネットワークは使っていない）。

```powershell
node apps\api\dist\regional-values\main.js real original verify-file --file data/real/open-data/ehime-catalog/pref-2/shelters.xlsx --expected-sha256 41df5967e75eafd82fee0a2a211bb1fa8699d936011247ef5c4f5b76bce8b3c6 --expected-bytes 288496
```

| 項目 | 結果 |
| --- | --- |
| 出力 | `file sha256=41df5967e75eafd82fee0a2a211bb1fa8699d936011247ef5c4f5b76bce8b3c6 bytes=288496`、`code=ORIGINAL_MATCH`（終了コード0） |
| 意味 | 手元のDIS-01の原本は、設計に記録したSHA-256とバイト数と一致する。手順1は、この原本で通る |
| ファイルの更新時刻（UTC） | 2026-11-11 22:29:49。取得日時の手がかりだが、取得日時そのものではない。`retrievedAt`は、人が取得した日時を確かめて書く |
| 中身 | 開いていない（表の構造、列、行数、個人情報の有無は未確認。手順2は人の作業） |

この確認は、原本の同一性だけを見ている。原本が公式の最新の版であるか、利用条件、送信可否については、何も確かめていない。

## 10. 経路B（松山市の人口）の違い

- 原本は取得しておらず、ダウンロードの許可が要る【保留】。
- CSVなので変換がなく、取込み要求の`conversion`を書かない。`expectedOriginal`は、人が取得したファイルのSHA-256とバイト数で、取得の直後に`Get-FileHash`で出した値を使う（公表者はSHA-256を示していない）。
- 取込みのあとの流れ（事実項目、検証、決定の記録、再確認）は経路Aと同じである。列名と年齢区分は自治体標準オープンデータセットの定義書で確かめる。
- 同じ地域・同じ定義の7年分を比べるときは、基準日の違いを文に書く（`FACT_COMPARISON_INVALID`の条件）。
