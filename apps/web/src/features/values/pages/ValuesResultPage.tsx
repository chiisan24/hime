import {
  BookOpen,
  Briefcase,
  CircleHelp,
  CircleSlash,
  Compass,
  Hash,
  House,
  Layers,
  Lightbulb,
  ListChecks,
  RotateCcw,
  Scale,
  SearchX,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { LevelBands, type LevelBandGroup } from "../components/LevelBands.js";
import { TradeoffPosition } from "../components/TradeoffPosition.js";
import type {
  Answers,
  AxisState,
  Level,
  MapError,
  NonOpinionCode,
  PriorityState,
  Question,
  ThemeDef,
  ThemeId,
  ValuesMap,
} from "../contractTypes.js";
import {
  AXIS_LABELS,
  IMPORTANCE_LEVEL_LABELS,
  NON_OPINION_LABELS,
  SCENE_LABELS,
  SCENE_ORDER,
  VALUES_LABELS,
} from "../labels.js";
import { answerLabelOf } from "../questionView.js";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "../styles.js";
import { THEME_ICONS } from "../themeIcons.js";
import type {
  GuidanceEntry,
  GuidanceScene,
  ResultTextEntry,
  ValuesAxis,
  ValuesResultSource,
} from "../types.js";
import { useHeadingFocus } from "../useHeadingFocus.js";

type ValuesResultPageProps = Readonly<{
  /** テーマ定義順（順位ではない） */
  themes: readonly ThemeDef[];
  /** 診断セットの提示順の質問 */
  questions: readonly Question[];
  /** 利用者の実際の回答（回答の振り返りに使う） */
  answers: Answers;
  result: ValuesResultSource;
  resultTexts: readonly ResultTextEntry[];
  guidance: readonly GuidanceEntry[];
  /** 回答を残したまま、1問目から見直す */
  onReview: () => void;
  /** 回答を消して、開始画面に戻る */
  onRestart: () => void;
}>;

const SCENE_ICONS: Readonly<Record<GuidanceScene, LucideIcon>> = {
  ELECTION: Vote,
  MOVE_OR_JOB: House,
  DAILY_LIFE: Briefcase,
};

function nameOf(themes: readonly ThemeDef[], themeId: ThemeId): string {
  return themes.find((theme) => theme.themeId === themeId)?.label ?? themeId;
}

function resultTextOf(
  texts: readonly ResultTextEntry[],
  themeId: ThemeId,
  axis: ValuesAxis,
  level: Level,
): string | null {
  return (
    texts.find((entry) => entry.themeId === themeId && entry.axis === axis && entry.level === level)
      ?.text ?? null
  );
}

/** 大切さの軸の文言。判定できない軸は「判定できません」、出題していない軸は「出題していません」 */
function importanceStatement(axis: AxisState): string {
  switch (axis.state) {
    case "DETERMINED":
      return IMPORTANCE_LEVEL_LABELS[axis.level];
    case "UNDETERMINED":
      return VALUES_LABELS.state.UNDETERMINED;
    case "NOT_ASKED":
      return VALUES_LABELS.state.NOT_ASKED;
  }
}

function ThemeChip({ themeId, name }: Readonly<{ themeId: ThemeId; name: string }>) {
  const Icon = THEME_ICONS[themeId];
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-bold text-ink">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
      {name}
    </span>
  );
}

function EmptyText() {
  return <p className="text-sm leading-6 text-ink-soft">{VALUES_LABELS.empty}</p>;
}

function ThemeList({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ul className="grid gap-3" role="list">
      {children}
    </ul>
  );
}

