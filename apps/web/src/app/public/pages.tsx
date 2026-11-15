import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Compass,
  Eye,
  FileText,
  Scale,
  UserRound,
  Users,
} from "lucide-react";
import { useId, useState } from "react";
import { useParams } from "react-router-dom";

import { PAST_ELECTION } from "#past-election";

import type { MockCandidate } from "../../data/mock/types.js";
import type { CandidateSummary } from "../../data/types.js";
import { formatJapaneseDate } from "../../services/dateLabel.js";
import {
  candidateDetailPath,
  getActivePastElection,
  getMockElectionData,
  isElectionDestinationAvailable,
  isElectionPageAvailable,
  listActiveCandidates,
  type ElectionPageId,
} from "../../services/electionData.js";
import { ELECTION_PHASE_LABELS, electionPhaseAt } from "../../services/electionPhase.js";
import { AiContent } from "../../shared/ui/AiContent.js";
import { Badge } from "../../shared/ui/Badge.js";
import { HomeTile } from "../../shared/ui/HomeTile.js";
import { InfoList, type InfoListItem } from "../../shared/ui/InfoList.js";
import { NoticeBar } from "../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../shared/ui/SectionCard.js";
import { SetouchiScene } from "../../shared/ui/SetouchiScene.js";
import { AppLink } from "../navigation.js";
import {
  AI_SUMMARY_STATE,
  CandidatePhotoPlaceholder,
  PageIntro,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  StatusPanel,
  ThemeSelector,
  type FeatureLink,
  type HomeTileDetail,
} from "./pageParts.js";
import { projectVisitorPresentation } from "./visitorPresentation.js";

/** 画面の共通部品（pageParts.tsx）。分析者向け画面とテストは、ここから書き出した名前で参照する */
export {
  FeatureLinkGrid,
  FutureFieldList,
  PageIntro,
  StatusPanel,
  type FeatureLink,
} from "./pageParts.js";

/**
 * 過去の選挙の対象候補者（#past-election）。分析者向け画面とテストもこの名前で参照するので、書き出し名は変えない。
 * 過去の選挙を含まないビルド（利用者向けの公開ビルド）では空になる。
 */
export const CANDIDATE_SKELETONS: readonly CandidateSummary[] = PAST_ELECTION?.candidates ?? [];

/**
 * 政策比較の項目。公開の政策比較の根拠の項目（「根拠リンク」）は、この画面のモジュールに置く
 * （scripts/build-boundary.mjs が確かめる）。過去の選挙の政策比較にも、この項目を渡す。
 */
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

/*
 * 選挙関連ページ（選挙日程・候補者・政策比較・会場閲覧）の表示データの切り替え。
 * 使うデータの種類は data/electionDataSource.ts の設定で決まる（services/electionData.ts）。
 * - PAST_REAL: 過去の選挙（2022年）の既存の画面（pastElection.tsx の PastXxxPage）を表示する。
 *              過去の選挙の画面とデータは #past-election からだけ読み込み、このファイルには置かない。
 *              利用者向けの公開ビルドには含まれない（vite.config.ts）ため、そのビルドでは MOCK と同じになる。
 * - MOCK     : モックデータの画面（MockXxxPage）を表示する。カード・一覧・テーマの選択などの構成は
 *              PastXxxPage と同じにし、値だけをモックデータから取る。モックデータが未設定のページも、
 *              同じ構成のまま「開発中」の空状態として表示する（ページも、ナビゲーションとホームの入口も外さない）。
 *              過去の選挙のデータは出さない。未設定の値を、推測や架空の値で埋めない。
 */

/** モックデータが未設定の項目に出す表示 */
const DEMO_DATA_MISSING_VALUE = "デモ用データ未設定";
/** 選挙関連ページが開発中であることの表示。完成した機能と誤認されないように、どの選挙関連ページにも出す */
const DEVELOPMENT_LABEL = "開発中";
/** モックデータ（デモ用データ）を表示していることの表示 */
const DEMO_DATA_LABEL = "デモ用データ";
/** モックデータには公式の出典がない */
const DEMO_DATA_SOURCE_VALUE = "なし（デモ用データのため、公式の出典はありません）";
const DEMO_DATA_NONE_VALUE = "なし（デモ用データ）";
const MOCK_ORDER_NOTICE =
  "並び順について：デモ用データの並びのまま表示しています。優劣を表すものではありません。";
