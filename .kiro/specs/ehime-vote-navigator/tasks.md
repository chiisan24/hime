# Implementation Plan: えひめ投票ナビ

## Overview

TypeScriptを実装言語とし、npm workspaces上にReact・Vite・Tailwind CSS・React Routerのweb、Express・Zod・AWS SDK v3のローカルAPI、共通契約、純粋domain、架空fixtureを分離して構築する。P0では、2022年第20回愛媛県知事選挙の実資料をSource Manifestから取り込み、Amazon Bedrockによる埋め込み・構造化抽出・要約・別要求の意味判定、決定的検査、人間承認、会場閲覧までをfail-closedで結線する。

全leaf taskは、実装と対応する自動テストを同じtaskで完了する。design.mdのCorrectness Properties 1〜42および52〜54はP0必須とし、それぞれ独立したleaf taskでfast-checkを最低100 runs実行する。通常の`npm test`はfake adapterだけを使用し、AWSへの実要求を行わない。

P1の当日投票所検索、期日前投票所検索、AI質問チャット、投票方法ガイド、およびP2の3D、通知、読み上げ、文字倍率、カレンダー、政治用語解説はこのP0計画の実装対象外とする。P1/P2のroute、依存関係、placeholder、skip testをP0へ追加せず、P0完成後に別の実装計画を作成する。P1/P2の状態はP0判定へ入力しない。

## External prerequisites / Blockers

以下は人間による外部作業または判断であり、チェックボックス付き実装taskには含めない。未完了でもコードとfixture/fakeによる自動テストは進められるが、実証跡を代替せずP0完成状態は`NOT_READY`または`P0未完成`のままとする。

- 2022年第20回愛媛県知事選挙について、両候補者に同じ採用規則を適用できる政策一次資料が未入手である。資料の取得、資料単位の利用条件確認、checksum対象ファイルのローカル配置が完了するまでP0完成は`NOT_READY`とする。2026年資料、現在の政策、片側だけの資料、AI生成文、fixtureへの自動fallbackを禁止する。
- AWS CLI v2は現在のPCに未導入である。ユーザーがAWS公式手順で導入し、利用権限のあるAWSアカウントを`default` profileまたはIAM Identity CenterのSSOへ設定する。アクセスキー、シークレットキー、セッショントークンをrepository、設定ファイル、画面、ログ、チャットへ記載しない。
- `ap-northeast-1`で生成、意味判定、埋め込みの3用途modelが利用可能かは、read-only診断後にユーザーが確定する。利用不可でも別Regionへ自動変更しない。Region変更は送信範囲を提示したprocess内の明示承認だけで行い、再起動時に失効させる。
- 候補者資料および候補者写真の取得・表示・再配布に関する利用条件と、選挙管理委員会へ確認する内容はユーザー判断を必要とする。アプリケーションは確認結果を記録・検査するが、法的判断や問い合わせを自動化しない。

## Tasks

- [x] 1. 非空workspaceを保護してnpm workspacesと検証基盤を構築する
  - [x] 1.1 既存資産を保持したmonorepo skeletonと最小起動entryを作成する
    - 主な変更領域: root `package.json`、`package-lock.json`、`tsconfig*.json`、`apps/web/`、`apps/api/`、`packages/contracts/`、`packages/domain/`、`packages/fixtures/`、`README.md`。
    - 実装: rootを`private: true`のnpm workspacesにし、React、TypeScript、Vite、Tailwind CSS、React Router、Express、Zod、AWS SDK v3のBedrock Runtime・Bedrock control plane・STS、Vitest、RTL、Supertest、fast-checkを固定する。既存`.git/`、Git履歴、`.kiro/`、spec設定、未関連ファイルを削除・移動・再作成しない。
    - 実装: webとAPIの最小entry、各packageの公開entry、終了する`lint`・`typecheck`・`test`・`build` scriptを作る。READMEは旧内容を残さず、本プロジェクトの目的、2022年過去選挙、ローカル限定、現時点の`NOT_READY`を記すところから更新を開始する。
    - テスト/検証: workspace解決、project references、最小health component/handler、lockfile再現性を自動テストし、`npm ci && npm run lint && npm run typecheck && npm test && npm run build`をwatchなしで成功させる。
    - 完了条件: 新しい作業用copyでも単一lockfileから全workspaceが復元され、既存Git/spec資産の保護を検査するstatic testが成功する。
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.12_

  - [x] 1.2 共通test harnessと外部通信禁止の通常test環境を実装する
    - 主な変更領域: root Vitest/ESLint設定、`packages/*/src/test/`、`apps/web/src/test/`、`apps/api/src/test/`。
    - 実装: RTL renderer、Supertest app factory、temporary directory helper、fake clock/ID source、fast-check共通設定を作る。PBTの既定`numRuns`を100以上にし、失敗時のseedとcounterexampleを保持する。
    - 実装: 通常testでは未stubの`fetch`、XHR、WebSocket、`sendBeacon`、AWS client送信をfail-fastにし、Supertestのin-process requestと明示fakeだけを許可する。利用者の`data/real`を読まず、一時directoryだけをfilesystem testに使う。
    - テスト/検証: guard自体の成功・失敗例と各workspaceのsmoke testを追加し、`npm test -- packages apps`と`npm run typecheck`を終了させる。
    - 完了条件: 通常suiteがAWS実要求、外部HTTP、watch mode、利用者raw資料なしで決定的に完了する。
    - _Requirements: 17.13, 17.14, 17.15, 17.16_

- [ ] 2. security境界、保存領域、data kind分離を実装する
  - [x] 2.1 gitignore済み実データ領域と秘密を含まない環境設定例を作成する
    - 主な変更領域: `.gitignore`、`.env.example`、`data/real/.gitkeep`方針、`apps/api/src/config/paths.ts`、static test。
    - 実装: `data/real/**`、temporary artifact、run、approval、evaluation、raw sourceをGit追跡から除外し、必要なら空directory markerだけを明示的に例外化する。fixtureは`packages/fixtures`だけへ置き、実データpathと重複させない。
    - 実装: `.env.example`へ`AWS_PROFILE=default`、`AWS_REGION=ap-northeast-1`、3用途model ID、`BEDROCK_CROSS_REGION=false`だけを秘密値なしで記載する。環境ファイルへcredential値を書く欄を設けない。
    - テスト/検証: `git check-ignore`相当のNode static testと環境schema testを`npm test -- apps/api/src/config packages/fixtures`で実行する。
    - 完了条件: real raw/派生成果物が追跡候補にならず、fixture path、実data path、秘密なし設定例が機械的に区別される。
    - _Requirements: 4.4, 4.12, 4.13, 14.1, 14.2, 14.3, 14.4, 14.10, 14.11, 17.5, 17.6_

  - [x] 2.2 REAL_AI/FIXTUREの型・tag・保存root排他性を実装する
    - 主な変更領域: `packages/contracts/src/data-kind.ts`、`packages/domain/src/data-kind/validateDataBoundary.ts`、arbitrary/property test。
    - 実装: `REAL_AI`と`FIXTURE`を別Zod schema・別TypeScript型にし、tag欠落、未知値、複数tag、保存root不一致、画面またはrun内混在を成功型へcastできない境界を作る。
    - **Property 8: data kindと保存rootの排他性**
    - テスト/検証: valid recordと1-field mutation、混合集合、path不一致をfast-checkで100 runs以上生成し、違反時の保存・解析・索引・表示件数が0で安全なfield pathだけを返すことを`npm test -- packages/domain/src/data-kind`で確認する。
    - 完了条件: fixture packageを実run composition rootからimportできないcompile/static testを含め、全違反がfail closedになる。
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 4.6, 4.9, 4.10, 4.12**

  - [x] 2.3 loopback限定API、Host/Origin検査、mutation nonceを実装する
    - 主な変更領域: `apps/api/src/server/`、`apps/api/src/middleware/localBoundary.ts`、`apps/api/src/routes/session.ts`、Supertest integration test。
    - 実装: APIを`127.0.0.1:8787`だけへbind可能にし、`0.0.0.0`、LAN address、public tunnel設定を拒否する。Hostとdevelopment/preview Originのallowlist、JSON Content-Type、method allowlist、1 MiB body上限を適用する。
    - 実装: 起動ごとの暗号学的nonceをmemoryだけに保持し、mutationへ`X-Ehime-Local-Nonce`を要求する。Originなしrequestはtest environmentのin-process testだけで許可し、nonceをlog・永続化しない。
    - テスト/検証: Host、Origin、nonce、Content-Type、body sizeを1条件ずつ欠くSupertestを追加し、拒否時のuse case call数0を`npm test -- apps/api/src/server apps/api/src/middleware`で確認する。
    - 完了条件: browserからAWSへ直接送るrouteがなく、一般公開endpoint数0という起動設定を自動検査できる。
    - _Requirements: 1.7, 1.8, 14.7, 14.8, 14.10, 17.2, 20.1_

  - [x] 2.4 credential・保護対象入力のrecursive redactionを実装する
    - 主な変更領域: `packages/domain/src/security/redact.ts`、`apps/api/src/logging/safeLogger.ts`、response projection test。
    - 実装: key名と値patternの両方でAWS access key、secret、session token、住所、座標、質問本文を検出し、API DTO、URL、画面、log、run history、永続storeへ元値を渡さない。検出済みcredential形式は外部送信前に破棄する。
    - **Property 34: 秘密情報と保護対象入力の非流出**
    - テスト/検証: 任意に入れ子にしたobjectへ禁止値を挿入するfast-checkを100 runs以上実行し、serialize後の全sinkとerror messageに元値がないことを`npm test -- packages/domain/src/security apps/api/src/logging`で検査する。
    - 完了条件: redaction後DTOをstrict response schemaで再decodeし、decode不能時は固定の安全なerrorへ置換する。
    - **Validates: Requirements 14.11, 15.14, 19.9, 20.8, 20.12, 20.13**

  - [ ] 2.5 配布bundleをfail-closedで検査する終了scriptを実装する
    - 主な変更領域: `scripts/bundle-check.ts`、`packages/domain/src/bundle/validateBundle.ts`、`config/`、fixture/property test。
    - 実装: tracked fileと配布候補を列挙し、data kind不明、保存root違反、`data/real`、`UNKNOWN`/`RESTRICTED` raw、秘密形式を検出したらbundle生成を止める。原資料の非収録理由と別途配置手順をREADME参照として結果へ含める。
    - **Property 9: 配布bundleのfail-closed検査**
    - テスト/検証: valid entry集合と各違反を含む集合をfast-checkで100 runs以上生成し、禁止資料0件の場合だけ成功することを`npm test -- packages/domain/src/bundle scripts`と`npm run bundle:check`で確認する。
    - 完了条件: checkerは入力を削除・移動せず、違反pathと理由を安全に表示して有限時間で終了する。
    - **Validates: Requirements 4.13, 4.14, 4.15, 4.16, 26.4, 26.5**

