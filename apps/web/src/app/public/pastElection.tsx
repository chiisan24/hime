import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Eye,
  FileText,
  Scale,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";

import type { PolicyTheme } from "../../data/visitorDisplayData.js";
import { formatJapaneseDate } from "../../services/dateLabel.js";
import { ELECTION_PHASE_LABELS, electionPhaseAt } from "../../services/electionPhase.js";
import {
  findCandidate,
  getTargetElection,
  listCandidates,
  listPolicyThemes,
} from "../../services/visitorData.js";
import { AiContent } from "../../shared/ui/AiContent.js";
import { Badge } from "../../shared/ui/Badge.js";
import { SourceFrame } from "../../shared/ui/EvidenceFrames.js";
import { InfoList, type InfoListItem } from "../../shared/ui/InfoList.js";
import { NoticeBar } from "../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../shared/ui/SectionCard.js";
import { AppLink } from "../navigation.js";
import {
  AI_SUMMARY_STATE,
  CandidatePhotoPlaceholder,
  FutureFieldList,
  PageIntro,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  StatusPanel,
  ThemeSelector,
  type FeatureLink,
  type HomeTileDetail,
} from "./pageParts.js";
import type { PastComparisonPageProps, PastElection } from "./pastElectionTypes.js";

/*
 * 過去の選挙（令和4年・2022年の愛媛県知事選挙）の画面と表示データ。
 * data/electionDataSource.ts の設定が "PAST_REAL" のときに表示する、退避用の既存の画面。
 * 過去の選挙のデータ（data/visitorDisplayData.ts）を使う画面と文言は、このファイルの中だけに置く。
 *
 * このファイルは #past-election として読み込む（vite.config.ts）。
 * - 分析者モード（--mode analyst）のビルド・開発サーバーと、テスト（Vitest）: このファイルを使う。
 * - 利用者向けのビルド・開発サーバー（npm run build / npm run dev）: #past-election は
 *   pastElectionExcluded.ts（PAST_ELECTION が null）に差し替わり、このファイルと過去の選挙のデータは
 *   公開成果物に入らない（scripts/build-boundary.mjs で確認する）。
 * #past-election の外から、このファイルを直接 import しない（公開ビルドに入ってしまうため）。
 */

/** 表示する選挙（データは services/visitorData.ts から受け取る） */
const ELECTION = getTargetElection();
const ELECTION_NAME = ELECTION.name;
const ELECTION_DATE_LABEL = formatJapaneseDate(ELECTION.electionDate);
/** 候補者に関する未確認項目（Req 12.16） */
const CANDIDATE_MISSING_VALUE = "資料で確認できません";
/** 日程に関する未確認項目（Req 18.5） */
const SCHEDULE_MISSING_VALUE = "一次情報未登録";
const ORDER_NOTICE =
  "並び順について：公式届出順未確認。画面確認用の暫定の並びで、優劣を表すものではありません。";

/** 対象候補者。pages.tsx が CANDIDATE_SKELETONS として書き出す（分析者向け画面とテストが参照する） */
const CANDIDATE_SKELETONS = listCandidates();

/** 選挙の状態を表すラベル。表示するたびに、その時点の日本標準時で判定する */
function ElectionPhaseBadge() {
  return <Badge>{ELECTION_PHASE_LABELS[electionPhaseAt(ELECTION.electionDate, new Date())]}</Badge>;
}

const POLICY_THEMES = listPolicyThemes();

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

/** ホームのカードに出す名前と説明（過去の選挙） */
const PAST_HOME_TILE_DETAILS: Readonly<Record<string, HomeTileDetail>> = {
  "/schedule": { title: "選挙日程", description: "投票日を確認", preparing: false },
  "/candidates": { title: "候補者一覧", description: "2人の候補者を知る", preparing: false },
  "/comparison": { title: "政策比較", description: "政策の違いを見る", preparing: true },
  "/venue": { title: "会場閲覧", description: "デモ会場向けのまとめ", preparing: true },
};

/** ホームの選挙情報（今表示できる値だけ）と、政策の準備状態の表示 */
function PastHomeElectionSummary() {
  return (
    <>
      <SectionCard aside={<ElectionPhaseBadge />} icon={CalendarDays} title="選挙情報">
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
    </>
  );
}

function PastSchedulePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="令和4年 第20回愛媛県知事選挙の日程です。過去の参照情報として表示しています。"
        title="選挙日程"
      />

      <SectionCard aside={<ElectionPhaseBadge />} icon={CalendarDays} title="この選挙">
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

function PastCandidatesPage() {
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
                  <AiContent state={AI_SUMMARY_STATE} />
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

function PastCandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const candidate = findCandidate(candidateId);
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
              <AiContent state={AI_SUMMARY_STATE} />
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

/** 政策資料がない候補者の欠落理由（Req 13.9）。2人とも同じ文で表示する */
const COMPARISON_MISSING_REASON = "2022年の政策資料が未入手のため、表示できる政策はありません。";

/** 政策比較。比べる項目は、公開の政策比較と同じもの（pages.tsx の COMPARISON_FIELDS）を受け取る */
function PastComparisonPage({ fields, fieldNotes }: PastComparisonPageProps) {
  const [selectedTheme, setSelectedTheme] = useState<PolicyTheme>(POLICY_THEMES[0] ?? "子育て");

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
          比べるテーマ
        </h2>
        <ThemeSelector
          onSelect={setSelectedTheme}
          selected={selectedTheme}
          themes={POLICY_THEMES}
        />
      </section>

      <section aria-labelledby="comparison-frame-heading">
        <h2 className="text-lg font-bold text-primary-dark sm:text-xl" id="comparison-frame-heading">
          「{selectedTheme}」の比較
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
                <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink">
                  {selectedTheme}：{COMPARISON_MISSING_REASON}
                </p>
                <dl className="mt-3 divide-y divide-line">
                  {fields.map((field) => {
                    const note = fieldNotes[field];
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

function PastVenuePage() {
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

export const PAST_ELECTION: PastElection | null = {
  candidates: CANDIDATE_SKELETONS,
  homeLinks: PUBLIC_HOME_LINKS,
  homeTileDetails: PAST_HOME_TILE_DETAILS,
  HomeElectionSummary: PastHomeElectionSummary,
  SchedulePage: PastSchedulePage,
  CandidatesPage: PastCandidatesPage,
  CandidateDetailPage: PastCandidateDetailPage,
  ComparisonPage: PastComparisonPage,
  VenuePage: PastVenuePage,
  shell: {
    notice: "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
    realAiDataKindLabel: "2022年実資料・AI解析",
    footerTarget: "対象: 令和4年（2022年）第20回愛媛県知事選挙",
  },
};
