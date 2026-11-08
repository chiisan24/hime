import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Eye,
  FileText,
  Scale,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../shared/ui/Badge.js";
import { AiSummaryFrame, SourceFrame } from "../../shared/ui/EvidenceFrames.js";
import { HomeTile } from "../../shared/ui/HomeTile.js";
import { InfoList, type InfoListItem } from "../../shared/ui/InfoList.js";
import { NoticeBar } from "../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../shared/ui/SectionCard.js";
import { SetouchiScene } from "../../shared/ui/SetouchiScene.js";
import { AppLink } from "../navigation.js";
import { projectVisitorPresentation } from "./visitorPresentation.js";

const ELECTION_NAME = "令和4年（2022年）第20回愛媛県知事選挙";
const ELECTION_DATE_LABEL = "2022年11月20日（日）";
/** 分析者向け画面の未接続項目で使う表示（分析者側の表示は変えない） */
const MISSING_VALUE = "no-data（今後の表示領域）";
/** 候補者に関する未確認項目（Req 12.16） */
const CANDIDATE_MISSING_VALUE = "資料で確認できません";
/** 日程に関する未確認項目（Req 18.5） */
const SCHEDULE_MISSING_VALUE = "一次情報未登録";
const NO_APPROVED_AI_TEXT = "承認済みの情報がないため表示しません";
const ORDER_NOTICE =
  "並び順について：公式届出順未確認。画面確認用の暫定の並びで、優劣を表すものではありません。";

export const CANDIDATE_SKELETONS = [
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

/** 政策比較の項目のうち、初めての人に説明が必要なもの */
const COMPARISON_FIELD_NOTES: Readonly<Partial<Record<(typeof COMPARISON_FIELDS)[number], string>>> = {
  否定: "「しない」と明言していること",
  実施段階: "構想・検討・計画・実施中・完了のどれか",
  自動状態: "機械による根拠チェックの結果",
  人間状態: "人による確認の結果",
};

const POLICY_THEMES = [
  "子育て",
  "教育",
  "経済",
  "福祉",
  "防災",
  "地域振興",
  "交通",
] as const;

const PRIMARY_LINK_CLASS =
  "inline-flex min-h-11 min-w-11 w-full items-center justify-center gap-1 rounded-full bg-primary px-5 py-3 font-bold text-white transition hover:bg-primary-dark";
const SECONDARY_LINK_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-line bg-white px-5 py-2 text-sm font-bold text-ink-soft shadow-[var(--shadow-card)] transition hover:border-primary/50 hover:text-primary";

type PageIntroProps = Readonly<{
  /** 見出しの上の小さなラベル。利用者向けの画面では使わない */
  eyebrow?: string;
  title: string;
  description: string;
}>;

export function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <div className="max-w-3xl">
      {eyebrow === undefined ? null : (
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-accent-dark">
          {eyebrow}
        </p>
      )}
      <h1
        className={`${eyebrow === undefined ? "" : "mt-2 "}text-2xl font-black leading-tight tracking-tight text-primary-dark sm:text-3xl`}
      >
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base sm:leading-7">
        {description}
      </p>
    </div>
  );
}

type StatusCode = "NOT_READY" | "no-data" | "404";

type StatusPanelProps = Readonly<{
  statusCode: StatusCode;
  title: string;
  children: ReactNode;
  /** 上の余白。並べる側で間隔を決める画面では空文字を渡す */
  className?: string;
}>;

export function StatusPanel({
  statusCode,
  title,
  children,
  className = "mt-8",
}: StatusPanelProps) {
  const headingId = useId();
  const palette =
    statusCode === "404"
      ? "border-red-300 bg-red-50 text-red-900"
      : statusCode === "NOT_READY"
        ? "border-accent/40 bg-accent-light text-accent-dark"
        : "border-line bg-surface text-ink";

  return (
    <section
      aria-labelledby={headingId}
      className={`${className} rounded-[var(--radius-card)] border p-4 sm:p-5 ${palette}`}
      data-terminal-state={statusCode}
    >
      <h2 className="text-base font-bold sm:text-lg" id={headingId}>
        {title}
      </h2>
      <div className="mt-1 text-sm leading-6 sm:text-base sm:leading-7">{children}</div>
      {/* 状態コードは見出しより目立たせない。コードの文字だけを持つ要素はテストと共同開発者の確認で使う */}
      <p className="mt-2 text-xs opacity-80">
        状態コード: <span className="font-bold tracking-wide">{statusCode}</span>
      </p>
    </section>
  );
}

