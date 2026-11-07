# Implementation Plan: Visitor/Analyst Mode Separation

## Overview

TypeScriptと既存Vite/React Router構成を使い、通常commandが必ずVisitor Modeになるfail-closed mode resolver、mode別route entry、mode別Home/navigation、分離したbuild outputを段階的に実装する。Visitor Modeから分析者page module、route、link、説明を除外し、`/analyst/*`の直接entryを既存shell付き404へ送る。Analyst Modeは明示commandだけで既存分析者routeを登録する。

追加の限定差分として、公開Standalone Sourcesだけを除去する。Visitor Homeとvisitor navigationから`/sources` linkを外し、Visitor/Analyst Routerのどちらにも`/sources`を登録せず、直接entryをShell-Preserving 404へ送る。未参照になった公開`SourcesPage`は削除するが、policy-level citation/evidence/provenance、source data、内部`/analyst/sources`のSource Manifest管理、API/domain機能は維持する。

既存`.kiro/specs/ehime-vote-navigator/`のrequirements、design、tasksとTask Metadata Fileは変更しない。認証を追加せず、分析者pageを削除せず、API production codeを変更しない。すべてのtestとbuild検証はwatchなしで終了させ、development serverまたはpreview serverは自動起動しない。

## Tasks

- [x] 1. fail-closed Application Modeと分離build targetを実装する
  - [x] 1.1 Application Mode resolverとVite mode別entryを実装する
    - `apps/web/src/config/applicationMode.ts`に`ApplicationMode`、`resolveApplicationMode`、`resolveBuildTarget`を追加し、exactな`analyst`だけを`ANALYST`へ写し、欠落、不明、型不正、Vite既定modeを`VISITOR`へ写す。
    - `apps/web/vite.config.ts`をconfig factoryへ変更し、resolver結果から`#app-routes` alias、`dist`または`dist-analyst`、build markerを決定する。両modeのserver/preview hostは`127.0.0.1`のままにする。
    - `apps/web/src/config/virtual-app-routes.d.ts`でselected route entryの最小signatureを定義し、browserからmodeを変更するsetter、context、storage readerを作らない。
    - `.gitignore`へ`**/dist-analyst/`を追加する。
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.1, 5.2, 5.3, 6.1, 6.2_

  - [x] 1.2 fail-closed mode resolutionのproperty testを実装する
    - **Property 1: fail-closed mode resolution**
    - arbitrary string、non-string、空白/case variant、query、hash、cookie、Web Storage相当値、UI event、API responseを生成し、exact `analyst`以外が`VISITOR`となりruntime値で結果が変わらないことをfast-checkで100 runs以上検査する。
    - test commentへ`Feature: visitor-analyst-mode-separation, Property 1`を記載する。
    - **Validates: Requirements 1.1, 1.4, 1.6, 1.7**

  - [x] 1.3 mode-to-build-target isolationのproperty testを実装する
    - **Property 5: mode-to-build-target isolation**
    - arbitrary mode入力に対し、visitorはvisitor entryと`dist`、analystはanalyst entryと`dist-analyst`のちょうど1組へ解決し、directoryが重複せずpreview targetに反対modeのfallbackがないことをfast-checkで100 runs以上検査する。
    - build marker schemaのmode/output一致、未知field拒否、入力非mutationも検査する。
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 1.4 通常commandとExplicit Analyst Commandをroot/web packageへ結線する
    - web workspaceへ通常`dev/build/preview`と`dev:analyst/build:analyst/preview:analyst`を定義し、rootへ対応する委譲commandを追加する。既存root `build`の全workspace buildを維持する。
    - normal dev/buildに`--mode analyst`を含めず、analyst dev/buildだけがexact `--mode analyst`を渡す。normal previewは`dist`、analyst previewは`dist-analyst`だけを対象にする。
    - preview前に対象build markerを有限処理で検査し、directory欠落、marker欠落、mode不一致では修正commandを返して終了する。反対mode outputへfallbackしない。
    - package/Vite config contract testで全script、alias、outDir、marker、loopback hostを検査する。長時間のdev/preview processはtestから起動しない。
    - _Requirements: 1.2, 1.3, 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 7.4_

