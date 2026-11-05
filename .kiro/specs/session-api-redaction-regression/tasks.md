# Implementation Plan

## Overview

完了済みの探索で、43文字base64url nonceとUUID request IDの両方がgeneric protected-value patternへ偶発一致し、`GET /api/v1/session`を固定safe HTTP 500へ変えるbug conditionを確認した。次に未修正コードのpreservation baselineを観測・固定し、その後`apps/api/src/routes/session.ts`だけへsession専用のprivate schema-aware projectorを実装する。実装は、server-generated primitive nonceとrequest IDをgeneric redactorまたは一般`projectApiResponse`へ渡さず、full candidateのinitial strict validation、検証済み両値の同field再構成、final strict validationを行う。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["4"] },
    { "id": 5, "tasks": ["5"] }
  ]
}
```

Task 1の探索は完了済みである。Task 2はproduction fixより前に完了させる。Task 3.1はTask 2のbaselineが未修正コードでPASSした後に開始し、Task 4はTask 3.2、3.3、3.4がすべて完了してから実行する。

## Tasks

- [x] 1. 未修正コードでbug condition探索property testを実装・実行する
  - **Property 1: Bug Condition** - Explicit Session Nonce and Request ID Projection
  - **COMPLETED EXPLORATION**: 未修正コードで、strict-schema-validなnonce、request ID、または両方がgeneric redactionで`REDACTED_VALUE`へ置換され、元の`projectApiResponse(SessionResponseSchema, candidate)`が固定safe failureとなることを確認した。allowed routeにexpected behaviorをassertする同じtestはHTTP 200を期待して実際のHTTP 500を受け取り、意図どおりFAILした。
  - Generator修正: nonce generatorを`fc.uint8Array({ minLength: 32, maxLength: 32 })`から1 sampleずつ43文字base64urlへ変換する形に固定した。request ID generatorは16-byte sampleごとにUUID v4のversion/variant bitを設定してcanonical UUIDへ変換した。nonce-only、requestId-only、combined isolationはsafe control値または独立seedを使い、原因fieldを分離した。
  - Generator修正: directed generatorは`POSTAL_ADDRESS_PATTERN`、base64urlと交差するAWS access key形式、AWS session token形式を、それぞれ43文字base64urlとして有効なnonceへ直接構成する。rare intersectionへの`fc.filter`依存、長さ不正、base64url外文字を排除した。
  - Nonce broad sweep: seed `20260901`、`20260902`、`20260903`、`20260904`を各250,000件、合計1,000,000件実行し、protected/projection-failing nonceは1件だった。counterexampleはseed `20260903`、generation index/replay path `372`、`_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ`で、部分文字列`975-8793`が`POSTAL_ADDRESS_PATTERN`に一致し、kind `ADDRESS`、field path `data.nonce`としてredactされた。
  - Deterministic route replay: seed `20260901`、path `0`のsynthetic nonce `AAAAAAAAAA123-4567BBBBBBBBBBBBBBBBBBBBBBBBB`は43文字base64urlかつdecode後32 bytesであり、`123-4567`が`POSTAL_ADDRESS_PATTERN`に一致した。safe control request IDと組み合わせたallowed routeは、期待HTTP 200に対して固定safe HTTP 500を返した。
  - Request ID isolation: safe control nonceとUUID v4 generatorを使い、4 seedを各1,000件、合計4,000件実行した。protected/projection-failing UUIDは899件だった。最初のcounterexampleはseed `20260901`、generation index/replay path `1`、`71f9383a-0201-4659-ba07-06d9d35b0302`で、`201-4659`が住所patternに一致し、kind `ADDRESS`、field path `requestId`としてredactされた。
  - Request IDのseed別先頭counterexampleとして、seed `20260902` path `5`の`063af900-02fe-45fe-8600-9206073cfa00`、seed `20260903` path `0`の`6a005102-0607-40f8-8020-02b00372a960`、seed `20260904` path `0`の`035afad7-0201-4335-adfa-dcfd4a7e0105`も記録した。いずれもfield path `requestId`、kind `ADDRESS`、generic projection failureだった。
  - Directed exploration: 3種のintersection generatorを4 seedで各1,000件、合計12,000 sample実行した。各sampleはvalidな43文字base64url nonceを維持し、`ADDRESS`、`AWS_ACCESS_KEY_ID`、または`AWS_SESSION_TOKEN`へ分類され、generic projectionのfixed fail-closedへ到達した。
  - Field isolation: nonce-only、requestId-only、combined runで、projection failureはすべて`data.nonce`または`requestId`のprotected kindと対応した。両fieldの分類で説明できないprojection failureは0件だった。
  - 探索結果により、request IDをgeneric metadata projectionへ残す案ではbugを解消できないことを確定した。以降のfix checkingはnonce-only、requestId-only、combinedのすべてを対象とする。
  - **RECORDED EXPECTED OUTCOME**: Property 1のexpected-behavior assertionだけが未修正routeのHTTP 500によってFAILし、compile error、timeout、無関係な例外、test skip、または期待statusの500化を成功として扱っていない。
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.5_

- [x] 2. 未修正コードのpreservation property testを観測先行で実装・実行する
  - **Property 2: Preservation** - Non-Bug Session Inputs and Non-Session Sinks
  - **IMPORTANT**: production fixより前に実施する。`isBugCondition(input) === false`の入力とsession外sinkの現在の実挙動を未修正コードで観測してからtestへ固定し、すべてPASSすることをbaselineの完了条件とする。
  - 主な変更領域: `apps/api/src/routes/session.property.test.ts`、`apps/api/src/http/responseProjection.test.ts`、`apps/api/src/logging/safeLogger.property.test.ts`、`apps/api/src/store/runEventStore.test.ts`、`apps/api/src/middleware/localBoundary.test.ts`。production fileは変更しない。
  - 非衝突session: nonceとrequest IDの両方がstrict-schema-validかつ`detectProtectedTextKind`で非保護となり、元のFが成功するcandidateを生成する。未修正Fとallowed routeのschema-level body、HTTP 200、`Cache-Control: no-store, max-age=0`、`Expires: 0`、`Pragma: no-cache`を観測して固定する。
  - Nonce lifecycle: 同一route harnessへの複数GETでは43文字base64url nonceが同一でrequest IDが別のvalid UUIDとなり、独立した`createLocalNonce()` instance間ではnonceが異なる既存挙動を観測して固定する。
  - 一般response baseline: Task 1で記録したnonce counterexampleとrequest ID counterexampleをsession schema-defined field以外の一般DTO fieldへ個別および同時に置き、generic `projectApiResponse`が従来どおりredactまたは固定safe failureを返すことを確認する。原値を返すsession専用例外を一般projectorへ導入しない。
  - Logger baseline: 記録済みnonce/request ID counterexampleをlogger eventの非session fieldへ個別および同時に置き、serialized lineに原値が残らず、既存redaction markerだけが残ることを確認する。入力objectの非mutationも維持する。
  - Run-store baseline: 同じcounterexampleをrun event diagnosticへ個別および同時に置き、temporary storeの保存bytesに原値が残らず、append前のgeneric redactionと入力非mutationが維持されることを確認する。
  - Session schema boundary: 同じ値がsessionのunknown root fieldまたはunknown nested fieldへ置かれたcandidateを`SessionResponseSchema.strict()`が拒否することを確認する。invalid nonceとinvalid UUIDも公開せず、固定safe failureとなるbaselineを記録する。
  - Local boundary baseline: 許可されていないHostまたはOriginではtyped `LocalNonce.revealForSession` spyが呼ばれず、session handler/projector到達前に既存403となることを確認する。method、mutation nonce判定、middleware順序を変更しない。
  - テスト/検証: `npm.cmd run test -- apps/api/src/routes/session.property.test.ts -t "Property 2: Preservation"`をwatchなしで単発実行する。
  - テスト/検証: `npm.cmd run test -- apps/api/src/http/responseProjection.test.ts apps/api/src/logging/safeLogger.property.test.ts apps/api/src/store/runEventStore.test.ts apps/api/src/middleware/localBoundary.test.ts`をwatchなしで単発実行する。
  - **EXPECTED OUTCOME**: すべて未修正コードでPASSする。Property 1の既知のexpected-behavior failureをこのtaskのcommandへ混ぜず、baseline failureをbug確認として受け入れない。
  - 完了条件: 非衝突session、一般response、logger、run store、local boundaryの観測済み挙動と、記録済みnonce/request ID counterexampleがsession外では引き続きredact/fail closedされる挙動が自動testとして固定される。
  - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. session responseだけにschema-aware projectionの最小修正を実装する

  - [x] 3.1 full candidateを二重strict検証するprivate session projectorを実装する
    - Production変更は`apps/api/src/routes/session.ts`だけに限定する。Task 1・2で作成した既存対象test以外にproduction helper、test-only production entry point、または新規test fileを追加しない。
    - `SessionResponseSchema`と`registerSessionRoute`を同じfile内で維持し、session専用projectorはexportしないprivate functionとする。入力はserver-generated primitive `nonceValue: string`と`requestIdValue: string`だけとし、任意object、schema、path、field名、callback、allowlist、bypass optionを受け取らない。
    - Primitive `nonceValue`と`requestIdValue`から、object spreadなしで`{ ok: true, data: { nonce: nonceValue }, requestId: requestIdValue }`というfull candidateを明示構築する。
    - Full candidateを最初にstrict `SessionResponseSchema.safeParse`へ通す。initial validationが失敗した場合は値、parse issue、exception textを反射せず、既存`SAFE_RESPONSE_PROJECTION_ERROR_STATUS`と`SAFE_RESPONSE_PROJECTION_ERROR`だけの固定safe HTTP 500へfail closedする。
    - Initial validationに成功した場合だけ、validation outputの`ok`、`data.nonce`、`requestId`を同じschema-defined fieldへ明示的に再構成する。nonceとrequest IDのどちらも`redactProtectedValues`、`detectProtectedTextKind`、generic `projectApiResponse`、またはその他のgeneric value-pattern redactorへ渡さない。
    - 再構成したfull bodyを同じstrict `SessionResponseSchema.safeParse`でfinal validationする。成功値だけをHTTP 200で送信し、final validation failureまたはprojector内例外も同じ固定safe HTTP 500へ変換する。
    - `nonce.revealForSession()`の取得順・回数、requestごとの`randomUUID()`、`Cache-Control: no-store, max-age=0`、`Expires: 0`、`Pragma: no-cache`を維持する。nonce/request IDをschema-defined body field以外のheader、logger、run store、file、URL、errorへ渡さない。
    - 任意のpath、field、value、responseへ適用できるallowlistまたはpublic bypassを作らない。`SessionMetadataSchema`を導入せず、request IDをgeneric metadata projectionへ残さない。
    - 変更禁止: `packages/domain/src/security/redact.ts`、`apps/api/src/http/responseProjection.ts`、`apps/api/src/logging/safeLogger.ts`、`apps/api/src/store/runEventStore.ts`、`apps/api/src/middleware/localBoundary.ts`、`apps/api/src/middleware/localNonce.ts`、tsconfig群を変更しない。nonce/request IDの固定、detector依存の再生成、redaction弱化、fail-open、`any`、型抑制directiveを追加しない。
    - _Bug_Condition: design.mdの`isBugCondition(input)`がtrue、すなわちallowedかつstrict-validなcandidateのnonce、request ID、または両方がgeneric protected-value判定でredactされ、元のFが失敗する入力_
    - _Expected_Behavior: design.mdの`expectedBehavior(input, result)`どおり、initial strict validation済みの両値を同じfieldへ再構成し、final strict validation済みのHTTP 200 bodyにbyte-for-byteで保持する_
    - _Preservation: invalid candidateは既存固定safe HTTP 500へfail closedし、非衝突sessionとsession外のgeneric response、logger、run store、local boundary、nonce lifecycleを変更しない_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 3.2 bug condition探索testを同じcounterexampleで再実行してPASSさせる
    - **Property 1: Expected Behavior** - Explicit Session Nonce and Request ID Projection
    - **IMPORTANT**: Task 1と同じtest、fixture、seed、generation index/replay pathを再実行する。代替testへ置き換えず、元のgeneric Fが同じcounterexampleを引き続きredact/fail closedすることをpreconditionとして残す。
    - Nonce-only: safe control request IDと、実在broad-sweep nonceおよびdeterministic synthetic nonceを組み合わせ、fixed routeが元nonceと元request IDを含むstrict HTTP 200を返すことを確認する。
    - RequestId-only: safe control nonceと記録済みprotected UUIDを組み合わせ、fixed routeが元request IDと元nonceを含むstrict HTTP 200を返すことを確認する。決定的route replayにはtest内のpartial `node:crypto` mockだけを使い、production injection optionを追加しない。
    - Combined: protected nonceとprotected request IDを同じcandidateで再生し、両方をbyte-for-byteでそれぞれ`data.nonce`と`requestId`へ保持することを確認する。
    - Directed property: `ADDRESS`、`AWS_ACCESS_KEY_ID`、`AWS_SESSION_TOKEN`と交差するvalid 43文字base64url nonce arbitraryを使い、bug conditionを満たすすべてのsampleで同じexpected behaviorを確認する。
    - 各resultについて、final bodyが`SessionResponseSchema`に適合し、nonceとrequest IDがschema-defined body fieldだけに現れ、cache headerを維持し、headerまたはerrorへ原値を反射しないことを確認する。
    - テスト/検証: `npm.cmd run test -- apps/api/src/routes/session.property.test.ts -t "Property 1"`をwatchなしで単発実行する。
    - **EXPECTED OUTCOME**: Task 1ではFAILした同じexpected-behavior assertionが、nonce-only、requestId-only、combined counterexampleとdirected propertyのすべてでPASSする。一般Fのfail-closed preconditionもPASSする。
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 3.3 preservation testを変更せず再実行する
    - **Property 2: Preservation** - Non-Bug Session Inputs and Non-Session Sinks
    - **IMPORTANT**: Task 2で未修正コード上に固定した同じtestと期待値を再実行する。fixに合わせてbaselineを書き換えず、test skip、削除、sample削減、期待500化を行わない。
    - `apps/api/src/app.test.ts`へ不足するtargeted assertionだけを追加し、実`createApp()`の同一instanceでnonce同一・request ID相違、異なるinstanceでnonce rotation、3種類のno-cache header、nonce/request IDのbody外非露出を確認する。
    - 非衝突sessionでは元のFとfixed routeのstrict-decoded bodyを比較する。invalid nonce、invalid UUID、unknown fieldは値やdiagnosticを反射しない既存固定safe HTTP 500になることを確認する。
    - Task 1のnonce/request ID counterexampleを一般response、logger、run storeへ個別および同時に置き、Task 2どおりredactまたはfixed fail closedされることを確認する。session専用projectorの扱いが同値文字列、別field、別schema、別sinkへ波及していないことを確認する。
    - 不許可Host/Originがprojector到達前に既存403となり、local-only boundary、mutation nonce判定、middleware順序が維持されることを確認する。
    - テスト/検証: `npm.cmd run test -- apps/api/src/routes/session.property.test.ts apps/api/src/app.test.ts apps/api/src/http/responseProjection.test.ts apps/api/src/logging/safeLogger.property.test.ts apps/api/src/store/runEventStore.test.ts apps/api/src/middleware/localBoundary.test.ts`をwatchなしで単発実行する。
    - **EXPECTED OUTCOME**: Property 2、一般response、logger、run store、local boundary、実nonce lifecycleの全testがPASSし、suite結果がrandom nonce/request ID値に依存しない。
    - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 3.4 Node built-inとglobal型を正規の型定義で検証する
    - 主な検証領域: `node:util`の`isDeepStrictEqual`・`types`、`node:crypto`の`randomUUID`・`randomBytes`・`timingSafeEqual`、`Buffer`のbase64url encode/decode、`TextEncoder`を使うserialization/store test。
    - テスト/検証: `npm.cmd run typecheck --workspace @ehime-vote-navigator/domain`をwatchなしで単発実行する。
    - テスト/検証: `npm.cmd run typecheck --workspace @ehime-vote-navigator/api`をwatchなしで単発実行する。
    - テスト/検証: `npm.cmd run typecheck`をwatchなしで単発実行する。
    - 完了条件: 全commandがexit code 0となり、`@types/node`と既存DOM libで解決する。`any`、`@ts-ignore`、`@ts-expect-error`、`skipLibCheck`追加・拡大、tsconfig緩和を使用しない。
    - _Requirements: 3.10_

- [x] 4. Checkpoint - 全品質gateをwatchなしで単発実行する
  - テスト/検証: workspace rootから`npm.cmd run lint`を実行し、exit code 0を確認する。
  - テスト/検証: workspace rootから`npm.cmd run typecheck`を実行し、exit code 0を確認する。
  - テスト/検証: workspace rootから`npm.cmd run test`を実行し、Property 1/2を含む全testの成功を確認する。
  - テスト/検証: workspace rootから`npm.cmd run build`を実行し、全workspace buildのexit code 0を確認する。
  - 実行制約: `.ps1` shim、watch mode、development server、PowerShell execution policy変更を使用しない。必要な場合だけdesign.md記載の`node --input-type=module`と`spawnSync`で同じ`npm.cmd`を単発実行する。
  - 完了条件: lint、typecheck、全test、全workspace buildがすべて成功する。失敗時はこのbugfixで変更した範囲だけを修正し、全gateを最初から再実行する。AWS、外部network、課金操作、実資料へ接続しない。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 5. read-only Git確認で変更範囲と検証結果を確定する
  - 検証: `git status --short`で既存変更とこのbugfixの変更を区別し、未関連の変更を編集・復元しない。
  - 検証: `git diff --check`でwhitespace errorがないことを確認する。
  - 検証: `git diff -- .kiro/specs/session-api-redaction-regression/tasks.md apps/api/src/routes/session.ts apps/api/src/routes/session.property.test.ts apps/api/src/app.test.ts apps/api/src/http/responseProjection.test.ts apps/api/src/logging/safeLogger.property.test.ts apps/api/src/store/runEventStore.test.ts apps/api/src/middleware/localBoundary.test.ts`で対象diffだけを確認する。
  - 変更範囲: production変更が`apps/api/src/routes/session.ts`だけであることを確認する。test変更はdesign.md記載の既存test fileだけを許可し、新規test file、public projector、test-only production APIがないことを確認する。
  - 禁止領域確認: generic redactor、一般`projectApiResponse`、logger、run store、local boundary、local nonce生成・比較、tsconfig、`.config.kiro`、`tasks.meta.json`にこのimplementationによる変更がないことを確認する。
  - 報告: 変更fileごとの内容、nonce 1/1,000,000、request ID 899/4,000、directed 12,000、分類不能failure 0、記録済みcounterexampleとseed/path、Property 1/2結果、4品質gate結果を記載する。
  - 実行禁止: `git add`、`git commit`、`git reset`、`git checkout`、`git clean`、stage済み内容の変更を行わない。
  - 完了条件: 許可された既存test群と`session.ts`の最小差分だけで要件追跡が完結し、禁止変更、test無効化、期待500化、固定nonce、型回避、AWS接続、実資料、新機能、選挙データ変更が0件である。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

## Notes

- 今回の更新対象は既存`.kiro/specs/session-api-redaction-regression/tasks.md`だけである。新しいspecを作らず、`.config.kiro`、`tasks.meta.json`、production code、test codeをこの更新作業では変更しない。
- 実装時もgeneric redactor、一般projector、logger、run store、local boundary、nonce生成・比較・ライフサイクル、tsconfigを変更しない。session専用projectorはprivateかつ固定shapeとし、任意allowlistまたはpublic bypassを追加しない。
- 全counterexampleとcredential-like valueはsyntheticまたは探索で記録済みのtest fixtureに限定し、production nonce、credential、実資料を出力しない。
- 新機能、AWS・外部network・課金操作、実資料、選挙データ変更、test skip・削除、期待HTTP statusの500化、固定nonce/request ID、detector依存の再生成、`any`、型抑制directive、`skipLibCheck`変更は完了手段として認めない。