- [x] 3. 共通contract、domain基盤、atomic local storeを実装する
  - [x] 3.1 現行designの全model、DTO、Result、strict Zod schemaを定義する
    - 主な変更領域: `packages/contracts/src/models/`、`packages/contracts/src/api/`、`packages/domain/src/result.ts`。
    - 実装: Election、Candidate、SourceManifestRecord、Locator、ExtractedSegment、PolicyUnit、RetrievalHit、StructuredPolicy、検証、AiArtifact、承認、AnalysisRun、評価、P0、API success/error envelopeを設計どおりに表現する。未知keyを拒否し、nullable値と欠落を区別する。
    - 実装: branded ID、lowercase SHA-256、ISO date/instant、固定列挙、7段階tuple、safe error codeを一つの契約packageに集約し、domainからReact、Express、filesystem、AWS SDKへの依存を禁止する。
    - テスト/検証: 有効例、全required field欠落、extra key、enum外、invalid日時、invalid hashのschema testを`npm test -- packages/contracts`と`npm run typecheck`で実行する。
    - 完了条件: apps/webとapps/apiが同じruntime contractをimportし、独自の重複DTOを持たない。
    - _Requirements: 3.1, 4.1, 5.14, 6.1, 6.2, 6.3, 7.10, 8.11, 9.1, 10.1, 15.3, 16.2, 17.20_

  - [x] 3.2 canonical JSON、content hash、atomic file primitiveを実装する
    - 主な変更領域: `packages/domain/src/serialization/`、`apps/api/src/store/atomicFiles.ts`、filesystem integration test。
    - 実装: UTF-8・LF・固定key順のcanonical JSON formatter、Node標準SHA-256、content-addressed pathを実装する。temporary write、file sync、close、未存在finalへのrename/`wx`、commit markerを共通primitiveにする。
    - 実装: absolute path、`..`、symbolic linkによるroot外参照、既存immutable fileの上書きを拒否する。失敗時はfinal/commit markerを作らず、利用者の既存fileを削除しない。
    - テスト/検証: temporary directoryでwrite、sync、rename、hash、既存file、path traversalのfault injectionを`npm test -- packages/domain/src/serialization apps/api/src/store/atomicFiles`で実行する。
    - 完了条件: 同じdomain値が同じbyte/hashになり、中断時のpartial fileがreader対象にならない。
    - _Requirements: 3.6, 3.7, 3.8, 5.16, 10.10, 15.1, 15.3_

  - [x] 3.3 immutable event-based run storeと起動時検査を実装する
    - 主な変更領域: `apps/api/src/store/runEventStore.ts`、`packages/domain/src/runs/foldRunEvents.ts`、filesystem integration test。
    - 実装: `events/000001.json`形式の連番eventをatomic追加し、run viewをeventから再構築できるようにする。欠番、不正hash、重複sequence、commit markerなし、stale temporaryを隔離し、推測修復しない。
    - 実装: index directoryは全file検査後に`COMMITTED.json`を最後に作り、readerはmarkerなしindexを無視する。store APIはin-place更新とdeleteを公開しない。
    - テスト/検証: 正常fold、各破損、process中断fixture、同時append競合を一時directoryで`npm test -- apps/api/src/store/runEventStore packages/domain/src/runs/foldRunEvents`により確認する。
    - 完了条件: committed eventだけから同じrun状態を再構築でき、破損時は安全な診断を返す。
    - _Requirements: 11.4, 11.5, 11.8, 11.9, 15.1, 15.3, 15.7_

  - [x] 3.4 REAL_AI/FIXTUREに共通のdata provider画面契約を実装する
    - 主な変更領域: `packages/contracts/src/provider/`、`packages/domain/src/provider/decodeProviderResult.ts`、`packages/fixtures/src/provider/`、property test。
    - 実装: request、success、no-data、no-results、failure、data kindをdiscriminated unionにし、REAL_AIとFIXTUREの入口schemaを別に保つ。同じ意味のresponseを同じ画面modelへ投影し、違反payloadを補完しない。
    - **Property 40: data provider契約とUI構造の同型性**
    - テスト/検証: 同値なREAL_AI/FIXTURE responseと1-field契約違反をfast-checkで100 runs以上生成し、route・表示項目・操作・状態がlabel以外同型で、違反時の保存・表示が0件になることを`npm test -- packages/domain/src/provider packages/fixtures/src/provider`で確認する。
    - 完了条件: fixture providerはtest/dev compositionだけで利用でき、会場閲覧の通常providerへ暗黙fallbackしない。
    - **Validates: Requirements 17.19, 17.20, 17.21, 17.22**

- [ ] 4. 対象選挙、Source Manifest、採用規則、readinessを実装する
  - [ ] 4.1 対象選挙registry、候補者alias、別選挙source排除を実装する
    - 主な変更領域: `config/election/`、`config/sources/official-election.json`、`packages/domain/src/election/registry.ts`、property test。
    - 実装: `ehime-governor-2022-20`、選挙名、2022-11-20、中村時広氏・林紀子氏の安定IDと確認sourceを登録し、「林のりこ」を林紀子氏だけへ関連付ける。2026年第21回特設site、現在政策、対象不明・不一致sourceをdeny分類する。
    - **Property 4: 候補者aliasと別選挙sourceの排除**
    - テスト/検証: alias/source metadata集合をfast-checkで100 runs以上生成し、複数解決・対象外・対象不明が解析、索引、表示へ0件となることを`npm test -- packages/domain/src/election/registry`で確認する。
    - 完了条件: official metadataは政策本文の代替として採用されず、source表記とcanonical nameを別fieldで保持する。
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12**

  - [ ] 4.2 対象選挙変更proposalとactive election cardinalityを実装する
    - 主な変更領域: `packages/domain/src/election/changeElection.ts`、`apps/api/src/routes/analyst/election.ts`、property/API test。
    - 実装: 変更前後のID・名称・理由・期限を提示するproposal、approve/reject、0/1/複数activeのfail-closed state machineを作る。pending/rejectで設定を書き換えず、approve時だけ提示済み値をatomic保存する。
    - **Property 3: 対象選挙変更の承認state machine**
    - テスト/検証: proposalと任意操作列をfast-checkで100 runs以上生成し、未承認保持、拒否保持、承認値限定、0/複数時の全データ非表示を`npm test -- packages/domain/src/election/changeElection apps/api/src/routes/analyst/election`で確認する。
    - 完了条件: P0対象変更を暗黙実行する設定pathがなく、mutationはlocal nonce境界を通る。
    - **Validates: Requirements 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19**

  - [ ] 4.3 公式届出順と暫定順だけを使う候補者順序serviceを実装する
    - 主な変更領域: `config/election/candidate-order.json`、`packages/domain/src/candidates/orderCandidates.ts`、property test。
    - 実装: election/checksumが有効で相互一致する公式届出順を優先し、それ以外は理由付きのtracked暫定順を使う。得票数、資料量、AI出力をsort inputから除外する。
    - **Property 29: 候補者順の根拠限定と無関係field不変性**
    - テスト/検証: official sourceの0/1/複数・不一致と候補者の非順序field mutationをfast-checkで100 runs以上生成し、一覧と比較が同じ順になることを`npm test -- packages/domain/src/candidates/orderCandidates`で確認する。
    - 完了条件: fallback時に「公式届出順未確認」、暫定順、理由を返し、公式順と誤表示しない。
    - **Validates: Requirements 12.9, 12.10, 12.11, 12.12, 12.13, 13.14, 13.15**

  - [ ] 4.4 Source Manifestのstrict schema、登録API、CLIを実装する
    - 主な変更領域: `packages/contracts/src/source-manifest.ts`、`packages/domain/src/sources/validateManifest.ts`、`apps/api/src/routes/analyst/sources.ts`、`scripts/source-check.ts`、property test。
    - 実装: 全必須項目、`sourceId + revision`複合一意性、実在日付、`retrievedAt >= publishedAt`、利用条件4点、採否理由、OCR reviewを検査する。local referenceは`data/real/raw`配下だけに制限し、既存revisionを上書きしない。
    - **Property 5: Source Manifestの完全性**
    - テスト/検証: valid record集合と各field/date/uniqueness mutationをfast-checkで100 runs以上生成し、API/CLIが同じdomain resultを返すことを`npm test -- packages/domain/src/sources apps/api/src/routes/analyst/sources scripts/source-check`で確認する。
    - 完了条件: 不適合recordは保存されず、field pathと安全な理由を返し、raw uploadやlive URL再取得を行わない。
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.9**

  - [ ] 4.5 source byteのSHA-256登録・再検査gateを実装する
    - 主な変更領域: `packages/domain/src/sources/checksum.ts`、`apps/api/src/sources/verifiedSourceBytes.ts`、property/filesystem test。
    - 実装: raw file全byteをstreaming SHA-256へ渡し、64文字lowercase hexを登録・再検査する。reference解決、現在byte一致を抽出前に要求し、不一致時のextractor callを0回にする。
    - **Property 6: source checksumのbyte同一性**
    - テスト/検証: 任意byte列と1 byte mutationをfast-checkで100 runs以上生成し、Node標準実装との一致、表記、版不一致を`npm test -- packages/domain/src/sources/checksum apps/api/src/sources`で確認する。
    - 完了条件: URL sourceもchecksum済みlocal snapshotだけを読み、run中にremote URLへアクセスしない。
    - **Validates: Requirements 3.6, 3.7, 3.8, 5.3, 5.4, 5.5**

  - [ ] 4.6 共通資料採用規則と両候補readiness evaluatorを実装する
    - 主な変更領域: `config/source-adoption/policy-v1.json`、`packages/domain/src/readiness/evaluateReadiness.ts`、`scripts/source-check.ts`、property test。
    - 実装: 許可資料種別、発行期間、発行者、対象選挙対応、利用条件、両候補への同一規則、同等資料範囲を版管理する。現在byteから毎回評価し、候補者別/source別issueを返す。
    - **Property 7: 両候補READY gateの必要十分条件**
    - テスト/検証: 両候補のvalid/invalid source集合、片側欠落、別選挙、fixture、AI文をfast-checkで100 runs以上生成し、全条件成功時だけ`READY`になることを`npm test -- packages/domain/src/readiness`で検査する。実workspaceの`npm run source:check`は資料未配置時に`NOT_READY`と不足項目を返して終了する。
    - 完了条件: `NOT_READY`時はrun開始件数、通常要約件数、比較用data件数をすべて0件にし、自動fallbackを行わない。
    - **Validates: Requirements 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20**

