# えひめ投票ナビ

令和4年（2022年）第20回愛媛県知事選挙を対象に、政策一次資料の取り込みからAI解析、検証、承認、会場閲覧までを実演するためのプロジェクトです。インターネットへ一般公開せず、会場内の開発端末で動かすローカル限定デモとして構築します。

## 現在の状態

**NOT_READY**

両候補者へ同じ採用規則を適用できる2022年当時の実政策資料がまだ入手・登録されていません。別選挙の資料、架空fixture、AI生成文で不足資料を補完しません。現時点では会場利用者向けと分析者向けのP0画面skeletonを、利用者モード（Visitor Mode）と分析者モード（Analyst Mode）に分けて提供します。政策解析、通常要約、および通常比較は成功扱いせず、両modeで`NOT_READY`と不足理由を表示します。実Bedrock要求は行いません。

## 構成

- `apps/web`: React、TypeScript、Vite、Tailwind CSS、React Routerによるweb
- `apps/api`: Node.js、TypeScript、Express、ZodによるローカルAPI
- `packages/contracts`: 共通契約
- `packages/domain`: 純粋なdomain処理
- `packages/fixtures`: 架空fixture専用package

依存関係はrootの`package-lock.json`に固定します。

## ローカル実データと環境設定

実原資料と、そのmanifest、抽出結果、索引、run、承認、評価、一時artifactはすべて`data/real/`へ置きます。この領域はGit追跡と配布bundleの対象外です。利用条件が未確認または再配布不可の原資料もここから移動しません。`packages/fixtures/`は追跡可能な架空fixture専用領域であり、実資料を置きません。

空directory markerは追跡しません。必要になったdirectoryだけを安全に作成できます。

```powershell
@(
  "data/real/raw",
  "data/real/manifests",
  "data/real/extracted",
  "data/real/policy-units",
  "data/real/indexes",
  "data/real/runs",
  "data/real/approvals",
  "data/real/evaluations",
  "data/real/p0"
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }
```

`.env.example`はAPI用の秘密を含まない設定例です。Git追跡対象外の`.env.local`へコピーし、大学管理者から受け取ったBedrock APIキー（`AWS_BEARER_TOKEN_BEDROCK`）と、生成、意味判定のモデルIDを設定します。使えるモデルIDは`jp.anthropic.claude-haiku-5-5`（既定）と`jp.anthropic.claude-opus-5-5`（比較用）だけで、処理は日本国内に限定されます。埋め込みのモデルIDは最小構成では必須ではありません。APIキーは`apps/api`（サーバー側）だけが読み、ブラウザ、Git、ログ、チャットには出しません。AWS CLI、SSO、AWSプロファイル、IAM、STSは使いません。

```powershell
Copy-Item .env.example .env.local
```

### Bedrock接続の確認（任意）

`.env.local`へ上記の設定を書いたあと、PowerShellで次を実行すると、短い入力を1回だけBedrockへ送ります。`RUN_BEDROCK_SMOKE=1`を指定しない限り、何も送りません。成功すると成否、HTTPステータス、モデルID、所要時間、応答の冒頭だけを表示します。

```powershell
$env:RUN_BEDROCK_SMOKE = "1"
npm run bedrock:smoke
Remove-Item Env:RUN_BEDROCK_SMOKE
```

入力は2万文字以下、最大出力は2,000トークン、同時実行は1件、呼出しは毎分10回以下に制限し、自動再試行はしません。Bedrockを呼ぶHTTPの窓口は作りません。

### 選挙レジストリ（ローカルCLI）

選挙は`config/election/elections.json`にデータとして登録します（現在は2022年の選挙を登録済みです）。2026年の候補者は、公式資料で確認できるまで登録しません。

```powershell
npm run analysis -- election show
npm run analysis -- election change <選挙ID>
```

`election change`は変更前後の選挙名と選挙IDを表示し、承認（`y`）した場合だけ保存します。保存に失敗しても元のファイルは変わりません。

## 必要環境

- Windows 10またはWindows 11
- Node.js 24.15.0以上の24.x
- npm 11.x
- PowerShell

PowerShellの実行ポリシーにより`npm.ps1`が拒否される場合は、以下の例どおり`npm.cmd`を使用してください。

## 最小コマンド

依存関係を固定lockfileから復元します。

```powershell
npm.cmd ci
```

終了する検証commandを実行します。

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

build後にローカルAPIを起動する場合は、1つ目のPowerShellで次を実行します。`npm.cmd run build`と`npm.cmd run build:analyst`は、どちらもAPIをbuildします。

```powershell
npm.cmd run start --workspace @ehime-vote-navigator/api
```

別のPowerShellでweb previewを起動します。次のcommandは既定のVisitor Modeで`apps/web/dist`を配信します。Analyst Modeで確認する場合は、後述の「利用者モードと分析者モード」の手順で`npm.cmd run build:analyst`を実行してから`npm.cmd run preview:analyst`を使用します。

```powershell
npm.cmd run preview --workspace @ehime-vote-navigator/web
```

APIは`http://127.0.0.1:8787/health`、webは`http://127.0.0.1:4173`で確認できます。どちらも停止するときは、それぞれのPowerShellで`Ctrl+C`を押します。Source Manifest登録と実AI実行手順は対応する後続taskで追加します。