const MOCK_THEME_MISSING_REASON = "このテーマの情報は提供されていません。";

const ELECTION_PAGE_IDS: readonly ElectionPageId[] = ["schedule", "candidates", "comparison", "venue"];

/** モックデータが、どれか1つのページの分でも設定されているか */
function hasAnyMockElectionPage(): boolean {
  return ELECTION_PAGE_IDS.some((page) => isElectionPageAvailable(page));
}

/** モックデータで表示していることを示す。モックデータを表示する画面には必ず置く */
function MockDataNotice() {
  return (
    <div data-mock-data-notice="true">
      <NoticeBar>
        モックデータ（試作用の仮データ）で表示しています。公式の情報ではありません。
      </NoticeBar>
    </div>
  );
}

/**
 * 選挙関連ページの状態の表示。どのページにも「開発中」を出し、モックデータを表示しているときは
 * 「デモ用データ」と、モックデータであることの説明を加える。
 */
function ElectionDemoStatus({ showsMockData }: Readonly<{ showsMockData: boolean }>) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"
        data-election-demo-status={showsMockData ? "mock-data" : "no-data"}
      >
        <Badge>{DEVELOPMENT_LABEL}</Badge>
        {showsMockData ? <Badge tone="primary">{DEMO_DATA_LABEL}</Badge> : null}
        <span>選挙関連の画面は、開発中のデモです。</span>
      </p>
      {showsMockData ? <MockDataNotice /> : null}
    </div>
  );
}

/**
 * モックデータが未設定の選挙関連ページで、内容の代わりに置く空状態の枠。
 * ページの見出しとカードの構成は残したまま、この枠で知らせる。
 */
function ElectionNoDataPanel() {
  return (
    <StatusPanel className="" statusCode="no-data" title="表示できる情報はまだありません">
      <p>
        この画面は開発中です。デモ用データが設定されると、ここに内容を表示します。それまでは、推測や架空の値で埋めません。
      </p>
      <AppLink className={`${SECONDARY_LINK_CLASS} mt-4`} to="/values">
        価値観診断をはじめる
        <ChevronRight aria-hidden="true" className="size-4" />
      </AppLink>
    </StatusPanel>
  );
}

/** モックデータの投票日に対する選挙の状態のラベル。表示するたびに、その時点の日本標準時で判定する */
function MockElectionPhaseBadge({ electionDate }: Readonly<{ electionDate: string }>) {
  return <Badge>{ELECTION_PHASE_LABELS[electionPhaseAt(electionDate, new Date())]}</Badge>;
}

/** 出典の欄。デモ用データには公式の出典がないことを示す */
function MockSourceCard() {
  return (
    <SectionCard icon={BookOpen} title="出典">
      <InfoList
        items={[
          { label: "出典", value: DEMO_DATA_SOURCE_VALUE },
          { label: "最終更新日", value: DEMO_DATA_NONE_VALUE },
        ]}
      />
    </SectionCard>
  );
}