- [ ] 5. AppShell、P0 route、標準画面状態、API clientを実装する
  - [x] 5.1 全画面shellとP0 route skeletonを結線する
    - 主な変更領域: `apps/web/src/app/`、`apps/web/src/shared/ui/AppShell.tsx`、router/route test。
    - 実装: `/`、`/schedule`、`/candidates`、`/candidates/:candidateId`、`/comparison`、`/sources`、`/venue`と全analyst route、404を登録する。未実装pageは契約上の`no-data`または`not-ready`を表示し、成功を装う疑似進捗や壊れた操作を置かない。
    - 実装: skip link、landmark、一意なh1、戻る、nav、「会場ローカルデモ・一般公開ではありません」、過去選挙、排他的data kind labelを404を含む全routeへ表示する。P1/P2 routeを登録しない。
    - テスト/検証: memory routerで全P0 path、直接entry、戻る1回、404、banner継続、P1/P2 pathが404になることを`npm test -- apps/web/src/app`で確認する。
    - 完了条件: Homeから実装済みP0画面だけへ到達でき、一般公開や現在の投票案内と誤認させない。
    - _Requirements: 1.7, 1.8, 1.10, 1.11, 2.2, 2.3, 2.4, 18.2, 18.3, 18.4, 18.6, 19.1, 19.2, 19.3, 19.14, 19.18_

  - [ ] 5.2 非同期画面状態と10秒timeout reducerを実装する
    - 主な変更領域: `apps/web/src/shared/state/asyncViewState.ts`、`apps/web/src/shared/hooks/useBoundedQuery.ts`、property test。
    - 実装: loadingと8 terminal状態を排他的にし、request ID、AbortController、10秒timeout、stale response無視、直前確定dataと秘密形式を含まない入力の保持を実装する。retry表示はserverのallowed/remainingだけを使う。
    - **Property 42: 非同期画面状態の排他性**
    - テスト/検証: 任意event列、stale ID、timeout、retry policyをfast-checkとfake timerで100 runs以上検査し、loading中terminal 0件、終了後terminal 1件となることを`npm test -- apps/web/src/shared/state apps/web/src/shared/hooks/useBoundedQuery`で確認する。
    - 完了条件: run全体には10秒timeoutを適用せず、個々のpoll requestだけへ適用できる契約を分離する。
    - **Validates: Requirements 19.4, 19.5, 19.6, 19.9, 19.10, 19.11, 19.12, 19.13**

  - [ ] 5.3 strict API clientとdata provider compositionを実装する
    - 主な変更領域: `apps/web/src/api/`、`apps/web/src/providers/DataProvider.tsx`、contract/integration test。
    - 実装: success/error envelopeをZod decodeし、未知field・契約違反・data kind混在を表示前に拒否する。raw local path、credential、AWS SDKをweb型とbundleから除外し、mutation時だけsession nonceを付ける。
    - 実装: REAL_AIを通常provider、FIXTUREをtest/dev専用providerとして明示選択し、片方の失敗時に他方へfallbackしない。request ID、timeout、abortを5.2のstateへ接続する。
    - テスト/検証: mock HTTP transportでsuccess、各terminal、malformed payload、nonce付与、fallback 0回を`npm test -- apps/web/src/api apps/web/src/providers`で確認する。
    - 完了条件: webはHTTP DTOだけを扱い、filesystem・AWS SDK・domain内部storeをimportしない。
    - _Requirements: 4.7, 4.8, 4.10, 17.2, 17.19, 17.20, 17.21, 17.22, 19.4, 19.5_

  - [ ] 5.4 標準状態、出典、根拠、状態badge、比較scrollの共通componentを実装する
    - 主な変更領域: `apps/web/src/shared/ui/StatePanel.tsx`、`AsyncContent.tsx`、`SourceCitation.tsx`、`EvidencePanel.tsx`、status badge、`ScrollableComparisonRegion.tsx`。
    - 実装: loading、data未取得、検索結果なし、権限拒否、未対応、失敗、対象選挙未設定、解析準備未完了を固定文言と次操作で区別する。出典、公開日、取得日、revision、利用条件、locator、AI非保証案内を共通表示する。
    - 実装: AI文・原文をtext nodeで描画し、`dangerouslySetInnerHTML`を禁止する。外部linkはhttps/host allowlistと`noopener noreferrer`を要求し、比較領域だけ独立横scroll・label・focusを持たせる。
    - テスト/検証: 全variant、XSS文字列、safe link、根拠focus、badgeの非色依存、44×44px class contractを`npm test -- apps/web/src/shared/ui`で確認する。
    - 完了条件: 360pxで比較領域以外の横overflowを作らないcomponent contractが成立する。
    - _Requirements: 8.12, 9.19, 11.6, 11.8, 11.12, 11.13, 13.5, 13.16, 13.17, 19.7, 19.8, 19.9, 19.15, 19.16, 26.1, 26.2, 26.3_

- [ ] 6. Checkpoint - 基盤の終了する自動検査を実行する
  - Ensure all tests pass, ask the user if questions arise.
  - `npm run lint && npm run typecheck && npm test && npm run build && npm run bundle:check`をwatchなしで実行し、失敗した基盤コードだけを修正する。

- [ ] 7. AWS設定、read-only診断、Bedrock port/adapterを実装する
  - [x] 7.1 AWS既定値、3用途model ID、cross-Region拒否を実装する
    - 主な変更領域: `apps/api/src/config/aws.ts`、`packages/contracts/src/aws-config.ts`、property test。
    - 実装: profile未設定を`default`、region未設定を`ap-northeast-1`、cross-Regionをfalseにする。生成・意味判定・埋め込みmodel IDのnon-emptyを全Bedrock call前に検査し、inference profile形式を拒否する。
    - **Property 32: AWS既定設定とmodel設定の事前検査**
    - テスト/検証: 任意の環境変数組合せをfast-checkで100 runs以上生成し、model欠落時に全adapter call数0と不足名を返すことを`npm test -- apps/api/src/config/aws`で確認する。
    - 完了条件: web buildへprofile、region、credential provider、環境値を注入しない。
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6**

  - [ ] 7.2 東京以外のRegion proposalをprocess内承認に限定する
    - 主な変更領域: `packages/domain/src/aws/regionApproval.ts`、`apps/api/src/aws/currentRegion.ts`、analyst API test。
    - 実装: 東京以外の環境値へ直結せず、送信先、対象data、変更範囲、有効期間を提示するproposalを作る。pending/rejectでは東京、approveでは提示済みRegionを現在process memoryだけで使い、再起動で失効させる。
    - **Property 33: AWSリージョン変更のprocess内限定**
    - テスト/検証: proposalと操作列、新process生成をfast-checkで100 runs以上検査し、暗黙fallbackと永続設定変更が0回であることを`npm test -- packages/domain/src/aws/regionApproval apps/api/src/aws/currentRegion`で確認する。
    - 完了条件: 承認APIはnonce境界を通り、承認済み対象以外のRegion/modelへ送信しない。
    - **Validates: Requirements 14.17, 14.18, 14.19, 14.20, 14.21**

  - [ ] 7.3 default credential chainとread-only AWS診断を実装する
    - 主な変更領域: `apps/api/src/aws/diagnostic.ts`、`scripts/diagnose-aws.ts`、analyst diagnostic route、fake client test。
    - 実装: AWS SDK default credential provider chain、STS `GetCallerIdentity`、Bedrock control planeのList/Getだけをbounded回数呼ぶ。推論、埋め込み、資料・設定・承認変更を行わない。
    - 実装: principalは種別、account末尾4桁、ARN hash prefixだけへ縮退し、3用途modelの東京catalog可否を返す。credential解決不能、権限拒否、model不明を安全なcodeへ分ける。
    - テスト/検証: fake clientsでoperation allowlist、call上限、秘密非表示を`npm test -- apps/api/src/aws/diagnostic scripts/diagnose-aws`で確認し、`npm run diagnose:aws`が成功または安全な`CREDENTIALS_MISSING`を返して必ず終了することを確認する。
    - 完了条件: AWS CLIやcredential fileを探索・読取・変更せず、診断結果をrun証跡の代わりにしない。
    - _Requirements: 14.9, 14.12, 14.13, 14.14, 14.15, 14.16, 14.22, 17.7, 17.8_

  - [x] 7.4 生成・意味判定・埋め込みportとBedrock/fake adapterを実装する
    - 主な変更領域: `packages/domain/src/ports/bedrock.ts`、`apps/api/src/aws/adapters/`、fake adapter contract suite。
    - 実装: GenerationPort、SemanticVerificationPort、EmbeddingPortを分離し、生成/意味判定はnon-streaming Converse、埋め込みはmodel固有InvokeModel codecへ閉じ込める。AWS clientは`maxAttempts: 1`にする。
    - 実装: model ID、request ID、usage、dimensionを正規化し、raw model body、prompt、credentialをdomain error/logへ渡さない。generationとsemantic verificationは別adapter instance・別prompt・別request IDを要求する。
    - テスト/検証: fake SDKでrequest projection、response codec、dimension不一致、usageなし、各AWS errorを`npm test -- apps/api/src/aws/adapters packages/domain/src/ports`で確認する。
    - 完了条件: browser direct AWS callと別AI providerが0件で、通常testはfake adapterだけを使う。
    - _Requirements: 7.5, 8.1, 9.11, 14.7, 14.8, 15.5, 17.15_

  - [ ] 7.5 明示flag付きで3用途各1件だけ実行するBedrock smoke commandを実装する
    - 主な変更領域: `scripts/test-bedrock.ts`、smoke fixture、fake command test、root script。
    - 実装: `RUN_BEDROCK_SMOKE=1`、東京Region、cross-Region false、3 model IDがそろう場合だけ、架空の短い入力でgeneration、semantic verification、embeddingを各1要求実行する。出力本文やcredentialをGit追跡物へ保存しない。
    - 実装: flagなし、設定不足、credentialなし、model利用不可では推論0回で安全に終了する。東京失敗時に別Regionへfallbackしない。
    - テスト/検証: fake adapterでcall数が用途ごとに0または1、verification request IDがgenerationと異なることを`npm test -- scripts/test-bedrock`で確認する。実`npm run test:bedrock`はflagなしで外部要求0件のまま終了する。
    - 完了条件: 外部前提が整った場合だけユーザーが`$env:RUN_BEDROCK_SMOKE='1'; npm run test:bedrock`を単発実行できる。
    - _Requirements: 17.11, 17.15, 17.16, 27.4, 27.5, 27.13, 27.17_

- [ ] 8. locator付き取り込みとPolicyUnit来歴を実装する
  - [ ] 8.1 PDF・HTML・UTF-8 text extractorと決定的locatorを実装する
    - 主な変更領域: `apps/api/src/extractors/`、`packages/domain/src/extraction/locator.ts`、配布可能fixture/property test。
    - 実装: PDF text layerを1始まりpage、HTML本文を見出し階層とsection内1始まり段落、UTF-8 textを1始まり開始・終了行へ抽出する。script/style/navigationを除き、BOMを許容し、不正UTF-8を拒否する。
    - **Property 10: media type別locatorの再現性**
    - テスト/検証: page列、heading tree、Unicode行列をfast-checkで100 runs以上生成し、同じ入力から同じlocator/textを返すことを`npm test -- apps/api/src/extractors packages/domain/src/extraction/locator`で確認する。
    - 完了条件: 対応形式以外を受理せず、実政策や実候補者をfixtureへ含めない。
    - **Validates: Requirements 5.1, 5.6, 5.7, 5.8, 5.14**

  - [ ] 8.2 checksum gate、画像PDF、OCR derivative、抽出atomicityを実装する
    - 主な変更領域: `packages/domain/src/extraction/ingestionGate.ts`、`apps/api/src/extraction/commitExtraction.ts`、property/filesystem test。
    - 実装: 未登録・checksum不一致時はextractor 0回、画像PDFはOCR自動実行0回、decode不能・locator欠損・途中失敗はpartial commit 0件にする。OCR derivativeは新revisionと照合者ID・日時・原文一致を必須にする。
    - **Property 11: 抽出とOCRのfail-closed atomicity**
    - テスト/検証: 各失敗条件、fault injection、人間照合recordの有無をfast-checkと一時filesystemで100 runs以上検査し、committed artifact件数を`npm test -- packages/domain/src/extraction/ingestionGate apps/api/src/extraction/commitExtraction`で確認する。
    - 完了条件: 失敗理由とOCR代替手順を返すが、推測text・部分text・元revision上書きを行わない。
    - **Validates: Requirements 5.2, 5.5, 5.9, 5.10, 5.11, 5.12, 5.13, 5.15, 5.16**

  - [ ] 8.3 PolicyUnit segmenterとprovenance検査を実装する
    - 主な変更領域: `packages/domain/src/policy-units/segment.ts`、`validatePolicyUnit.ts`、property test。
    - 実装: 見出し、段落、箇条書き、必要時の句点境界で決定的に分割し、locatorをまたぐunitを作らない。選挙、候補者、source、revision、checksum、locator、原文substring、segmenter版を保持する。
    - **Property 12: PolicyUnitの来歴保存と旧版排除**
    - テスト/検証: valid segment、1-field provenance mutation、current revision変更をfast-checkで100 runs以上生成し、欠損・不一致・旧版unitがindex/生成入力へ0件となることを`npm test -- packages/domain/src/policy-units`で確認する。
    - 完了条件: 原文は同locator segmentの連続substringで、別revisionの原文を代用しない。
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10**

  - [ ] 8.4 ingestion use case、保存adapter、分析APIを結線する
    - 主な変更領域: `apps/api/src/use-cases/ingestSource.ts`、artifact store、analyst source viewer route、integration test。
    - 実装: Source Manifest再検査、VerifiedSourceBytes、media adapter、temporary artifact、provenance検査、atomic commitを一つのuse caseへ結線する。source viewerは完全一致locatorの原文1件だけを返し、raw pathを返さない。
    - テスト/検証: PDF/HTML/text正常系、未登録、checksum mismatch、画像PDF、invalid UTF-8、commit failure、0/複数参照を一時directoryとSupertestで`npm test -- apps/api/src/use-cases/ingestSource apps/api/src/routes/analyst`により確認する。
    - 完了条件: use case失敗時にrunへ安全な`EXTRACTION_FAILED`を渡し、committed前段artifactを変更しない。
    - _Requirements: 5.2, 5.3, 5.4, 5.10, 5.14, 5.16, 6.8, 6.9, 11.18, 11.19_

