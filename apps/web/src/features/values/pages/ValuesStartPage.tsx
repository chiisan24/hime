import { ArrowRight, Ban, Clock, Compass, ListChecks, Lock } from "lucide-react";
import { useId } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { InfoList } from "../../../shared/ui/InfoList.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { SetouchiScene } from "../../../shared/ui/SetouchiScene.js";
import { PRIMARY_BUTTON_CLASS } from "../styles.js";
import { THEME_ICONS } from "../themeIcons.js";
import type { ThemeDef } from "../contractTypes.js";
import { useHeadingFocus } from "../useHeadingFocus.js";
import { estimateMinutes } from "../useValuesAnswers.js";

type ValuesStartPageProps = Readonly<{
  /** この診断セットで出題するテーマ（テーマ定義順） */
  askedThemes: readonly ThemeDef[];
  /** 全テーマ数（質問バンクのテーマ数） */
  totalThemeCount: number;
  /** 診断セットの質問数（固定値で持たない。Req 2.1） */
  questionCount: number;
  /** デモ用の仮の質問を含むとき true */
  isDemo: boolean;
  /** 診断の途中から戻ってきたときなど、見出しにフォーカスを移すとき true */
  focusHeading: boolean;
  onStart: () => void;
}>;

const LEARN_ITEMS = [
  "それぞれのテーマが、あなたの暮らしにとってどのくらい大切か（大切さ）",
  "両立が難しい場面で、どちらを先に進めたい考えに近いか（優先条件）",
  "判断に迷ったテーマと、回答しなかったテーマ",
  "結果を、選挙・移住や就職・日常生活の判断に活かすときの観点",
] as const;

const NOT_LEARN_ITEMS = [
  "投票先の提案や、候補者・政党との一致",
  "テーマの順位",
  "あなたの政治思想や性格の判定",
] as const;

/** V-01 診断開始。コンセプト、わかること、問数と所要時間、回答の取り扱いを示す */
export function ValuesStartPage({
  askedThemes,
  totalThemeCount,
  questionCount,
  isDemo,
  focusHeading,
  onStart,
}: ValuesStartPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("start", focusHeading);
  const headingId = useId();
  const minutes = estimateMinutes(questionCount);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-6">
      {/* 左（スマホでは上）：コンセプトと開始ボタン */}
      <section
        aria-labelledby={headingId}
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 lg:sticky lg:top-20"
      >
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="text-2xl font-black leading-tight tracking-tight text-primary-dark outline-none sm:text-3xl"
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
            >
              価値観マップ
            </h1>
            {isDemo ? <Badge>デモ版</Badge> : null}
          </div>
          <p className="mt-3 text-base font-bold leading-7 text-ink sm:text-lg">
            愛媛の地域課題から、自分が大切にしていることを知ろう
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            愛媛の暮らしに関わる地域課題の質問に答えると、テーマごとの「大切さ」と、両立が難しい場面での「優先条件」を、別々に整理して表示します。政治に詳しくなくても答えられるように、質問ごとに解説と用語の説明を読めます。
          </p>

          <ul className="mt-4 flex flex-wrap gap-2" role="list">
            <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary-light px-3 text-sm font-bold text-primary-dark">
              <Clock aria-hidden="true" className="size-4 shrink-0" />
              {questionCount}問・約{minutes}分
            </li>
            <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary-light px-3 text-sm font-bold text-primary-dark">
              <Compass aria-hidden="true" className="size-4 shrink-0" />
              {askedThemes.length}つのテーマ
            </li>
          </ul>

          <button className={`${PRIMARY_BUTTON_CLASS} mt-5 w-full sm:w-auto`} onClick={onStart} type="button">
            診断をはじめる
            <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
          </button>
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-ink-soft">
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            回答は保存・送信しません。くわしくは「回答の取り扱い」を見てください。
          </p>
        </div>
        <SetouchiScene className="pointer-events-none mt-4 h-16 w-full opacity-70 sm:h-20" />
      </section>

      {/* 右（スマホでは下）：説明 */}
      <div className="grid gap-4">
        {isDemo ? (
          <NoticeBar>
            <Badge>架空データ</Badge>{" "}
            この診断はデモ版です。質問と結果は、画面を確かめるための架空のデモ用データです。結果の画面には、あなたの回答から計算した結果ではなく、デモ用の固定結果を表示します。
          </NoticeBar>
        ) : null}

        <SectionCard icon={ListChecks} title="診断の内容">
          <InfoList
            items={[
              { label: "質問の数", value: `${questionCount}問（1画面に1問）` },
              {
                label: "所要時間の目安",
                note: "1問あたり約15秒で計算",
                value: `約${minutes}分`,
              },
              {
                label: "この診断で扱うテーマ",
                note: `全${totalThemeCount}テーマのうち${askedThemes.length}テーマ。ほかのテーマは結果で「出題していません」と表示します`,
                value: (
                  <ul className="flex flex-wrap gap-2" role="list">
                    {askedThemes.map((theme) => {
                      const Icon = THEME_ICONS[theme.themeId];
                      return (
                        <li
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-bold text-ink"
                          key={theme.themeId}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          {theme.label}
                        </li>
                      );
                    })}
                  </ul>
                ),
              },
              {
                label: "答え方",
                value: "テーマごとに2問あります。「大切さ」の質問と、2つの考え方のどちらに近いかを選ぶ「優先条件」の質問です。どちらも5段階から選び、答えにくいときは「わからない」か「回答しない」を選べます。前の質問に戻って、回答を変えることもできます。",
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