- [x] 2. public pageとanalyst pageを分離してmode別routerを実装する
  - [x] 2.1 既存page moduleをpublicとanalystへ分割し、公開SourcesPageだけを除去する
    - `apps/web/src/app/pages.tsx`の会場利用者pageと404を`app/public/`へ、分析者pageと分析者Home sectionを`app/analyst/`へ分ける。表示文、path parameter、`NOT_READY`、欠損表示、既存component contractを保持する。
    - Visitor Homeは`/sources`を除く会場閲覧のP0 linkだけを持ち、`ANALYST_HOME_LINKS`、ローカル分析section、分析操作の説明をimportしない。Analyst Homeはpublic Home contentと分析者link sectionを組み合わせるが、公開`/sources` linkは追加しない。
    - 公開`SourcesPage`のroute/import/export参照を除去し、参照が0件になったことを確認してcomponent定義を削除する。`AnalystSourcesPage`は削除せずanalyst moduleへ移し、`/analyst/sources`用のSource Manifest画面として維持する。
    - policy-level citation、evidence、locator、revision、checksum、provenance、source dataを扱うtype/componentを公開`SourcesPage`と一緒に削除しない。
    - 分析者page componentは削除せず、既存h1と`runId`/`artifactId`表示を維持する。
    - _Requirements: 2.1, 2.4, 4.3, 4.4, 4.7, 6.4, 8.1, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [x] 2.2 AppShellへ確定済みnavigation variantを結線する
    - `AppShell`へliteralな`VISITOR`または`ANALYST` navigation variantをroute entryから渡す。Visitor navigationは`/sources`を除くpublic linkだけ、Analyst navigationは残存public linkと明示的な分析入口を表示する。両variantからexact `/sources` destinationを除外する。
    - `/analyst/sources`は公開出典一覧ではなく内部Source Manifest管理としてAnalyst Homeまたはanalyst navigationから到達可能な状態を維持する。
    - query string、hash、cookie、localStorage、sessionStorage、IndexedDB、browser control、API応答からvariantを導出しない。mode切替button、select、linkを作らない。
    - skip link、banner、data kind、footer、戻る操作、`aria-current`、44px以上の操作classを維持する。
    - _Requirements: 2.2, 2.3, 2.5, 4.5, 6.3, 6.5, 8.2, 8.7_

  - [x] 2.3 Visitor Routerを残存public routeとwildcard 404だけで実装する
    - `apps/web/src/app/visitor/routes.tsx`に`/sources`を除くpublic route、Visitor Home、Visitor AppShell、wildcard NotFoundだけを登録し、Existing Analyst Route descriptor、retired `/sources` descriptor、analyst page importを0件にする。
    - `/analyst/readiness`を含む全既存分析者path、parameterized path、未知`/analyst/*`、および`/sources`直接entryをredirectせず同じShell-Preserving 404へ送る。
    - route contract matrixを実装し、Visitorは`/`、`/schedule`、`/candidates`、`/candidates/:candidateId`、`/comparison`、`/venue`、wildcardだけを返す。
    - `App.tsx`はViteが選んだ`#app-routes`だけをimportし、runtime fallback routerを持たない。
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.6, 8.3, 8.4_

  - [x] 2.4 Visitor presentation omissionのproperty testを実装する
    - **Property 2: Visitor presentation omits analyst and retired standalone-source content**
    - `apps/web/src/app/visitor/visitorPresentation.property.test.tsx`で、visitor Home/navigation projectionへ任意のpublic/analyst item集合とretired `/sources` itemを与え、render対象のhref、accessible name、textにExisting Analyst Route、Analyst Internal Content、exact `/sources` destinationが0件で、configured remaining public destinationは保持されることをfast-checkで100 runs以上検査する。
    - 固定RTL例で現在の分析者link label/descriptionと「出典一覧を見る」がDOMにないことも確認する。
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 8.1, 8.2**

  - [x] 2.5 Visitor Router analyst-path exclusionのproperty testを実装する
    - **Property 3: Visitor Router excludes every analyst path**
    - `apps/web/src/app/visitor/visitorRoutes.property.test.tsx`で、全Existing Analyst Routeの具体path、valid parameter、任意安全suffixを生成し、visitor route selectorが404を返し、analyst descriptorとanalyst page component renderが0件であることをfast-checkで100 runs以上検査する。
    - MemoryRouterのdirect entryで既存h1ではなく「ページが見つかりません」、404状態、Home link、共通shellが表示されることを確認する。
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [x] 2.6 Analyst Routerに既存分析者routeと残存public routeを明示的に結線する
    - `apps/web/src/app/analyst/routes.tsx`に`/sources`を除くpublic route、Analyst Home、Analyst AppShell、全Existing Analyst Route、wildcard 404を登録する。exact `/sources` descriptorは登録しない。
    - `/analyst/sources`は`AnalystSourcesPage`へ対応させ、`/analyst/runs/:runId`、`/analyst/verification/:artifactId`、`/analyst/review/:artifactId`を含むpathとpage対応を変更しない。
    - Analyst route contract matrixに残存public routeと全Existing Analyst Routeを含め、`/sources`はwildcard contractへ解決する。
    - login、account、auth dependency、authorization guardを追加せず、P1/P2 routeも追加しない。
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.7, 8.3, 8.4, 8.7_

  - [x] 2.7 Analyst Router route preservationのproperty testを実装する
    - **Property 4: Analyst Router preserves existing route contracts**
    - Existing Analyst Route contractとvalid path parameterを生成し、`/analyst/sources`を含む対応h1/page、Home link、navigation destinationへ解決し、`/sources`を除くpublic route contractも同じrouterで保持されることをfast-checkで100 runs以上検査する。
    - 全分析者routeのparameterized RTL testを追加し、`/analyst/sources`が「Source Manifest」を表示し、分析者page moduleが残っていることを検査する。
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 8.7**

