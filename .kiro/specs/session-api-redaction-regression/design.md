# Session API Redaction Regression Bugfix Design

## Overview

`GET /api/v1/session` は、サーバー内部で生成した process-local nonce と request ID を `data.nonce` と `requestId` に返す。両fieldは strict `SessionResponseSchema` が明示する公開値だが、現在のrouteはfull candidateを一般API応答用の `projectApiResponse` へ渡している。43文字base64url nonceまたはUUID request IDがgeneric protected-value patternへ偶発一致すると、値が `[REDACTED]` へ置換され、その後のstrict schema decodeが失敗し、許可済みHost/Originからの正当なsession GETも固定safe HTTP 500になる。

探索では、nonce broad sweep 1,000,000件中1件とrequestId-only 4,000件中899件で、この回帰を確認した。したがって、nonceだけを分離し、requestIdをgeneric metadata projectionへ通す旧推奨案は成立しない。本設計では、`/api/v1/session`だけで使うprivate schema-aware projectorが、サーバー内部生成のprimitive nonceとrequestIdからfull candidateを構築し、最初にstrict `SessionResponseSchema`で検証する。検証済みの両値を同じschema-defined fieldへ明示的に再構成し、最終strict検証に成功したbodyだけを送信する。nonceとrequestIdはgeneric value-pattern redactorへ渡さない。

修正範囲は `apps/api/src/routes/session.ts` と既存bugfix計画で指定済みのtestだけに限定する。generic redactor、一般 `projectApiResponse`、logger、run store、local-only boundary、nonce生成・比較・ライフサイクルは変更しない。任意のpath、field、value、またはresponseで再利用できるallowlist APIは導入しない。

## Glossary

- **Bug_Condition (C)**: 許可済みsession GETのstrict-schema-valid nonceまたはrequest IDがgeneric redactionで保護値と誤判定され、元のgeneric session projectionが失敗する条件
- **Property (P)**: Cを満たしても、元のnonceとrequest IDをschema-defined fieldだけに含むstrict-schema-validなHTTP 200を返す性質
- **Preservation**: Cを満たさないsession挙動と、session以外のresponse、logger、run store、local boundary、nonce lifecycleに対する既存動作を変更しないこと
- **`SessionResponseSchema`**: `apps/api/src/routes/session.ts`にある、`ok`、`data.nonce`、`requestId`だけを許可するstrict Zod schema
- **Session_Private_Projector**: `/api/v1/session`内部だけで使い、primitive nonceとrequest IDをstrict検証・再構成・最終strict検証する非公開projector
- **`projectApiResponse`**: `apps/api/src/http/responseProjection.ts`にある、generic redaction、strict decode、再redaction、再decode、最終auditを行う一般API応答projector
- **`redactProtectedValues`**: `packages/domain/src/security/redact.ts`にある、保護値を再帰的に検出・置換し、unsafe object graphを拒否するgeneric redactor
- **`detectProtectedTextKind`**: 文字列をcredential、bearer token、address、coordinates、AI questionなどの保護値種別、または非保護値として分類する関数
- **Capability_Nonce**: `createLocalNonce`が `node:crypto.randomBytes(32)` から生成し、同一app process中だけ保持する43文字base64url値
- **Request_ID**: session requestごとに `node:crypto.randomUUID()` が生成し、`SessionResponseSchema`のUUID制約を満たす値
- **F**: 未修正コードの `projectApiResponse(SessionResponseSchema, candidate)`
- **F'**: 修正後のSession_Private_Projector
- **Counterexample**: strict `SessionResponseSchema`には適合するが、Fではsafeなsession responseを生成できない具体的なnonceまたはrequest ID

## Bug Details

### Bug Condition

入力領域を次のように定義する。

- `N = { n ∈ [A-Za-z0-9_-]^43 | Base64UrlDecode(n)の長さ = 32 bytes }`
- `U = { u | uはSessionResponseSchemaのUUID制約に適合する }`
- `S = { { ok: true, data: { nonce: n }, requestId: u } | n ∈ N, u ∈ U }`
- `K(v) = detectProtectedTextKind(v)`
- `R(v) = redactProtectedValues(v)`
- `F(s) = projectApiResponse(SessionResponseSchema, s)`

bug conditionはnonce衝突とrequest ID衝突の和集合である。

`C = { X | X.requestAllowed ∧ X.candidate ∈ S ∧ F(X.candidate).ok = false ∧ ((K(X.candidate.data.nonce) ≠ null ∧ R(X.candidate).data.nonce = "[REDACTED]") ∨ (K(X.candidate.requestId) ≠ null ∧ R(X.candidate).requestId = "[REDACTED]")) }`