- [ ] 9. filter-first最小Hybrid RAGを実装する
  - [ ] 9.1 日本語2/3-gram正規化とlocal BM25を実装する
    - 主な変更領域: `packages/domain/src/retrieval/normalize.ts`、`ngram.ts`、`bm25.ts`、unit test。
    - 実装: Unicode NFKC、whitespace集約、Latin lowercaseを検索用copyだけへ適用し、2/3-gram multisetとBM25 `k1=1.2`, `b=0.75`を有限値で計算する。原文・引用は変更しない。
    - テスト/検証: 日本語、Latin、空白、surrogate、空query、score tie、finite境界をreference implementationと比較し、`npm test -- packages/domain/src/retrieval/normalize packages/domain/src/retrieval/bm25`を実行する。
    - 完了条件: normalizer、n-gram幅、BM25係数をversioned retrieval configへ固定し、同じcorpus/queryで同じscoreを返す。
    - _Requirements: 7.2, 7.5, 7.6, 7.12, 7.13_

  - [ ] 9.2 検索filterと両channel共通集合を実装する
    - 主な変更領域: `packages/domain/src/retrieval/filterFirst.ts`、retrieval config schema、property test。
    - 実装: electionId、candidateId、revision、来歴完全性をscore計算前に一度だけ適用し、keywordとembedding/cosineへ同じPolicyUnit key集合を渡す。filter/config必須値欠落時は両channel 0回にする。
    - **Property 13: Hybrid RAGのfilter-first共通集合**
    - テスト/検証: 任意PolicyUnit、filter、設定欠落、provenance mutationをfast-checkで100 runs以上生成し、両channel input集合と生成hitがpredicateに一致することを`npm test -- packages/domain/src/retrieval/filterFirst`で確認する。
    - 完了条件: 候補者・revisionをchannel別に補正せず、不足field名を安全に返す。
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.9**

  - [ ] 9.3 Bedrock embedding indexとlocal cosine計算を実装する
    - 主な変更領域: `apps/api/src/retrieval/buildEmbeddingIndex.ts`、`packages/domain/src/retrieval/cosine.ts`、index store/integration test。
    - 実装: filter済みunit本文をEmbeddingPortへ送り、vector、dimension、model ID、input hashをimmutable indexへ保存する。query vectorとのcosineをlocal計算し、NaN/Infinity、zero vector、dimension不一致を拒否する。
    - テスト/検証: fake embedding、既存index再利用、commit marker欠落、dimension/error、cosine reference例を`npm test -- apps/api/src/retrieval packages/domain/src/retrieval/cosine`で確認する。
    - 完了条件: PBTや通常testからAWSを呼ばず、OpenSearch package・client・endpointを追加しない。
    - _Requirements: 7.5, 7.10, 7.12, 7.13, 7.14, 17.15_

  - [ ] 9.4 threshold、重複排除、RRF、tie-break順位を実装する
    - 主な変更領域: `packages/domain/src/retrieval/fuseResults.ts`、property test。
    - 実装: keyword/cosine thresholdと境界採否を設定どおり適用し、同じPolicyUnit keyを1件へ統合する。RRF定数60、keyword/cosineの欠損順、key昇順で1始まり欠番なしの最終順位を返す。
    - **Property 14: threshold、重複排除、RRF順位の決定性**
    - テスト/検証: threshold直下/同値/直上、duplicate key、全score tie、任意入力順をfast-checkで100 runs以上生成し、reference sortと再実行同一性を`npm test -- packages/domain/src/retrieval/fuseResults`で確認する。
    - 完了条件: resultへsourceId、revision、checksum、locator、両score、最終順位、設定hashを保持する。
    - **Validates: Requirements 7.6, 7.7, 7.8, 7.10, 7.12**

  - [ ] 9.5 RetrievalServiceと根拠0件時の生成停止を実装する
    - 主な変更領域: `packages/domain/src/retrieval/retrieve.ts`、`apps/api/src/use-cases/retrieveEvidence.ts`、property/integration test。
    - 実装: filter-first、BM25、embedding/cosine、RRF、topKを結線し、threshold通過hitが0件なら`EVIDENCE_INSUFFICIENT`を返してGenerationPortを呼ばない。
    - **Property 15: 根拠0件では生成0回**
    - テスト/検証: 0 hitになるquery/config/corpusをfast-checkで100 runs以上生成し、生成spy 0回と分類を`npm test -- packages/domain/src/retrieval/retrieve apps/api/src/use-cases/retrieveEvidence`で確認する。正常integrationでは両channelが同じkeyを使うことも検査する。
    - 完了条件: 検索はlocalで完結し、OpenSearch importとnetwork callが0件である。
    - **Validates: Requirements 7.9, 7.11, 7.13, 7.14**

- [ ] 10. strict構造化抽出、JSON往復、初心者向け要約を実装する
  - [ ] 10.1 StructuredPolicyのJSON Schemaとstrict parserを実装する
    - 主な変更領域: `packages/contracts/src/structured-policy.ts`、export済みJSON Schema、property test。
    - 実装: 9 required key、型、enum、nullability、`additionalProperties: false`をZodとJSON Schemaで一致させる。response全文が単一JSON objectの場合だけparseし、fenceや前後説明を切り出さない。
    - **Property 16: StructuredPolicy strict schema**
    - テスト/検証: valid値、各required欠落、extra key、型違い、文字列`null`、invalid locatorをfast-checkで100 runs以上生成し、受理条件を`npm test -- packages/contracts/src/structured-policy`で確認する。
    - 完了条件: 構文不正を`INVALID_MODEL_JSON`、schema不適合をfield path付き`MODEL_SCHEMA_INVALID`へ区別できる。
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8**

  - [ ] 10.2 StructuredPolicyの標準formatter/parser往復を実装する
    - 主な変更領域: `packages/domain/src/generation/structuredPolicyJson.ts`、property test。
    - 実装: 9 keyを固定順でcanonical JSONへ変換し、strict parserで再解析する。配列順、null、negation object、locator unionを変更しない。
    - **Property 17: StructuredPolicy JSON往復**
    - テスト/検証: 全fieldのnull/non-null、各locator、Unicode文字列をfast-checkで100 runs以上生成し、`parse(format(value))`のdeep equalityとextra key 0件を`npm test -- packages/domain/src/generation/structuredPolicyJson`で確認する。
    - 完了条件: formatter出力が公開JSON Schemaにも適合し、入力objectをmutationしない。
    - **Validates: Requirements 8.13, 8.14, 17.14**

  - [ ] 10.3 grounded構造化抽出とJSON修正1回のorchestrationを実装する
    - 主な変更領域: `config/prompts/extraction/`、`packages/domain/src/generation/extractPolicy.ts`、`apps/api/src/use-cases/generateStructuredPolicy.ts`、fake adapter test。
    - 実装: readiness `READY`かつ検索hitがある場合だけ、根拠とprovenanceをGenerationPortへ送る。JSON構文不正時だけ同じ根拠/model/prompt系列で修正要求を最大1回行い、schema不適合はretryしない。
    - 実装: evidenceQuote/locatorを同じ選挙・候補者・source・revision・checksumのhitへ一意解決し、引用substring不一致なら保存・summary・表示を0件にする。model responseはuntrusted delimiterと長さ上限で扱う。
    - テスト/検証: 正常、構文不正→修正成功、2回不正、schema不正、別source、0/複数locatorをfake portで`npm test -- packages/domain/src/generation/extractPolicy apps/api/src/use-cases/generateStructuredPolicy`により確認する。
    - 完了条件: raw response/prompt本文をerror・logへ保存せず、修正要求上限を実行履歴へ記録できる。
    - _Requirements: 8.1, 8.5, 8.6, 8.7, 8.8, 15.10, 15.11_

  - [ ] 10.4 初心者向け要約とPENDING artifact生成を実装する
    - 主な変更領域: `config/prompts/summary/`、`packages/domain/src/generation/createArtifact.ts`、`apps/api/src/use-cases/summarizePolicy.ts`、property test。
    - 実装: valid StructuredPolicyだけを要約portへ渡し、Unicode code point数1〜300を検査する。artifactへ全provenance、locator、run、prompt版、3 model ID、content hashを付け、humanStatusを必ず`PENDING`にする。
    - **Property 18: 有効生成artifactの長さ・来歴・初期状態**
    - テスト/検証: BMP/surrogateを含む0/1/300/301 code point要約と1-field provenance mutationをfast-checkで100 runs以上生成し、保存条件とmodel-only approval 0回を`npm test -- packages/domain/src/generation/createArtifact apps/api/src/use-cases/summarizePolicy`で確認する。
    - 完了条件: 長さ不適合は保存・表示0件で理由を記録し、valid artifactだけを後続検証へ渡す。
    - **Validates: Requirements 8.9, 8.10, 8.11, 8.15, 8.16**

