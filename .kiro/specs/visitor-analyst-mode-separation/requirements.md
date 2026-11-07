# Requirements Document

## Introduction

`visitor-analyst-mode-separation`は、既存の「えひめ投票ナビ」webを利用者モードと分析者モードに分離する。通常の開発、build、previewでは利用者モードをfail-closedの既定値とし、共同開発者向けの画面、URL、導線、および説明を利用者向け画面から除外する。分析者画面は明示的なローカル分析者用commandで起動またはbuildした場合だけ利用できる。

本更新は、公開側の独立した「出典一覧」機能だけを対象から外す。Visitor Homeと共通navigationから`/sources`への導線を除去し、Visitor RouterとAnalyst Routerのどちらにも`/sources`を登録しない。`/sources`への直接entryは既存shellを維持する404を表示する。参照がなくなった公開`SourcesPage` componentは削除する。一方、政策単位や候補者情報に付随する出典、根拠引用、根拠link、locator、来歴、source data、および内部`/analyst/sources`のSource Manifest管理は維持する。APIとdomain機能は変更しない。

この差分は、既存`.kiro/specs/ehime-vote-navigator/requirements.md`のRequirement 19.1にあるHomeから独立した出典一覧へ移動する導線だけを上書きする。政策情報へ付随する出典表示や根拠要件は上書きしない。既存の`.kiro/specs/ehime-vote-navigator/`文書自体は編集せず、本specで優先される差分を定義する。

本featureは既存の分析者機能を削除せず、認証機能を追加しない。既存のloopback限定、過去選挙表示、`NOT_READY`、共通shell、アクセシビリティ、および残存するP0 route contractを、各モードに適用できる範囲で維持する。`tasks.meta.json`は変更しない。

## Glossary

- **えひめ投票ナビweb**: `apps/web`に実装されたReact、TypeScript、Vite、React RouterのブラウザーUI。
- **Application_Mode**: えひめ投票ナビwebのroute集合と内部導線を決定する`VISITOR`または`ANALYST`の値。
- **Visitor_Mode**: 会場利用者向け画面だけを公開するfail-closedの既定Application_Mode。
- **Analyst_Mode**: 会場利用者向け画面に加えて共同開発者向け分析画面を公開する、明示的に選択されたApplication_Mode。
- **Normal_Command**: modeを明示しない通常の`npm run dev`、`npm run build`、`npm run preview`および対応するweb workspace command。
- **Explicit_Analyst_Command**: Analyst_Modeを明示して起動、build、またはpreviewする専用command。
- **Mode_Resolver**: 起動時またはbuild時に指定されたmodeを`VISITOR`または`ANALYST`へ正規化する処理。
- **Visitor_Router**: 会場利用者向けrouteとwildcard 404だけを登録するReact Router構成。
- **Analyst_Router**: 会場利用者向けroute、既存の分析者route、およびwildcard 404を登録するReact Router構成。
- **Visitor_Home**: Visitor_Modeで表示する`/`画面。
- **Shared_Navigation**: 既存`AppShell`内の共通ナビゲーション。
- **Analyst_Internal_Content**: `/analyst/*`へのlink、分析者画面名、分析操作の説明、Source Manifest、run、検証、承認、評価、P0判定、AWS診断など共同開発者向けの導線または説明。
- **Existing_Analyst_Route**: `/analyst/readiness`、`/analyst/sources`、`/analyst/runs`、`/analyst/runs/:runId`、`/analyst/verification/:artifactId`、`/analyst/review/:artifactId`、`/analyst/evaluation`、`/analyst/p0`、`/analyst/aws`。
- **Standalone_Public_Sources**: 公開側の独立した出典一覧page、`/sources` route、Visitor Home link、およびShared Navigation linkから成る廃止対象機能。
- **Embedded_Source_Evidence**: 候補者情報、政策情報、比較情報、AI生成情報、または根拠表示に付随する出典、根拠引用、根拠link、locator、revision、checksum、および来歴情報。
- **Source_Manifest_Management**: 内部`/analyst/sources`でSource Manifestの資料版、来歴、checksum、利用条件、および採否を扱う分析者機能。
- **Retired_Public_Route**: 両Application_Modeでrouterへ登録せず、直接entryをShell_Preserving_404へ送る`/sources` path。
- **Shell_Preserving_404**: 既存`AppShell`、ローカル限定表示、過去選挙表示、データ種別表示、戻る操作、およびホーム導線を維持して「ページが見つかりません」と404状態を表示する画面。
- **Visitor_Build**: Visitor_Modeだけを含む通常build成果物。
- **Analyst_Build**: Explicit_Analyst_Commandで生成し、Visitor_Buildと異なる出力場所へ保存するAnalyst_Mode成果物。
- **Runtime_Mode_Source**: query string、URL path parameter、hash、cookie、Web Storage、IndexedDB、browser UI control、または実行中のAPI応答によってApplication_Modeを変更する入力源。
- **Local_Only_Binding**: Vite development serverとpreview serverを`127.0.0.1`へ限定する既存設定。
- **NOT_READY_Behavior**: 2022年の両候補者の同等な政策一次資料が未登録である間、政策解析、通常要約、および通常比較を成功扱いせず不足理由を表示する既存動作。
- **Task_Metadata_File**: `.kiro/specs/**/tasks.meta.json`に一致する実行管理用file。

