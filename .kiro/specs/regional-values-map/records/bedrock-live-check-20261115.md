# 実Bedrockの確認の実行記録（AI下書き工程。架空データのみ）

**状態: 実施済み（承認された1回の実行）。** この記録は、秘密情報（キー、プロンプトの文、応答の文）を含まない。キーのアカウントの下4桁も伏せた。実行の出力（下書きとイベントの記録、ログの原文）は、Git管理外の`dist/bedrock-live-check/20261115T130743644Z/`にある。

## 承認

- 利用者が、会話で、計画のダイジェスト`4eeda36e2cd0dc67691d39b120bb35b355c767bc323c1b94a7c953801838953d`の実AWS呼び出し計画（P0、S1、S2、S3の最大4回）を承認した。AWS Marketplaceの購読が発生する可能性も了承された。
- 実行は、承認されたダイジェストを環境変数`BEDROCK_LIVE_CHECK_APPROVAL`に入れた1回だけである。実行の中で、ランナーが現在の計画のダイジェストと照合し、一致したので送った。追加の呼出し、モデルの変更、上限の変更はしていない。

## 実行

| 項目 | 内容 |
| --- | --- |
| 実行ID（UTC。機械の時計） | `20261115T130743644Z`（2026-11-15 13:07:43。日本時間22:07） |
| コマンド | `npm run bedrock:draft-check`（design.mdのD45。承認の環境変数は、その実行のプロセスだけに置き、終了時に消した） |
| サービス | Amazon Bedrock Runtime（Converse API）、`bedrock-runtime.ap-northeast-1.amazonaws.com` |
| リージョン、モデル | `ap-northeast-1`（東京）、`jp.anthropic.claude-haiku-5-5`（日本国内の推論プロファイル） |
| 認証 | Bedrock APIキー（長期キー形式）。S1〜S3だけが実キーを送った。P0は、キーとして受け付けられない固定の文字列を送った |
| 送ったデータ | `packages/fixtures/src/regional-values/facts.json`の架空の事実項目だけ（人口、防災、教育）。公式データ、個人情報、秘密は送っていない |
| 上限 | 4回以内、1回30秒、出力2,000トークン、費用の最悪値の合計0.05ドル、最初の失敗で停止、再試行なし |
| 検査用の語の一覧 | 承認前の試験専用（`tests/harness/regional-values/test-config/`）。承認済みの語ではない |
| プロンプトの版 | `rv-draft-1` |

## 呼出しごとの結果

| 手順 | 内容 | 結果 | 所要時間 | 入力トークン | 出力トークン | 停止の理由 | 推定費用（ドル） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 受け付けられないキーでの挨拶（43文字） | 拒否（HTTP 403、`AccessDeniedException`）。期待どおり。`AUTH`として扱い、実キーは送っていない | - | - | - | - | 0 |
| S1 | 課題候補（人口。事実項目3件） | 成功。決定的検査に合格し、`PENDING`で保存 | 8,909 ms | 1,093 | 1,969 | `end_turn` | 0.001204 |
| S2 | 課題候補（防災。事実項目2件） | 成功。決定的検査に合格し、`PENDING`で保存 | 6,508 ms | 1,015 | 1,329 | `end_turn` | 0.000843 |
| S3 | 課題候補（教育。事実項目2件） | 呼出しは成功。決定的検査が不合格（`DR_HEDGE_REQUIRED:statement`）で、保存せず | 5,716 ms | 1,030 | 1,292 | `end_turn` | 0.000824 |

- 呼出しは4回（モデルの呼出し3回と、キーの拒否の確認1回）。エラーによる停止、タイムアウト、上限による拒否は0回。
- 推定費用の合計は**0.002871ドル**（約0.4円。1ドル=150円で換算）。承認時の最悪値は0.005375ドル、上限は0.05ドル。推定費用は、サービスが返したトークン数と、`jp.`プロファイルの単価（入力0.11ドル、出力0.55ドル／100万トークン。第三者の料金表で確認した値）から求めた。請求額は、AWSの請求とCost Explorerで確認する。
- 応答の形は、3回とも、そのままJSONの1つのオブジェクトで、コードブロックで囲まれていなかった。

## AI生成結果の検査

