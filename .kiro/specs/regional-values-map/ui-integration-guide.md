# regional-values-map UI統合ガイド（共同開発者向け）

`/values` 画面を実装する共同開発者のためのガイドです。ここに書いた型と関数は実装済みで、テストがあります。契約と関数の版は 1 です。項目の削除と型の変更は版を上げ、項目の追加は同じ版に入れて通知します。

このガイドの内容は `tests/regional-values/guideSync.test.ts` が実装と照合します。公開名や状態を足したときは、このガイドも更新してください。

## 1. このガイドの範囲と現状

画面は、ドメインの関数が返す値を描画し、イベントを渡すだけにします。計算、文言、並び順、保存は画面に持たせません。

| 区分 | 内容 |
| --- | --- |
| 実装済み | 価値観マップ生成、診断の状態機械、質問・結果・カード・About の表示モデル、バンドルの取得と検証、バンドルを作る CLI |
| 未実装 | 回答の端末内保存（13.8）、リリース用ビルド基盤（14.1。`__RV_EXPECTED__` の埋込みとバンドルの複製）、画面本体（14.2〜14.4） |
| 本ブランチでは変更しない | `apps/web` 配下すべて（`/values` ルート、`AppShell`、`build-boundary.mjs` を含む）。共同開発者の担当です |
| 人の承認待ち | 本番設定（`config/regional-values/` の `neutrality.json` と `build.json`。13.1）。実データの取り込み（13.x） |

現時点で作れるバンドルは架空データ（`FIXTURE`）だけです。実データ（`REAL_AI`）のバンドルは 13.12 まで作れません。

## 2. 全体の流れ

```text
bundle.json を GET ──► loadBundle ──► VerifiedBundle
                                         │
        initialDiagnosticState ──► diagnosticReducer(state, event) ──► DiagnosticState
                                                                          │
   phase が QUESTION     ──► presentQuestion(bundle, session, hint) ──► QuestionPresentation
   phase が RESULT       ──► buildResultViewModel({...})            ──► ResultViewModel
   phase が FACT_CARD    ──► buildCardView(bundle, cardId)          ──► CardView
   phase が ABOUT        ──► buildAboutView(bundle)                 ──► AboutView
   phase が UNEXPECTED_ERROR ──► buildUnexpectedErrorView(bundle)   ──► UnexpectedErrorView
```

画面は `useReducer(diagnosticReducer, initialDiagnosticState)` のように状態を1つだけ持ちます。利用者の操作は、表示モデルが持つ `event` をそのまま `dispatch` します。

## 3. import の方法（ブラウザ向けの入口）

画面は次の2つの入口だけを使います。

```ts
import {
  diagnosticReducer,
  initialDiagnosticState,
  loadBundle,
  presentQuestion,
  buildResultViewModel,
  LOAD_FAILURE_TEXTS,
  type ExpectedBundle,
} from "@ehime-vote-navigator/domain/regional-values";
import type { Answers, ValuesMap, MapError } from "@ehime-vote-navigator/contracts/regional";
```

- 値（関数と定数）は `@ehime-vote-navigator/domain/regional-values` から取り込みます。
- 契約の型（`Answers`、`ValuesMap`、`MapError` など）は `@ehime-vote-navigator/contracts/regional` から `import type` で取り込みます。
- パッケージの根の入口（`@ehime-vote-navigator/domain`、`@ehime-vote-navigator/contracts`）は画面から使いません。domain の根は `node:crypto` と `node:util` を使うモジュールを含み、ブラウザ向けのビルドに入ると壊れます。
- `packages/domain/src/...` などの内部ファイルを直接 import しません。ビルド用の検査、組立て、ハッシュ計算はこの入口に含まれていません。
- 入口は `dist` を参照します。取り込む前に `npm.cmd run build --workspace @ehime-vote-navigator/contracts`、続けて `npm.cmd run build --workspace @ehime-vote-navigator/domain` を実行してください。
- `apps/web` は現在ワークスペースのパッケージを import していません。`apps/web/package.json` の `dependencies` に宣言するかどうかは、共同開発者が決めます。

## 4. バンドルの生成と配置

バンドル（`bundle.json`）は CLI が作ります。画面は、バンドルを GET で取得して使うだけです。