## Requirements

### Requirement 1: Application Modeのfail-closed決定

**User Story:** 会場利用者として、通常commandで分析者画面が有効にならない状態を利用したい。分析者向け機能を誤って会場画面へ出さないためである。

#### Acceptance Criteria

1. THE えひめ投票ナビweb SHALL Application_Modeとして`VISITOR`または`ANALYST`の1値だけを使用する
2. WHEN Normal_Commandを実行するとき, THE Mode_Resolver SHALL Application_Modeを`VISITOR`に決定する
3. WHEN 有効なExplicit_Analyst_Commandを実行するとき, THE Mode_Resolver SHALL Application_Modeを`ANALYST`に決定する
4. IF mode指定が欠落、不明、空、または許可値以外である, THEN THE Mode_Resolver SHALL Application_Modeを`VISITOR`に決定する
5. THE Mode_Resolver SHALL Application_Modeをrouter生成前に決定する
6. THE えひめ投票ナビweb SHALL Runtime_Mode_SourceからApplication_Modeを変更する操作回数を0回にする
7. THE えひめ投票ナビweb SHALL Visitor_ModeからAnalyst_Modeへの暗黙fallback回数を0回にする

### Requirement 2: Visitor Homeと共通navigationからの完全分離

**User Story:** 会場利用者として、利用者向けHomeとnavigationだけを見たい。共同開発者向け操作や内部用語に迷わないためである。

#### Acceptance Criteria

1. WHILE Visitor_ModeでVisitor_Homeを表示している, THE えひめ投票ナビweb SHALL Analyst_Internal_Contentの表示件数を0件にする
2. WHILE Visitor_ModeでShared_Navigationを表示している, THE えひめ投票ナビweb SHALL Existing_Analyst_Routeを参照するlinkの表示件数を0件にする
3. WHILE Visitor_ModeでShared_Navigationを表示している, THE えひめ投票ナビweb SHALL 分析状態、Source Manifest、run、検証、承認、評価、P0判定、およびAWS診断へ移動する操作の表示件数を0件にする
4. WHILE Visitor_Modeで会場利用者向けrouteを表示している, THE えひめ投票ナビweb SHALL 残存する会場利用者向けroute、選挙情報、および会場閲覧の既存導線を保持する
5. THE Visitor_Home SHALL Analyst_Modeを有効にするbrowser toggleまたはlinkを表示しない

### Requirement 3: Visitor Modeにおける分析者URLの404化

**User Story:** 会場利用者として、分析者URLを直接開いても内部画面を表示しない状態を利用したい。保存済みURLや手入力で分析者画面へ到達しないためである。

#### Acceptance Criteria

1. WHILE Visitor_Modeで動作している, WHEN Existing_Analyst_Routeを開いたとき, THE Visitor_Router SHALL Shell_Preserving_404を表示する
2. WHILE Visitor_Modeで動作している, WHEN `/analyst/`配下の未定義URLを開いたとき, THE Visitor_Router SHALL Shell_Preserving_404を表示する
3. WHILE Visitor_Modeで動作している, WHEN browser address barからExisting_Analyst_Routeへ直接entryしたとき, THE Visitor_Router SHALL 分析者page componentをrenderせずShell_Preserving_404を表示する
4. WHILE Visitor_Modeで動作している, THE Visitor_Router SHALL Existing_Analyst_Routeの登録件数を0件にする
5. WHILE Visitor_ModeでShell_Preserving_404を表示している, THE えひめ投票ナビweb SHALL Analyst_Modeへの切替操作を表示しない