- [ ] 11. 決定的検査、別Bedrock意味判定、自動状態、error/retryを実装する
  - [ ] 11.1 7項目の決定的検査を三値で実装する
    - 主な変更領域: `packages/domain/src/verification/deterministic/`、property test。
    - 実装: 引用実在、出典帰属、数字・日付、否定、条件と例外、実施段階、期限を独立checkとして実装する。一致は`PASS`、不一致は`FAIL`、入力不足・規則で判定不能は理由付き`UNVERIFIABLE`にする。
    - **Property 19: 決定的検査の三値判定**
    - テスト/検証: 各checkの一致、不一致、入力欠落、曖昧markerをfast-checkで100 runs以上生成し、各項目がちょうど1 outcomeを持つことを`npm test -- packages/domain/src/verification/deterministic`で確認する。
    - 完了条件: 各recordがartifact/check/input ID、安全な理由を保持し、別source/revisionのtextを参照しない。
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10**

  - [ ] 11.2 separate semantic verificationと三値response正規化を実装する
    - 主な変更領域: `config/prompts/semantic/`、`packages/domain/src/verification/semantic.ts`、`apps/api/src/use-cases/verifyMeaning.ts`、property/fake test。
    - 実装: 原文、引用、StructuredPolicy、要約を同じ比較入力へ含め、生成とは別model requestで意味変化、意味反転、原文にない追加を判定する。strict response不正、必要入力不足、request失敗は理由付き`UNDETERMINED`にする。
    - **Property 20: 意味判定responseの完全な三値化**
    - テスト/検証: valid/invalid responseとadapter failureをfast-checkで100 runs以上生成し、3項目がそれぞれ1値になること、generationとrequest IDが異なることを`npm test -- packages/domain/src/verification/semantic apps/api/src/use-cases/verifyMeaning`で確認する。
    - 完了条件: deterministic recordとsemantic recordを別artifactとして保存し、意味保持の完全保証と表示しない。
    - **Validates: Requirements 9.1, 9.11, 9.12, 9.13**

  - [ ] 11.3 FAIL・REVIEW・PASS優先順位と説明可能な自動状態を実装する
    - 主な変更領域: `packages/domain/src/verification/deriveAutomaticStatus.ts`、property test。
    - 実装: `FAIL/DETECTED`を最優先、次に根拠不足・曖昧・`UNVERIFIABLE/UNDETERMINED`、残りの全成功だけを`PASS`にする。入力ID、個別結果、理由、状態決定理由を保存modelへ返す。
    - **Property 21: 自動状態の優先順位と説明可能性**
    - テスト/検証: deterministic/semantic outcomeの全組合せと根拠十分性をfast-checkで100 runs以上生成し、reference truth tableとの一致を`npm test -- packages/domain/src/verification/deriveAutomaticStatus`で確認する。
    - 完了条件: 複数条件でも自動状態は1件で、`PASS`から人間`APPROVED`へ自動遷移しない。
    - **Validates: Requirements 9.14, 9.15, 9.16, 9.17, 9.18, 10.2**

  - [ ] 11.4 throttling・invalid JSON・非再試行errorの有限retry policyを実装する
    - 主な変更領域: `packages/domain/src/retry/retryPolicy.ts`、`apps/api/src/aws/boundedRetry.ts`、property/fake timer test。
    - 実装: throttlingは初回込み3送信以下、JSON修正は1回以下、credentials/access/model/extraction/evidence errorは自動retry 0回にする。bounded jitter delayを注入clock/randomで計算し、SDK内部retryと重複させない。
    - **Property 36: 有限retry上限**
    - テスト/検証: 任意error列をfast-checkで100 runs以上生成し、用途別送信回数、remaining、停止分類を`npm test -- packages/domain/src/retry apps/api/src/aws/boundedRetry`で確認する。
    - 完了条件: UIへ`allowed`と`remaining`を返し、HTTP statusだけからretry可否を推測させない。
    - **Validates: Requirements 15.8, 15.9, 15.10, 15.11, 15.12, 19.10, 19.11**

  - [ ] 11.5 adapter failureを7つの公開error分類へ安全に写像する
    - 主な変更領域: `apps/api/src/errors/mapExternalError.ts`、`packages/domain/src/errors/classifyFailure.ts`、property test。
    - 実装: credential、permission、model、throttling、JSON、extraction、evidence failureを対応する1分類へ写す。未知timeout/5xxをthrottlingへ偽装せず、transport/lifecycle codeをAnalysisRunの7分類へ混入させない。
    - **Property 54: error sourceから公開分類への全域写像**
    - テスト/検証: 既知failureと秘密を含むcauseをfast-checkで100 runs以上生成し、ちょうど1分類、安全な理由、秘密非流出を`npm test -- apps/api/src/errors packages/domain/src/errors/classifyFailure`で確認する。
    - 完了条件: API error、run stage、fixture error scenarioが同じcode体系を使い、raw exception/stackを表示しない。
    - **Validates: Requirements 11.9, 14.12, 14.13, 14.14, 15.7, 27.22**

- [ ] 12. single job queue、run API、段階state、再起動整合を実装する
  - [ ] 12.1 run ID生成とactive dedupeを実装する
    - 主な変更領域: `packages/domain/src/runs/createRun.ts`、`apps/api/src/runs/dedupeLock.ts`、property/filesystem test。
    - 実装: 既存と重複しないrun ID、source/revision/checksum/prompt/model/retrieval hashからのdedupe key、`QUEUED/RUNNING` lockを実装する。一意ID生成失敗または同じactive keyでは新runを作らない。
    - **Property 24: run IDとactive runの一意性**
    - テスト/検証: 既存ID/key集合、seeded ID source、同時lock競合をfast-checkと一時filesystemで100 runs以上検査し、作成件数を`npm test -- packages/domain/src/runs/createRun apps/api/src/runs/dedupeLock`で確認する。
    - 完了条件: duplicate時は既存run IDとstatus URLだけを返し、run created eventを二重保存しない。
    - **Validates: Requirements 11.4, 15.1, 15.2**

  - [ ] 12.2 固定順7段階のrun state machineを実装する
    - 主な変更領域: `packages/domain/src/runs/runStateMachine.ts`、property test。
    - 実装: ingestion、segmentation、retrieval、structured extraction、summary、deterministic verification、semantic verificationを固定ordinalで管理する。同時`RUNNING`最大1件、失敗段階`FAILED`、未開始後続`SKIPPED`、時刻順を強制する。
    - **Property 25: 7段階run state machine**
    - テスト/検証: 正当/不正event列と各ordinal失敗をfast-checkで100 runs以上生成し、固定順、RUNNING cardinality、後続SKIPPED、retry残数を`npm test -- packages/domain/src/runs/runStateMachine`で確認する。
    - 完了条件: completed stageの開始・終了・結果を保持し、途中生成物を成功runとして扱わない。
    - **Validates: Requirements 11.5, 11.7, 11.8, 11.9, 11.10**

  - [ ] 12.3 `POST /runs`とconcurrency 1のpipeline queueを結線する
    - 主な変更領域: `apps/api/src/runs/runQueue.ts`、`runWorker.ts`、`routes/analyst/runs.ts`、Supertest/integration test。
    - 実装: active election、readiness、選択1 revision、現在checksumを受付時に再検査し、成功時は`202`、runId、statusUrlを返す。workerは1 jobずつ7段階serviceを実行し、各transitionをimmutable eventとしてcommitする。
    - 実装: invalid選択、NOT_READY、duplicate、persistence failureでは外部callと新run作成を止める。段階失敗時はpartial artifactを公開候補へ渡さない。
    - テスト/検証: fake pipelineでqueue順、同時POST、0/1/2選択、NOT_READY、各段階失敗、worker concurrencyを`npm test -- apps/api/src/runs apps/api/src/routes/analyst/runs`で確認する。
    - 完了条件: 同一processで同時`RUNNING` jobが1件以下となり、API request threadで長時間処理しない。
    - _Requirements: 3.17, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 11.17_

  - [ ] 12.4 起動時run reconciliationとlock解放を実装する
    - 主な変更領域: `packages/domain/src/runs/reconcileInterruptedRuns.ts`、`apps/api/src/bootstrap/reconcileRuns.ts`、integration test。
    - 実装: 起動時の`RUNNING`をcurrent stage `FAILED`、後続`SKIPPED`、lifecycle `RUN_INTERRUPTED`へし、`QUEUED`を`CANCELLED_BEFORE_START`へする。event commit後にdedupe lockを解放し、自動再開しない。
    - テスト/検証: process中断前event、破損event、複数lock、reconciliation保存失敗を一時directoryで`npm test -- packages/domain/src/runs/reconcileInterruptedRuns apps/api/src/bootstrap/reconcileRuns`により確認する。
    - 完了条件: lifecycle codeを7つのAI error分類へ偽装せず、完了済み段階を暗黙再利用しない。
    - _Requirements: 11.7, 11.9, 15.7, 15.13_

  - [ ] 12.5 provenance link・run IDの一意解決とrun polling契約を実装する
    - 主な変更領域: `packages/domain/src/references/resolveExactlyOne.ts`、run/source GET route、`apps/web/src/features/runs/useRunPolling.ts`、property/integration test。
    - 実装: source/revision/checksum/locatorとrun IDを各1件だけへ解決し、0/複数件で代用しない。run GETへETagを付け、webは初回1秒・以後2秒poll、同一ETag描画抑止、terminal停止、手動更新を実装する。
    - **Property 26: provenance linkとrun IDの一意解決**
    - テスト/検証: 候補record集合をfast-checkで100 runs以上生成して0/1/複数解決を確認し、fake timer/Supertestでpoll間隔、ETag、terminal停止を`npm test -- packages/domain/src/references apps/api/src/routes/analyst/runs apps/web/src/features/runs/useRunPolling`で検査する。
    - 完了条件: run polling request単位の10秒timeoutとrun全体の長時間状態を区別し、stale responseを表示しない。
    - **Validates: Requirements 6.8, 6.9, 11.18, 11.19, 11.20, 11.21**

- [ ] 13. analyst readiness・source・run・verification画面を実装する
  - [ ] 13.1 readinessとSource Manifest管理画面を実APIへ接続する
    - 主な変更領域: `apps/web/src/features/readiness/`、`features/sources/analyst/`、route/component test。
    - 実装: 両候補を同じcolumnで表示し、資料名、種別、公開日、取得日、利用条件、対象選挙対応、checksum、採否、候補者別不足を示す。新revision登録と再検査はnonce付きAPIへ接続する。
    - 実装: `NOT_READY`では通常要約・比較・run開始への操作を無効にし、2026/現在/片側/fixtureで補完しない。利用条件UNKNOWN/RESTRICTEDの固定表示を使う。
    - テスト/検証: READY/NOT_READY、各manifest error、登録成功/失敗、保存失敗、data kind違反をRTL + mock transportで`npm test -- apps/web/src/features/readiness apps/web/src/features/sources/analyst`により確認する。
    - 完了条件: 画面は実Source Manifest状態をそのまま示し、資料未入手時に成功表示を作らない。
    - _Requirements: 3.12, 3.18, 3.19, 3.20, 4.7, 4.8, 11.1, 11.2, 11.3, 11.17, 26.1, 26.2, 26.3_

  - [ ] 13.2 run一覧・run詳細・7段階polling UIを実装する
    - 主な変更領域: `apps/web/src/features/runs/`、route integration test。
    - 実装: Source Manifest revisionをちょうど1件選択し、run開始、queue、7段階状態、開始/終了、結果、失敗分類、safe reason、retry可否、最終poll時刻を表示する。0/2件選択とNOT_READYで開始buttonを無効にする。
    - 実装: run詳細から検索hit、artifact、verification、historyへ一意IDで移動する。重複runでは既存runへ案内し、無制限retry buttonを置かない。
    - テスト/検証: 受付202、409 duplicate、各段階進行/失敗、ETag不変、terminal停止、選択保持、nonce失敗をRTL + fake timerで`npm test -- apps/web/src/features/runs`により確認する。
    - 完了条件: 同時RUNNING表示が0/1件で、失敗後の後続段階をSKIPPEDとして表示する。
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.20, 11.21_

  - [ ] 13.3 検索hit・原文・決定的検査・意味判定のverification UIを実装する
    - 主な変更領域: `apps/web/src/features/verification/`、component/route test。
    - 実装: 同じsource/revision/checksum/locatorの原文と引用、keyword/cosine score、統合順位、7決定的check、3意味判定、自動状態、決定理由を表示する。根拠linkは一意解決時だけ原文へ移動する。
    - 実装: REVIEW/FAIL/PENDING/REJECTEDを分析画面だけに表示し、意味保持の非保証と原文確認案内を常に付ける。0/複数参照では代用せず解決errorを出す。
    - テスト/検証: PASS/REVIEW/FAIL、UNVERIFIABLE/UNDETERMINED、0/複数locator、XSS文字列、raw path不在を`npm test -- apps/web/src/features/verification`で確認する。
    - 完了条件: verification pageから未検証・未承認artifactを会場表示へ昇格させる操作が存在しない。
    - _Requirements: 7.10, 9.18, 9.19, 11.11, 11.12, 11.13, 11.18, 11.19_