```text
npm.cmd run regional-values -- build --kind demo|public [--data-mode REAL|FIXTURE|REAL_PREFERRED] [--generated-at <ISO 8601>] [--config-dir <path>]
```

| 引数 | 内容 |
| --- | --- |
| `--kind` | `demo` か `public`。必須 |
| `--data-mode` | 既定は demo が `REAL_PREFERRED`、public が `REAL`。public は `REAL` 以外を受け付けない |
| `--generated-at` | `meta.generatedAt` に入れる時刻（タイムゾーン付き）。省略すると実行時刻 |
| `--config-dir` | 設定ファイルのディレクトリ。省略すると `config/regional-values/` |

- 出力先は `dist/regional-values/<kind>/bundle.json` と `build-report.json` です。`dist` は Git 管理外なので、コミットしません。
- 標準出力に出るのは、`code=BUILD_OK dataKind=… switched=…`、`code=BUILD_FAILED`、`code=SELF_CHECK_FAILED`、`code=ARGUMENT_INVALID`、`code=USAGE` のコードだけです。ビルドの経過（`BUILD_START`、`DATA_MODE_SWITCHED`、`BUILD_DONE`）は標準エラー出力に1行ずつ出ます。失敗の詳細は `build-report.json` の `findings` に ID とコードで書かれます。
- 書き出したバンドルは、ブラウザと同じ `verifyBundleText` で自己検査します。合格しなければ `bundle.json` を消して失敗にします。
- 終了コードは、成功が 0、それ以外が 1 です。

### 検証用バンドルの作り方（13.1 の承認前）

リポジトリの `config/regional-values/` には `map.json` しかなく、`neutrality.json` と `build.json` は人の承認待ちです。そのため、リポジトリの設定だけでは `CONFIG_UNREADABLE` で止まります。動作確認には、試験専用の設定を `--config-dir` に渡します。

```text
npm.cmd run regional-values -- build --kind demo --data-mode FIXTURE --config-dir tests/harness/regional-values/test-config
```

- 試験専用の設定は `tests/harness/regional-values/test-config/` の3ファイル（`map.json`、`neutrality.json`、`build.json`）です。内容はテスト用の語だけで、本番の語の一覧ではありません。
- この設定の `dataVersion` は `2026-01-01.1` です。画面の `ExpectedBundle` には同じ値を渡します。
- 作ったバンドルの `meta.dataKind` は `FIXTURE`、`meta.buildKind` は `DEMO`、診断セットは `QUICK` だけです（3テーマ6問）。

### 配置

画面は `/regional-values/bundle.json` を GET します。この URL にバンドルを置く処理（複製と、期待値 `__RV_EXPECTED__` の埋込み）は 14.1 のビルド基盤で実装する予定で、現時点ではありません。それまでの手元の確認では、開発サーバーが `/regional-values/bundle.json` として返す場所に、生成した `bundle.json` を共同開発者が自分のブランチでコピーしてください。コピー先と Git の扱いは共同開発者が決めます。

## 5. バンドルの読み込み（`loadBundle` と `VerifiedBundle`）

```ts
const expected: ExpectedBundle = { schemaVersion: 1, dataVersion: "2026-01-01.1", buildKind: "DEMO" };

const loaded = await loadBundle({
  httpGet: (url, init) => fetch(url, init),
  url: "/regional-values/bundle.json",
  expected,
});

if (loaded.ok) {
  dispatch({ type: "BUNDLE_LOADED", bundle: loaded.value });
} else {
  dispatch({ type: "BUNDLE_FAILED", code: loaded.error });
}
```

- `loadBundle` はバンドルを1回だけ GET します。認証情報なし、リダイレクトなし、再試行なし、第二の URL なしです。回答に関するものは何も送りません。
- 戻り値は `{ ok: true, value: VerifiedBundle }` か `{ ok: false, error: BundleLoadErrorCode }` です。失敗時はコードだけを返し、取得した本文は返しません。画面には `LOAD_FAILURE_TEXTS` の固定文言を表示します（11章）。
- バンドルは 2,000,000 バイトまでです。超えると `TOO_LARGE` になります。
- ハッシュの計算は WebCrypto（`crypto.subtle`）を使います。HTTPS か `localhost` で開いてください。テストでは `digest` を差し替えられます。
- `ExpectedBundle` の `dataVersion` と `buildKind` は、リリース用ビルドが埋め込む値（`__RV_EXPECTED__`）を使います。画面にその値を直接書き込みません。