### Requirement 4: 明示的なAnalyst Modeでの既存機能維持

**User Story:** 共同開発者として、明示的に分析者用modeを選んだときだけ既存分析画面を使いたい。会場利用者向け構成と分離しながら開発・検証作業を継続するためである。

#### Acceptance Criteria

1. WHEN Explicit_Analyst_Commandでえひめ投票ナビwebを起動するとき, THE Analyst_Router SHALL Existing_Analyst_Routeを登録する
2. WHILE Analyst_Modeで動作している, WHEN Existing_Analyst_Routeを開いたとき, THE Analyst_Router SHALL 対応する既存分析者page componentを表示する
3. WHILE Analyst_Modeで動作している, THE えひめ投票ナビweb SHALL Existing_Analyst_Routeのpath parameterと画面対応を保持する
4. WHILE Analyst_Modeで動作している, THE Visitor_Home SHALL Existing_Analyst_Routeへ移動できる分析者用導線を表示する
5. WHILE Analyst_Modeで動作している, THE Shared_Navigation SHALL 分析者画面へ移動できる明示的な導線を表示する
6. THE えひめ投票ナビweb SHALL Analyst_Modeの利用にaccount登録、login、または認証を要求しない
7. THE えひめ投票ナビweb SHALL 既存分析者page componentを削除しない

### Requirement 5: build成果物とpreviewの分離

**User Story:** 開発者として、通常previewが直前の分析者buildを誤って配信しない構成を使いたい。起動commandの意図と表示routeを一致させるためである。

#### Acceptance Criteria

1. WHEN Normal_Commandでbuildするとき, THE えひめ投票ナビweb SHALL Visitor_Buildを生成する
2. WHEN Explicit_Analyst_Commandでbuildするとき, THE えひめ投票ナビweb SHALL Analyst_Buildを生成する
3. THE えひめ投票ナビweb SHALL Visitor_BuildとAnalyst_Buildを重複しない出力場所へ保存する
4. WHEN Normal_Commandでpreviewするとき, THE えひめ投票ナビweb SHALL Visitor_Buildだけを配信する
5. WHEN Explicit_Analyst_Commandでpreviewするとき, THE えひめ投票ナビweb SHALL Analyst_Buildだけを配信する
6. IF Normal_Commandのpreview対象に有効なVisitor_Buildが存在しない, THEN THE えひめ投票ナビweb SHALL Analyst_Buildへfallbackせず起動失敗を表示する
7. IF Explicit_Analyst_Commandのpreview対象に有効なAnalyst_Buildが存在しない, THEN THE えひめ投票ナビweb SHALL Visitor_Buildへfallbackせず起動失敗を表示する

### Requirement 6: 既存の安全境界と画面contractの維持

**User Story:** 利用者と共同開発者として、mode分離後も既存のローカル限定表示とfail-closed動作を利用したい。route分離によって選挙情報の安全境界を弱めないためである。

#### Acceptance Criteria

1. WHILE Visitor_ModeまたはAnalyst_Modeでdevelopment serverが動作している, THE えひめ投票ナビweb SHALL Local_Only_Bindingを使用する
2. WHILE Visitor_ModeまたはAnalyst_Modeでpreview serverが動作している, THE えひめ投票ナビweb SHALL Local_Only_Bindingを使用する
3. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, THE えひめ投票ナビweb SHALL ローカル限定表示、過去選挙表示、および排他的なデータ種別表示を全routeに表示する
4. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, THE えひめ投票ナビweb SHALL NOT_READY_Behaviorを保持する
5. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, THE えひめ投票ナビweb SHALL skip link、landmark、一意な`h1`、44 CSS pixel以上の操作領域、戻る操作、および現在routeの`aria-current`を各route contractに従って保持する
6. WHEN Visitor_ModeまたはAnalyst_Modeで未定義URLを開いたとき, THE えひめ投票ナビweb SHALL Shell_Preserving_404を表示する
7. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, THE えひめ投票ナビweb SHALL P1およびP2 routeを未登録のまま保持する
8. THE えひめ投票ナビweb SHALL 既存ローカルAPIのHost、Origin、nonce、およびloopback境界を変更しない

### Requirement 7: 自動テスト、README、および変更範囲