- [ ] 14. immutable人間判断、snapshot無効化、公開selectorを実装する
  - [ ] 14.1 承認・却下の状態条件と入力制約を実装する
    - 主な変更領域: `packages/domain/src/approval/validateDecision.ts`、property test。
    - 実装: 承認操作を`automatic PASS + human PENDING`だけで許可し、local allowlistの承認者IDと1〜500 Unicode code point理由を要求する。却下も承認者と同じ理由長を要求し、無効入力で状態/record数を変えない。
    - **Property 22: 人間判断操作の状態・入力制約**
    - テスト/検証: automatic/human全状態、allowlist内外ID、0/1/500/501 code point理由をfast-checkで100 runs以上生成し、state transitionとrecord件数を`npm test -- packages/domain/src/approval/validateDecision`で確認する。
    - 完了条件: Bedrock結果またはautomatic PASSだけからAPPROVEDになる関数が存在しない。
    - **Validates: Requirements 10.1, 10.2, 10.6, 10.7, 10.8, 10.9, 10.11, 10.12**

  - [ ] 14.2 immutable Approval/Rejection storeとnonce付きAPIを実装する
    - 主な変更領域: `apps/api/src/store/decisionStore.ts`、approval/rejection routes、filesystem/Supertest test。
    - 実装: canonical snapshot、判断者、日時、理由、previous hashをcontent-addressed fileへ`wx`で保存し、update/delete endpointを作らない。approve/reject commandのexpected hashを現在artifactと比較し、staleなら保存0件にする。
    - 実装: write/sync/rename/hash-chain失敗時はdecisionを存在しないものとしてhuman状態を`PENDING`に保つ。error responseへ原文・秘密・absolute pathを含めない。
    - テスト/検証: 正常承認/却下、重複、stale、保存fault、chain破損、nonce/Origin失敗を`npm test -- apps/api/src/store/decisionStore apps/api/src/routes/analyst`で確認する。
    - 完了条件: 成功recordだけがderived human stateへ反映され、既存recordを上書きしない。
    - _Requirements: 10.10, 10.13, 11.16_

  - [ ] 14.3 approval snapshot完全一致の公開gateを実装する
    - 主な変更領域: `packages/domain/src/publication/selectPublishableArtifact.ts`、property test。
    - 実装: REAL_AI、automatic PASS、human APPROVED、snapshotの選挙・候補者・source・checksum・revision・structured・summary・prompt・3 model ID・content hash完全一致を要求する。1 fieldでも変更・欠落・比較不能ならderived humanをPENDINGへ戻す。
    - **Property 23: approval snapshot完全一致の公開gate**
    - テスト/検証: valid artifact/approval pairと全snapshot fieldの1-field mutationをfast-checkで100 runs以上生成し、公開件数とPENDING復帰を`npm test -- packages/domain/src/publication/selectPublishableArtifact`で確認する。
    - 完了条件: REVIEW、FAIL、PENDING、REJECTED、FIXTURE、stale approvalは会場閲覧selectorから0件となる。
    - **Validates: Requirements 10.3, 10.4, 10.14, 10.15, 12.17, 13.8, 27.7, 27.18**

  - [ ] 14.4 未完了・失敗・中断runのartifact公開除外を実装する
    - 主な変更領域: `packages/domain/src/publication/runEligibility.ts`、property test。
    - 実装: runが`SUCCEEDED`かつ7段階成功でない限り、artifact自身の状態やdecision recordに関係なく公開候補から除外する。FAILED、CANCELLED、RUN_INTERRUPTED、stage incompleteを区別した理由を返す。
    - **Property 37: 未完了runの公開除外**
    - テスト/検証: 任意run状態・stage列・artifact statusをfast-checkで100 runs以上生成し、未完了runからの公開件数0を`npm test -- packages/domain/src/publication/runEligibility`で確認する。
    - 完了条件: failしたrunのartifactを後続runやfixtureで昇格させない。
    - **Validates: Requirements 15.13**

  - [ ] 14.5 review画面と承認・却下API flowを結線する
    - 主な変更領域: `apps/web/src/features/review/`、approval client、route/API integration test。
    - 実装: 対象選挙、候補者、原文、locator、source、checksum、revision、structured、summary、prompt/model、deterministic/semantic結果を同じ画面に表示する。条件を満たす場合だけ承認/却下formを有効にする。
    - 実装: 成功後に判断者、日時、理由を表示し、stale/保存失敗ではPENDINGと非表示理由を表示する。フォーム値にcredential形式を検出した場合は値を再表示・送信しない。
    - テスト/検証: valid approve/reject、0/501文字、non-PASS、non-PENDING、stale、persistence failure、未承認のvenue非表示をRTL + Supertestで`npm test -- apps/web/src/features/review apps/api/src/routes/analyst`により確認する。
    - 完了条件: review操作から一般公開endpointや法的承認を有効にするpathが存在しない。
    - _Requirements: 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.16, 11.14, 11.15, 11.16_

- [ ] 15. Checkpoint - pipelineと承認gateの終了する自動検査を実行する
  - Ensure all tests pass, ask the user if questions arise.
  - `npm run lint && npm run typecheck && npm test && npm run build && npm run source:check`をwatchなしで実行する。実資料未配置による`NOT_READY`は期待されるblockerとして記録し、fixtureでREADYを偽装しない。

- [ ] 16. 候補者・日程・出典・会場・政策比較をREAL_AI providerへ接続する
  - [ ] 16.1 対象2候補者と共通表示modelのfail-closed投影を実装する
    - 主な変更領域: `packages/domain/src/candidates/buildCandidateReadModel.ts`、property test。
    - 実装: 中村時広氏と林紀子氏が各1件の場合だけ一覧を作り、氏名、source表記、党派、結果、出典、更新日を同じfield順で返す。詳細も経歴、採用資料、資料量を同じ規則で返し、未確認は固定欠損表示にする。
    - **Property 27: 対象候補者集合と共通表示model**
    - テスト/検証: 0/1/2/重複/余分な候補者、nullable field、入力順をfast-checkで100 runs以上生成し、対象2名以外で一覧0件となることを`npm test -- packages/domain/src/candidates/buildCandidateReadModel`で確認する。
    - 完了条件: 候補者ごとに異なるschemaや情報量に基づく表示優先を作らない。
    - **Validates: Requirements 12.1, 12.2, 12.5, 12.6, 12.15, 12.16**

  - [ ] 16.2 候補者写真の三条件gateと共通placeholderを実装する
    - 主な変更領域: `packages/domain/src/candidates/selectPhoto.ts`、`apps/web/src/shared/ui/CandidatePhoto.tsx`、property/component test。
    - 実装: candidate ID対応、出典、利用条件CONFIRMEDが全て成立する場合だけlocal写真assetを返す。それ以外は全候補で同寸法・同様式の非人物placeholderを返し、写真byteをbundle候補から除外する。
    - **Property 28: 候補者写真の三条件gate**
    - テスト/検証: 3条件の全組合せとmetadata mutationをfast-checkで100 runs以上生成し、表示/bundle判断を`npm test -- packages/domain/src/candidates/selectPhoto apps/web/src/shared/ui/CandidatePhoto`で確認する。
    - 完了条件: remote imageや利用条件不明写真を読み込まず、カードimage slot寸法を候補者間で統一する。
    - **Validates: Requirements 12.3, 12.7, 12.8, 26.6, 26.7**

  - [ ] 16.3 current revisionの資料量と候補者差分を実装する
    - 主な変更領域: `packages/domain/src/candidates/materialVolume.ts`、property test。
    - 実装: current revisionの採用済みsourceId一意数、解析対象segmentのUnicode code point合計、来歴検査成功PolicyUnit数を候補者別に算出し、対応する数値差を返す。
    - **Property 30: 資料量と候補者間差分の算出**
    - テスト/検証: source重複、旧revision、Unicode text、invalid unitをfast-checkで100 runs以上生成し、reference countとの差を`npm test -- packages/domain/src/candidates/materialVolume`で確認する。
    - 完了条件: 資料量を候補者順や政策優劣へ使わず、「優劣を示さない」表示modelを伴う。
    - **Validates: Requirements 12.14, 13.6, 13.7**

  - [ ] 16.4 7テーマの中立な承認済み政策比較selectorを実装する
    - 主な変更領域: `packages/domain/src/comparison/buildComparison.ts`、property test。
    - 実装: 固定7テーマだけを受け、2候補を各1回、同じcolumn/schema/順序で返す。公開可能artifactだけを含め、記載なしと記載あり・承認済みなしを区別し、反対・不支持・政策なし・推薦・採点・rankingを加えない。
    - **Property 31: 中立な政策比較selector**
    - テスト/検証: theme、資料記載、artifact状態、候補順をfast-checkで100 runs以上生成し、公開fieldと禁止評価語を`npm test -- packages/domain/src/comparison/buildComparison`で確認する。
    - 完了条件: NOT_READYでは通常比較表を0件にし、候補者別欠落理由を返す。
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13**

  - [ ] 16.5 JSTの過去選挙日程と有限な手動再試行modelを実装する
    - 主な変更領域: `packages/domain/src/schedule/buildSchedule.ts`、property test。
    - 実装: JSTで2022-11-21 00:00以後を終了済みにし、投票日、出典、更新日を表示する。一次情報にない開始/終了時刻・期日前期間をnullのまま「一次情報未登録」とし、取得失敗は自動retry 0、手動操作1回をrequest 1回へする。
    - **Property 41: 過去選挙日程と有限な手動再試行**
    - テスト/検証: JST境界、nullable項目、failure/action列をfast-checkで100 runs以上生成し、端末timezone非依存、推測値0件、request数を`npm test -- packages/domain/src/schedule/buildSchedule`で確認する。
    - 完了条件: 残日数や現在/将来の投票行動を促す操作を返さない。
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9**

  - [ ] 16.6 候補者一覧・詳細pageとpublic APIをREAL_AI read modelへ接続する
    - 主な変更領域: candidate GET routes、`apps/web/src/features/candidates/`、API/route integration test。
    - 実装: registry、表示順、写真gate、資料量、公開selectorを結線し、一覧2件と選択候補詳細を表示する。詳細のAI情報はPASS+APPROVED+snapshot一致だけにし、0件時は承認済み情報がない理由を示す。
    - 実装: 共通カード寸法、field順、source表記、placeholder、出典、更新日、選択route、戻るを実装する。raw pathと未承認本文をDTO/DOMへ含めない。
    - テスト/検証: 正常2候補、暫定/公式順、候補不一致、unknown ID、未承認/stale/failed run、NOT_READYをSupertest + RTLで`npm test -- apps/api/src/routes/candidates apps/web/src/features/candidates`により確認する。
    - 完了条件: fixture providerを実API成功の代替にせず、実資料未入手時はNOT_READY/no approved dataを正しく表示する。
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18_

  - [ ] 16.7 出典一覧と過去選挙日程pageをREAL_AI read modelへ接続する
    - 主な変更領域: source/schedule GET routes、`apps/web/src/features/sources/public/`、`features/schedule/`、integration test。
    - 実装: 表示対象sourceの出典、公開日、取得日、対象選挙、revision、利用条件を返し、local pathを隠す。日程は終了済み・過去の参照情報・未確認項目を表示し、失敗時に明示的な1回再試行を出す。
    - テスト/検証: CONFIRMED/UNKNOWN/RESTRICTED、source 0件、schedule成功/失敗/再試行、現在向け操作不在をSupertest + RTLで`npm test -- apps/api/src/routes/sources apps/api/src/routes/schedule apps/web/src/features/sources apps/web/src/features/schedule`により確認する。
    - 完了条件: AI情報と原資料の共通SourceCitationを使い、利用条件を法的保証として表示しない。
    - _Requirements: 8.12, 12.2, 12.5, 18.2, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 26.1, 26.2, 26.3, 26.15, 26.16_

  - [ ] 16.8 venue・政策比較pageとREAL_AI public providerを統合する
    - 主な変更領域: venue/comparison GET routes、`apps/web/src/features/venue/`、`features/comparison/`、end-to-end component test。
    - 実装: venueには公開selector通過artifactだけを集約し、comparisonには7テーマselector、2候補、共通列、資料量差、根拠、自動/人間状態を表示する。360pxではtable領域だけ独立横scrollにする。
    - 実装: NOT_READY、記載なし、記載あり・承認済みなし、provider contract違反を区別する。推薦、採点、ranking、根拠外分類、P1/P2導線を置かない。
    - テスト/検証: PASS+APPROVED、各非公開状態、snapshot stale、FIXTURE混入、7テーマ、2候補、資料量差、360px DOM contractをSupertest + RTLで`npm test -- apps/api/src/routes/venue apps/api/src/routes/comparisons apps/web/src/features/venue apps/web/src/features/comparison`により確認する。
    - 完了条件: 実資料未入手の現在状態では通常比較を表示せず、候補者別NOT_READY理由を表示する。
    - _Requirements: 3.18, 4.7, 4.8, 10.3, 10.4, 10.15, 13.1, 13.2, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17_