/** 選挙日程。カードの構成は PastSchedulePage と同じ（この選挙・当日の投票時間・期日前投票・出典） */
function MockSchedulePage() {
  const schedule = getMockElectionData().schedule;

  if (schedule === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageIntro
          description="選挙の日程を表示する画面です。デモ用データはまだ設定されていません。"
          title="選挙日程"
        />
        <ElectionDemoStatus showsMockData={false} />

        <SectionCard icon={CalendarDays} title="この選挙">
          <p className="font-bold text-ink">{DEMO_DATA_MISSING_VALUE}</p>
          <p className="mt-2 text-2xl font-black text-primary-dark">未設定</p>
          <p className="mt-1 text-sm text-ink-soft">投票日</p>
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="当日の投票時間">
            <InfoList items={[{ label: "投票時間", value: DEMO_DATA_MISSING_VALUE }]} />
          </SectionCard>
          <SectionCard title="期日前投票">
            <InfoList items={[{ label: "期日前投票期間", value: DEMO_DATA_MISSING_VALUE }]} />
          </SectionCard>
        </div>

        <ElectionNoDataPanel />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageIntro description="選挙の日程です。デモ用データで表示しています。" title="選挙日程" />
      <ElectionDemoStatus showsMockData />

      <SectionCard
        aside={<MockElectionPhaseBadge electionDate={schedule.election.electionDate} />}
        icon={CalendarDays}
        title="この選挙"
      >
        <p className="font-bold text-ink">{schedule.election.name}</p>
        <p className="mt-2 text-2xl font-black text-primary-dark">
          {formatJapaneseDate(schedule.election.electionDate)}
        </p>
        <p className="mt-1 text-sm text-ink-soft">投票日</p>
        {schedule.note === undefined ? null : (
          <p className="mt-4 text-sm leading-6 text-ink">{schedule.note}</p>
        )}
      </SectionCard>

      {/* 提供された項目のカードだけを出す。省略された項目は、推測で埋めない */}
      {schedule.votingHours === undefined && schedule.earlyVoting === undefined ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          {schedule.votingHours === undefined ? null : (
            <SectionCard title="当日の投票時間">
              <InfoList items={[{ label: "投票時間", value: schedule.votingHours }]} />
            </SectionCard>
          )}
          {schedule.earlyVoting === undefined ? null : (
            <SectionCard title="期日前投票">
              <InfoList items={[{ label: "期日前投票期間", value: schedule.earlyVoting }]} />
            </SectionCard>
          )}
        </div>
      )}

      <MockSourceCard />
    </div>
  );
}

/** 候補者の基本情報。提供された項目の行だけを作る（未提供の項目を「資料で確認できません」などで埋めない） */
function mockCandidateBasicItems(candidate: MockCandidate): readonly InfoListItem[] {
  const items: InfoListItem[] = [{ label: "氏名", value: candidate.name }];
  if (candidate.party !== undefined) {
    items.push({ label: "党派", value: candidate.party });
  }
  if (candidate.profile !== undefined) {
    items.push({ label: "経歴", value: candidate.profile });
  }
  return items;
}

/** 候補者一覧のカードの項目。基本情報に、提供されていれば政策の要約を加える */
function mockCandidateItems(candidate: MockCandidate): readonly InfoListItem[] {
  return candidate.summary === undefined
    ? mockCandidateBasicItems(candidate)
    : [...mockCandidateBasicItems(candidate), { label: "政策の要約", value: candidate.summary }];
}

/**
 * 候補者のデモ用データが未設定のときに、候補者カードの位置に置く枠。
 * 候補者ではないので、候補者カード（article）にはしない。
 */
function CandidateCardPlaceholder() {
  return (
    <div
      className="flex h-full flex-col gap-4 rounded-[var(--radius-card)] border-2 border-dashed border-line bg-white p-4 sm:p-6"
      data-candidate-card-placeholder="true"
    >
      <div className="flex items-center gap-4">
        <CandidatePhotoPlaceholder className="size-24 shrink-0 md:size-28" />
        <p className="min-w-0 text-base font-bold text-ink-soft">{DEMO_DATA_MISSING_VALUE}</p>
      </div>
      <p className="text-sm leading-6 text-ink-soft">
        候補者のデモ用データが設定されると、ここに候補者ごとのカードが同じ形式で並びます。
      </p>
    </div>
  );
}

/** 候補者一覧。カードの構成は PastCandidatesPage と同じ（写真の枠・氏名・項目・AI要約の枠・詳細へのリンク） */
function MockCandidatesPage() {
  const candidates = getMockElectionData().candidates ?? [];
  const provided = candidates.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro description="候補者を、同じ形式で表示します。" title="候補者一覧" />
      <ElectionDemoStatus showsMockData={provided} />

      {provided ? <NoticeBar>{MOCK_ORDER_NOTICE}</NoticeBar> : <ElectionNoDataPanel />}

      <section aria-labelledby="mock-candidate-grid-heading">
        <h2
          className="text-lg font-bold text-primary-dark sm:text-xl"
          id="mock-candidate-grid-heading"
        >
          {provided ? `候補者（${candidates.length}名）` : "候補者"}
        </h2>
        <div className="mt-3 grid items-stretch gap-5 md:grid-cols-2">
          {provided ? (
            candidates.map((candidate) => {
              const titleId = `mock-candidate-${candidate.candidateId}-title`;

              return (
                <article
                  aria-labelledby={titleId}
                  className="flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6"
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
                    <InfoList items={mockCandidateItems(candidate)} />
                  </div>
                  <div className="mt-5">
                    <AiContent state={AI_SUMMARY_STATE} />
                  </div>
                  <div className="mt-auto pt-6">
                    <AppLink
                      aria-label={`${candidate.name}の候補者詳細へ移動`}
                      className={PRIMARY_LINK_CLASS}
                      to={candidateDetailPath(candidate.candidateId)}
                    >
                      {candidate.name}の詳細を見る
                      <ChevronRight aria-hidden="true" className="size-5" />
                    </AppLink>
                  </div>
                </article>
              );
            })
          ) : (
            <CandidateCardPlaceholder />
          )}
        </div>
      </section>

      {provided ? <MockSourceCard /> : null}
    </div>
  );
}