**User Story:** 共同開発者として、両modeのroute境界を自動検証し、正しいcommandで起動したい。将来の変更で分析者画面が通常buildへ再混入することを防ぐためである。

#### Acceptance Criteria

1. THE えひめ投票ナビweb SHALL Mode_Resolverの`VISITOR`、`ANALYST`、欠落、不明、および無効入力を自動テスト対象にする
2. THE えひめ投票ナビweb SHALL Visitor_ModeのHome、Shared_Navigation、全Existing_Analyst_Routeの直接entry、および未定義`/analyst/*`を自動テスト対象にする
3. THE えひめ投票ナビweb SHALL Analyst_ModeのHome、Shared_Navigation、および全Existing_Analyst_Routeを自動テスト対象にする
4. THE えひめ投票ナビweb SHALL Normal_CommandとExplicit_Analyst_Commandのbuild出力場所およびpreview対象を自動テスト対象にする
5. THE えひめ投票ナビweb SHALL 両modeのLocal_Only_Binding、NOT_READY_Behavior、Shell_Preserving_404、およびアクセシビリティcontractを自動テスト対象にする
6. THE README SHALL Normal_CommandとExplicit_Analyst_Commandのdevelopment、build、およびpreview手順を別々に記載する
7. THE README SHALL Visitor_Modeが既定値であり、Analyst_Modeがローカル限定かつ認証境界ではないことを記載する
8. THE README SHALL query string、Web Storage、browser toggle、および暗黙fallbackではmodeを変更できないことを記載する
9. THE visitor-analyst-mode-separation実装 SHALL Task_Metadata_Fileを変更しない
10. THE visitor-analyst-mode-separation実装 SHALL `.kiro/specs/ehime-vote-navigator/requirements.md`、`.kiro/specs/ehime-vote-navigator/design.md`、および`.kiro/specs/ehime-vote-navigator/tasks.md`を変更しない

### Requirement 8: 公開Standalone Sourcesの限定廃止

**User Story:** 会場利用者として、独立した出典一覧への導線がない簡潔な公開画面を利用したい。政策情報に必要な出典と分析者向けSource Manifestを失わずに、未接続のStandalone Public Sourcesだけを除去するためである。

#### Acceptance Criteria

1. WHILE Visitor_ModeでVisitor_Homeを表示している, THE えひめ投票ナビweb SHALL `/sources`を参照するlinkの表示件数を0件にする
2. WHILE Visitor_ModeでShared_Navigationを表示している, THE えひめ投票ナビweb SHALL `/sources`を参照するlinkの表示件数を0件にする
3. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, THE えひめ投票ナビweb SHALL Retired_Public_Routeの登録件数を0件にする
4. WHILE Visitor_ModeまたはAnalyst_Modeで動作している, WHEN Retired_Public_Routeを直接開いたとき, THE えひめ投票ナビweb SHALL Shell_Preserving_404を表示する
5. WHEN Standalone_Public_Sourcesへのcomponent参照件数が0件になったとき, THE えひめ投票ナビweb SHALL 公開`SourcesPage` componentの定義件数を0件にする
6. WHILE 候補者情報、政策情報、比較情報、AI生成情報、または根拠情報を表示している, THE えひめ投票ナビweb SHALL 各画面contractで要求されるEmbedded_Source_Evidenceを保持する
7. WHILE Analyst_Modeで動作している, WHEN `/analyst/sources`を開いたとき, THE Analyst_Router SHALL Source_Manifest_Managementを表示する
8. THE えひめ投票ナビweb SHALL source data、provenance contract、citation contract、Source Manifest、およびEmbedded_Source_EvidenceをStandalone_Public_Sourcesの廃止対象から除外する
9. THE えひめ投票ナビweb SHALL Standalone_Public_Sourcesの廃止に伴うAPIおよびdomain機能の変更件数を0件にする
10. THE えひめ投票ナビweb SHALL Visitor_ModeとAnalyst_Modeの`/sources`直接entry、`/analyst/sources`の維持、およびEmbedded_Source_Evidenceの維持を自動テスト対象にする
11. THE README SHALL `/sources`が両Application_ModeでShell_Preserving_404になることとEmbedded_Source_Evidenceおよび`/analyst/sources`を維持することを記載する
12. THE visitor-analyst-mode-separation実装 SHALL `.kiro/specs/ehime-vote-navigator/`の文書とTask_Metadata_FileをStandalone_Public_Sourcesの廃止のために変更しない