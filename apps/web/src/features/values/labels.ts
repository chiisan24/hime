import type { Level, NonOpinionCode } from "./contractTypes.js";
import type { GuidanceScene, ValuesAxis } from "./types.js";

/*
 * 価値観診断の画面の固定の文言（仮）。
 *
 * 正式な設計（design.md「固定文言の型と選択」）では、画面の文言は公開バンドルの承認済み固定文言
 * （FixedTexts）から受け取り、画面に日本語を直書きしない（【要確認22】）。
 * 固定文言の契約（tasks.md 5.1）がまだないため、ここに1か所にまとめて仮に置く。
 * 各項目のコメントは、対応する固定文言のキー（design.md の表）を示す。差し替えるときの目印にする。
 * 禁止語（一致率、ランキング、おすすめ、タイプなど）は使わない。
 */

export const VALUES_LABELS = {
  /** banner.FIXTURE（Req 10.12） */
  bannerFixture: "デモ用の架空データです",
  /** notice（注意書き。Req 5.9） */
  notice: "この結果は、自己理解のための参考です。投票先の推奨ではありません。",
  /** デモ用の固定結果であることの表示（generateValuesMap の接続前だけ使う） */
  demoFixedBadge: "デモ用の固定結果",
  demoFixedNote:
    "デモ用の固定結果です。あなたの回答から計算したものではありません。画面を確かめるための架空の結果で、下の「回答の振り返り」だけが、あなたの実際の回答です。",

  sections: {
    explainer: "結果の読み方", // section.explainer
    priority: "最優先テーマ", // section.priority
    importance: "大切さ", // section.importance
    importanceChart: "段階の帯", // section.chart
    tradeoff: "優先条件", // section.tradeoff
    hesitant: "判断に迷ったテーマ", // section.hesitant
    declined: "回答しなかったテーマ", // section.declined
    undetermined: "判定できない項目", // section.undetermined
    notAsked: "未出題のテーマ", // section.notAsked
    counts: "結果のもとになった数", // section.counts
    reflection: "回答の振り返り（あなたの実際の回答）", // section.reflection
    guidance: "この結果の活かし方", // section.guidance
  },

  /** lead.tradeoff（Req 5.3） */
  tradeoffLead: "両立が難しい場面で、どちらを先に進めたいかを示します。大切さとは別の質問から決まります。",

  /** priority.NOT_ASKED / priority.NONE_SELECTED（Req 5.16, 5.17） */
  priorityNotAsked: "この診断では最優先テーマを聞いていません",
  priorityNoneSelected: "最優先テーマは選ばれていません",

  /** empty.*（該当するテーマがないとき） */
  empty: "該当するテーマはありません",

  /** note.noThemeDifference / note.equalLevel（Req 4.16, 4.19, 5.7） */
  noThemeDifference:
    "大切さを判定できたテーマが、すべて同じ段階です。大切さの回答だけでは、テーマ間の差は読み取れません。",
  equalLevelNote: "同じ段階の中のテーマの並びはテーマの定義順で、優先度の差ではありません。",

  explainer: [
    {
      code: "STAGE_MEANING",
      heading: "段階の意味",
      body: "大切さは「とても大切」から「大切でない」までの5段階で示します。優先条件は、両立が難しい場面でどちらを先に進めたいかを示し、大切さとは別の質問から決まります。",
    },
    {
      code: "GROUP_READING",
      heading: "段階のグループの見方",
      body: "段階は順位ではありません。同じ段階の中のテーマは、テーマの定義順に並べています。",
    },
    {
      code: "HESITANT_MEANING",
      heading: "判断に迷ったテーマの意味",
      body: "そのテーマの質問で「わからない」を選んだテーマです。",
    },
  ],

  /** state.*（Req 5.5, 5.17） */
  state: {
    NOT_ASKED: "出題していません",
    UNDETERMINED: "判定できません",
    UNSURE: "わからない",
    DECLINE: "回答しない",
    UNANSWERED: "未回答",
  },

  /** reason.UNSURE / reason.PICK_CONFLICT（Req 5.4） */
  hesitantReason: {
    UNSURE: "「わからない」を選んだ質問があります",
    PICK_CONFLICT: "最優先に選んだテーマですが、大切さの段階が「あまり大切でない」以下です",
  },

  /** counts.themes / counts.questions（Req 5.6。「n / m」の形） */
  counts: {
    themes: "出題したテーマ",
    questions: "意見を答えた質問",
  },

  /** 活かし方の案内 */
  guidanceLead: "大切だと答えたテーマについて、確かめる観点の例です。特定の候補者・政党・地域・職場を勧めるものではありません。",

  /** error.<code>（Req 5.14） */
  error: {
    NO_OPINION_ANSWERS:
      "出題したすべての質問が「わからない」「回答しない」「未回答」のため、価値観マップを作れませんでした。",
    UNKNOWN_QUESTION: "結果を表示できませんでした。最初からやり直してください。",
    INVALID_ANSWER: "結果を表示できませんでした。最初からやり直してください。",
    INVALID_CONFIG: "設定の誤りにより、結果を表示できませんでした。",
  },

  /** ui.*（Req 2.8） */
  selectRequired: "回答を1つ選んでください",
} as const;

/** level.importance.<+2〜−2>（大切さの段階の文言。Req 4.7 の用語集） */
export const IMPORTANCE_LEVEL_LABELS: Readonly<Record<Level, string>> = {
  2: "とても大切",
  1: "大切",
  0: "どちらともいえない",
  [-1]: "あまり大切でない",
  [-2]: "大切でない",
};

/** 軸の名前（Req 5.5） */
export const AXIS_LABELS: Readonly<Record<ValuesAxis, string>> = {
  IMPORTANCE: "大切さ",
  TRADEOFF: "優先条件",
};

/** 非意見回答の文言（Req 5.17、6.1） */
export const NON_OPINION_LABELS: Readonly<Record<NonOpinionCode, string>> = {
  UNSURE: VALUES_LABELS.state.UNSURE,
  DECLINE: VALUES_LABELS.state.DECLINE,
  UNANSWERED: VALUES_LABELS.state.UNANSWERED,
};

/** scene.*（Req 6.6 の場面の名前） */
export const SCENE_LABELS: Readonly<Record<GuidanceScene, string>> = {
  ELECTION: "選挙で",
  MOVE_OR_JOB: "移住や就職で",
  DAILY_LIFE: "日常生活で",
};

/** 場面の表示順（Req 6.6：選挙 → 移住や就職 → 日常生活） */
export const SCENE_ORDER: readonly GuidanceScene[] = ["ELECTION", "MOVE_OR_JOB", "DAILY_LIFE"];

/** 段階の表示順（Req 5.2：+2 から −2）。順位ではない */
export const LEVEL_ORDER: readonly Level[] = [2, 1, 0, -1, -2];
