# Bugfix Requirements Document

## Introduction

`GET /api/v1/session` が、サーバー内部で生成した43文字のbase64url形式process-local nonceまたはUUID形式request IDとgeneric recursive redactionの保護値パターンとの偶発一致により、許可されたHost/Originからの正当なリクエストにも固定safe HTTP 500を返す回帰を修正する。nonce broad sweepでは1,000,000件中、seed `20260903`、generation index/replay path `372`のnonce `_7mdImaYAdAVsMQC1xb3hQHGc975-87932kCjSIF-QQ`が`POSTAL_ADDRESS_PATTERN`の`975-8793`に一致して`data.nonce`を`ADDRESS`としてredactし、generic projectionを失敗させた。requestId-only探索でも4,000件中899件のUUIDが内部の数字-hyphen-数字によって`ADDRESS`と誤検出され、`requestId`のredaction後にgeneric projectionを失敗させた。

修正対象は、`/api/v1/session`のstrict schemaで公開が明示され、サーバー内部で生成された`data.nonce`と`requestId`の両fieldに限定する。session専用の非公開schema-aware projectionは、full candidateを最初にstrict `SessionResponseSchema`へ通し、検証に成功した値だけからresponse bodyを再構成して最終strict検証を行う。この2 fieldはgeneric value-pattern redactorへ渡さず、任意のpath、field、またはvalueを許可するallowlist APIは導入しない。generic redactor、一般response projection、logger、run store、Host/Origin境界、nonce生成と比較、および`Cache-Control: no-store`の動作は変更対象外とする。

## Bug Analysis

### Current Behavior (Defect)

session routeはサーバー内部で生成した`data.nonce`と`requestId`を含むcandidateをgeneric recursive redactionへ通した後、strict `SessionResponseSchema`で再decodeする。いずれかの値が保護値パターンへ偶発一致すると、そのfieldがredaction markerへ置換されてschemaを満たさなくなり、正当なsession responseも固定safe HTTP 500へ変換される。

探索では、上記の実在broad-sweep counterexampleに加え、synthetic nonce `AAAAAAAAAA123-4567BBBBBBBBBBBBBBBBBBBBBBBBB`でも`POSTAL_ADDRESS_PATTERN`による`data.nonce`の`ADDRESS`判定とHTTP 500を再現した。directed探索は`ADDRESS`、AWS access key、およびAWS session tokenを埋め込んだ合計12,000 sampleについて、有効な43文字base64url nonce形状を保ったままgeneric fail-closedへ到達することを確認した。nonceとrequestIdのfield-isolation探索で、これらの分類に該当しないprojection failureは0件だった。

1.1 WHEN 許可されたHost/Originから`GET /api/v1/session`を受け、サーバー内部で生成済みの有効な43文字base64url nonceがgeneric redactorの保護値パターンへ偶発一致する THEN the system `data.nonce`をredaction markerへ置換し、strict `SessionResponseSchema`の再decodeを失敗させ、期待するHTTP 200ではなく固定safe HTTP 500を返す

1.2 WHEN 許可されたHost/Originから`GET /api/v1/session`を受け、サーバー内部で生成済みの有効なUUID request IDがgeneric redactorの保護値パターンへ偶発一致する THEN the system `requestId`をredaction markerへ置換し、strict `SessionResponseSchema`の再decodeを失敗させ、期待するHTTP 200ではなく固定safe HTTP 500を返す

1.3 WHEN 全体テストまたは通常実行が1.1または1.2の条件を満たす値を生成する THEN the system 同じ有効なsession candidateに対する成功可否をnonceまたはrequest IDの乱数値に依存させ、テスト結果またはAPI可用性を非決定的にする

### Expected Behavior (Correct)

session responseで公開が明示されたサーバー内部生成の`data.nonce`と`requestId`は、generic redactionを弱めず、session route内部専用のschema-aware projectionによって安全に返される必要がある。以下の番号付き条項を本修正の受入条件とする。

2.1 WHEN 許可されたHost/Originから`GET /api/v1/session`を受け、生成済みの有効な43文字base64url nonceがgeneric redactorの保護値パターンへ偶発一致する THEN the system SHALL full candidateを最初にstrict `SessionResponseSchema`で検証し、検証済みの`data.nonce`と`requestId`を意図的な公開fieldとしてresponse bodyへ再構成し、最終strict検証に成功した元のnonceとrequest IDを含むHTTP 200応答を返す