Cは未修正関数Fに対して固定する。F'導入後も、同じ入力が修正対象かを判定するためにFの観測結果を使う。

**Formal Specification:**

```text
FUNCTION isBugCondition(input)
  INPUT: input of type SessionRequestCase
  OUTPUT: boolean

  IF NOT input.requestAllowed THEN
    RETURN false
  END IF

  parsed := SessionResponseSchema.safeParse(input.candidate)
  IF NOT parsed.success THEN
    RETURN false
  END IF

  redacted := redactProtectedValues(parsed.data)
  originalProjection := projectApiResponse(
    SessionResponseSchema,
    parsed.data
  )

  nonceCollision :=
    detectProtectedTextKind(parsed.data.data.nonce) IS NOT null
    AND redacted.data.nonce = REDACTED_VALUE

  requestIdCollision :=
    detectProtectedTextKind(parsed.data.requestId) IS NOT null
    AND redacted.requestId = REDACTED_VALUE

  RETURN originalProjection.ok = false
         AND (nonceCollision OR requestIdCollision)
END FUNCTION
```

### Confirmed Exploration Results

探索結果と更新済み `bugfix.md` を本設計の正本とする。

| 探索 | Sample数 | 観測結果 | 結論 |
| --- | ---: | --- | --- |
| 32-byte nonce broad sweep | 1,000,000 | protected/projection-failing nonce 1件 | nonceの低頻度衝突を確認 |
| requestId-only isolation | 4,000 | protected/projection-failing UUID 899件 | requestIdをgeneric metadata projectionへ残せない |
| Directed nonce intersections | 12,000 | ADDRESS、AWS access key、AWS session tokenを埋めたvalid nonceがgeneric fail-closedへ到達 | 複数patternとの交差を確認 |
| nonce/requestId field isolation | 上記探索内 | protected kindで説明できないprojection failure 0件 | 観測failureは両fieldのvalue-pattern分類で説明可能 |

Broad sweepはseed `20260901`、`20260902`、`20260903`、`20260904`を各250,000件使用した。唯一のhitはseed `20260903`、generation index/replay path `372`の次のnonceである。

```text
_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ
```

この値は43文字base64url形状を維持したまま、部分文字列 `975-8793` が `POSTAL_ADDRESS_PATTERN` に一致した。`detectProtectedTextKind`は `ADDRESS` を返し、redacted field pathは `data.nonce`、Fの結果はfailureだった。

requestId-only探索の最初のcounterexampleはseed `20260901`、generation index/replay path `1`の次のUUIDである。

```text
71f9383a-0201-4659-ba07-06d9d35b0302
```

部分文字列 `201-4659` が郵便番号形式に一致し、`requestId`が `ADDRESS` としてredactされた。ほかのseedの最初のcounterexampleは `063af900-02fe-45fe-8600-9206073cfa00`、`6a005102-0607-40f8-8020-02b00372a960`、`035afad7-0201-4335-adfa-dcfd4a7e0105` であり、いずれもfield path `requestId`、kind `ADDRESS`、generic projection failureだった。

Directed探索は3種のintersection generatorを4 seedで各1,000件、合計12,000件実行した。各sampleは43文字base64url nonceとして有効なまま、`ADDRESS`、`AWS_ACCESS_KEY_ID`、または`AWS_SESSION_TOKEN`へ分類され、generic projectionのfixed fail-closedへ到達した。

### Failure Mechanism

1. `registerSessionRoute`が `nonce.revealForSession()` と `randomUUID()` からstrict schema候補を作る。
2. 現在の `sendProjectedJson` がfull candidateを `projectApiResponse` へ渡す。
3. generic redactorがnonceまたはrequest IDの部分文字列を保護値patternとして検出し、該当fieldを `[REDACTED]` に置換する。
4. `[REDACTED]` は43文字base64url制約にもUUID制約にも適合しないため、`SessionResponseSchema.safeParse`が失敗する。
5. response projectionはcandidate値を含まない固定 `SAFE_RESPONSE_PROJECTION_ERROR` を返し、routeのstatusは500になる。
6. どちらのfieldが偶発一致するかは乱数値に依存するため、API可用性とtest結果が非決定的になる。

### Examples