### `VerifiedBundle` の扱い

- `VerifiedBundle` は、検証に合格したバンドルだけが持てる読み取り専用の値です。画面で作らず、書き換えず、コピーして変更しません。
- 公開されている項目は `meta`、`themes`、`questions`、`diagnosticSets`、`cards`、`resultTexts`、`fixedTexts`、`guidance`、`mapConfig`、`aiContribution` です。
- そのまま `diagnosticReducer` の `BUNDLE_LOADED` と、`presentQuestion`、`buildResultViewModel`、`buildCardView`、`buildAboutView` の `bundle` 引数に渡せます（状態機械の `SessionBundle` と表示モデルの `ViewBundle` を構造的に満たします）。
- 検証に失敗したバンドルは使いません。失敗の種類は付録Bのコードで返ります。

## 6. 質問と回答のデータ形式

### 回答

`Answers` は「質問ID から回答値への対応」です。未回答の質問はキーを持ちません。回答値 `AnswerValue` は次のどれかです。

| 質問の種別（`QuestionKind`） | 回答値 |
| --- | --- |
| `IMPORTANCE`（大切さ） | `VERY_IMPORTANT`、`IMPORTANT`、`NEUTRAL`、`NOT_VERY_IMPORTANT`、`NOT_IMPORTANT` |
| `TRADEOFF`（優先条件） | `A_STRONG`、`A_LEAN`、`BALANCED`、`B_LEAN`、`B_STRONG` |
| `PRIORITY_PICK`（最優先テーマ。`FULL` のみ） | `{ pick: [themeId] }` または `{ pick: [themeId, themeId] }`（1〜2テーマ） |
| どの種別でも | 非意見回答 `UNSURE`（判断に迷う）、`DECLINE`（回答しない）。`UNANSWERED` は未回答を表す値 |

- 回答値は画面で作りません。選択肢の `event` に入っている値をそのまま `dispatch` します（`SELECT_ANSWER` の `value`、`TOGGLE_PICK` の `item`）。
- 診断セット（`SetKind`）は `QUICK`（3テーマ6問。MVP）と `FULL`（6テーマ13問。完成形）です。セットが1つだけのバンドルでは、`START` で選択なしに質問が始まります。
- テーマ（`ThemeId`）は6つで、配列の順序は定義順です。順位ではありません。

### 質問

質問の表示は `presentQuestion` の戻り値（`QuestionPresentation`）だけを使います。質問文、解説、選択肢のラベルと並び順、`swapDirections`（優先条件の方向A/Bの入れ替え）は、すべて反映済みです。

## 7. 診断の状態遷移（`diagnosticReducer`）

`diagnosticReducer(state, event)` は純関数です。状態は `DiagnosticState`（`phase` で区別）、イベントは `DiagnosticEvent`（`type` で区別）です。乱数、時刻、通信を使わず、入力を書き換えません。表にないイベントは、同じオブジェクトをそのまま返します。