- [ ] 17. run履歴、token usage、versioned価格、概算費用を実装する
  - [ ] 17.1 価格表schemaとmodel usage/cost normalizerを実装する
    - 主な変更領域: `config/pricing/`、`packages/contracts/src/pricing.ts`、`packages/domain/src/cost/calculateRequestCost.ts`、unit test。
    - 実装: model、Region、単位、入出力単価、通貨、確認日、出典URL、versionをstrict schemaで管理する。Converse/embedding usageを共通形へ正規化し、usageまたは対応単価がなければ費用をnullと理由にする。
    - テスト/検証: input/output/total、embedding usage、missing usage、missing price、decimal計算、unknown modelをtable-driven testで`npm test -- packages/domain/src/cost packages/contracts/src/pricing`により確認する。
    - 完了条件: 未取得値を0や推測値にせず、価格確認日と計算式を履歴へ渡せる。
    - _Requirements: 15.5, 15.6, 16.15, 16.17, 16.18_

  - [ ] 17.2 run開始snapshot・時刻・費用の再現性を実装する
    - 主な変更領域: `packages/domain/src/runs/runHistory.ts`、property test。
    - 実装: source provenance、prompt版、3 model ID、profile、Region、cross-Region、検索設定hash、価格表版を開始時に固定する。終了時刻、duration、各request usage・式・費用を記録し、開始後の設定変更を反映しない。
    - **Property 35: run開始snapshot、時刻、費用の再現性**
    - テスト/検証: 任意設定、開始/終了時刻、usage/price null組合せ、開始後mutationをfast-checkで100 runs以上生成し、snapshot不変、`end >= start`、duration、cost/null理由を`npm test -- packages/domain/src/runs/runHistory`で確認する。
    - 完了条件: prompt本文、credential、保護対象入力を履歴へ含めず、失敗段階と安全な診断を保持する。
    - **Validates: Requirements 15.3, 15.4, 15.5, 15.6, 15.7, 15.14**

  - [ ] 17.3 run履歴APIと履歴・費用UIを実装する
    - 主な変更領域: analyst history routes、`apps/web/src/features/history/`、integration test。
    - 実装: run IDで一意解決した履歴へ、source/revision/checksum、prompt/model、profile/Region、検索設定、開始/終了/duration、用途別usage・費用、失敗分類を表示する。null費用には取得不能理由を出す。
    - テスト/検証: success/failure、usageなし、単価なし、run ID 0/複数、redaction、raw prompt不在をSupertest + RTLで`npm test -- apps/api/src/routes/analyst/history apps/web/src/features/history`により確認する。
    - 完了条件: 一覧endpointは原文を返さず、詳細も必要なsafe metadataだけを返す。
    - _Requirements: 11.8, 11.15, 11.20, 11.21, 15.3, 15.4, 15.5, 15.6, 15.7, 15.14, 27.10_

- [ ] 18. gold dataset評価と検証あり・なし比較を実装する
  - [ ] 18.1 gold datasetのstrict schema、coverage、不一致除外を実装する
    - 主な変更領域: `packages/contracts/src/evaluation.ts`、`packages/domain/src/evaluation/validateDataset.ts`、property test。
    - 実装: 両候補各1例以上、全provenance、期待根拠・structured・公開可否、条件/否定/段階/期限/意味変化または追加/根拠不足category coverageを要求する。2名の照合不一致例を理由付きで集計から除外する。
    - **Property 38: gold datasetの妥当性と比較入力同一性**
    - テスト/検証: valid/invalid dataset、coverage欠落、reviewer不一致、2 mode設定mutationをfast-checkで100 runs以上生成し、受理条件と共通入力を`npm test -- packages/domain/src/evaluation/validateDataset packages/contracts/src/evaluation`で確認する。
    - 完了条件: 実datasetは`data/real/evaluations`へ置き、tracked example/fixtureをP0実評価証跡に数えない。
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8**

  - [ ] 18.2 評価率、分母0、方式差分の算術を実装する
    - 主な変更領域: `packages/domain/src/evaluation/calculateMetrics.ts`、property test。
    - 実装: 根拠一致、条件・否定・段階・期限保持、意味変化検出、誤検出、保留の分子/分母を要件どおり算出する。分母0、片側値/費用nullでは数値差を作らず「算出不可」理由を返す。
    - **Property 39: 評価率と差分の算術**
    - テスト/検証: eligible/correct/held boolean modelとnull費用をfast-checkで100 runs以上生成し、hand-written reference modelとの一致を`npm test -- packages/domain/src/evaluation/calculateMetrics`で確認する。
    - 完了条件: 各指標が分子、分母、値を保持し、法的適合や完全な意味保持を表すfieldを持たない。
    - **Validates: Requirements 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.16, 16.17**

  - [ ] 18.3 評価use case、immutable結果、API、分析UIを結線する
    - 主な変更領域: `packages/domain/src/evaluation/runEvaluation.ts`、evaluation store/routes、`apps/web/src/features/evaluation/`、integration test。
    - 実装: 同じdataset版・artifactSet・生成物・generation model・prompt・検索設定を2 modeへ渡し、検証ありだけdeterministic/semantic gateを適用する。generation/summary callは両modeで0回にする。
    - 実装: 開始/終了/duration、費用、差分、除外例、3 model ID、Region、設定、評価日時をimmutable保存して参考値として表示する。
    - テスト/検証: fake artifact setで2 mode、call count 0、除外、各metric、null費用、保存失敗を`npm test -- packages/domain/src/evaluation/runEvaluation apps/api/src/routes/analyst/evaluations apps/web/src/features/evaluation`で確認する。
    - 完了条件: tracked fixture結果を実gold dataset結果へ昇格せず、評価不能理由を明示する。
    - _Requirements: 16.6, 16.7, 16.8, 16.15, 16.16, 16.17, 16.18, 16.19, 16.20, 27.11_

- [ ] 19. P0 completion、期限判定、本番前確認の分離を実装する
  - [ ] 19.1 P1/P2入力を受け付けないP0 phase境界を実装する
    - 主な変更領域: `packages/contracts/src/p0-evidence.ts`、`packages/domain/src/p0/selectP0Inputs.ts`、property test。
    - 実装: P0 evidence schemaからP1/P2 route、package、実装状態、test結果を除外し、入力objectに混入した場合は未知fieldとして拒否する。P1/P2値を変えてもP0結果へ影響しないpure selectorを作る。
    - **Property 1: P0判定のphase分離**
    - テスト/検証: 任意P0検査とP1/P2状態mutationをfast-checkで100 runs以上生成し、P0結果不変とschema拒否を`npm test -- packages/domain/src/p0/selectP0Inputs packages/contracts/src/p0-evidence`で確認する。
    - 完了条件: P1/P2をP0未達の代替にするfield、route、test evidenceが存在しない。
    - **Validates: Requirements 1.2, 1.9, 21.17, 22.26, 23.16, 24.11, 25.2, 27.24**

  - [ ] 19.2 P0全項目とJST期限状態の必要十分判定を実装する
    - 主な変更領域: `packages/domain/src/p0/completeP0.ts`、property test。
    - 実装: 全check PASS時だけimmutable completion timestampを作り`P0完成`、1件以上FAILではtimestampなし`P0未完成`にする。2026-11-16 00:00 JSTより前だけ期限内とし、記録なしは期限超過/完成日時なしを要件どおり表示する。
    - **Property 2: P0完成と期限状態の全称判定**
    - テスト/検証: 任意check集合と境界前/同時/後JST時刻をfast-checkで100 runs以上生成し、truth tableとtimestamp生成件数を`npm test -- packages/domain/src/p0/completeP0`で確認する。
    - 完了条件: 完成recordを上書きせず、未達項目と証跡URIを保持する。
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 17.18, 27.15, 27.23**

  - [ ] 19.3 本番前確認6項目と一般公開endpoint無効を分離する
    - 主な変更領域: `packages/domain/src/release/preReleaseGate.ts`、analyst read model、property test。
    - 実装: 選挙法、著作権、privacy、写真、資料利用条件、選管確認の6種類と確認者・日・対象・根拠を要求する。全完了でも「一般公開候補」と非保証表示だけを返し、public endpointを自動有効化するcommandを作らない。
    - **Property 52: 本番前確認と一般公開の分離**
    - テスト/検証: 6項目の任意組合せ、field欠落、別途承認/deploy状態をfast-checkで100 runs以上生成し、endpoint数0と候補表示条件を`npm test -- packages/domain/src/release/preReleaseGate`で確認する。
    - 完了条件: ローカルデモでは確認状態にかかわらず一般公開でないbannerを維持し、法的適合を保証しない。
    - **Validates: Requirements 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14, 26.15, 26.16**

  - [ ] 19.4 P0 evidence完全性とfixture非代替を実装する
    - 主な変更領域: `packages/domain/src/p0/evaluateEvidence.ts`、P0 evidence builders、property test。
    - 実装: 同等実資料、locator/provenance、両候補Hybrid RAG、実Bedrock生成/要約/意味判定、REAL_AI PASS+APPROVED、公開gate、代表UI、分析UI、履歴、評価、fresh-copy、必須test、data分離を個別checkにする。
    - **Property 53: P0証跡の完全性とfixture非代替**
    - テスト/検証: valid/欠落evidenceと任意量のmock/fixture evidenceをfast-checkで100 runs以上生成し、実証跡が全てある場合だけ完成候補になることを`npm test -- packages/domain/src/p0/evaluateEvidence`で確認する。
    - 完了条件: 2022資料未入手、実Bedrock未実行、実承認なしの現状を`P0未完成`とし、fixture PASS/REVIEW/FAILを代替にしない。
    - **Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8, 27.9, 27.10, 27.11, 27.12, 27.13, 27.14, 27.16, 27.17, 27.19, 27.20**

  - [ ] 19.5 P0 completion CLI・API・分析UIとimmutable結果を結線する
    - 主な変更領域: `scripts/p0-check.ts`、P0 result store/routes、`apps/web/src/features/p0/`、integration test。
    - 実装: CLIとAPIが同じP0CompletionServiceを使い、checkごとのPASS/FAIL、安全な理由、証跡URI、JST検査時刻を返す。全件PASS時だけcompletion recordをimmutable保存し、画面へ期限状態を表示する。
    - 実装: fixtureで8標準状態と7 error分類を再現する検査をP0 evidenceに記録するが、実資料・実Bedrock・公開artifact証跡へ数えない。
    - テスト/検証: 全PASS、各1項目FAIL、保存失敗、期限境界、fixture-only、P1/P2混入を`npm test -- scripts/p0-check apps/api/src/routes/analyst/p0 apps/web/src/features/p0`で確認する。`npm run p0:check`は現状の未達を列挙して終了する。
    - 完了条件: P0状態を法的適合・一般公開承認として表示せず、最新resultとimmutable履歴を区別する。
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 17.17, 17.18, 27.8, 27.9, 27.15, 27.18, 27.19, 27.20, 27.21, 27.22, 27.23, 27.24_