| 手順 | 検査の結果 | 内容（架空データ） |
| --- | --- | --- |
| S1 | 合格（保存） | テーマ`POPULATION_REVITALIZATION`。題名「地域の集まりの参加者数の変化について」。仮説の文は「…が、地域活動の継続に影響している可能性があります。」。事実の要約3件は、事実項目の値（延べ480人、延べ420人、12件）をそのまま使い、計算した値（差、割合）は含まない。判断できないこと2件、追加で確認すること3件、対応の方向（参考のみ）2件 |
| S2 | 合格（保存） | テーマ`DISASTER_PREVENTION`。題名「架空町みなとの避難場所の配置について」。仮説の文は「…が、住民の避難行動に影響している可能性があります。」。事実の要約2件は、8か所、3か所をそのまま使う。判断できないこと1件、追加で確認すること1件、対応の方向（参考のみ）1件 |
| S3 | 不合格（保存せず） | 仮説の文の語尾が、試験専用の語尾の一覧（「可能性があります」「かもしれません」）のどちらでもなかった。不合格の出力は保存しないので、文そのものは残っていない。`REJECTED_BY_CHECKS`として数えた |

- 保存された下書き: `87ace664…e3cd`（S1）、`5cfa933b…7a97`（S2）。どちらも`aiClass = AI_DRAFT`、`dataKind = FIXTURE`、`modelId = jp.anthropic.claude-haiku-5-5`、`PENDING`。
- AIの貢献を示す4つの数: `drafted = 3`、`rejectedByChecks = 1`、`humanEdited = 0`、`humanRejected = 0`。
- 承認の記録は0件、採否の記録は0件。承認台帳と課題の記録は作られていない。AIの生成結果は、人の採用と承認（確認項目6つ）を経ない限り、課題にも公開バンドルにも入らない。

## 観察と留意点

1. **出力トークンの多くは、見えない思考である。** S1は、可視の応答が1,171文字なのに、出力トークンは1,969で、上限2,000に31トークンまで近づいた。Haiku 5.5は適応的思考が既定で有効なためと考えられる。今回は`end_turn`で終わったが、入力の事実項目が増えると、`max_tokens`で途切れて`DR_JSON`で不合格になりうる。変更（`maxTokens`の引上げ、思考の無効化）は、利用者の確認を得てから行う。
2. **S3の不合格は、語尾の一覧と、モデルの言い回しの食い違いである。** プロンプトは「断定を避けた語尾」とだけ言い、検査の語尾の一覧（試験専用で2語）を知らせていない。13.1で語尾の一覧を承認する（案は6語）か、プロンプトに一覧を含める（`promptVersion`の更新と、架空データの下書きの作り直しが要る）かの判断が要る。実行はしていない。
3. **決定的検査を通っても、因果を示唆する言い方は残る。** S1とS2の仮説の文は「…が…に影響している可能性があります」で、試験専用の因果語の一覧を通ったが、因果関係を疑わせる。S2の「住民の避難行動」は、事実項目にない内容である。人のレビュー（確認項目の「因果関係を断定していない」）と、13.1で承認する語の一覧が、この残りを減らす。
4. **キーの権限は足りていた。** P0以外の呼出しが成功したので、`bedrock:CallWithBearerToken`と、JPプロファイルへの`bedrock:InvokeModel`は足りていた。AWS Marketplaceの購読が、今回の呼出しで新しく作られたのか、以前からあったのかは、この環境から確認できない。AWSの「Marketplaceの購読」の画面で確認する。
5. **認証の拒否の確認（P0）は、実サービスの`AccessDeniedException`（HTTP 403）を、`AUTH`として扱って止まる経路を確認した。** 受け付けられない固定の文字列を送ったので、実キーは使っていない。

## 実行後の対応（実AWSの呼出しなし。design.mdのD46）

この実行のあとで、1、2、3に次の対応をした。**この記録の本文（上の結果と観察）は、実行時の状態のままで、書き換えていない。**

- 2: 指示が、設定の語尾の一覧と因果語の一覧を名指しするようにした（`promptVersion`は`rv-draft-2`）。S3の不合格の語尾は、保存されていないので未確認で、原因は「一覧と指示の食い違い」と推定した。効果は未確認。
- 3: 因果関係と、事実項目にない内容を書かない指示を足した。決定的検査の範囲は変えていない。人のレビューは省略しない。
- 1: 思考の設定（`disabled`、`low`、`medium`、`high`）を確認コマンドの`--thinking`に足し、途切れを`truncated=true`、出力の余裕を`headroom=`で示すようにした。**既定と`maxTokens`は変えていない。**
- この実行の承認（ダイジェスト`4eeda36e…953d`）は、プロンプトの版が変わったので、もう使えない。次の実行には、新しい計画の承認が要る。

## 安全の確認

- ログと出力に、キー、`Bearer`、環境変数の名前、P0の固定の文字列が含まれていないことを、文字列の検索で確認した（0件）。出力は、固定の符号、ID、件数、トークン数、費用、応答の形だけである。
- 入力の検査、出力の検査（13種）を省略していない。`runDraftCommand`（`draft run`と同じ処理）を通した。
- 下書きとイベントは`dist/bedrock-live-check/`にだけ書いた。`packages/fixtures/`の架空データの記録、`data/real/`は変更していない。
- 再試行、追加の呼出し、モデルの変更、上限の変更はしていない。