## 利用者モードと分析者モード

webは、起動時またはbuild時にcommandで決まる2つのApplication Modeを持ちます。

| mode | 表示する画面 | 使用するcommand |
|---|---|---|
| Visitor Mode（既定） | 会場利用者向け画面だけ | `dev`、`build`、`preview` |
| Analyst Mode | 会場利用者向け画面と共同開発者向けの分析画面（`/analyst/*`） | `dev:analyst`、`build:analyst`、`preview:analyst` |

- Visitor Modeが既定値です。mode指定がない場合、空の場合、不明な値の場合もVisitor Modeになります。
- Analyst Modeになるのは、`:analyst`付きの明示commandを実行した場合だけです。query string、URL hash、cookie、Web Storage（localStorage、sessionStorage）、IndexedDB、browser toggle、API応答、および暗黙fallbackではmodeを変更できません。画面にはmode切替のbutton、select、linkがありません。
- Analyst Modeはローカル限定の共同開発者向け起動modeであり、認証やauthorizationではありません。account登録とloginは不要です。一般公開を許可する権限制御として使用しないでください。
- 両modeとも、development server（port 5173）とpreview server（port 4173）は`127.0.0.1`だけにbindします。両modeは同じportを使うため、同時には起動できません。
- Visitor Modeは`/analyst/*`をrouterへ登録しません。分析者URLを直接開いても、共通shellを維持した「ページが見つかりません」（404）を表示します。
- 両modeで、ローカル限定表示、過去選挙表示、データ種別表示、および`NOT_READY`を維持します。P1/P2画面はどちらのmodeでも対象外であり、routeを登録しません。

development serverとpreview serverは終了しない常駐processです。それぞれ専用のPowerShellで起動し、停止するときはそのPowerShellで`Ctrl+C`を押します。

### Visitor Mode（通常command）

開発用serverを起動します。`http://127.0.0.1:5173`で確認できます。

```powershell
npm.cmd run dev
```

全workspaceをbuildします。webのVisitor Buildは`apps/web/dist`へ出力します。

```powershell
npm.cmd run build
```

`apps/web/dist`のVisitor Buildだけを`http://127.0.0.1:4173`で配信します。

```powershell
npm.cmd run preview
```

### Analyst Mode（明示command）

分析者画面を含む開発用serverを起動します。`http://127.0.0.1:5173`で確認できます。

```powershell
npm.cmd run dev:analyst
```

contracts、domain、fixtures、APIをbuildした後、webのAnalyst Buildを`apps/web/dist-analyst`へ出力します。`apps/web/dist`のVisitor Buildは上書きしません。

```powershell
npm.cmd run build:analyst
```

`apps/web/dist-analyst`のAnalyst Buildだけを`http://127.0.0.1:4173`で配信します。

```powershell
npm.cmd run preview:analyst
```

### previewの事前確認

previewは起動前に、対象の出力directoryと`web-build-marker.json`を検査します。directoryがない場合、markerがないか不正な場合、またはmarkerのmodeとdirectoryが要求したmodeに一致しない場合は、serverを起動せずに終了し、再build commandを表示します。反対modeの出力へfallbackしません。preview前に、Visitor Modeでは`npm.cmd run build`、Analyst Modeでは`npm.cmd run build:analyst`を実行してください。

### build境界の確認

次のcommandは、Visitor BuildとAnalyst Buildをrepository外の一時directoryへbuildして検査し、`BUILD_BOUNDARY_RESULT PASS`または`BUILD_BOUNDARY_RESULT FAIL`を表示して終了します。Visitor Buildに分析者moduleと`/analyst/*` routeがないこと、両buildに公開`SourcesPage`と`/sources` routeがないこと、Analyst Buildに`/analyst/sources`が残ること、および両buildにruntimeのmode切替入力と認証依存がないことを確認します。検査後は一時出力を削除し、`apps/web/dist`と`apps/web/dist-analyst`は変更しません。

```powershell
npm.cmd run check:build-boundary
```

## 公開出典一覧（`/sources`）の廃止

公開側の独立した出典一覧（`/sources`）は、Visitor ModeとAnalyst Modeの両方で廃止しました。

- HomeとShared Navigationに`/sources`へのlinkはありません。
- どちらのmodeのrouterにも`/sources`を登録しません。直接開くと、共通shell、ローカル限定表示、過去選挙表示、およびHome導線を維持した「ページが見つかりません」（404）を表示します。`/analyst/sources`へredirectしません。
- 候補者情報、政策情報、比較情報、AI生成情報、および根拠表示に付随する出典、根拠引用、根拠リンク、locator、revision、checksum、来歴（provenance）は維持します。
- source data、citation contract、provenance contract、およびSource Manifestは変更しません。API機能とdomain機能も変更しません。
- Analyst Modeの内部`/analyst/sources`は、Source Manifest管理画面として維持します。資料版、来歴、checksum、利用条件、および採否を扱います。

この廃止は`visitor-analyst-mode-separation` specによる差分です。既存`ehime-vote-navigator` specのRequirement 19.1のうち、Homeから独立した出典一覧へ移動する導線だけを上書きします。政策情報に付随する出典表示と根拠要件は上書きしません。`.kiro/specs/ehime-vote-navigator/`の`requirements.md`、`design.md`、`tasks.md`は編集しません。
