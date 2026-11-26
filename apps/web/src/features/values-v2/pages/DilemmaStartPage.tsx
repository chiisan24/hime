import { ArrowRight, Ban, Clock, Compass, ListChecks, Lock } from "lucide-react";
import { useId } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { InfoList } from "../../../shared/ui/InfoList.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { SetouchiScene } from "../../../shared/ui/SetouchiScene.js";
import { PRIMARY_BUTTON_CLASS } from "../../values/styles.js";
import { THEME_ICONS } from "../../values/themeIcons.js";
import { useHeadingFocus } from "../../values/useHeadingFocus.js";
import { estimateMinutes } from "../../values/useValuesAnswers.js";
import { ProvisionalAxesNotice } from "../components/ProvisionalAxesNotice.js";
import type { UiDilemmaQuestion } from "../uiTypes.js";

type DilemmaStartPageProps = Readonly<{
  questions: readonly UiDilemmaQuestion[];
  isDemo: boolean;
  focusHeading: boolean;
  onStart: () => void;
}>;

const LEARN_ITEMS = [
  "地域課題ごとに、2つの考え方のどちらをどのくらい重視したか",
  "回答した問いと、スキップした問いの数",
] as const;

const NOT_LEARN_ITEMS = [
  "投票先の提案や、候補者・政党との一致",
  "テーマや考え方の順位",
  "あなたの政治思想や性格の判定",
] as const;

/** v2 の診断開始画面。問数・所要時間はデータの問数から出す */
export function DilemmaStartPage({ questions, isDemo, focusHeading, onStart }: DilemmaStartPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("dilemma-start", focusHeading);
  const headingId = useId();
  const total = questions.length;
  const minutes = estimateMinutes(total);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-6">
      <section
        aria-labelledby={headingId}
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-card)] sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="text-2xl font-black leading-tight tracking-tight text-primary-dark outline-none sm:text-3xl"
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
          >
            地域課題ジレンマ診断
          </h1>
          {isDemo ? <Badge>デモ版</Badge> : null}
        </div>
        <p className="mt-3 text-base font-bold leading-7 text-ink sm:text-lg">
          地域の課題で、あなたはどちらを重視する？
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          交通や子育て、防災などの地域課題について、両立が難しい2つの考え方を比べて答えます。答え終わると、テーマごとに自分がどちらに寄ったかを、地域課題マップで振り返れます。
        </p>
        <ul className="mt-4 flex flex-wrap gap-2" role="list">
          <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary-light px-3 text-sm font-bold text-primary-dark">
            <Clock aria-hidden="true" className="size-4 shrink-0" />
            {total}問・約{minutes}分
          </li>
        </ul>
        <button className={`${PRIMARY_BUTTON_CLASS} mt-5 w-full sm:w-auto`} onClick={onStart} type="button">
          診断をはじめる
          <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
        </button>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-ink-soft">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          回答は保存・送信しません。
        </p>
        <SetouchiScene className="pointer-events-none mt-4 h-16 w-full opacity-70 sm:h-20" />
      </section>

      <div className="grid gap-4">
        {isDemo ? (
          <NoticeBar>
            <Badge>架空データ</Badge>{" "}
            質問は、画面を確かめるための架空のデモ用の質問です。状況は「ある町」の架空の話で、愛媛県の実際の状況を述べるものではありません。
          </NoticeBar>
        ) : null}
        <ProvisionalAxesNotice />

        <SectionCard icon={ListChecks} title="答え方">
          <InfoList
            items={[
              { label: "質問の数", value: `${total}問（1画面に1問）` },
              { label: "所要時間の目安", note: "1問あたり約15秒で計算", value: `約${minutes}分` },
              {
                label: "扱うテーマ",
                value: (
                  <ul className="flex flex-wrap gap-2" role="list">
                    {questions.map((question) => {
                      const Icon = THEME_ICONS[question.themeId];
                      return (
                        <li
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-bold text-ink"
                          key={question.questionId}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          {question.themeLabel}
                        </li>
                      );
                    })}
                  </ul>
                ),
              },
              {
                label: "選び方",
                value:
                  "「Aを強く重視」から「Bを強く重視」までの5段階から1つ選びます。最初はどれも選ばれていません。答えにくい問いは「スキップ」できます。前の質問に戻って、回答を変えることもできます。",
              },
            ]}
          />
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard icon={Compass} title="この診断でわかること">
            <ul className="grid gap-2 text-sm leading-6" role="list">
              {LEARN_ITEMS.map((item) => (
                <li className="flex gap-2" key={item}>
                  <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard icon={Ban} title="この診断でわからないこと">
            <ul className="grid gap-2 text-sm leading-6" role="list">
              {NOT_LEARN_ITEMS.map((item) => (
                <li className="flex gap-2" key={item}>
                  <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-soft" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <SectionCard icon={Lock} title="回答の取り扱い">
          <ul className="grid gap-2 text-sm leading-6" role="list">
            <li>回答は、この画面の中だけで使います。</li>
            <li>回答を保存したり、サーバーやAIに送ったりしません。</li>
            <li>画面を再読み込みしたり、タブを閉じたりすると、回答は消えます。</li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