function PrioritySection({
  priority,
  themes,
}: Readonly<{ priority: PriorityState; themes: readonly ThemeDef[] }>) {
  return (
    <SectionCard icon={Compass} title={VALUES_LABELS.sections.priority}>
      {priority.state === "SELECTED" ? (
        <ul className="flex flex-wrap gap-2" role="list">
          {priority.themeIds.map((themeId) => (
            <li key={themeId}>
              <ThemeChip name={nameOf(themes, themeId)} themeId={themeId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-ink">
          {priority.state === "NOT_ASKED"
            ? VALUES_LABELS.priorityNotAsked
            : VALUES_LABELS.priorityNoneSelected}
        </p>
      )}
    </SectionCard>
  );
}

function ErrorView({
  error,
  onReview,
  onRestart,
}: Readonly<{ error: MapError; onReview: () => void; onRestart: () => void }>) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("result-error", true);
  return (
    <div className="grid max-w-2xl gap-4">
      <h1
        className="text-2xl font-black text-primary-dark outline-none sm:text-3xl"
        ref={headingRef}
        tabIndex={-1}
      >
        価値観マップを表示できませんでした
      </h1>
      <NoticeBar>{VALUES_LABELS.error[error.code]}</NoticeBar>
      {/* INVALID_CONFIG では、回答を見直す導線もやり直す導線も出さない（Req 5.14 c） */}
      {error.code === "INVALID_CONFIG" ? null : (
        <div className="flex flex-wrap gap-3">
          {error.code === "NO_OPINION_ANSWERS" ? (
            <button className={PRIMARY_BUTTON_CLASS} onClick={onReview} type="button">
              回答を見直す
            </button>
          ) : (
            <button className={PRIMARY_BUTTON_CLASS} onClick={onRestart} type="button">
              最初からやり直す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * V-03 価値観マップ（結果）。結果は受け取って表示するだけで、計算・並べ替えをしない。
 * 欄の順は design.md の sectionOrder の既定（注意書き → 説明 → 最優先テーマ → 大切さ → 優先条件 →
 * 判断に迷った → 回答しなかった → 判定できない → 未出題 → 件数 → 振り返り → 活かし方）に合わせる。
 */
export function ValuesResultPage(props: ValuesResultPageProps) {
  const { result, onReview, onRestart } = props;
  if (result.origin === "ERROR") {
    return <ErrorView error={result.error} onRestart={onRestart} onReview={onReview} />;
  }
  return (
    <MapView
      {...props}
      guidanceThemeIds={result.guidanceThemeIds}
      isDemoFixed={result.origin === "DEMO_FIXED"}
      map={result.map}
    />
  );
}

function MapView({
  themes,
  questions,
  answers,
  map,
  isDemoFixed,
  guidanceThemeIds,
  resultTexts,
  guidance,
  onReview,
  onRestart,
}: ValuesResultPageProps &
  Readonly<{ map: ValuesMap; isDemoFixed: boolean; guidanceThemeIds: readonly ThemeId[] }>) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("result", true);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);

  // 大切さの段階ごとのグループ（受け取った順。+2 から −2）
  const importanceGroups: LevelBandGroup[] = map.importanceGroups.map((group) => ({
    level: group.level,
    heading: IMPORTANCE_LEVEL_LABELS[group.level],
    themes: group.themeIds.map((themeId) => ({
      themeId,
      name: nameOf(themes, themeId),
      explanation: resultTextOf(resultTexts, themeId, "IMPORTANCE", group.level),
    })),
  }));

  // 優先条件を判定できたテーマ（テーマ定義順）
  const tradeoffItems = map.themes.flatMap((entry) => {
    if (entry.tradeoff.state !== "DETERMINED") {
      return [];
    }
    const question = questions.find(
      (candidate) => candidate.kind === "TRADEOFF" && candidate.themeId === entry.themeId,
    );
    return [
      {
        themeId: entry.themeId,
        level: entry.tradeoff.level,
        text: resultTextOf(resultTexts, entry.themeId, "TRADEOFF", entry.tradeoff.level),
        importanceLabel: importanceStatement(entry.importance),
        directions:
          question?.kind === "TRADEOFF"
            ? { a: question.directionA.text, b: question.directionB.text }
            : null,
      },
    ];
  });

  // 判定できない軸（Req 5.5）。未出題の軸はここに入れない
  const undeterminedItems = map.themes.flatMap((entry) =>
    (["IMPORTANCE", "TRADEOFF"] as const).flatMap((axis) => {
      const state = axis === "IMPORTANCE" ? entry.importance : entry.tradeoff;
      return state.state === "UNDETERMINED"
        ? [{ themeId: entry.themeId, axis, reasons: state.reasons }]
        : [];
    }),
  );

  const declinedColumns = (["DECLINE", "UNANSWERED"] as const).map((code) => ({
    code,
    themeIds: map.declinedThemes
      .filter((entry) => entry.reasons.includes(code))
      .map((entry) => entry.themeId),
  }));

  return (
    <div className="grid gap-4 md:gap-6">
      {/* 見出しと注意書き（注意書きは折りたたまず、閉じる操作も設けない。Req 5.9） */}
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="text-2xl font-black leading-tight tracking-tight text-primary-dark outline-none sm:text-3xl"
            ref={headingRef}
            tabIndex={-1}
          >
            あなたの価値観マップ
          </h1>
          {isDemoFixed ? <Badge>{VALUES_LABELS.demoFixedBadge}</Badge> : null}
        </div>
        <NoticeBar>{VALUES_LABELS.notice}</NoticeBar>
        {isDemoFixed ? (
          <NoticeBar>
            <Badge>{VALUES_LABELS.demoFixedBadge}</Badge> {VALUES_LABELS.demoFixedNote}
          </NoticeBar>
        ) : null}
      </div>

      {/* 結果の読み方（Req 5.8） */}
      <SectionCard icon={BookOpen} title={VALUES_LABELS.sections.explainer}>
        <dl className="grid gap-3 text-sm leading-6 md:grid-cols-3">
          {VALUES_LABELS.explainer.map((item) => (
            <div key={item.code}>
              <dt className="font-bold text-primary-dark">{item.heading}</dt>
              <dd className="mt-0.5 text-ink">{item.body}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <PrioritySection priority={map.priority} themes={themes} />

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2 lg:items-start">
        {/* 大切さ：段階ごとのグループ（段階の帯） */}
        <SectionCard icon={Layers} title={VALUES_LABELS.sections.importance}>
          {map.notices.noThemeDifference ? (
            <p className="mb-3 text-sm leading-6 text-ink">{VALUES_LABELS.noThemeDifference}</p>
          ) : null}
          <LevelBands emptyText={VALUES_LABELS.empty} groups={importanceGroups} />
          <p className="mt-3 text-xs leading-5 text-ink-soft">{VALUES_LABELS.equalLevelNote}</p>
        </SectionCard>

        {/* 優先条件：大切さとは別の欄（Req 5.3） */}
        <SectionCard icon={Scale} title={VALUES_LABELS.sections.tradeoff}>
          <p className="mb-3 text-sm leading-6 text-ink-soft">{VALUES_LABELS.tradeoffLead}</p>
          {tradeoffItems.length === 0 ? (
            <EmptyText />
          ) : (
            <ThemeList>
              {tradeoffItems.map((item) => (
                <li
                  className="rounded-[var(--radius-btn)] border border-line bg-white p-3"
                  key={item.themeId}
                >
                  <ThemeChip name={nameOf(themes, item.themeId)} themeId={item.themeId} />
                  {item.text === null ? null : (
                    <p className="mt-2 text-sm leading-6 text-ink">{item.text}</p>
                  )}
                  {item.directions === null ? null : (
                    <TradeoffPosition
                      directionA={item.directions.a}
                      directionB={item.directions.b}
                      level={item.level}
                    />
                  )}
                  <p className="mt-2 text-xs leading-5 text-ink-soft">
                    {AXIS_LABELS.IMPORTANCE}：{item.importanceLabel}
                  </p>
                </li>
              ))}
            </ThemeList>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-6">
        {/* 判断に迷ったテーマ（Req 5.4） */}
        <SectionCard icon={CircleHelp} title={VALUES_LABELS.sections.hesitant}>
          {map.hesitantThemes.length === 0 ? (
            <EmptyText />
          ) : (
            <ThemeList>
              {map.hesitantThemes.map((entry) => (
                <li key={entry.themeId}>
                  <ThemeChip name={nameOf(themes, entry.themeId)} themeId={entry.themeId} />
                  <ul className="mt-1 text-sm leading-6 text-ink" role="list">
                    {entry.reasons.map((reason) => (
                      <li key={reason}>{VALUES_LABELS.hesitantReason[reason]}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ThemeList>
          )}
        </SectionCard>

        {/* 回答しなかったテーマ：「回答しない」と「未回答」の2つの小欄（Req 5.15） */}
        <SectionCard icon={CircleSlash} title={VALUES_LABELS.sections.declined}>
          <div className="grid gap-3">
            {declinedColumns.map((column) => (
              <div className="rounded-[var(--radius-btn)] bg-surface p-3" key={column.code}>
                <h3 className="text-sm font-bold text-primary-dark">
                  {NON_OPINION_LABELS[column.code]}
                </h3>
                {column.themeIds.length === 0 ? (
                  <p className="mt-1 text-sm leading-6 text-ink-soft">{VALUES_LABELS.empty}</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-2" role="list">
                    {column.themeIds.map((themeId) => (
                      <li key={themeId}>
                        <ThemeChip name={nameOf(themes, themeId)} themeId={themeId} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        {/* 判定できない項目（Req 5.5）：スコアや段階の文言は出さない */}
        <SectionCard icon={SearchX} title={VALUES_LABELS.sections.undetermined}>
          {undeterminedItems.length === 0 ? (
            <EmptyText />
          ) : (
            <ThemeList>
              {undeterminedItems.map((item) => (
                <li key={`${item.themeId}-${item.axis}`}>
                  <ThemeChip name={nameOf(themes, item.themeId)} themeId={item.themeId} />
                  <p className="mt-1 text-sm leading-6 text-ink">
                    {AXIS_LABELS[item.axis]}：{VALUES_LABELS.state.UNDETERMINED}
                    <span className="text-ink-soft">
                      （理由：
                      {item.reasons.map((reason: NonOpinionCode) => NON_OPINION_LABELS[reason]).join("、")}
                      ）
                    </span>
                  </p>
                </li>
              ))}
            </ThemeList>
          )}
        </SectionCard>

        {/* 未出題のテーマ（Req 5.17 a）：「わからない」などとは別の文言と欄 */}
        <SectionCard icon={CircleSlash} title={VALUES_LABELS.sections.notAsked}>
          {map.notAskedThemes.length === 0 ? (
            <EmptyText />
          ) : (
            <ThemeList>
              {map.notAskedThemes.map((themeId) => (
                <li className="flex flex-wrap items-center gap-2" key={themeId}>
                  <ThemeChip name={nameOf(themes, themeId)} themeId={themeId} />
                  <span className="text-sm text-ink-soft">{VALUES_LABELS.state.NOT_ASKED}</span>
                </li>
              ))}
            </ThemeList>
          )}
        </SectionCard>
      </div>

      {/* 結果のもとになった数（Req 5.6：「n / m」） */}
      <SectionCard icon={Hash} title={VALUES_LABELS.sections.counts}>
        <dl className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-surface px-2 py-2">
            <dt className="text-xs font-bold leading-5 text-ink-soft">{VALUES_LABELS.counts.themes}</dt>
            <dd className="text-lg font-bold text-primary-dark">
              {map.counts.askedThemes} / {map.counts.totalThemes}
            </dd>
          </div>
          <div className="rounded-lg bg-surface px-2 py-2">
            <dt className="text-xs font-bold leading-5 text-ink-soft">
              {VALUES_LABELS.counts.questions}
            </dt>
            <dd className="text-lg font-bold text-primary-dark">
              {map.counts.usableQuestions} / {map.counts.askedQuestions}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* 回答の振り返り（Req 6.1）：利用者の実際の回答。デモの固定結果とは別 */}
      <SectionCard icon={ListChecks} title={VALUES_LABELS.sections.reflection}>
        <ol className="grid gap-3" role="list">
          {questions.map((question) => (
            <li className="rounded-[var(--radius-btn)] border border-line p-3" key={question.questionId}>
              <p className="text-xs font-bold leading-5 text-ink-soft">
                {question.kind === "PRIORITY_PICK"
                  ? "6テーマを横断する質問"
                  : nameOf(themes, question.themeId)}
              </p>
              <p className="mt-0.5 text-sm leading-6 text-ink">{question.text}</p>
              <p className="mt-1 text-sm font-bold text-primary-dark">
                <span className="font-normal text-ink-soft">あなたの回答：</span>
                {answerLabelOf(question, answers[question.questionId])}
              </p>
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* この結果の活かし方（Req 6.6：選挙 → 移住や就職 → 日常生活） */}
      <SectionCard icon={Lightbulb} title={VALUES_LABELS.sections.guidance}>
        <p className="text-sm leading-6 text-ink-soft">{VALUES_LABELS.guidanceLead}</p>
        {guidanceThemeIds.length === 0 ? (
          <div className="mt-3">
            <EmptyText />
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2" role="list">
            {guidanceThemeIds.map((themeId) => (
              <li className="rounded-[var(--radius-btn)] border border-line bg-surface p-4" key={themeId}>
                <ThemeChip name={nameOf(themes, themeId)} themeId={themeId} />
                <dl className="mt-3 grid gap-2 text-sm leading-6">
                  {SCENE_ORDER.map((scene) => {
                    const entry = guidance.find(
                      (candidate) => candidate.themeId === themeId && candidate.scene === scene,
                    );
                    if (entry === undefined) {
                      return null;
                    }
                    const Icon = SCENE_ICONS[scene];
                    return (
                      <div key={scene}>
                        <dt className="flex items-center gap-1.5 font-bold text-primary-dark">
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          {SCENE_LABELS[scene]}
                        </dt>
                        <dd className="text-ink">{entry.text}</dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 次の操作 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button className={SECONDARY_BUTTON_CLASS} onClick={onReview} type="button">
          <ListChecks aria-hidden="true" className="size-4 shrink-0" />
          回答を見直す
        </button>
        <button
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => setRestartDialogOpen(true)}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          最初からやり直す
        </button>
      </div>

      <ConfirmDialog
        cancelLabel="結果に戻る"
        confirmLabel="回答を消して最初から"
        onCancel={() => setRestartDialogOpen(false)}
        onConfirm={() => {
          setRestartDialogOpen(false);
          onRestart();
        }}
        open={restartDialogOpen}
        title="最初からやり直しますか？"
      >
        今の回答と結果は消えて、診断の最初の画面に戻ります。回答を変えたいだけなら「回答を見直す」を使ってください。
      </ConfirmDialog>
    </div>
  );
}