type FutureFieldListProps = Readonly<{
  fields: readonly string[];
  /** 値の表示。省略時は分析者向けの従来表示 */
  value?: string;
}>;

export function FutureFieldList({ fields, value = MISSING_VALUE }: FutureFieldListProps) {
  return (
    <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-white">
      {fields.map((field) => (
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]" key={field}>
          <dt className="font-semibold text-ink">{field}</dt>
          <dd>
            <span className="font-medium text-ink-soft">{value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type FeatureLink = Readonly<{
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}>;

/** リンクの一覧。分析者モードのホームで使う（見た目は変更していない） */
export function FeatureLinkGrid({ links }: Readonly<{ links: readonly FeatureLink[] }>) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2" role="list">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <li key={link.to}>
            <AppLink
              aria-label={link.label}
              className="flex min-h-24 h-full items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white px-5 py-4 shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              to={link.to}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-ink">{link.label}</span>
                <span className="mt-0.5 block text-sm leading-6 text-ink-soft">
                  {link.description}
                </span>
              </span>
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

const PUBLIC_HOME_LINKS: readonly FeatureLink[] = [
  {
    to: "/schedule",
    label: "選挙日程を見る",
    description: "投票日と終了済みの過去選挙であることを確認します。",
    icon: CalendarDays,
  },
  {
    to: "/candidates",
    label: "候補者一覧を見る",
    description: "対象候補者を同じ画面構造で確認します。",
    icon: Users,
  },
  {
    to: "/candidates/nakamura-tokihiro",
    label: "中村時広氏の詳細を見る",
    description: "候補者詳細の共通表示枠を確認します。",
    icon: UserRound,
  },
  {
    to: "/candidates/hayashi-noriko",
    label: "林紀子氏の詳細を見る",
    description: "候補者詳細の共通表示枠を確認します。",
    icon: UserRound,
  },
  {
    to: "/comparison",
    label: "政策比較を見る",
    description: "資料未入手のため、現在はNOT_READYを表示します。",
    icon: Scale,
  },
  {
    to: "/venue",
    label: "会場閲覧画面を見る",
    description: "公開条件を満たした情報の表示先を確認します。",
    icon: Eye,
  },
];

export const VISITOR_HOME_LINKS = projectVisitorPresentation(PUBLIC_HOME_LINKS);

type HomeTileDetail = Readonly<{
  /** カードに出す短い名前。リンク名（VISITOR_HOME_LINKS の label）に含まれる文字にする */
  title: string;
  description: string;
  /** 行き先の中身が資料待ちで準備中か */
  preparing: boolean;
}>;

/** ホームのカードに出す名前と説明 */
const HOME_TILE_DETAILS: Readonly<Record<string, HomeTileDetail>> = {
  "/schedule": { title: "選挙日程", description: "投票日を確認", preparing: false },
  "/candidates": { title: "候補者一覧", description: "2人の候補者を知る", preparing: false },
  "/comparison": { title: "政策比較", description: "政策の違いを見る", preparing: true },
  "/venue": { title: "会場閲覧", description: "デモ会場向けのまとめ", preparing: true },
};

const CANDIDATE_DETAIL_PREFIX = "/candidates/";
const CANDIDATE_LIST_PATH = "/candidates";

/**
 * ホームのメニュー（region）の名前。
 * 共同開発者のテスト（visitorPresentation / analystRoutes）がこの名前で region を探すため、
 * 画面には出さず読み上げ用の名前としてだけ残す。表示上の見出しはない。
 */
const HOME_MENU_REGION_NAME = "会場閲覧のP0画面";

function homeTileDetail(link: FeatureLink): HomeTileDetail {
  return (
    HOME_TILE_DETAILS[link.to] ?? {
      title: link.label,
      description: link.description,
      preparing: false,
    }
  );
}

function candidateNameOf(to: string): string {
  return (
    CANDIDATE_SKELETONS.find(
      (candidate) => `${CANDIDATE_DETAIL_PREFIX}${candidate.candidateId}` === to,
    )?.name ?? to
  );
}

/** 「候補者一覧」カードの下に置く、候補者ごとの詳細へのリンク。2人とも同じ見た目にする */
function CandidateSubLinks({ links }: Readonly<{ links: readonly FeatureLink[] }>) {
  return (
    <div>
      <p className="mb-1 text-center text-xs text-ink-soft">ひとりずつ見る</p>
      <ul className="grid grid-cols-2 gap-1.5 max-[359px]:grid-cols-1" role="list">
        {links.map((link) => (
          <li key={link.to}>
            <AppLink
              aria-label={link.label}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface px-0.5 text-xs font-bold text-primary-dark transition hover:bg-primary-light active:bg-surface-2"
              to={link.to}
            >
              {candidateNameOf(link.to)}
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VisitorHomePage() {
  // 候補者ごとの詳細リンクは「候補者一覧」カードの中に入れる（リンクの並び順は変えない）
  const candidateLinks = VISITOR_HOME_LINKS.filter((link) =>
    link.to.startsWith(CANDIDATE_DETAIL_PREFIX),
  );
  const menuLinks = VISITOR_HOME_LINKS.filter(
    (link) => !link.to.startsWith(CANDIDATE_DETAIL_PREFIX),
  );

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* 小さな表紙：キャッチコピーと控えめな愛媛の風景。アプリ名はヘッダーにあるので見出しは読み上げ用 */}
      <section
        aria-labelledby="home-hero-heading"
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-white"
      >
        <SetouchiScene className="pointer-events-none absolute inset-y-0 right-0 h-full w-24 sm:w-48 md:w-72" />
        <div className="relative py-3 pl-4 pr-28 sm:pl-6 sm:pr-52 md:py-4 md:pr-80">
          <h1 className="sr-only" id="home-hero-heading">
            えひめ投票ナビ
          </h1>
          <p className="text-base font-bold leading-snug text-primary-dark md:text-xl">
            愛媛の選挙を、わかりやすく
          </p>
        </div>
      </section>

      {/* メインメニュー：スマホ2列、1024px以上は4列 */}
      <section aria-label={HOME_MENU_REGION_NAME}>
        <h2 className="sr-only">メインメニュー</h2>
        <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4" role="list">
          {menuLinks.map((link) => {
            const detail = homeTileDetail(link);
            return (
              <li key={link.to}>
                <HomeTile
                  description={detail.description}
                  icon={link.icon}
                  label={link.label}
                  preparing={detail.preparing}
                  subLinks={
                    link.to === CANDIDATE_LIST_PATH && candidateLinks.length > 0 ? (
                      <CandidateSubLinks links={candidateLinks} />
                    ) : undefined
                  }
                  title={detail.title}
                  to={link.to}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {/* 選挙情報：今表示できる値だけ */}
      <SectionCard aside={<Badge>終了済み</Badge>} icon={CalendarDays} title="選挙情報">
        <p className="font-bold text-ink">{ELECTION_NAME}</p>
        <div className="mt-3">
          <InfoList
            items={[
              { label: "投票日", value: ELECTION_DATE_LABEL },
              { label: "期日前投票期間", value: SCHEDULE_MISSING_VALUE },
            ]}
          />
        </div>
      </SectionCard>

      <StatusPanel className="" statusCode="NOT_READY" title="政策の情報は準備中です">
        <p>
          2人の2022年の政策資料がまだそろっていないため、政策の要約と比較は表示しません。
        </p>
      </StatusPanel>
    </div>
  );
}

export function SchedulePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="令和4年 第20回愛媛県知事選挙の日程です。過去の参照情報として表示しています。"
        title="選挙日程"
      />

      <SectionCard aside={<Badge>終了済み</Badge>} icon={CalendarDays} title="この選挙">
        <p className="font-bold text-ink">{ELECTION_NAME}</p>
        <p className="mt-2 text-2xl font-black text-primary-dark">{ELECTION_DATE_LABEL}</p>
        <p className="mt-1 text-sm text-ink-soft">投票日。現在の投票案内ではありません。</p>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 投票日は上のカードで大きく出しているので、ここでは時刻だけを出す */}
        <SectionCard title="当日の投票時間">
          <InfoList
            items={[
              { label: "投票開始時刻", value: SCHEDULE_MISSING_VALUE },
              { label: "投票終了時刻", value: SCHEDULE_MISSING_VALUE },
            ]}
          />
        </SectionCard>
        <SectionCard title="期日前投票">
          <InfoList items={[{ label: "期日前投票期間", value: SCHEDULE_MISSING_VALUE }]} />
        </SectionCard>
      </div>

      <StatusPanel className="" statusCode="no-data" title="日程の出典情報は未登録です">
        <p>公式の資料が登録されるまで、時刻や期間は推測で表示しません。</p>
        <FutureFieldList fields={["出典", "最終更新日"]} value={SCHEDULE_MISSING_VALUE} />
      </StatusPanel>
    </div>
  );
}

type CandidatePhotoPlaceholderProps = Readonly<{
  className: string;
}>;

/** 全候補者で同一仕様の写真の仮枠（Req 12.8） */
function CandidatePhotoPlaceholder({ className }: CandidatePhotoPlaceholderProps) {
  return (
    <div
      aria-label="候補者写真の共通プレースホルダー"
      className={`flex items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface px-2 text-center text-xs font-bold leading-5 text-ink-soft ${className}`}
      role="img"
    >
      候補者写真は未確認です
    </div>
  );
}

function candidateListItems(name: string): readonly InfoListItem[] {
  return [
    { label: "氏名", value: name },
    { label: "情報源上の氏名表記", value: CANDIDATE_MISSING_VALUE },
    { label: "党派", value: CANDIDATE_MISSING_VALUE },
    { label: "選挙結果", value: CANDIDATE_MISSING_VALUE },
    { label: "出典", value: CANDIDATE_MISSING_VALUE },
    { label: "最終更新日", value: CANDIDATE_MISSING_VALUE },
  ];
}

export function CandidatesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="2022年の愛媛県知事選挙の候補者を、同じ形式で表示します。"
        title="候補者一覧"
      />

      <NoticeBar>{ORDER_NOTICE}</NoticeBar>

      <StatusPanel className="" statusCode="NOT_READY" title="政策資料は未入手です">
        <p>
          候補者の政策の要約は、資料がそろうまで表示しません。値がない項目は「{CANDIDATE_MISSING_VALUE}」と表示しています。
        </p>
      </StatusPanel>

      <section aria-labelledby="candidate-grid-heading">
        <h2 className="text-lg font-bold text-primary-dark sm:text-xl" id="candidate-grid-heading">
          候補者（2名）
        </h2>
        <div className="mt-3 grid items-stretch gap-5 md:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => {
            const titleId = `candidate-${candidate.candidateId}-title`;

            return (
              <article
                aria-labelledby={titleId}
                className="flex h-full min-h-[38rem] flex-col rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6"
                data-candidate-card="true"
                key={candidate.candidateId}
              >
                <div className="flex items-center gap-4">
                  <CandidatePhotoPlaceholder className="size-24 shrink-0 md:size-28" />
                  <h3
                    className="min-w-0 text-xl font-black text-primary-dark md:text-2xl"
                    id={titleId}
                  >
                    {candidate.name}
                  </h3>
                </div>
                <div className="mt-5">
                  <InfoList items={candidateListItems(candidate.name)} />
                </div>
                <div className="mt-5">
                  <AiSummaryFrame>{NO_APPROVED_AI_TEXT}</AiSummaryFrame>
                </div>
                <div className="mt-auto pt-6">
                  <AppLink
                    aria-label={`${candidate.name}の候補者詳細へ移動`}
                    className={PRIMARY_LINK_CLASS}
                    to={`/candidates/${candidate.candidateId}`}
                  >
                    {candidate.name}の詳細を見る
                    <ChevronRight aria-hidden="true" className="size-5" />
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

function MaterialAmountList() {
  return (
    <ul className="space-y-1" role="list">
      {["採用資料数", "抽出文字数", "政策単位数"].map((label) => (
        <li className="flex flex-wrap gap-x-4" key={label}>
          <span className="text-ink-soft">{label}</span>
          <span>{CANDIDATE_MISSING_VALUE}</span>
        </li>
      ))}
    </ul>
  );
}

export function CandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const candidate = CANDIDATE_SKELETONS.find(
    (item) => item.candidateId === candidateId,
  );
  const name = candidate?.name ?? CANDIDATE_MISSING_VALUE;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="どの候補者も、同じ項目と同じ順番で表示します。"
        title="候補者詳細"
      />

      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <CandidatePhotoPlaceholder className="h-44 w-full lg:h-56" />

        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <h2 className="text-2xl font-black text-primary-dark sm:text-3xl">{name}</h2>
            {candidate === undefined ? (
              <p className="mt-2 font-bold text-red-700">
                この候補者IDに対応する候補者はいません。一覧から選び直してください。
              </p>
            ) : null}
          </div>

          <StatusPanel className="" statusCode="NOT_READY" title="政策の情報は表示できません">
            <p>政策の資料と承認済みの情報がないため、政策の要約は表示しません。</p>
          </StatusPanel>

          <SectionCard icon={UserRound} title="基本情報">
            <InfoList
              items={[
                { label: "氏名", value: name },
                { label: "情報源上の氏名表記", value: CANDIDATE_MISSING_VALUE },
                { label: "党派", value: CANDIDATE_MISSING_VALUE },
                { label: "経歴", value: CANDIDATE_MISSING_VALUE },
              ]}
            />
          </SectionCard>

          <SectionCard icon={FileText} title="政策">
            <div className="flex flex-col gap-3">
              <AiSummaryFrame>{NO_APPROVED_AI_TEXT}</AiSummaryFrame>
              <SourceFrame>{CANDIDATE_MISSING_VALUE}</SourceFrame>
            </div>
          </SectionCard>

          <SectionCard icon={BookOpen} title="資料と出典">
            <InfoList
              items={[
                {
                  label: "採用資料",
                  note: "政策を確かめるために使う公式の資料",
                  value: CANDIDATE_MISSING_VALUE,
                },
                { label: "資料量", value: <MaterialAmountList /> },
                { label: "出典", value: CANDIDATE_MISSING_VALUE },
                { label: "最終更新日", value: CANDIDATE_MISSING_VALUE },
              ]}
            />
            {candidateId === undefined ? null : (
              <p className="mt-4 text-xs text-ink-soft">
                候補者ID: <code className="break-all">{candidateId}</code>
              </p>
            )}
          </SectionCard>

          <div>
            <AppLink className={SECONDARY_LINK_CLASS} to="/comparison">
              政策比較を見る
              <ChevronRight aria-hidden="true" className="size-4" />
            </AppLink>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComparisonPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="2人の政策を、同じ項目で見比べる画面です。推薦・採点・ランキングはしません。"
        title="政策比較"
      />

      <StatusPanel className="" statusCode="NOT_READY" title="政策比較は準備中です">
        <p>
          2人の2022年の政策資料がまだそろっていません。資料がそろうまで比較表は表示しません。
        </p>
      </StatusPanel>

      <section aria-labelledby="themes-heading">
        <h2 className="text-lg font-bold text-primary-dark sm:text-xl" id="themes-heading">
          比べられるテーマ
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          資料がそろうと、テーマを選んで比べられるようになります。
        </p>
        {/* 押せないタグ。枠線と影を付けず、ボタンに見せない */}
        <ul className="mt-3 flex flex-wrap gap-2" role="list">
          {POLICY_THEMES.map((theme) => (
            <li className="rounded-md bg-surface-2 px-3 py-1 text-sm text-ink-soft" key={theme}>
              {theme}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comparison-frame-heading">
        <h2 className="text-lg font-bold text-primary-dark sm:text-xl" id="comparison-frame-heading">
          候補者ごとの比較項目
        </h2>
        <NoticeBar className="mt-3">
          並び順について：公式届出順未確認。画面確認用の暫定の並びです。
        </NoticeBar>
        <div className="mt-4 grid items-stretch gap-5 md:grid-cols-2">
          {CANDIDATE_SKELETONS.map((candidate) => {
            const headingId = `comparison-${candidate.candidateId}-heading`;

            return (
              <article
                aria-labelledby={headingId}
                className="h-full rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6"
                data-comparison-candidate="true"
                key={candidate.candidateId}
              >
                <h3 className="text-xl font-black text-primary-dark" id={headingId}>
                  {candidate.name}
                </h3>
                <dl className="mt-3 divide-y divide-line">
                  {COMPARISON_FIELDS.map((field) => {
                    const note = COMPARISON_FIELD_NOTES[field];
                    return (
                      <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-3" key={field}>
                        <dt className="text-sm font-bold text-ink-soft">
                          {field}
                          {note === undefined ? null : (
                            <span className="mt-0.5 block text-xs font-normal leading-5">
                              {note}
                            </span>
                          )}
                        </dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          <Badge>準備中</Badge>
                          <span className="text-xs text-ink-soft">NOT_READY</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function VenuePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="このデモの展示会場で、確認と承認がすんだ政策情報をまとめて見る画面です。投票所の案内ではありません。"
        title="会場閲覧"
      />
      <StatusPanel className="" statusCode="NOT_READY" title="表示できる情報はまだありません">
        <p>資料の確認と承認がまだすんでいないため、表示できる情報はありません。</p>
      </StatusPanel>
      <SectionCard icon={Eye} title="この画面に表示されるもの（資料がそろったあと）">
        <ul className="list-disc space-y-1 pl-5 text-ink" role="list">
          <li>2人の候補者の基本情報</li>
          <li>確認と承認がすんだ政策の要約と、その原文・出典</li>
        </ul>
      </SectionCard>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro description="指定されたページは見つかりませんでした。" title="ページが見つかりません" />
      <StatusPanel className="" statusCode="404" title="このページはありません">
        <p>URLが正しいか確かめるか、ホームから目的の画面を選んでください。</p>
        <AppLink
          className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full bg-primary px-6 py-3 font-bold text-white transition hover:bg-primary-dark"
          to="/"
        >
          ホームへ移動
        </AppLink>
      </StatusPanel>
    </div>
  );
}