- **実在broad-sweep nonce**: `_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ`。期待値は元nonceとUUID request IDを含むHTTP 200、未修正Fは`data.nonce`をredactして固定500を返す。
- **決定的synthetic nonce**: `AAAAAAAAAA123-4567BBBBBBBBBBBBBBBBBBBBBBBBB`。seed `20260901`、path `0`のroute counterexampleであり、`123-4567`が`POSTAL_ADDRESS_PATTERN`に一致する。safe control request IDを使っても未修正routeはHTTP 500になる。
- **実在request ID counterexample**: `71f9383a-0201-4659-ba07-06d9d35b0302`。safe control nonceを使っても`requestId`が`ADDRESS`としてredactされ、未修正Fは失敗する。
- **両field衝突**: directed nonceと記録済みprotected UUIDを同じcandidateに置いた場合、F'は両方の元値をそれぞれ`data.nonce`と`requestId`へ返す必要がある。
- **非衝突例**: nonce `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` と非保護UUIDでは、FとF'が同じschema-level bodyを返す。
- **schema不適合edge case**: 42文字または44文字のnonce、base64url外文字を含むnonce、invalid UUID、またはunknown fieldを含むcandidateは公開対象ではない。最初のstrict validationで拒否し、値やparse issueを含まない固定safe HTTP 500にする。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- 同一app instanceへの複数session GETは同じ43文字base64url nonceを返し、requestごとに独立したUUID `requestId`を返す。
- 異なるapp instanceは `node:crypto.randomBytes(32)` に基づく異なるnonceを持つ。
- session responseは `Cache-Control: no-store, max-age=0`、`Expires: 0`、`Pragma: no-cache` を維持する。
- nonceとrequest IDはresponse body内の `data.nonce` と `requestId` 以外のheader、log、file、run history、URL、errorへ保存または出力しない。
- 一般API responseは引き続き `projectApiResponse` のgeneric redaction、strict decode、再audit、fixed fail-closed契約を使う。
- safe loggerは引き続き `serializeRedactedValue` を使い、run event storeはappend前に `redactProtectedValues` を使う。
- nonceまたはrequest IDと同じ文字列がsession内の別field、別response schema、logger、またはrun storeに現れた場合は、通常のfield名とvalue-patternによる保護判定を適用する。
- local-only middlewareのHost、Origin、method、mutation nonce判定、およびmiddleware順序を変更しない。
- `createLocalNonce` の32-byte暗号学的乱数生成、43文字base64url表現、closure内保持、`timingSafeEqual`による比較、processごとのrotationを変更しない。
- `SAFE_RESPONSE_PROJECTION_ERROR` のstatus、body、値非反射性を変更しない。
- Node built-inとglobal型は既存の正規型定義で解決し、`skipLibCheck`、`any`、または型抑制directiveによる回避を追加しない。

**Scope:**

session専用の扱いは、route内部で生成し、full `SessionResponseSchema`の最初のstrict validationに成功した両primitiveにだけ適用する。F'は任意objectを受け取る公開APIではなく、任意のpath、field、value、または他responseへ許可を広げる仕組みを持たない。

| 境界 | 修正後の方針 |
| --- | --- |
| Session `data.nonce` | full candidateの最初のstrict validation後、検証済み値を同じfieldへ再構成。generic redactorへ渡さない |
| Session `requestId` | full candidateの最初のstrict validation後、検証済み値を同じfieldへ再構成。generic redactorへ渡さない |
| Session `ok` | strict literal `true`として検証し、同じfieldへ再構成 |
| Sessionのinvalid nonce / invalid UUID | 最初のstrict validationで拒否し、固定safe HTTP 500 |
| Sessionのunknown field | `SessionResponseSchema.strict()`で拒否し、固定safe HTTP 500。projectorはobject spreadや任意candidate入力を持たない |
| 一般API response | `projectApiResponse`を含め変更なし |
| Logger | allowlistなし、変更なし |
| Run event store / filesystem | allowlistなし、変更なし |
| Header / URL / error | nonceとrequest IDを渡さない |
| Local request boundary | 変更なし。拒否requestはprojectorへ到達しない |

## Hypothesized Root Cause

静的分析で立てた仮説は探索によって次のように確認された。

1. **Nonceとsubstring detectorのintersection**: `POSTAL_ADDRESS_PATTERN`は文字列内の3桁、hyphen、4桁を検出する。43文字base64urlは数字とASCII hyphenを許可するため、有効なnonceが低頻度で`ADDRESS`へ誤分類される。
   - 1,000,000件中1件のbroad-sweep counterexampleがこの経路を実証した。
   - Directed 12,000 sampleは`ADDRESS`だけでなく、base64urlと交差するAWS access keyおよびAWS session token形式でも同じgeneric fail-closedへ到達することを確認した。