| 状態（`phase`） | 受け付けるイベント（`type`）と遷移先 |
| --- | --- |
| `LOADING` | `BUNDLE_LOADED` → `INTRO`。`BUNDLE_FAILED` → `LOAD_ERROR` |
| `LOAD_ERROR` | 終端。どのイベントでも変わらない |
| `INTRO` | `START` → 診断セットが1つなら `QUESTION`、2つ以上なら `SET_SELECT`。`OPEN_ABOUT` → `ABOUT` |
| `SET_SELECT` | `SELECT_SET` → `QUESTION`（1問目）。`OPEN_ABOUT` → `ABOUT` |
| `QUESTION` | `SELECT_ANSWER`、`TOGGLE_PICK`、`CLEAR_ANSWER` → `QUESTION`（回答を更新。`hint` が付くことがある）。`NEXT` → 未回答なら `QUESTION` のまま `hint` が `SELECT_REQUIRED`、途中なら次の質問、最後なら `RESULT`。`BACK` → 前の質問。`RESTART` → 同じセットの1問目（回答は消える）。`OPEN_CARD` → `FACT_CARD`。`OPEN_ABOUT` → `ABOUT` |
| `FACT_CARD` | `CLOSE_CARD` → 開いた元の画面。`OPEN_ABOUT` → `ABOUT` |
| `ABOUT` | `CLOSE_ABOUT` → 開いた元の画面 |
| `RESULT` | `FOCUS_THEME` → `RESULT`（焦点テーマを変更）。`OPEN_EDIT` → `ANSWER_EDIT`（`ALL` か、判断に迷ったテーマの `themeId`）。`RESTART` → 1問目から。`OPEN_CARD` → `FACT_CARD`。`OPEN_ABOUT` → `ABOUT` |
| `ANSWER_EDIT` | `SELECT_ANSWER`、`TOGGLE_PICK`、`CLEAR_ANSWER` → `ANSWER_EDIT`（`editable` の質問だけ）。`CONFIRM_EDIT` → `RESULT`（再計算。変更前の結果を `previous` に保持）。`CANCEL_EDIT` → `RESULT`（何も変えない）。`RESTART`。`OPEN_CARD` → `FACT_CARD`。`OPEN_ABOUT` → `ABOUT` |
| `UNEXPECTED_ERROR` | `RESTART` だけを受け付ける → 同じセットの1問目（バンドルが無い場合は変わらない） |

- `RESULT` と `ANSWER_EDIT` では、マップ生成の設定が不正（`INVALID_CONFIG`）のとき `OPEN_EDIT` と `RESTART` を受け付けません。
- 想定外の例外（実装の不具合）は、`UNEXPECTED_ERROR` に入ります。この状態はバンドルと診断セットの種別だけを持ち、回答、結果、例外の内容を持ちません。
- 「次へ」「戻る」の有効・無効は、`presentQuestion` の `nav` を使います。画面で判定しません。

## 8. 質問画面（`presentQuestion`）

`phase` が `QUESTION` のとき、`presentQuestion(bundle, state.session, state.hint)` を呼びます。

| 項目 | 内容 |
| --- | --- |
| `position` | `{ current, total }`（1始まり） |
| `themeLabel`、`text`、`explanation`、`premise`、`directions` | 質問文、解説、前提文、方向の説明。用語の注記（`RichText`）つき |
| `options` | 選択肢。`id`、`kind`（`OPINION`、`UNSURE`、`DECLINE`、`THEME`）、`label`、`selected`、`event` |
| `cardLinks` | 関連する課題カード。押したら `{ type: "OPEN_CARD", cardId }` を渡す |
| `dataKindLabel` | データ種別の表示（12章） |
| `aiLabel` | AI が下書きした質問のラベル。無ければ `null` |
| `hintText` | `hint` に対応する固定文言。無ければ `null` |
| `nav` | `backEnabled`、`nextEnabled`、`nextLabel` |

- 選択肢は `options` の並びのまま描画し、押されたら `option.event` を `dispatch` します。ラベルと並び順を作り直しません。
- `QuestionPresentation` には `frame` がありません。バナーとAboutへの導線は `buildFrame(bundle)` の戻り値（`FrameView`）で描画します。

## 9. 結果画面（`buildResultViewModel`）と価値観マップの出力形式

`phase` が `RESULT` のとき、状態から次のように組み立てます。

```ts
if (state.phase === "RESULT" && state.session.setKind !== null && state.session.current !== null) {
  const view = buildResultViewModel({
    bundle,
    setKind: state.session.setKind,
    answers: state.session.answers,
    current: state.session.current,
    previous: state.session.previous,
    focusThemeId: state.focusThemeId,
  });
}
```

- 戻り値 `ResultViewModel` は `kind` で分かれます。`"MAP"` は結果（`ResultMapView`）、`"ERROR"` はマップ生成の失敗（`ResultErrorView`。11章）です。
- `ResultMapView` は `sectionOrder` の順に描画します。節は `notice`、`explainer`、`priority`、`importance`、`tradeoff`、`hesitant`、`declined`、`undetermined`、`notAsked`、`counts`、`reflection`、`diff`、`guidance` です。`diff` は回答を変更した後だけ現れます。
- `notice` は折りたたみも閉じる操作もつけません（結果が推奨ではないことの注意書き）。
- 大切さは5つのグループ（`+2` から `-2`）で表示します。グループは順位ではありません。テーマに順位をつけません。
- 表示する文言は、すべてバンドルの承認済み固定文言と結果解説から作られています。画面で文を作りません。