2.2 WHEN 許可されたHost/Originから`GET /api/v1/session`を受け、生成済みの有効なUUID request IDがgeneric redactorの保護値パターンへ偶発一致する THEN the system SHALL full candidateを最初にstrict `SessionResponseSchema`で検証し、検証済みの`data.nonce`と`requestId`を意図的な公開fieldとしてresponse bodyへ再構成し、最終strict検証に成功した元のnonceとrequest IDを含むHTTP 200応答を返す

2.3 WHEN 全体テストまたは通常実行が任意の有効な43文字base64url nonceと有効なUUID request IDを持つsession candidateを生成する THEN the system SHALL いずれの値がgeneric保護値パターンへ一致するかに左右されず、元の検証済み値を含むschema-validなHTTP 200応答を返す

2.4 WHEN session response candidateのnonceが無効、request IDが無効、またはcandidateにunknown fieldが存在する THEN the system SHALL 最初のstrict `SessionResponseSchema`検証でcandidateを拒否し、当該値をresponseへ部分的に公開せず、固定safe HTTP 500へfail closedする

2.5 WHEN 最初のstrict検証に成功したsession response bodyを再構成する THEN the system SHALL サーバー内部生成済みの`data.nonce`と`requestId`をgeneric value-pattern redactorへ渡さず、再構成したfull responseを最終strict `SessionResponseSchema`で検証してから送信する

### Unchanged Behavior (Regression Prevention)

修正は`/api/v1/session`でstrict検証済みのサーバー内部生成`data.nonce`と`requestId`を返す内部専用projectionに限定し、他のfield、response、sink、およびlocal-only制約を変更しない。

3.1 WHEN 同一app process内で`GET /api/v1/session`を複数回受ける THEN the system SHALL CONTINUE TO 各応答で同じ43文字base64url nonceを返し、各応答の有効なUUID request IDは独立して生成する

3.2 WHEN 異なるapp instanceを生成して各instanceへ`GET /api/v1/session`を送る THEN the system SHALL CONTINUE TO instanceごとに異なる暗号学的乱数の43文字base64url nonceを返し、各応答に独立した有効なUUID request IDを返す

3.3 WHEN schema-validなsession responseを返す THEN the system SHALL CONTINUE TO `Cache-Control: no-store`を設定する

3.4 WHEN session responseのnonceとrequest IDを公開する THEN the system SHALL CONTINUE TO 両方の値をresponse body内のschema-defined fieldだけに含め、header、log、file、run history、URL、またはその他の永続先へ保存または出力しない

3.5 WHEN session response専用の`data.nonce`と`requestId`以外の一般API応答候補に認証情報、住所、位置情報、または質問が含まれる THEN the system SHALL CONTINUE TO generic redactionと一般response projectionのstrict schema検証によって当該保護値を遮断またはredactし、安全にfail closedする

3.6 WHEN nonceまたはrequest IDと同じ文字列値がsession response内の別fieldまたは別response schemaに現れる THEN the system SHALL CONTINUE TO 通常のfield名とvalue-patternによる保護判定を適用し、session専用の扱いを任意のpath、field、またはvalueに適用できるallowlistとして公開または再利用しない

3.7 WHEN loggerまたはrun storeがsession routeを含む処理を扱う THEN the system SHALL CONTINUE TO 既存のredaction、記録境界、および永続化方針を適用し、session response projectionの限定的な扱いによって保護値の記録範囲を拡大しない

3.8 WHEN 許可されていないHostまたはOriginからsession routeへアクセスする THEN the system SHALL CONTINUE TO local-only request boundaryで拒否する

3.9 WHEN local nonceを生成または比較する THEN the system SHALL CONTINUE TO 既存の暗号学的乱数による32-byte nonce生成、43文字base64url表現、process-localライフサイクル、および既存の比較方式を使用する

3.10 WHEN 修正後のworkspaceをlint、TypeScript型検査、全テスト、および全workspace buildで検証する THEN the system SHALL CONTINUE TO `node:util`、`node:crypto`、`Buffer`、`TextEncoder`を正規の型定義で解決し、`skipLibCheck`緩和または`any`による回避を必要としない