2. **UUIDとsubstring detectorの高頻度intersection**: UUIDはdigitとhyphenを構造上含むため、隣接segmentの一部が `ddd-dddd` を形成し得る。
   - requestId-only 4,000件中899件が`ADDRESS`として誤分類された。
   - requestIdをgeneric metadata projectionへ残す旧推奨案では、正当なsession responseの非決定的500を解消できない。

3. **Redaction markerとstrict schemaの不一致**: generic redactorは仕様どおり該当値を `[REDACTED]` にするが、このmarkerはnonce regexにもUUID制約にも適合しない。後段のstrict decodeが正しくfail closedするため、generic detectorや一般projectorを緩和するべきではない。

4. **Projection境界の不一致**: session routeはサーバー自身が生成し、strict response schemaで公開を明示した両値を、任意の一般API candidateと同じvalue-pattern heuristicへ渡している。修正点はdetectorではなく、このroute固有のprojection境界である。

5. **未知のpipeline failureは観測されていない**: nonce/requestId field-isolationでは、いずれのfieldもprotected kindへ分類されないのにFが失敗したsampleは0件だった。修正は確認済みの両fieldに限定し、別原因を仮定した広い変更を行わない。

## Correctness Properties

期待動作Pを次のように定義する。

```text
FUNCTION expectedBehavior(input, result)
  INPUT: input of type SessionRequestCase
         result of type HttpSessionResult
  OUTPUT: boolean

  parsedInput := SessionResponseSchema.safeParse(input.candidate)
  parsedBody := SessionResponseSchema.safeParse(result.body)

  RETURN input.requestAllowed
         AND parsedInput.success
         AND result.status = 200
         AND parsedBody.success
         AND parsedBody.data.data.nonce = parsedInput.data.data.nonce
         AND parsedBody.data.requestId = parsedInput.data.requestId
         AND result.headers.cacheControl CONTAINS "no-store"
         AND valueOccursOnlyAt(
               result,
               parsedInput.data.data.nonce,
               "body.data.nonce"
             )
         AND valueOccursOnlyAt(
               result,
               parsedInput.data.requestId,
               "body.requestId"
             )
END FUNCTION
```

Property 1: Bug Condition - Explicit Session Nonce and Request ID Projection

_For any_ allowed session input where the bug condition holds (`isBugCondition` returns true because the valid nonce, the valid request ID, or both are redacted by F), F' SHALL construct the full candidate only from the server-generated primitive values, strictly validate it, preserve both validated values without passing either value to the generic value-pattern redactor, reconstruct them only at `data.nonce` and `requestId`, strictly validate the final body, and produce a result satisfying `expectedBehavior`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

Property 2: Preservation - Strict Failure and Non-Session Behavior

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), F' SHALL preserve F's schema-level successful result for valid non-collision session candidates, return the unchanged fixed safe HTTP 500 for invalid nonce, invalid UUID, or unknown-field candidates, preserve the local boundary result for rejected requests, and leave the generic response, logger, run-store, nonce-lifecycle, cache, and type-resolution behavior unchanged.

**Validates: Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**
## Fix Implementation

### Alternatives Considered

| Option | Method | Security and correctness | Blast radius | Decision |
| --- | --- | --- | --- | --- |
| A. Full session private strict projector | primitive nonceとrequest IDからfull candidateを作り、initial strict validation、validated-value reassembly、final strict validationを行う | 両値の公開意図をrouteとschemaへ局所化し、invalid shapeをfail closedできる。generic redactorへ両値を渡さない | `session.ts`と既存対象testだけ | **採用** |
| B. Nonceだけを分離しrequestIdをgeneric metadata projectionへ渡す | validated nonceを退避し、`ok`と`requestId`を`projectApiResponse`へ渡す | requestId-only 4,000件中899件で同じfalse positiveが起きたため、回帰を解消しない | session route | **旧推奨案を廃止** |
| C. Generic projectorへallowlist追加 | path、field、またはvalueの除外optionを追加する | 呼出し誤用や再利用によってsession以外の保護値を公開し得る | 全API response | 不採用 |
| D. Protected-value detectorを緩和 | UUID/base64url、特定pattern、または発見値を検出対象外にする | 一般response、logger、run storeで本物の住所やcredentialを見逃し得る | 全generic sink | 不採用 |
| E. Session bodyをschema validationなしで直接送信 | generic projectorを迂回し、そのまま`response.json`へ渡す | invalid値、unknown field、将来fieldをfail closedできず、固定safe failure契約も失う | session response全体 | 不採用 |
| F. 衝突しない値まで再生成する | detectorがnullになるまでnonceまたはrequest IDを作り直す | 生成分布と可用性をheuristicへ従属させ、generic detector変更時に再発する | nonce/request ID生成 | 不採用 |