### 価値観マップ（`ValuesMap`）の形

画面は `ValuesMap` を直接描画しません（`ResultViewModel` を使います）。契約の概要は次のとおりです。

| 項目 | 内容 |
| --- | --- |
| `setKind` | `QUICK` か `FULL` |
| `themes` | 6テーマ分。各テーマが `importance` と `tradeoff` の `AxisState` を持つ |
| `AxisState` | `DETERMINED`（点数 `score` と段階 `level`）、`UNDETERMINED`（理由 `UNSURE`/`DECLINE`/`UNANSWERED`）、`NOT_ASKED`（診断セットが聞いていない） |
| `importanceGroups` | `+2`、`+1`、`0`、`-1`、`-2` の5グループ |
| `priority` | `NOT_ASKED`、`SELECTED`、`UNSURE`、`DECLINE`、`UNANSWERED`。`QUICK` は常に `NOT_ASKED` |
| `hesitantThemes`、`declinedThemes`、`notAskedThemes` | 判断に迷ったテーマ、回答しなかったテーマ、未出題のテーマ（互いに別の項目） |
| `counts` | 出題テーマ数、全テーマ数、使えた質問数、出題質問数 |
| `MapError` | `UNKNOWN_QUESTION`、`INVALID_ANSWER`、`NO_OPINION_ANSWERS`、`INVALID_CONFIG` |

「未出題」は回答の一種ではありません。聞いていないテーマを、判断に迷ったテーマや回答しなかったテーマに混ぜません。

## 10. 課題カードと「このアプリについて」

- `phase` が `FACT_CARD` のとき、`buildCardView(bundle, state.cardId)` を呼びます。戻り値 `CardView` は、出典、事実項目、ライセンス表示、データ種別のラベル、AI関与のラベルを持ちます。
- `phase` が `ABOUT` のとき、`buildAboutView(bundle)` を呼びます。戻り値 `AboutView` は、質問の作成者と承認者、計算の規則、しきい値、データ種別の説明、AI の使い方、AI の貢献を示す4つの数を持ちます。
- どちらも閉じるときは `CLOSE_CARD`、`CLOSE_ABOUT` を渡し、開いた元の画面に戻ります。
- 課題カードの事実は、価値観マップの計算に使いません。事実項目を変えてもマップは変わりません。

## 11. エラー画面の表示

エラーは3種類あり、表示方法が違います。

| 種類 | 状態 | 表示 |
| --- | --- | --- |
| バンドルを読み込めない | `LOAD_ERROR` | `LOAD_FAILURE_TEXTS[buildKind]` の固定文言だけ。`DEMO` は「データの読み込みに失敗しました。」、`PUBLIC` は「準備中」。バンドルが無いので承認済み固定文言は読めない。`FIXTURE` に切り替えない |
| マップを作れない（`MapError`） | `RESULT` | `buildResultViewModel` が返す `kind: "ERROR"` の表示モデル。`code` は `NO_OPINION_ANSWERS`（回答を見直す導線）、`UNKNOWN_QUESTION` と `INVALID_ANSWER`（最初からやり直す導線）、`INVALID_CONFIG`（導線なし） |
| 想定外の内部エラー | `UNEXPECTED_ERROR` | `buildUnexpectedErrorView(bundle)`。バンドルがあれば固定文言と「最初からやり直す」の導線、やり直すと回答が消える旨の注記（`restartNote`）。バンドルが無ければ `RELOAD_GUIDE_TEXT`（「ページを再読み込みしてください。」）だけ |

- `UNEXPECTED_ERROR` の状態の `bundle` が `null` でなければ、読み込み済みの `VerifiedBundle` を `buildUnexpectedErrorView` に渡します。`null` なら `null` を渡します。
- エラーの内容、例外のメッセージ、スタック、回答の値、質問IDを、画面、状態、ログ、`console` のどこにも出しません。React のエラー境界で例外を受けたときも、`console.error(error)` を呼ばず、状態を `UNEXPECTED_ERROR` 相当の表示に切り替えるだけにします。
- エラー画面にも、データ種別のバナー（`frame`）を表示します。