## 実行ログの原文（秘密を含まない。キーのアカウントの下4桁だけ伏せた）

```text
plan version=1 digest=4eeda36e2cd0dc67691d39b120bb35b355c767bc323c1b94a7c953801838953d
plan aws region=ap-northeast-1 endpoint=bedrock-runtime.ap-northeast-1.amazonaws.com auth=BEDROCK_API_KEY keyAccount=********XXXX crossRegion=false
plan models generation=jp.anthropic.claude-haiku-5-5 verification=jp.anthropic.claude-haiku-5-5 used=generation
plan data kind=FIXTURE source=packages/fixtures/src/regional-values/facts.json realData=none
plan prompt version=rv-draft-1
plan checks status=TEST_ONLY_NOT_APPROVED configDir=tests/harness/regional-values/test-config settings=tests/harness/regional-values/test-config/draft-settings.json settingsSha256=5b7a6c4a65a3a0c117552f613b8f755167b2d710ee4184a7c7e1c5d1559e01dd
plan limits maxCalls=4 maxWorstCaseUsd=0.050000 timeoutMs=30000 maxOutputTokens=2000 maxInputChars=20000 minIntervalMs=6100 stopAfterFailure=true retries=0
plan pricing asOf=2026-11 model=jp.anthropic.claude-haiku-5-5 inputUsdPerMillionTokens=0.11 outputUsdPerMillionTokens=0.55 inputTokensPerCodeUnitCeiling=2
plan step id=P0 kind=AUTH_PROBE theme=- facts=- model=jp.anthropic.claude-haiku-5-5 inputChars=43 inputSha256=36bc18dd962529aed902fe90bf5a5470929ca2c03c8eae004e2669e994cd384b worstCaseUsd=0.001110
plan step id=S1 kind=ISSUE_CANDIDATE theme=population facts=fixture-fact-population-2023-v1,fixture-fact-population-2024-v1,fixture-fact-population-v1 model=jp.anthropic.claude-haiku-5-5 inputChars=1535 inputSha256=c78d03ed3732c7161defab51e7c76c6e836b4d5780e204760df7c1a71f2dcf5e worstCaseUsd=0.001438
plan step id=S2 kind=ISSUE_CANDIDATE theme=disaster facts=fixture-fact-disaster-v1,fixture-fact-disaster-hills-v1 model=jp.anthropic.claude-haiku-5-5 inputChars=1410 inputSha256=3f6ea35eaef4a38ca461b4cd6167a91c8a0a00fbf12a9637974f91aab0e63a63 worstCaseUsd=0.001411
plan step id=S3 kind=ISSUE_CANDIDATE theme=education facts=fixture-fact-education-v1,fixture-fact-education-users-v1 model=jp.anthropic.claude-haiku-5-5 inputChars=1432 inputSha256=31de5be1bfff2eb1eedc99e63d76279a5dbfa3a833fe759cf963ae437c12e741 worstCaseUsd=0.001416
plan total calls=4 worstCaseUsd=0.005375
run id=20261115T130743644Z output=dist\bedrock-live-check\20261115T130743644Z
run step=P0 kind=AUTH_PROBE outcome=AUTH expected=true elapsedMs=- httpStatus=403 errorType=AccessDeniedException
run step=S1 outcome=DRAFT_OK draftId=87ace664ed9a50150e526469e6c30334a93e946dcda74b236e1c11b40119e3cd status=PENDING cached=false elapsedMs=8909 inputTokens=1093 outputTokens=1969 stopReason=end_turn usd=0.001204 shape=OBJECT/OBJECT fence=false codePoints=1171
run step=S2 outcome=DRAFT_OK draftId=5cfa933b03f523a25850a3c0be6f326cdce77ea56a1ff53efd9de1fa005b7a97 status=PENDING cached=false elapsedMs=6508 inputTokens=1015 outputTokens=1329 stopReason=end_turn usd=0.000843 shape=OBJECT/OBJECT fence=false codePoints=676
run step=S3 outcome=CHECK_FAILED violations=DR_HEDGE_REQUIRED:statement elapsedMs=5716 inputTokens=1030 outputTokens=1292 stopReason=end_turn usd=0.000824 shape=OBJECT/OBJECT fence=false codePoints=817
summary calls=4 refusals=0 actualUsd=0.002871 worstCaseUsd=0.005375 ceilingUsd=0.050000
summary drafts saved=2 pending=2 adopted=0 rejected=0 approvals=0 humanApprovalRequired=true
summary aiContribution drafted=3 rejectedByChecks=1 humanEdited=0 humanRejected=0
code=LIVE_CHECK_DONE
```