### Recommended Data Flow

Session_Private_Projectorは `apps/api/src/routes/session.ts` 内のprivate functionとする。入力はrouteが取得したprimitive `nonceValue` と `requestIdValue`だけであり、任意object、field名、path、allowlist、schema、またはcallbackを受け取らない。candidateは明示的なobject literalで構築し、spreadを使わない。

```text
FUNCTION projectSessionResponse(nonceValue, requestIdValue)
  INPUT: nonceValue of primitive string from LocalNonce
         requestIdValue of primitive string from randomUUID
  OUTPUT: SessionProjectionResult

  TRY
    candidate := {
      ok: true,
      data: { nonce: nonceValue },
      requestId: requestIdValue
    }

    initialValidation := SessionResponseSchema.safeParse(candidate)
    IF NOT initialValidation.success THEN
      RETURN fixedSafeProjectionFailure()
    END IF

    validated := initialValidation.data
    assembled := {
      ok: validated.ok,
      data: { nonce: validated.data.nonce },
      requestId: validated.requestId
    }

    finalValidation := SessionResponseSchema.safeParse(assembled)
    IF NOT finalValidation.success THEN
      RETURN fixedSafeProjectionFailure()
    END IF

    RETURN {
      ok: true,
      body: finalValidation.data
    }
  CATCH
    RETURN fixedSafeProjectionFailure()
  END TRY
END FUNCTION
```

`fixedSafeProjectionFailure()`は既存の `SAFE_RESPONSE_PROJECTION_ERROR` だけをbodyにし、`SAFE_RESPONSE_PROJECTION_ERROR_STATUS`を使う。candidate、nonce、request ID、parse issue、exception textはerrorへ反射しない。

送信処理はprojectorのresultだけを受け取り、success時はHTTP 200、failure時は固定HTTP 500を送る。既存の `Cache-Control: no-store, max-age=0`、`Expires: 0`、`Pragma: no-cache` はbody送信前に設定する。initial validationの前後を含め、nonceとrequest IDをlogger、run store、header、URL、file、またはerrorへ渡さない。

このdata flowでは `projectApiResponse` と `redactProtectedValues` をsession candidateへ呼び出さない。両値をgeneric heuristicから除外する根拠は、次の条件の積に限定される。

1. 値がサーバー内部の `LocalNonce` と `randomUUID()` からprimitiveとして得られる。
2. `/api/v1/session` のprivate projector内部で固定shapeへ配置される。
3. full candidateがstrict `SessionResponseSchema`のinitial validationに成功する。
4. validation outputから同じschema-defined fieldへだけ再構成される。
5. final full responseが同じstrict schemaのvalidationに成功する。

いずれかを満たさない値は公開しない。unknown fieldは固定object constructionで受入口を持たず、将来candidateへ誤って追加された場合もinitial `strict()` validationが拒否する。

### Changes Required

**Production file**: `apps/api/src/routes/session.ts` のみ

**Functions and schema**: `SessionResponseSchema`、`registerSessionRoute`、private session projector/sender

**Specific Changes**:

1. **Private result path**: session専用のsuccess/fixed-failure resultとprivate projectorを同じfile内に定義する。projectorをexportせず、一般用途のoptionを持たせない。
2. **Explicit full candidate**: `nonce.revealForSession()` と `randomUUID()` のprimitiveから、`ok`、`data.nonce`、`requestId`だけを持つcandidateを構築する。
3. **Initial strict validation**: bodyの一部を送信または再構成する前に、full candidateを `SessionResponseSchema.safeParse` へ通す。
4. **Two-field reassembly**: validation outputのnonceとrequest IDを、それぞれ同じ `data.nonce` と `requestId` へ再構成する。どちらも `projectApiResponse` または `redactProtectedValues` へ渡さない。
5. **Final strict validation**: assembled bodyを `SessionResponseSchema.safeParse` で再検証し、成功値だけをHTTP 200で送信する。
6. **Fixed fail-closed response**: initial validation、final validation、または例外のすべてを既存の固定safe HTTP 500へ変換し、入力値やdiagnosticを反射しない。
7. **Header and lifecycle preservation**: 既存cache header、requestごとの `randomUUID()` 呼出し、process-local nonceの取得順と回数を維持する。