## 12. `FIXTURE` と `REAL_AI` の表示区分

- バンドルの `meta.dataKind` は `FIXTURE`（架空データ）か `REAL_AI`（実データ）のどちらかです。画面の表示はこの項目に従います。
- 1つのバンドルに両方を混ぜません。実行時にも切り替えません。画面で独自に判定しません。
- すべての画面（診断、結果、課題カード、「このアプリについて」、エラー）で、データ種別のバナーを常に表示します。スクロール位置と画面幅（360px 以上）にかかわらず表示領域内に置き、非表示にする操作を設けません。
  - `FIXTURE`: 「これはデモ用の架空データです。」
  - `REAL_AI`: 愛媛県の公式サービスではないことを述べる承認済み固定文言
- バナーの文言は表示モデルが持っています。結果・エラー・About は各表示モデルの `frame.banner` を、質問とカードは `buildFrame(bundle).banner` を使います（どちらも同じ値です）。`QuestionPresentation.dataKindLabel` と `CardView.dataKindLabel` は個別のラベルで、バナーの代わりにはなりません。画面で文言を書きません。
- すべての画面から、1回の操作でデータ種別を確認できるようにします。`frame.aboutLink` から「このアプリについて」へ移れます。
- ビルドの `dataMode` が `REAL_PREFERRED`（デモ版の既定）で実データが無いときは、全体が `FIXTURE` のバンドルに切り替わります。このとき `build-report.json` の `switched` が `true` になり、理由が記録されます。画面は切り替えを意識せず、`meta.dataKind` だけを見ます。
- 公開版（`--kind public`）は、実データが条件を満たさなければバンドルを作りません。画面は「準備中」だけを表示します。

## 13. 利用者の回答を外部送信しない制約

回答、最優先テーマの選択、価値観マップ、およびそこから導いた値（以下「回答データ」）は、ブラウザのメモリの中だけで扱います（要件 9 の基準 1〜3、6、9）。

禁止:

- 回答データをサーバーや外部サービス（Amazon Bedrock などの AI を含む）へ送ること。`fetch`、`XMLHttpRequest`、`navigator.sendBeacon`、`WebSocket`、フォーム送信、画像やリンクの URL への埋込みのすべてが対象です。
- 回答データを URL（クエリ文字列と hash を含む）に載せること。診断の状態もURLに持たせません。
- `localStorage`、`sessionStorage`、cookie、`IndexedDB` に、回答データや、そこから復元できる値を書くこと。端末内保存は、利用者が自分で選んだときだけの別機能（13.8）で、現時点の入口には保存の関数がありません。
- 回答データ、エラーの内容、質問IDを `console` やログに出すこと。
- アクセス解析、広告、行動追跡のスクリプトを入れること。共有用の URL や画像を自動で作ること。

許可される通信は、`loadBundle` による `bundle.json` の GET だけです。この GET は回答データを含みません。

## 14. 画面からの禁止事項

1. 表示する文字列を自作しない。ラベル、見出し、注意書き、エラー文は表示モデルの値を使う。
2. スコア、段階、グループ、並び順を再計算しない。`ValuesMap` と表示モデルの値をそのまま使う。
3. 保存領域（`localStorage`、`sessionStorage`、cookie、`IndexedDB`）に書き込まない。
4. バンドルの GET 以外の通信をしない。
5. ドメインの内部モジュールを取り込まない。入口は3章の2つだけ。
6. `AnswerValue` を自作しない。回答値は `option.event` の中の値だけを使う。
7. 質問や選択肢の並びを入れ替えない（方向の入れ替えは `presentQuestion` が反映済み）。
8. テーマに順位、ランク、一致率、候補者・政党との比較を表示しない。
9. `VerifiedBundle` を書き換えたり、検証前のバンドルを使ったりしない。
10. `generateValuesMap` と `levelOf` を画面から直接呼ばない。呼ぶのは `diagnosticReducer` だけです。

## 15. `/values` ルートと `AppShell` の例外

`apps/web` の変更は共同開発者が担当します。Task 14 に記録された着手承認（2026-11-13、西原薙寧）の範囲は次のとおりです。これは変更作業の開始を認める記録であり、実装完了の承認ではありません。

