# えひめ投票ナビ

令和4年（2022年）第20回愛媛県知事選挙を対象に、政策一次資料の取り込みからAI解析、検証、承認、会場閲覧までを実演するためのプロジェクトです。インターネットへ一般公開せず、会場内の開発端末で動かすローカル限定デモとして構築します。

## 現在の状態

**NOT_READY**

両候補者へ同じ採用規則を適用できる2022年当時の実政策資料がまだ入手・登録されていません。別選挙の資料、架空fixture、AI生成文で不足資料を補完しません。現時点ではmonorepoの最小skeletonとhealth表示だけを提供し、実Bedrock要求は行いません。

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

`.env.example`はAPI用の秘密を含まない設定例です。Git追跡対象外の`.env`へコピーし、必要時に生成、意味判定、embeddingのmodel IDだけを設定します。AWSのアクセスキー、シークレット、セッショントークン、bearer tokenは環境ファイルへ記載せず、AWS既定認証チェーンまたはSSOを使用します。

```powershell
Copy-Item .env.example .env
```

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

build後にローカルAPIを起動する場合は、1つ目のPowerShellで次を実行します。

```powershell
npm.cmd run start --workspace @ehime-vote-navigator/api
```

別のPowerShellでweb previewを起動します。

```powershell
npm.cmd run preview --workspace @ehime-vote-navigator/web
```

APIは`http://127.0.0.1:8787/health`、webは`http://127.0.0.1:4173`で確認できます。どちらも停止するときは、それぞれのPowerShellで`Ctrl+C`を押します。Source Manifest登録と実AI実行手順は対応する後続taskで追加します。