`SessionMetadataSchema`は導入しない。nonceだけを退避してrequestIdをgeneric projectionへ渡す旧data flowは削除する。

### Test Files Within Scope

変更可能なtestは既存bugfix計画で指定済みの次のfileに限定する。新しいtest fileやtest-only production entry pointは追加しない。

- `apps/api/src/routes/session.property.test.ts`: C、探索記録、Property 1、Property 2をnonceとrequest IDの両fieldへ更新する。
- `apps/api/src/app.test.ts`: 実appのnonce lifecycle、request ID独立性、cache header、body外非露出を確認する。
- `apps/api/src/http/responseProjection.test.ts`: 同じcounterexampleが一般 `projectApiResponse` では引き続きredact/fail closedすることを確認する。
- `apps/api/src/logging/safeLogger.property.test.ts`: nonce/request ID counterexampleがloggerへ置かれた場合に原値が残らないことを確認する。
- `apps/api/src/store/runEventStore.test.ts`: 同じ値がrun event diagnosticへ置かれた場合に保存bytesへ原値が残らないことを確認する。
- `apps/api/src/middleware/localBoundary.test.ts`: 不許可Host/Originがsession projector到達前に拒否されることを確認する。

### Prohibited Changes

- `packages/domain/src/security/redact.ts` のpattern、分類、recursive redaction
- `apps/api/src/http/responseProjection.ts` のgeneric algorithmまたは公開API
- `apps/api/src/logging/safeLogger.ts`、`apps/api/src/store/runEventStore.ts`、`apps/api/src/middleware/localBoundary.ts`、`apps/api/src/middleware/localNonce.ts`
- session以外から利用できるpath/field/value allowlist、bypass option、またはprojector export
- production nonce/request IDの固定、短縮、detector依存の再生成、または決定的生成
- generic redactionの削除、弱化、fail-open化
- `any`、`@ts-ignore`、`@ts-expect-error`、`skipLibCheck`変更、tsconfig緩和
- testのskip、削除、sample数によるごまかし、または期待statusの500への変更
- `.config.kiro`、`tasks.md`、`tasks.meta.json`の変更
- AWS接続、外部network、課金操作、実資料読込み、新機能、選挙データ変更
## Testing Strategy

### Validation Approach

検証は、完了済みの探索結果を再現可能なfixtureとして固定し、修正後に同じCでfix checkingを行う。その後、未修正コードで先に観測した¬Cの挙動と非session sinkをpreservation checkingで比較する。通常suiteには記録済みcounterexampleと軽量propertyを残し、1,000,000件broad sweepと12,000件directed探索は明示的な探索modeで再実行できるようにする。

### Exploratory Bug Condition Checking

**Goal**: 未修正コードでnonceとrequest IDのどちらがどのprotected patternへ一致し、generic redactionとstrict decodeのどの段階で固定500へ変わるかを確定する。

**Completed Test Plan**:

1. `fc.uint8Array({ minLength: 32, maxLength: 32 })`を43文字base64url nonceへ変換し、4 seedを各250,000件、合計1,000,000件実行した。
2. UUID v4 arbitraryを4 seedで各1,000件、合計4,000件実行し、safe control nonceでrequestId-only failureを分離した。
3. `POSTAL_ADDRESS_PATTERN`、AWS access key形式、AWS session token形式をvalid nonceへ埋め込む3 arbitraryを、4 seedで各1,000件、合計12,000件実行した。
4. nonce-only、requestId-only、両field independent-seedのisolation matrixで、kind、redacted field path、Fのresultを記録した。
5. typed `LocalNonce` test doubleを使うallowed route harnessでsynthetic nonceを再生し、未修正routeが期待200ではなく固定500を返すことを確認した。

**Observed Counterexamples**:

- Nonce broad sweep: seed `20260903`、index/path `372`、`_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ`、kind `ADDRESS`、pattern `POSTAL_ADDRESS_PATTERN`、field `data.nonce`
- Route replay: seed `20260901`、path `0`、`AAAAAAAAAA123-4567BBBBBBBBBBBBBBBBBBBBBBBBB`、kind `ADDRESS`、field `data.nonce`、actual HTTP 500
- Request ID isolation: seed `20260901`、index/path `1`、`71f9383a-0201-4659-ba07-06d9d35b0302`、kind `ADDRESS`、field `requestId`

**Observed Totals**:

- Nonce broad sweep: 1 / 1,000,000
- Request ID isolation: 899 / 4,000
- Directed nonce intersections: 12,000 sampleで対象分類とgeneric fail-closedを確認
- Classified field以外のprojection failure: 0

この探索により、requestId交絡を除外するという旧仮説は反証された。実装とfix checkingはnonceとrequest IDの両fieldを対象にする。

### Fix Checking

**Goal**: Cを満たすすべての生成入力について、F'が両fieldの元値を保持し、Pを満たすことを確認する。

```text
FOR ALL input WHERE isBugCondition(input) DO
  result := projectSessionResponse_fixed(
    input.candidate.data.nonce,
    input.candidate.requestId
  )
  ASSERT expectedBehavior(input, asHttpResult(result))
END FOR
```

**Checks**:

- 記録済みnonce counterexampleをsafe control request IDと組み合わせ、Fは失敗しF'は元nonceを含むstrict successになる。
- 記録済みrequest ID counterexampleをsafe control nonceと組み合わせ、Fは失敗しF'は元request IDを含むstrict successになる。
- protected nonceとprotected request IDを同時に組み合わせ、F'が両方をbyte-for-byteで保持する。
- ADDRESS、AWS access key、AWS session tokenと交差するvalid nonce arbitraryに対し、F'が元nonceと元request IDを返す。
- result bodyが最終 `SessionResponseSchema` に適合し、nonceとrequest IDがそれぞれ `data.nonce` と `requestId` に一度だけ現れ、headerとerrorへ現れない。
- invalid nonceまたはinvalid UUIDではinitial strict validationが失敗し、candidate値を含まない固定safe HTTP 500になる。
- unknown fieldを含むfull candidateは `SessionResponseSchema.strict()` が拒否する。production projectorにはunknown fieldを注入できるobject/spread interfaceが存在しないことも確認する。

Private projectorをtest用にexportしたり、production routeへrequest ID factory optionを追加したりしない。requestId route counterexampleの決定的再生が必要な場合は、既存 `session.property.test.ts` 内で `node:crypto` の `randomUUID` だけをpartial module mockし、ほかのcrypto exportとproduction APIを変更しない。

### Preservation Checking

**Goal**: ¬Cのsession入力について既存の観測可能動作を保ち、session以外ではgeneric sinkの結果を変更しないことを確認する。

```text
FOR ALL input WHERE NOT isBugCondition(input) DO
  IF input.requestAllowed
     AND SessionResponseSchema.safeParse(input.candidate).success
     AND F(input.candidate).ok THEN
    fixed := F'(
      input.candidate.data.nonce,
      input.candidate.requestId
    )
    ASSERT fixed.ok
    ASSERT SessionResponseSchema.parse(fixed.body)
           = SessionResponseSchema.parse(F(input.candidate).body)
  END IF
END FOR

FOR ALL invalidCandidate DO
  ASSERT F'(invalidCandidate.nonce, invalidCandidate.requestId)
         = FIXED_SAFE_HTTP_500
END FOR

FOR ALL protectedValue, sink
WHERE sink IS NOT session.data.nonce
  AND sink IS NOT session.requestId DO
  ASSERT sink_after(protectedValue) = sink_before(protectedValue)
END FOR
```

**Preservation Cases**:

1. 非衝突のvalid nonceとvalid UUIDでは、FとF'のstrict-decoded bodyが同値になる。
2. 同じapp instanceへの複数GETではnonceが同一で、request IDはrequestごとに異なるvalid UUIDになる。
3. 異なるapp instanceではnonceがrotationし、32 random bytesからの43文字base64url形状を維持する。
4. 3種類のcache headerとHTTP 200 success statusを維持する。
5. counterexample文字列を一般DTO fieldへ置くと、generic `projectApiResponse`が従来どおりredactまたはfixed fail closedする。
6. counterexample文字列をlogger eventとrun event diagnosticへ置くと、serialized outputまたは保存bytesに原値が残らない。
7. nonceまたはrequest IDと同じ値をsessionのunknown fieldへ置くと、strict schemaが拒否する。
8. 不許可HostまたはOriginではsession handlerが値を公開する前にlocal boundaryが既存403を返す。
9. invalid candidateのfixed 500はnonce、request ID、parse issue、exceptionを含まない。
10. source側のNode built-in/global型は既存設定で解決し、型回避を必要としない。

### Unit Tests