- Visitor と Analyst のルート契約に `/values` を追加し、`build-boundary.mjs` の `PUBLIC_ROUTE_PATHS` に `/values` を追加できます。
- `AppShell` は、現在のパスが `/values` のときだけ、2022年選挙のバナー、2022年のデータ種別表示、2022年選挙のフッターを表示しません。それ以外のルートの表示と動作は、従来のまま変えません。
- 診断の状態と回答由来の値を、URL、クエリ、hash に持たせません。
- 既存のルート関連テスト6ファイルには `/values` の期待値を追加します。既存の期待値の削除、緩和、置換はしません。
- ローカル限定バナー、skip link、landmark、戻る操作、Shared Navigation は承認の対象外です。変更しません。
- 既存の2022年選挙の画面、`/analyst/*`、退役済みの `/sources` の 404、既存のルート契約は変更しません。

## 16. 使用例とテストの入力

- 架空データによる通しの使用例は `tests/regional-values/fixtureUsage.test.ts` です。バンドルの読み込み、`START`、6問への回答、結果、回答の変更、やり直しまでを、`diagnosticReducer` と `buildResultViewModel` で実行しています。
- 画面テストの入力には、金テストベクタ V15、V16、V18 の期待値（`tests/harness/regional-values/goldenViews.ts` の `GOLDEN_V15`、`GOLDEN_V16`、`GOLDEN_V18`）と、その回答（`tests/harness/regional-values/viewDriver.ts` の `ANSWERS_V15`、`ANSWERS_V16`、`ANSWERS_V18`）を使います。
- 架空データの実体は `packages/fixtures/src/regional-values/` です。

## 付録A. ブラウザ向けの入口の公開名

`@ehime-vote-navigator/domain/regional-values` が公開する名前の全一覧です。同期テストが、実装の公開名とこの一覧を照合します。

### マップ生成

`generateValuesMap`、`levelOf`

### 診断の状態機械と質問

`createDiagnosticReducer`、`diagnosticReducer`、`initialDiagnosticState`、`ReducerDependencies`、`isAnswered`、`matchesKind`、`toMapInput`、`presentQuestion`、`DiagnosticEvent`、`DiagnosticState`、`Hint`、`QuestionId`、`Session`、`SessionBundle`、`SessionQuestion`、`SessionSet`

### 表示モデルと補助関数

`buildResultViewModel`、`defaultSectionOrder`、`ResultViewInput`、`buildErrorView`、`buildUnexpectedErrorView`、`RELOAD_GUIDE_TEXT`、`buildCardView`、`buildAboutView`、`buildFrame`、`annotateTerms`、`GlossaryEntry`、`lookupFixedText`、`renderFixedText`、`missingFixedTextKeys`、`FixedTextValues`、`formatDate`、`formatDateTime`

### 表示モデルの型

`JaText`、`RichText`、`Entry`、`ThemeRef`、`AiContribution`、`ViewBundle`、`FrameView`、`ResultErrorView`、`UnexpectedErrorView`、`SectionId`、`DiffCell`、`ThemeDrilldown`、`ChartBand`、`ResultMapView`、`ResultViewModel`、`PresentedOption`、`QuestionPresentation`、`CardView`、`AboutView`

### バンドルの取得と検証

`loadBundle`、`LoadBundleInput`、`HttpGet`、`BundleHttpResponse`、`BUNDLE_GET_INIT`、`MAX_BUNDLE_BYTES`、`verifyBundleText`、`ExpectedBundle`、`VerifiedBundle`、`BundleLoadErrorCode`、`BUNDLE_LOAD_ERROR_CODES`、`LOAD_FAILURE_TEXTS`、`Digest`

## 付録B. バンドルの読み込みエラーのコード

`loadBundle` と `verifyBundleText` が返すコードは次の12個です。画面はコードを表示せず、`LOAD_FAILURE_TEXTS` の固定文言を表示します。

`FETCH_FAILED`、`TOO_LARGE`、`NOT_JSON`、`META_MISSING`、`GENERATED_AT_INVALID`、`SCHEMA_VERSION_MISMATCH`、`DATA_VERSION_MISMATCH`、`BUILD_KIND_MISMATCH`、`SCHEMA_INVALID`、`HASH_MISMATCH`、`REFERENCE_BROKEN`、`PUBLIC_CONDITION_FAILED`