- [ ] 20. integration・browser・security・fresh-copy検査とREADMEを完成する
  - [ ] 20.1 loopback API/UIの代表integrationとsecurity contract suiteを完成する
    - 主な変更領域: `apps/api/src/test/integration/`、`apps/web/src/test/integration/`。
    - 実装: health、session、source、run、polling、verification、approval、candidate、comparison、venue、history、evaluation、P0のsuccess/error envelopeを一連のfake-backed appで検査する。
    - 実装: loopback bind、Host/CORS/nonce、body上限、run concurrency、ETag polling、未承認非表示、snapshot stale、秘密redaction、REAL_AI/FIXTURE混在拒否を境界ごとに確認する。
    - テスト/検証: `npm test -- apps/api/src/test/integration apps/web/src/test/integration`を終了させ、network spyではAWS/外部HTTP 0回、Supertest in-process requestだけを許可する。
    - 完了条件: 正常縦切りとfail-closed縦切りが同じcontractを通り、未承認本文がresponse/DOMに現れない。
    - _Requirements: 4.10, 10.3, 10.4, 11.4, 11.6, 11.7, 17.13, 17.19, 17.20, 17.22, 19.4, 19.5, 27.8, 27.9_

  - [ ] 20.2 360・768・1280pxのbrowser/route/accessibility検査を実装する
    - 主な変更領域: `tests/browser/`、単発browser test設定、route metadata test。
    - 実装: 全P0主要route、404、戻る、全banner、主要操作、loading/8 terminal状態を3 viewportで検査する。button/link 44×44px、comparisonだけ横scroll、page全体overflowなし、heading/landmark/focus/labelを実寸でassertする。
    - テスト/検証: `npm run test:browser`をwatchなし・自動終了で実行し、失敗時にrouteとviewportを報告する。Geolocation、Speech、P1/P2 APIや外部networkを起動しない。
    - 完了条件: P0主要導線が全viewport内から利用でき、固定文言やエラーを色だけに依存させない。
    - _Requirements: 12.3, 13.16, 13.17, 19.1, 19.2, 19.3, 19.14, 19.15, 19.16, 19.17, 19.18, 27.8, 27.21_

  - [ ] 20.3 production buildとimport graphの禁止物static checkerを実装する
    - 主な変更領域: `scripts/check-build-boundaries.ts`、package/import graph test、root scripts。
    - 実装: web bundleにAWS SDK、credential provider、profile/region、`data/real` path、raw資料、prompt、秘密形式がないことを走査する。P1/P2 route、Three.js、Notification、Web Speech、calendar、地図、OpenSearch、不要な依存がP0 buildにないことも確認する。
    - テスト/検証: 意図的な禁止import fixtureでchecker自身を検査し、`npm run build && npm run check:boundaries && npm run bundle:check`を終了させる。
    - 完了条件: real raw、UNKNOWN/RESTRICTED source、credential、P1/P2不要依存を含むbuild/bundleが失敗する。
    - _Requirements: 1.8, 4.13, 4.14, 4.15, 7.14, 14.8, 14.11, 17.2, 17.15, 25.2, 27.14, 27.24_

  - [ ] 20.4 fresh-copy再現検査と有限health check scriptを実装する
    - 主な変更領域: `scripts/fresh-copy-check.ts`、`scripts/health-check.ts`、evidence schema/test。
    - 実装: Git追跡物を一時copyへ展開し、`npm ci`、typecheck、test、buildを実行し、loopback appを有限test harnessで起動してhealth確認後に`finally`で停止する。commit、Node/npm、lockfile、環境設定hash、各command時刻/exitをsafe evidenceへ記録する。
    - 実装: raw資料と秘密をcopyしない。許可済みrawはユーザーが別途配置する手順だけを検査し、常駐dev serverやwatcherをspawnしない。
    - テスト/検証: success、install/build/health failure、timeout、process cleanupをfake process runnerで`npm test -- scripts/fresh-copy-check scripts/health-check`により確認し、`npm run fresh-copy:check`を有限時間で終了させる。
    - 完了条件: failure時もchild processとtemporary resourceを解放し、結果をP0証跡として参照できる。
    - _Requirements: 17.3, 17.4, 17.11, 17.12, 17.17, 27.12_

  - [ ] 20.5 READMEを実装済みcommand・安全境界・外部前提と同期する
    - 主な変更領域: `README.md`、`docs/source-acquisition.md`、`docs/legal-checklist.md`、documentation contract test。
    - 実装: Windows/Node/npm、`npm ci`、秘密なし環境設定、AWS公式CLI v2/SSOリンク、3 model ID、raw別途配置、Source Manifest、実AI/fixture分離、手動のloopback起動/停止、終了する検査command、fresh-copy、非収録理由をdesignの順で記す。
    - 実装: `dev`、API、previewの常駐commandはユーザーが別terminalで手動実行し`Ctrl+C`で停止する手順として明記する。agent/testからwatcherを開始しない。実資料未入手時のNOT_READY、flagなしBedrock 0 call、P1/P2対象外、法的非保証を記す。
    - テスト/検証: READMEのcommand名、route、環境変数、label、AWS公式link、source配置pathを実装metadataと照合する`npm test -- documentation-contract`を追加する。最後に`npm run lint && npm run typecheck && npm test && npm run build && npm run bundle:check`を実行する。
    - 完了条件: `source:check`、`diagnose:aws`、`test:bedrock`、`p0:check`がいずれも有限commandとして説明され、外部blockerを自動成功扱いしない。
    - _Requirements: 4.16, 14.10, 14.11, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 26.16_

- [ ] 21. Final checkpoint - P0 coding artifactsの全終了検査を実行する
  - Ensure all tests pass, ask the user if questions arise.
  - `npm ci`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:browser`、`npm run build`、`npm run check:boundaries`、`npm run bundle:check`、`npm run fresh-copy:check`をwatchなしで実行する。
  - `npm run source:check`、`npm run diagnose:aws`、`npm run test:bedrock`、`npm run p0:check`が必ず終了し、外部前提未完了時にはそれぞれ`NOT_READY`、安全な診断、実要求0件、`P0未完成`を正直に返すことを確認する。実Bedrock smokeは外部前提が整った後に限り明示flagで各用途1件だけ実行する。

## P1/P2 Scope Boundary

- Requirements 21〜24とCorrectness Properties 43〜49のP1実装は、このP0 task listの対象外である。P0完成後に別task listを作り、P1開始gateを前提に実装する。
- Requirement 25の3D、通知、読み上げ、文字倍率、カレンダー、政治用語解説とCorrectness Properties 50〜51は、このP0 task listの対象外である。2026-11-15後の別変更で扱う。
- P0にはP1/P2のroute、dependency、placeholder、skip test、完成証跡を追加しない。P1/P2の未実装状態はP0をblockせず、P0未達を補完もしない。

## Notes

- このtask listのcheckboxはすべてP0のコード作成、変更、自動テスト、または終了する検証commandに限定している。資料取得、利用条件判断、AWS CLI/SSO設定、法律相談、選挙管理委員会への問い合わせは`External prerequisites / Blockers`だけに記載している。
- `*`付きoptional taskは置いていない。P0に必要な自動テストとCorrectness Properties 1〜42・52〜54はP0完成条件のためrequiredである。
- 各Property taskはdesign.mdと同じ番号・名称をtest commentへ記録し、1 propertyにつき独立した`test`/`it`と`fc.assert`を最低100 runs実行する。AWS SDK、外部HTTP、実filesystem、実clock、非seed乱数をPBTから直接呼ばない。
- `packages/contracts`を先に確定し、以後はdomain/API担当とweb/fixture担当が同じfileを同一waveで編集しない。共有contract変更は先行waveで完了してからconsumerを並行実装する。
- 既存`.git`、Git履歴、`.kiro`、`.kiro/specs/ehime-vote-navigator/.config.kiro`、requirements.md、design.mdを削除・再作成しない。この計画の実行対象は実装repositoryであり、spec文書の書換え自体を実装taskにしない。
- 実資料、実AWS、実承認がそろうまでは、fixture/fakeによるコード検証が成功しても`source:check`と`p0:check`は未達を返す。2026資料、現在政策、片側資料、fixture、mock Bedrockを実証跡へ昇格させない。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2"] },
    { "id": 4, "tasks": ["2.3", "3.3"] },
    { "id": 5, "tasks": ["2.4", "3.4"] },
    { "id": 6, "tasks": ["2.5", "5.1"] },
    { "id": 7, "tasks": ["4.1", "5.2"] },
    { "id": 8, "tasks": ["4.2", "4.4"] },
    { "id": 9, "tasks": ["4.3", "4.5"] },
    { "id": 10, "tasks": ["4.6", "5.3"] },
    { "id": 11, "tasks": ["5.4", "7.1"] },
    { "id": 12, "tasks": ["7.2", "8.1"] },
    { "id": 13, "tasks": ["7.3", "8.2"] },
    { "id": 14, "tasks": ["7.4", "8.3"] },
    { "id": 15, "tasks": ["7.5", "8.4"] },
    { "id": 16, "tasks": ["9.1", "10.1"] },
    { "id": 17, "tasks": ["9.2", "10.2"] },
    { "id": 18, "tasks": ["9.3", "10.3"] },
    { "id": 19, "tasks": ["9.4", "10.4"] },
    { "id": 20, "tasks": ["9.5", "11.1"] },
    { "id": 21, "tasks": ["11.2", "11.4"] },
    { "id": 22, "tasks": ["11.3", "11.5"] },
    { "id": 23, "tasks": ["12.1", "12.2"] },
    { "id": 24, "tasks": ["12.3", "12.4"] },
    { "id": 25, "tasks": ["12.5", "13.1"] },
    { "id": 26, "tasks": ["13.2", "14.1"] },
    { "id": 27, "tasks": ["13.3", "14.2"] },
    { "id": 28, "tasks": ["14.3", "14.4"] },
    { "id": 29, "tasks": ["14.5", "16.1"] },
    { "id": 30, "tasks": ["16.2", "16.5"] },
    { "id": 31, "tasks": ["16.3", "16.4"] },
    { "id": 32, "tasks": ["16.6", "16.7"] },
    { "id": 33, "tasks": ["16.8", "17.1"] },
    { "id": 34, "tasks": ["17.2", "18.1"] },
    { "id": 35, "tasks": ["17.3", "18.2"] },
    { "id": 36, "tasks": ["18.3", "19.1"] },
    { "id": 37, "tasks": ["19.2", "19.3"] },
    { "id": 38, "tasks": ["19.4"] },
    { "id": 39, "tasks": ["19.5"] },
    { "id": 40, "tasks": ["20.1", "20.3"] },
    { "id": 41, "tasks": ["20.2"] },
    { "id": 42, "tasks": ["20.4"] },
    { "id": 43, "tasks": ["20.5"] }
  ]
}
```