- [x] 3. shell、安全境界、既存routeの回帰testを完成する
  - [x] 3.1 preserved shell and route safety contractsのproperty testを実装する
    - **Property 6: preserved shell and route safety contracts**
    - Application Modeとpublic/analyst/unknown/P1/P2 route categoryを生成し、利用可能routeでは正しいpage、利用不可routeでは404となり、全caseでlocal-only banner、過去選挙banner、排他的data kind、1つのh1、skip link、landmark、戻るcontractが維持されることをfast-checkで100 runs以上検査する。
    - 両modeで`NOT_READY`と疑似AI進捗0件を検査し、Analyst Modeでも既存安全表示を弱めない。
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**

  - [x] 3.2 mode別のfocused route/component regression suiteを実装する
    - `apps/web/src/app/routes.test.tsx`をVisitor/Analyst suiteへ再構成し、`/sources`を除くpublic route、Home link、Shared Navigation、全Existing Analyst Routeの直接entry、未知`/analyst/*`、404、戻る、`aria-current`をmode別に検査する。
    - Visitor/Analyst両suiteで`/sources`へ直接entryし、Shell-Preserving 404、Home link、共通banner、1つのh1「ページが見つかりません」を確認する。「出典一覧」h1と公開`SourcesPage` contentは表示しない。
    - Analyst suiteでは`/analyst/sources`が「Source Manifest」を表示し、`/sources`と混同されないことを確認する。
    - query/hash/storage値を設定したVisitor testでも分析者routeと`/sources`が404のままで、mode toggleが存在しないことを確認する。
    - 360/768/1280向け既存class contract、candidate/comparisonの`NOT_READY`、P1/P2 404、1つのh1を維持する。
    - `apps/web/src/App.test.tsx`を通常selected entryがVisitor Modeであることを検査する回帰testへ更新する。
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.2, 4.3, 4.4, 4.5, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.7, 8.10_

  - [x] 3.3 Visitor Buildからanalyst moduleを除外し、両buildから公開SourcesPageを除外するbuild boundary testを実装する
    - 終了するbuild/static checkerでVisitor Buildのmodule manifestに`app/analyst`、Existing Analyst Route、分析者Home descriptionがなく、Analyst Buildには明示entry経由で既存分析者moduleがあることを検査する。
    - 両buildで公開`SourcesPage` export/import/referenceとexact public route descriptor `/sources`が0件であることを検査する。raw substring検索で`/analyst/sources`を誤検出せず、正規化済みroute descriptorまたはmodule metadataを比較する。
    - Analyst Buildには`AnalystSourcesPage`とexact `/analyst/sources` routeが残り、source evidence/provenance contract moduleが除去されていないことを検査する。
    - 両成果物のmarker、出力directory、mode一致を検査し、欠落またはcross-mode markerをfail closedにする。
    - web bundleにruntime mode source、mode切替control、auth dependencyが追加されていないことをstatic testで検査する。
    - _Requirements: 1.5, 1.6, 1.7, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 7.4, 8.3, 8.5, 8.7, 8.8, 8.9, 8.10_

  - [x] 3.4 standalone public sources removal boundaryのproperty testを実装する
    - **Property 7: standalone public sources removal preserves source evidence boundaries**
    - `apps/web/src/app/sourceBoundary.property.test.tsx`でApplication Mode、route contract、validなEmbedded Source Evidence recordを生成し、両modeの`/sources`がwildcard 404へ解決され、route descriptorと公開`SourcesPage` exportが0件であることをfast-checkで100 runs以上検査する。
    - evidence projectionが各contractで要求する出典、根拠link、locator、revision、checksum、provenanceを保持し、Analyst route setが`/analyst/sources`と`AnalystSourcesPage`対応を保持することを同じpropertyで検査する。
    - API/domain/source dataを呼び出す反復testにはせず、pure route selector、module metadata、evidence projectionを対象にする。既存contract testを回帰suiteとして結線する。
    - test commentへ`Feature: visitor-analyst-mode-separation, Property 7`を記載する。
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9**

