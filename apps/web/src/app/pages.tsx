import { useId, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { AppLink } from "./navigation.js";

const ELECTION_NAME = "令和4年（2022年）第20回愛媛県知事選挙";
const MISSING_VALUE = "no-data（今後の表示領域）";

const CANDIDATE_SKELETONS = [
  {
    candidateId: "nakamura-tokihiro",
    name: "中村時広氏",
  },
  {
    candidateId: "hayashi-noriko",
    name: "林紀子氏",
  },
] as const;

const COMPARISON_FIELDS = [
  "対象",
  "内容",
  "条件",
  "例外",
  "否定",
  "実施段階",
  "期限",
  "根拠リンク",
  "自動状態",
  "人間状態",
] as const;

const POLICY_THEMES = [
  "子育て",
  "教育",
  "経済",
  "福祉",
  "防災",
  "地域振興",
  "交通",
] as const;

type PageIntroProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>;

function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-800">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-700">{description}</p>
    </div>
  );
}

type StatusCode = "NOT_READY" | "no-data" | "404";

type StatusPanelProps = Readonly<{
  statusCode: StatusCode;
  title: string;
  children: ReactNode;
}>;

function StatusPanel({ statusCode, title, children }: StatusPanelProps) {
  const headingId = useId();
  const palette =
    statusCode === "404"
      ? "border-rose-300 bg-rose-50 text-rose-950"
      : statusCode === "NOT_READY"
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-slate-300 bg-slate-50 text-slate-900";

  return (
    <section
      aria-labelledby={headingId}
      className={`mt-8 rounded-2xl border p-5 sm:p-6 ${palette}`}
      data-terminal-state={statusCode}
    >
      <p className="font-mono text-sm font-black tracking-wide">{statusCode}</p>
      <h2 className="mt-2 text-xl font-bold" id={headingId}>
        {title}
      </h2>
      <div className="mt-3 leading-7">{children}</div>
    </section>
  );
}

function MissingValue() {
  return <span className="font-medium text-slate-600">{MISSING_VALUE}</span>;
}

type FutureFieldListProps = Readonly<{
  fields: readonly string[];
}>;