- `SessionResponseSchema`が43文字base64url nonce、UUID request ID、literal `ok: true`だけを受け入れ、invalid nonce、invalid UUID、nested/root unknown fieldを拒否する。
- nonce-only、requestId-only、両field衝突の各candidateについて、generic Fはfixed failure、session routeのF'はstrict successになる。
- initial validationまたはfinal validationが失敗した場合、固定safe errorだけを返し、candidate dataを反射しない。
- private projectorが `projectApiResponse`、`redactProtectedValues`、任意allowlistを使用せず、validation outputだけからexact shapeを再構成する。
- generic `projectApiResponse`の既存redact-first、transform audit、unsafe graph rejectionを変更しない。

### Property-Based Tests

- **Property 1 nonce collision**: 32-byte arbitraryとdirected intersection arbitraryからvalid nonceを生成し、nonceがCの原因ならF'が元nonceと元request IDを含むstrict successを返す。
- **Property 1 request ID collision**: UUID v4 arbitraryまたは記録済みADDRESS-intersection UUIDを使い、request IDがCの原因ならF'が元nonceと元request IDを含むstrict successを返す。
- **Property 1 combined collision**: protected nonceとprotected UUIDを組み合わせ、どちらもgeneric redactorへ渡さず同じschema-defined fieldに保持する。
- **Property 2 session preservation**: 両fieldが非保護のvalid candidateについて、FとF'のschema-level resultを比較する。
- **Property 2 sink preservation**: counterexampleを一般DTO、logger event、run event diagnosticの生成位置へ置き、既存のredactionまたはfixed failureと入力非mutationを維持する。
- seed、counterexample、generation index、replay pathは既存 `tests/harness/fast-check.ts` のparameter/reporting方式で再現可能にする。通常suiteでは軽量run数を使い、探索modeだけで全sampleを再実行する。

### Integration Tests

- typed `LocalNonce` test doubleでnonce counterexampleを注入し、許可済みHost/Originへのsession GETがHTTP 200、strict body、元nonce、valid request ID、no-storeを返す。
- test-only partial `node:crypto` mockで記録済みrequest IDを返し、safe nonceとのrequestId-only case、およびprotected nonceとのcombined caseをpublic route経由で確認する。production injection optionは追加しない。
- 同じappへの複数GETでnonce同一、request ID相違、両値のheader非出現を確認する。
- 異なる `createApp()` instanceでnonceがrotationする既存testを維持する。
- 不許可Host/Originではprivate projectorへ到達せず、既存403 responseとなることを確認する。
- network guard下で実行し、AWSまたは外部networkへ接続しない。

### Type and Build Verification

型検証では既存の `@types/node` とDOM libを使い、次を再確認する。

- `node:util`: `isDeepStrictEqual` と `types`
- `node:crypto`: `randomUUID`、`randomBytes`、`timingSafeEqual`、hash API
- `Buffer`: base64url encode/decodeとUTF-8比較
- `TextEncoder`: canonical serializationとstore tests

PowerShell execution policyを変更せず、workspace rootからwatchなしの単発commandを実行する。

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

### Completion Criteria

- design、Property 1、Property 2がnonceとrequest IDの両fieldを扱い、requestId generic metadata projectionの旧推奨案を残していない。
- nonce 1 / 1,000,000、request ID 899 / 4,000、directed 12,000、分類不能failure 0の探索結果と再現可能counterexampleを記録している。
- full candidateのinitial strict validation、両validated valueの同field reassembly、final strict validation、fixed safe failureが実装されている。
- nonceとrequest IDをgeneric value-pattern redactorへ渡していない。
- invalid nonce、invalid UUID、unknown fieldが固定safe HTTP 500へfail closedし、値またはdiagnosticを反射しない。
- production変更は `apps/api/src/routes/session.ts` だけで、test変更は本設計の既存対象fileだけである。
- generic redactor、一般 `projectApiResponse`、logger、run store、local boundary、nonce生成・比較、tsconfigを変更していない。
- session以外へ適用できるallowlist、bypass option、public projectorを追加していない。
- Property 1のnonce-only、requestId-only、combined counterexample replayとdirected propertyがすべて成功する。
- Property 2のsession、一般response、logger、run store、local boundary、nonce lifecycle preservation testsがすべて成功する。
- `npm.cmd run lint`、`npm.cmd run typecheck`、`npm.cmd run test`、`npm.cmd run build`がすべてexit code 0で完了する。
- `node:util`、`node:crypto`、`Buffer`、`TextEncoder`が正規型で解決し、`any`、型抑制、tsconfig緩和を追加していない。
- AWS、外部network、実資料、新機能、選挙データへ触れていない。