/** 候補者詳細。構成は PastCandidateDetailPage と同じ（写真の枠・氏名・基本情報・政策・資料と出典） */
function MockCandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const candidates = getMockElectionData().candidates ?? [];
  const candidate = candidates.find((entry) => entry.candidateId === candidateId);
  const provided = candidates.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="どの候補者も、同じ項目と同じ順番で表示します。"
        title="候補者詳細"
      />
      <ElectionDemoStatus showsMockData={provided} />

      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <CandidatePhotoPlaceholder className="h-44 w-full lg:h-56" />

        <div className="flex min-w-0 flex-col gap-5">
          {/* URL の候補者IDは、モックデータの候補者に当たるときだけ表示する（過去の候補者IDを画面に出さない） */}
          {candidate === undefined ? (
            provided ? (
              <StatusPanel className="" statusCode="no-data" title="この候補者の情報はありません">
                <p>この候補者IDに対応する候補者はいません。一覧から選び直してください。</p>
                <AppLink className={`${SECONDARY_LINK_CLASS} mt-4`} to="/candidates">
                  候補者一覧を見る
                  <ChevronRight aria-hidden="true" className="size-4" />
                </AppLink>
              </StatusPanel>
            ) : (
              <ElectionNoDataPanel />
            )
          ) : (
            <>
              <div>
                <h2 className="text-2xl font-black text-primary-dark sm:text-3xl">
                  {candidate.name}
                </h2>
              </div>

              <SectionCard icon={UserRound} title="基本情報">
                <InfoList items={mockCandidateBasicItems(candidate)} />
              </SectionCard>

              <SectionCard icon={FileText} title="政策">
                <div className="flex flex-col gap-3">
                  {candidate.summary === undefined ? (
                    <p className="text-sm text-ink-soft">
                      政策の要約は、デモ用データに含まれていません。
                    </p>
                  ) : (
                    <p className="whitespace-pre-line leading-7 text-ink">{candidate.summary}</p>
                  )}
                  <AiContent state={AI_SUMMARY_STATE} />
                </div>
              </SectionCard>

              <SectionCard icon={BookOpen} title="資料と出典">
                <InfoList
                  items={[
                    {
                      label: "採用資料",
                      note: "政策を確かめるために使う公式の資料",
                      value: DEMO_DATA_NONE_VALUE,
                    },
                    { label: "出典", value: DEMO_DATA_SOURCE_VALUE },
                    { label: "最終更新日", value: DEMO_DATA_NONE_VALUE },
                  ]}
                />
                <p className="mt-4 text-xs text-ink-soft">
                  候補者ID: <code className="break-all">{candidate.candidateId}</code>
                </p>
              </SectionCard>

              <div>
                <AppLink className={SECONDARY_LINK_CLASS} to="/comparison">
                  政策比較を見る
                  <ChevronRight aria-hidden="true" className="size-4" />
                </AppLink>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 政策比較の項目の一覧（PastComparisonPage と同じ項目と並び）。項目ごとの値はまだないので、開発中であることだけを示す */
function MockComparisonFieldList() {
  return (
    <dl className="mt-3 divide-y divide-line">
      {COMPARISON_FIELDS.map((field) => {
        const note = COMPARISON_FIELD_NOTES[field];
        return (
          <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-3" key={field}>
            <dt className="text-sm font-bold text-ink-soft">
              {field}
              {note === undefined ? null : (
                <span className="mt-0.5 block text-xs font-normal leading-5">{note}</span>
              )}
            </dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Badge>{DEVELOPMENT_LABEL}</Badge>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * 政策比較。構成は PastComparisonPage と同じ（比べるテーマの選択と、選んだテーマの候補者ごとのカード）。
 * 候補者は、モックデータの候補者の順に並べ、内容だけがある候補者IDを後ろに足す。
 */
function MockComparisonPage() {
  const data = getMockElectionData();
  const themes = data.comparison?.themes ?? [];
  const entries = data.comparison?.entries ?? [];
  const [selectedTheme, setSelectedTheme] = useState<string>(themes[0] ?? "");
  const selectedThemeNameId = useId();
  const provided = themes.length > 0;

  const candidates = (data.candidates ?? []).map(({ candidateId, name }) => ({ candidateId, name }));
  const participants = [
    ...candidates,
    ...[...new Set(entries.map((entry) => entry.candidateId))]
      .filter((candidateId) => !candidates.some((candidate) => candidate.candidateId === candidateId))
      .map((candidateId) => ({ candidateId, name: candidateId })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description="政策を、同じ項目で見比べる画面です。推薦・採点・ランキングはしません。"
        title="政策比較"
      />
      <ElectionDemoStatus showsMockData={provided} />

      {provided ? (
        <>
          <section aria-labelledby="mock-themes-heading">
            <h2 className="text-lg font-bold text-primary-dark sm:text-xl" id="mock-themes-heading">
              比べるテーマ
            </h2>
            <ThemeSelector onSelect={setSelectedTheme} selected={selectedTheme} themes={themes} />
          </section>

          {/* 選んだテーマの比較。region の名前はテーマ名にする */}
          <section aria-labelledby={selectedThemeNameId}>
            <h2 className="text-lg font-bold text-primary-dark sm:text-xl">
              「<span id={selectedThemeNameId}>{selectedTheme}</span>」の比較
            </h2>
            <NoticeBar className="mt-3">{MOCK_ORDER_NOTICE}</NoticeBar>
            {participants.length === 0 ? (
              <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-sm text-ink">
                {MOCK_THEME_MISSING_REASON}
              </p>
            ) : (
              <div className="mt-4 grid items-stretch gap-5 md:grid-cols-2">
                {participants.map((candidate) => {
                  const headingId = `mock-comparison-${candidate.candidateId}-heading`;
                  const summary = entries.find(
                    (entry) =>
                      entry.theme === selectedTheme && entry.candidateId === candidate.candidateId,
                  )?.summary;

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
                        {summary ?? MOCK_THEME_MISSING_REASON}
                      </p>
                      <MockComparisonFieldList />
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <ElectionNoDataPanel />
          <SectionCard icon={Scale} title="比べる項目">
            <p className="text-sm leading-6 text-ink-soft">
              デモ用データが設定されると、テーマごとに、候補者の政策をこの項目で並べます。
            </p>
            <MockComparisonFieldList />
          </SectionCard>
        </>
      )}
    </div>
  );
}

/** 会場閲覧。構成は PastVenuePage と同じ（見出しの説明と、カードのまとめ） */
function MockVenuePage() {
  const sections = getMockElectionData().venue?.sections ?? [];
  const provided = sections.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro
        description={
          provided
            ? "このデモの展示会場向けのまとめです。投票所の案内ではありません。"
            : "このデモの展示会場で、政策情報をまとめて見る画面です。投票所の案内ではありません。"
        }
        title="会場閲覧"
      />
      <ElectionDemoStatus showsMockData={provided} />

      {provided ? (
        sections.map((section) => (
          <SectionCard icon={Eye} key={section.heading} title={section.heading}>
            <p className="whitespace-pre-line leading-7 text-ink">{section.body}</p>
          </SectionCard>
        ))
      ) : (
        <>
          <ElectionNoDataPanel />
          <SectionCard icon={Eye} title="この画面に表示されるもの（デモ用データが設定されたあと）">
            <ul className="list-disc space-y-1 pl-5 text-ink" role="list">
              <li>候補者の基本情報</li>
              <li>確認と承認がすんだ政策の要約と、その原文・出典</li>
            </ul>
          </SectionCard>
        </>
      )}
    </div>
  );
}

/**
 * モックデータで表示するときのホームの入口。データが未設定のページの入口も残し、
 * カードに「開発中」と出す（homeTileDetail）。
 */
const MOCK_HOME_LINK_BASES: readonly Readonly<{ page: ElectionPageId; link: FeatureLink }>[] = [
  {
    page: "schedule",
    link: {
      to: "/schedule",
      label: "選挙日程を見る",
      description: "投票日などの日程を確認します。",
      icon: CalendarDays,
    },
  },
  {
    page: "candidates",
    link: {
      to: "/candidates",
      label: "候補者一覧を見る",
      description: "候補者を同じ画面構造で確認します。",
      icon: Users,
    },
  },
  {
    page: "comparison",
    link: {
      to: "/comparison",
      label: "政策比較を見る",
      description: "政策を同じ項目で見比べます。",
      icon: Scale,
    },
  },
  {
    page: "venue",
    link: {
      to: "/venue",
      label: "会場閲覧画面を見る",
      description: "デモ会場向けのまとめを確認します。",
      icon: Eye,
    },
  },
];

/**
 * いま選んでいるデータの種類で、ホームに出す入口の一覧。過去の選挙は既存の一覧（pastElection.tsx）。
 * モックは4つのページの入口をいつも出し、候補者ごとの入口は、モックデータの候補者の分だけ出す。
 */
function homeLinksForActiveSource(): readonly FeatureLink[] {
  const pastElection = getActivePastElection();
  if (pastElection !== null) {
    return pastElection.homeLinks;
  }

  return MOCK_HOME_LINK_BASES.flatMap(({ page, link }): readonly FeatureLink[] => {
    if (page !== "candidates") {
      return [link];
    }

    return [
      link,
      ...listActiveCandidates().map(
        (candidate): FeatureLink => ({
          to: candidateDetailPath(candidate.candidateId),
          label: `${candidate.name}の詳細を見る`,
          description: "候補者の情報を確認します。",
          icon: UserRound,
        }),
      ),
    ];
  });
}

export const VISITOR_HOME_LINKS = projectVisitorPresentation(homeLinksForActiveSource());

/**
 * ホームのカードに出す名前と説明（モックデータ。候補者の人数など、データで変わる内容は書かない）。
 * preparing は、そのページのモックデータの有無で決める（homeTileDetail）。
 */
const MOCK_HOME_TILE_DETAILS: Readonly<Record<string, HomeTileDetail>> = {
  "/schedule": { title: "選挙日程", description: "投票日を確認", preparing: false },
  "/candidates": { title: "候補者一覧", description: "候補者を知る", preparing: false },
  "/comparison": { title: "政策比較", description: "政策の違いを見る", preparing: false },
  "/venue": { title: "会場閲覧", description: "デモ会場向けのまとめ", preparing: false },
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
  const fallback: HomeTileDetail = { title: link.label, description: link.description, preparing: false };
  const pastElection = getActivePastElection();
  if (pastElection !== null) {
    return pastElection.homeTileDetails[link.to] ?? fallback;
  }

  // モックデータが未設定のページの入口は残し、「開発中」と示す
  return {
    ...(MOCK_HOME_TILE_DETAILS[link.to] ?? fallback),
    preparing: !isElectionDestinationAvailable(link.to),
  };
}

function candidateNameOf(to: string): string {
  return (
    listActiveCandidates().find((candidate) => candidateDetailPath(candidate.candidateId) === to)
      ?.name ?? to
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

/** 価値観診断の入口（/values）。選挙に依存しない機能のため、メインメニューの一覧には入れず上に置く */
const VALUES_DIAGNOSIS_PATH = "/values";

function ValuesEntryCard() {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[var(--radius-card)] border-2 border-primary bg-primary-light p-4 shadow-[var(--shadow-card)] sm:p-6"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white"
          >
            <Compass className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-primary-dark sm:text-xl" id={headingId}>
              価値観診断をはじめる
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink">
              愛媛の地域課題について答えて、自分が大切にしていることを整理しよう。
            </p>
          </div>
        </div>
        <AppLink
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-white transition hover:bg-primary-dark"
          to={VALUES_DIAGNOSIS_PATH}
        >
          診断をはじめる
          <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
        </AppLink>
      </div>
    </section>
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
  const pastElection = getActivePastElection();
  const mockSchedule = getMockElectionData().schedule;
  /** モックデータが1ページ分でも設定されているか（過去の選挙の設定では false） */
  const mockProvided = pastElection === null && hasAnyMockElectionPage();
  const hasElectionMenu = menuLinks.length > 0;

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

      {/* 価値観診断の入口：主要機能のメニューより上に置く */}
      <ValuesEntryCard />

      {/* モックデータを表示するときは、そのことを明示する（モックデータが1ページ分もないときは出さない） */}
      {mockProvided ? <MockDataNotice /> : null}

      {/*
        メインメニュー：スマホ2列、1024px以上は4列。
        モックデータが未設定のページの入口も残し、カードに「開発中」と出す
      */}
      {hasElectionMenu ? (
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
                    {...(pastElection === null ? { preparingLabel: DEVELOPMENT_LABEL } : {})}
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
      ) : null}

      {/*
        選挙情報：今表示できる値だけ。過去の選挙（選挙情報のカードと政策の準備状態）は、
        設定が PAST_REAL で、このビルドに過去の選挙が含まれるときだけ出す
      */}
      {pastElection === null ? (
        <>
          {/* モックデータの選挙情報。未設定なら、同じカードの構成のまま「デモ用データ未設定」と出す */}
          <SectionCard
            aside={
              mockSchedule === undefined ? (
                <Badge>{DEVELOPMENT_LABEL}</Badge>
              ) : (
                <MockElectionPhaseBadge electionDate={mockSchedule.election.electionDate} />
              )
            }
            icon={CalendarDays}
            title="選挙情報"
          >
            <p className="font-bold text-ink">
              {mockSchedule?.election.name ?? DEMO_DATA_MISSING_VALUE}
            </p>
            <div className="mt-3">
              <InfoList
                items={[
                  {
                    label: "投票日",
                    value:
                      mockSchedule === undefined
                        ? DEMO_DATA_MISSING_VALUE
                        : formatJapaneseDate(mockSchedule.election.electionDate),
                  },
                ]}
              />
            </div>
          </SectionCard>

          {mockProvided ? null : (
            <StatusPanel className="" statusCode="no-data" title="選挙に関する情報は準備中です">
              <p>
                選挙日程・候補者・政策比較・会場閲覧は、開発中のデモ画面です。デモ用データが設定されるまでは、各画面を空の状態で表示します。価値観診断はご利用いただけます。
              </p>
            </StatusPanel>
          )}
        </>
      ) : (
        <pastElection.HomeElectionSummary />
      )}
    </div>
  );
}

/*
 * 選挙関連ページの公開コンポーネント。ルート（visitor / analyst）とテストはこの名前で参照する。
 * 設定（data/electionDataSource.ts）が PAST_REAL で、このビルドに過去の選挙が含まれるときは、
 * 過去の選挙の画面（pastElection.tsx の PastXxxPage）を表示する。それ以外は、モックデータの画面
 * （未設定なら同じ構成の空状態）を表示する。PastXxxPage は削除していないので、分析者モードとテストでは
 * 設定を PAST_REAL にすると元のまま表示できる。
 */
export function SchedulePage() {
  const pastElection = getActivePastElection();
  return pastElection === null ? <MockSchedulePage /> : <pastElection.SchedulePage />;
}

export function CandidatesPage() {
  const pastElection = getActivePastElection();
  return pastElection === null ? <MockCandidatesPage /> : <pastElection.CandidatesPage />;
}

export function CandidateDetailPage() {
  const pastElection = getActivePastElection();
  return pastElection === null ? (
    <MockCandidateDetailPage />
  ) : (
    <pastElection.CandidateDetailPage />
  );
}

export function ComparisonPage() {
  const pastElection = getActivePastElection();
  return pastElection === null ? (
    <MockComparisonPage />
  ) : (
    <pastElection.ComparisonPage fieldNotes={COMPARISON_FIELD_NOTES} fields={COMPARISON_FIELDS} />
  );
}

export function VenuePage() {
  const pastElection = getActivePastElection();
  return pastElection === null ? <MockVenuePage /> : <pastElection.VenuePage />;
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