function FutureFieldList({ fields }: FutureFieldListProps) {
  return (
    <dl className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {fields.map((field) => (
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]" key={field}>
          <dt className="font-semibold text-slate-900">{field}</dt>
          <dd>
            <MissingValue />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type FeatureLink = Readonly<{
  to: string;
  label: string;
  description: string;
}>;

function FeatureLinkGrid({ links }: Readonly<{ links: readonly FeatureLink[] }>) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2" role="list">
      {links.map((link) => (
        <li key={link.to}>
          <AppLink
            aria-label={link.label}
            className="flex min-h-24 h-full flex-col justify-center rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-orange-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
            to={link.to}
          >
            <span className="font-bold text-slate-950">{link.label}</span>
            <span className="mt-1 text-sm leading-6 text-slate-600">
              {link.description}
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

const PUBLIC_HOME_LINKS: readonly FeatureLink[] = [
  {
    to: "/schedule",
    label: "選挙日程を見る",
    description: "投票日と終了済みの過去選挙であることを確認します。",
  },
  {
    to: "/candidates",
    label: "候補者一覧を見る",
    description: "対象候補者を同じ画面構造で確認します。",
  },
  {
    to: "/candidates/nakamura-tokihiro",
    label: "中村時広氏の詳細を見る",
    description: "候補者詳細の共通表示枠を確認します。",
  },
  {
    to: "/candidates/hayashi-noriko",
    label: "林紀子氏の詳細を見る",
    description: "候補者詳細の共通表示枠を確認します。",
  },
  {
    to: "/comparison",
    label: "政策比較を見る",
    description: "資料未入手のため、現在はNOT_READYを表示します。",
  },
  {
    to: "/sources",
    label: "出典一覧を見る",
    description: "出典と来歴の表示枠を確認します。",
  },
  {
    to: "/venue",
    label: "会場閲覧画面を見る",
    description: "公開条件を満たした情報の表示先を確認します。",
  },
];

const ANALYST_HOME_LINKS: readonly FeatureLink[] = [
  {
    to: "/analyst/readiness",
    label: "解析準備状態を見る",
    description: "両候補者の資料不足を確認します。",
  },
  {
    to: "/analyst/sources",
    label: "Source Manifest画面を見る",
    description: "資料版と来歴の管理画面枠です。",
  },
  {
    to: "/analyst/runs",
    label: "解析実行と履歴を見る",
    description: "runは開始せず、未準備状態を確認します。",
  },
  {
    to: "/analyst/evaluation",
    label: "評価画面を見る",
    description: "評価結果の表示枠です。",
  },
  {
    to: "/analyst/p0",
    label: "P0完成判定を見る",
    description: "P0検査と未達項目の表示枠です。",
  },
  {
    to: "/analyst/aws",
    label: "AWS診断画面を見る",
    description: "読み取り診断の結果表示枠です。",
  },
];

export function HomePage() {
  return (
    <div>
      <PageIntro
        description={`${ELECTION_NAME}を対象にした、終了済み選挙のローカル限定デモです。`}
        eyebrow="P0 local demonstration"
        title="えひめ投票ナビ"
      />

      <section
        aria-labelledby="election-identity-heading"
        className="mt-8 rounded-2xl bg-slate-950 p-6 text-white"
      >
        <h2 className="text-xl font-bold" id="election-identity-heading">
          対象選挙
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-300">選挙名</dt>
            <dd className="mt-1 font-semibold">{ELECTION_NAME}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-300">投票日</dt>
            <dd className="mt-1 font-semibold">2022-11-20</dd>
          </div>
        </dl>
      </section>

      <StatusPanel statusCode="NOT_READY" title="政策解析は開始できません">
        <p>
          両候補者へ同じ採用規則を適用できる2022年の実政策資料が未入手です。資料がそろうまで、政策要約と政策比較は表示しません。
        </p>
      </StatusPanel>

      <section aria-labelledby="visitor-links-heading" className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950" id="visitor-links-heading">
          会場閲覧のP0画面
        </h2>
        <FeatureLinkGrid links={PUBLIC_HOME_LINKS} />
      </section>

      <section aria-labelledby="analyst-links-heading" className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950" id="analyst-links-heading">
          ローカル分析のP0画面
        </h2>
        <p className="mt-2 text-slate-700">
          共同開発者向けの画面枠です。実資料へのアクセスやAWS要求は、この画面表示では実行しません。
        </p>
        <FeatureLinkGrid links={ANALYST_HOME_LINKS} />
      </section>
    </div>
  );
}

export function SchedulePage() {
  return (
    <div>
      <PageIntro
        description="対象選挙の日程を、現在の投票案内ではなく過去の参照情報として扱います。"
        eyebrow="会場閲覧"
        title="選挙日程"
      />

      <section aria-labelledby="past-schedule-heading" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-bold" id="past-schedule-heading">
          確認対象
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-semibold text-slate-600">投票日</dt>
            <dd className="mt-1 font-bold">2022-11-20</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-600">選挙状態</dt>
            <dd className="mt-1 font-bold">終了済み</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate-600">扱い</dt>
            <dd className="mt-1 font-bold">過去の参照情報</dd>
          </div>
        </dl>
      </section>

      <StatusPanel statusCode="no-data" title="日程の出典情報は未接続です">
        <p>出典、最終更新日、投票時刻、期日前投票期間は推測せず、今後のデータ接続まで表示しません。</p>
        <FutureFieldList fields={["出典", "最終更新日", "投票開始時刻", "投票終了時刻", "期日前投票期間"]} />
      </StatusPanel>
    </div>
  );
}

function CandidatePhotoPlaceholder() {
  return (
    <div
      aria-label="候補者写真の共通プレースホルダー"
      className="flex h-44 w-full items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-100 px-4 text-center text-sm font-semibold text-slate-600"
      role="img"
    >
      候補者写真は未確認です
    </div>
  );
}

function CandidateListFields({ name }: Readonly<{ name: string }>) {
  const fields = [
    { label: "氏名", value: name },
    { label: "情報源上の氏名表記", value: MISSING_VALUE },
    { label: "党派", value: MISSING_VALUE },
    { label: "選挙結果", value: MISSING_VALUE },
    { label: "出典", value: MISSING_VALUE },
    { label: "最終更新日", value: MISSING_VALUE },
  ] as const;

  return (
    <dl className="mt-5 space-y-3">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="text-sm font-semibold text-slate-600">{field.label}</dt>
          <dd className="mt-1 text-slate-900">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CandidatesPage() {
  return (
    <div>
      <PageIntro
        description="対象候補者を同じ項目順、同じカード寸法、同じ写真プレースホルダーで表示する画面枠です。"
        eyebrow="会場閲覧"
        title="候補者一覧"
      />

      <StatusPanel statusCode="NOT_READY" title="政策資料は未入手です">
        <p>
          候補者の政策要約は表示しません。候補者カード内の未接続項目は、成功データで補わずno-dataとしています。
        </p>
        <p className="mt-2 font-semibold">公式届出順未確認。現在の並びは画面構造確認用の暫定表示です。</p>
      </StatusPanel>

      <section aria-labelledby="candidate-grid-heading" className="mt-10">
        <h2 className="text-2xl font-bold" id="candidate-grid-heading">
          対象候補者の共通カード
        </h2>
        <div className="mt-5 grid items-stretch gap-5 md:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => {
            const titleId = `candidate-${candidate.candidateId}-title`;

            return (
              <article
                aria-labelledby={titleId}
                className="flex h-full min-h-[38rem] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                data-candidate-card="true"
                key={candidate.candidateId}
              >
                <CandidatePhotoPlaceholder />
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-orange-800">
                  共通表示構造
                </p>
                <h3 className="mt-2 text-2xl font-black" id={titleId}>
                  {candidate.name}
                </h3>
                <CandidateListFields name={candidate.name} />
                <div className="mt-auto pt-6">
                  <AppLink
                    aria-label={`${candidate.name}の候補者詳細へ移動`}
                    className="inline-flex min-h-11 min-w-11 w-full items-center justify-center rounded-xl bg-orange-700 px-4 py-3 font-bold text-white hover:bg-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
                    to={`/candidates/${candidate.candidateId}`}
                  >
                    {candidate.name}の詳細を見る
                  </AppLink>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CandidateDetailFields({ name }: Readonly<{ name: string | null }>) {
  return (
    <dl className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold">氏名</dt>
        <dd>{name ?? MISSING_VALUE}</dd>
      </div>
      {[
        "情報源上の氏名表記",
        "党派",
        "経歴",
        "採用資料",
        "出典",
        "最終更新日",
      ].map((field) => (
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]" key={field}>
          <dt className="font-semibold">{field}</dt>
          <dd>
            <MissingValue />
          </dd>
        </div>
      ))}
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold">資料量</dt>
        <dd>
          <ul className="space-y-2" role="list">
            {[
              "採用資料数",
              "抽出文字数",
              "政策単位数",
            ].map((label) => (
              <li className="flex flex-wrap justify-between gap-2" key={label}>
                <span>{label}</span>
                <MissingValue />
              </li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

export function CandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const candidate = CANDIDATE_SKELETONS.find(
    (item) => item.candidateId === candidateId,
  );

  return (
    <div>
      <PageIntro
        description="どの候補者IDでも同じ項目順と欠損表示を使う詳細画面枠です。"
        eyebrow="会場閲覧"
        title="候補者詳細"
      />

      <StatusPanel statusCode="NOT_READY" title="候補者の政策情報は表示できません">
        <p>
          2022年の実政策資料と承認済み情報がないため、政策要約を表示せず、共通項目だけをno-dataとして配置します。
        </p>
      </StatusPanel>

      <section aria-labelledby="candidate-profile-heading" className="mt-10">
        <h2 className="text-2xl font-bold" id="candidate-profile-heading">
          候補者情報の共通表示項目
        </h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-[16rem_1fr]">
          <CandidatePhotoPlaceholder />
          <div>
            {candidateId === undefined ? null : (
              <p className="text-sm text-slate-600">
                候補者ID: <code className="break-all font-mono">{candidateId}</code>
              </p>
            )}
            {candidate === undefined ? (
              <p className="mt-3 font-semibold text-rose-800">
                この候補者IDに対応する表示データはno-dataです。
              </p>
            ) : null}
            <CandidateDetailFields name={candidate?.name ?? null} />
          </div>
        </div>
      </section>

      <section aria-labelledby="approved-policy-heading" className="mt-10">
        <h2 className="text-2xl font-bold" id="approved-policy-heading">
          承認済み政策情報
        </h2>
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <p className="font-mono font-black text-amber-950">NOT_READY</p>
          <p className="mt-2 text-amber-950">
            公開可能な承認済み政策情報はありません。資料未入手のため、AI生成文による補完は行いません。
          </p>
        </div>
      </section>
    </div>
  );
}

export function ComparisonPage() {
  return (
    <div>
      <PageIntro
        description="両候補者へ同じ項目を適用する政策比較の画面枠です。推薦、採点、ランキングは行いません。"
        eyebrow="会場閲覧"
        title="政策比較"
      />

      <StatusPanel statusCode="NOT_READY" title="通常の政策比較は非表示です">
        <p>
          両候補者の2022年実政策資料が未入手です。別年代の資料、片方だけの資料、fixture、AI生成情報で不足を補いません。
        </p>
      </StatusPanel>

      <section aria-labelledby="themes-heading" className="mt-10">
        <h2 className="text-2xl font-bold" id="themes-heading">
          共通テーマ（準備完了後の表示領域）
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2" role="list">
          {POLICY_THEMES.map((theme) => (
            <li className="rounded-full border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700" key={theme}>
              {theme}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comparison-frame-heading" className="mt-10">
        <h2 className="text-2xl font-bold" id="comparison-frame-heading">
          候補者別の共通比較項目
        </h2>
        <p className="mt-2 text-slate-700">
          通常の比較表ではなく、準備完了後に使う同一構造だけを示しています。
        </p>
        <div className="mt-5 grid items-stretch gap-5 md:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => {
            const headingId = `comparison-${candidate.candidateId}-heading`;

            return (
              <article
                aria-labelledby={headingId}
                className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                data-comparison-candidate="true"
                key={candidate.candidateId}
              >
                <h3 className="text-xl font-black" id={headingId}>
                  {candidate.name}
                </h3>
                <p className="mt-2 font-semibold text-amber-900">
                  NOT_READY: 2022年の政策一次資料が未入手です。
                </p>
                <dl className="mt-5 divide-y divide-slate-200">
                  {COMPARISON_FIELDS.map((field) => (
                    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr]" key={field}>
                      <dt className="font-semibold">{field}</dt>
                      <dd className="font-mono text-sm text-amber-900">NOT_READY</dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function SourcesPage() {
  return (
    <div>
      <PageIntro
        description="表示中の情報に対応する出典、revision、利用条件、locatorを確認するための画面枠です。"
        eyebrow="会場閲覧"
        title="出典一覧"
      />
      <StatusPanel statusCode="no-data" title="表示できる出典はありません">
        <p>実政策資料が未入手のため、出典レコードを推測して表示しません。</p>
        <FutureFieldList fields={["資料名", "発行者", "公開日", "取得日", "revision", "利用条件確認状態", "locator"]} />
      </StatusPanel>
    </div>
  );
}

export function VenuePage() {
  return (
    <div>
      <PageIntro
        description="公開条件を通過した情報だけを集約する会場向け画面の入口です。"
        eyebrow="会場閲覧"
        title="会場閲覧"
      />
      <StatusPanel statusCode="NOT_READY" title="会場表示できる政策情報はありません">
        <p>実政策資料、検証、人間承認がそろっていないため、成功データや疑似AI進捗を表示しません。</p>
      </StatusPanel>
    </div>
  );
}

export function AnalystReadinessPage() {
  return (
    <div>
      <PageIntro
        description="Source Manifestと両候補者の同等資料範囲を確認する分析画面枠です。"
        eyebrow="ローカル分析"
        title="政策解析準備状態"
      />
      <StatusPanel statusCode="NOT_READY" title="両候補者の政策一次資料が不足しています">
        <div className="grid gap-3 sm:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => (
            <section className="rounded-xl border border-amber-200 bg-white p-4" key={candidate.candidateId}>
              <h3 className="font-bold">{candidate.name}</h3>
              <p className="mt-2">不足項目: 2022年の採用可能な政策一次資料</p>
            </section>
          ))}
        </div>
      </StatusPanel>
    </div>
  );
}

export function AnalystSourcesPage() {
  return (
    <div>
      <PageIntro
        description="Source Manifestの資料版、checksum、利用条件、採否を扱う画面枠です。"
        eyebrow="ローカル分析"
        title="Source Manifest"
      />
      <StatusPanel statusCode="no-data" title="登録済みの実政策資料はありません">
        <p>資料版の登録操作とAPI接続はTask 5.1の対象外です。</p>
        <FutureFieldList fields={["資料版", "候補者", "対象選挙", "revision", "source checksum", "利用条件確認状態", "採否理由"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystRunsPage() {
  return (
    <div>
      <PageIntro
        description="資料版の選択、解析開始、queue、実行履歴を扱う画面枠です。"
        eyebrow="ローカル分析"
        title="解析実行と履歴"
      />
      <StatusPanel statusCode="NOT_READY" title="解析runは開始できません">
        <p>政策解析準備状態がNOT_READYのため、run開始操作を置かず、疑似進捗も表示しません。</p>
      </StatusPanel>
    </div>
  );
}

export function AnalystRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const stages = [
    "取り込み",
    "分割",
    "検索",
    "構造化抽出",
    "要約",
    "決定的検査",
    "Bedrock意味判定",
  ] as const;

  return (
    <div>
      <PageIntro
        description="1件のrunについて固定順の7段階、結果、失敗理由、費用を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="解析run詳細"
      />
      {runId === undefined ? null : (
        <p className="mt-6 text-sm text-slate-600">
          run ID: <code className="break-all font-mono">{runId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="一致する実行履歴はありません">
        <p>runは実行していません。以下は進捗ではなく、今後表示する段階名です。</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="今後表示する解析段階">
          {stages.map((stage, index) => (
            <li className="rounded-lg border border-slate-200 bg-white px-4 py-3" key={stage}>
              <span className="font-semibold">{index + 1}. {stage}</span>
              <span className="ml-2 font-mono text-sm text-slate-600">no-data</span>
            </li>
          ))}
        </ol>
      </StatusPanel>
    </div>
  );
}

export function AnalystVerificationPage() {
  const { artifactId } = useParams<{ artifactId: string }>();

  return (
    <div>
      <PageIntro
        description="原文、引用、決定的検査、別要求の意味判定を同じartifactに結び付ける画面枠です。"
        eyebrow="ローカル分析"
        title="根拠検証"
      />
      {artifactId === undefined ? null : (
        <p className="mt-6 text-sm text-slate-600">
          artifact ID: <code className="break-all font-mono">{artifactId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="検証対象artifactはありません">
        <FutureFieldList fields={["対応原文", "根拠引用", "locator", "決定的検査", "Bedrock意味判定", "自動状態", "状態決定理由"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystReviewPage() {
  const { artifactId } = useParams<{ artifactId: string }>();

  return (
    <div>
      <PageIntro
        description="原文と検証結果を照合し、人間状態を判断する画面枠です。"
        eyebrow="ローカル分析"
        title="人間確認"
      />
      {artifactId === undefined ? null : (
        <p className="mt-6 text-sm text-slate-600">
          artifact ID: <code className="break-all font-mono">{artifactId}</code>
        </p>
      )}
      <StatusPanel statusCode="no-data" title="確認対象artifactはありません">
        <p>承認条件を満たす実データがないため、承認・却下操作は表示しません。</p>
        <FutureFieldList fields={["対象選挙", "候補者", "原文", "locator", "構造化政策情報", "初心者向け要約", "検証結果", "人間状態"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystEvaluationPage() {
  return (
    <div>
      <PageIntro
        description="gold datasetによる検証あり・なしの評価結果を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="評価"
      />
      <StatusPanel statusCode="no-data" title="評価結果はありません">
        <p>実資料と評価datasetがないため、指標、時間、費用の数値を生成しません。</p>
        <FutureFieldList fields={["dataset版", "除外例", "指標の分子・分母・値", "所要時間", "概算費用", "設定"]} />
      </StatusPanel>
    </div>
  );
}

export function AnalystP0Page() {
  return (
    <div>
      <PageIntro
        description="P0検査、証跡、完成期限の判定結果を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="P0完成判定"
      />
      <StatusPanel statusCode="NOT_READY" title="P0未完成です">
        <p>両候補者の実政策資料、実AI実行、検証、人間承認などの証跡が未達です。fixtureや画面枠を完成証跡として扱いません。</p>
      </StatusPanel>
    </div>
  );
}

export function AnalystAwsPage() {
  return (
    <div>
      <PageIntro
        description="AWS既定認証チェーン、東京リージョン、3用途modelの読み取り診断を表示する画面枠です。"
        eyebrow="ローカル分析"
        title="AWS診断"
      />
      <StatusPanel statusCode="no-data" title="AWS診断は実行していません">
        <p>この画面表示によるAWS要求は0件です。診断操作とAPI接続はTask 5.1の対象外です。</p>
        <FutureFieldList fields={["認証可否", "呼出主体の安全な識別結果", "設定リージョン", "生成model", "意味判定model", "埋め込みmodel"]} />
      </StatusPanel>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div>
      <PageIntro
        description="指定されたURLはP0の定義済み画面ではありません。"
        eyebrow="経路エラー"
        title="ページが見つかりません"
      />
      <StatusPanel statusCode="404" title="定義されていないURLです">
        <p>P1/P2を含む未登録の経路は、この404画面を表示します。</p>
        <AppLink
          className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 font-bold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
          to="/"
        >
          ホームへ移動
        </AppLink>
      </StatusPanel>
    </div>
  );
}