- [ ] 4. startup説明と自動検証を実装へ同期する
  - [x] 4.1 READMEへVisitor/Analyst startup・build・preview手順と公開sources廃止範囲を追加する
    - READMEの通常手順をVisitor Mode既定として`npm run dev`、`npm run build`、`npm run preview`で記載し、Analyst Modeを`npm run dev:analyst`、`npm run build:analyst`、`npm run preview:analyst`の別節に記載する。
    - 両modeが`127.0.0.1`限定であること、Analyst Modeは認証/authorizationではないこと、query string・Web Storage・browser toggle・暗黙fallbackでは変更できないこと、preview前に対応buildが必要なことを明記する。
    - 公開Standalone Sources `/sources`は両modeで廃止済みかつShell-Preserving 404になる一方、policy-level citation/evidence/provenance、source data、内部`/analyst/sources`のSource Manifest管理は維持することを記載する。
    - 既存`ehime-vote-navigator` specのHomeから独立した出典一覧へ移動する導線だけを本follow-upがsupersedeし、既存spec文書自体を編集しないことを記載する。
    - APIを必要とする場合の既存手動起動手順と`Ctrl+C`停止、`NOT_READY`、過去選挙、P1/P2対象外を保持する。
    - README contract testでcommand名、output、local-only、非認証、runtime切替禁止、`/sources`廃止、`/analyst/sources`とEmbedded Source Evidence維持の記載を実route/package metadataと照合する。
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 7.6, 7.7, 7.8, 8.11, 8.12_

  - [ ] 4.2 mode分離と限定的な公開sources廃止の品質gate・変更範囲checkを結線する
    - focused resolver/property/RTL/config/build marker/documentation testをrootの既存`npm test`へ含める。通常suiteからdev server、preview server、AWS、外部HTTPを起動しない。
    - `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run build:analyst`をwatchなしで終了させる検証手順を整える。
    - 既存API local boundary testとsource/citation/provenance contract testを単回実行し、Host、Origin、nonce、loopback、Embedded Source Evidence、Source Manifest domain contractが維持されることを確認する。API production fileとdomain/source data fileは変更しない。
    - read-only Git checkでTask Metadata Fileと`.kiro/specs/ehime-vote-navigator/requirements.md`、`design.md`、`tasks.md`がimplementation diffに含まれないことを確認する。
    - 公開`SourcesPage`、exact `/sources` route、Home/navigation link以外のsource関連機能がdiffから削除されていないことを確認する。
    - _Requirements: 6.1, 6.2, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12_

- [ ] 5. Final checkpoint - mode分離の全自動検査を実行する
  - Ensure all tests pass, ask the user if questions arise.
  - `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run build:analyst`をwatchなしで実行し、両build markerとbuild boundary checkerを確認する。
  - dev/preview commandは長時間processのため自動起動せず、config/script contractと有限preview preflightだけを自動検査する。
  - read-only Git status/diffで既存ehime-vote-navigator spec、Task Metadata File、API production code、domain/source data、provenance/citation contract、未関連fileに変更がないことを確認する。
  - 両modeの`/sources`がShell-Preserving 404、Analyst Modeの`/analyst/sources`がSource Manifest、evidence-bearing contractが必要な出典項目を保持することを確認する。

## Notes

- 本計画はwebのstartup/build composition、route、Home/navigation、公開`SourcesPage`、test、READMEだけを変更対象とする。AWS、実資料、選挙data、domain/API機能、source data、provenance/citation contractは対象外である。
- 公開Standalone Sources `/sources`だけを削除し、policy-level citation/evidence、根拠link、locator、revision、checksum、および内部`/analyst/sources`のSource Manifest管理を維持する。
- 本follow-upは既存`ehime-vote-navigator` Requirement 19.1のうちHomeから独立した出典一覧への導線だけをsupersedeする。既存spec文書は編集しない。
- Analyst Modeはローカル共同開発者向けの明示構成であり、認証またはsecurity authorizationではない。一般公開を許可する機能は追加しない。
- 分析者pageは削除せず、Visitor Modeのroute graphから除外する。Analyst Modeで既存pathと画面contractを維持する。
- Task Metadata Fileと既存`.kiro/specs/ehime-vote-navigator/`の3文書を変更しない。
- すべてのproperty testはfast-checkを最低100 runs実行し、design.mdのproperty番号と名称をtest commentへ記載する。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2"] },
    { "id": 3, "tasks": ["1.4", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6"] },
    { "id": 5, "tasks": ["2.7", "3.1", "3.4"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] }
  ]
}
```
