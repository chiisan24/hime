import type {
  Question,
  QuestionBank,
  ThemeId,
  ValuesMap,
} from "./contractTypes.js";
import type { GlossaryEntry, GuidanceEntry, ResultTextEntry } from "./types.js";

/*
 * 価値観診断のデモ用データ（すべて架空・仮の内容。dataKind は FIXTURE）。
 *
 * - 質問バンクと価値観マップは、正式な契約の型（QuestionBank、ValuesMap）で書く。
 *   契約の検証（QuestionBankSchema、ValuesMapSchema）に通ることは demoData.test.ts で確かめる。
 * - 質問は人間の承認を経ていない（approval: null）。正式な架空データは tasks.md 6.1〜6.3 で共同開発者が用意する。
 * - クイック版の3テーマは requirements.md の暫定案（人口減少・地域活性化、防災、教育・子育て）に合わせた。
 *   テーマは診断セットのデータで決め、画面のコードには固定しない。
 * - 画面はこのファイルを直接読まず、services/valuesData.ts を経由して受け取る。
 */

const CREATED_ON = "2026-11-12" as Question["createdOn"];

/** 5つの選択肢の文言（回答値 +2、+1、0、−1、−2 の順） */
type OpinionLabels = Extract<Question, { kind: "IMPORTANCE" }>["opinionLabels"];

/** 大切さ質問の選択肢（Req 3.6：全質問で同じ5つの文言。+2 から −2 の順） */
const IMPORTANCE_LABELS: OpinionLabels = [
  "とても大切",
  "大切",
  "どちらともいえない",
  "あまり大切でない",
  "大切でない",
];

/** 優先条件質問の選択肢（+2＝方向A寄り から −2＝方向B寄り の順。Req 3.16：0 は「どちらも同じくらい大切」） */
const TRADEOFF_LABELS: OpinionLabels = [
  "Aに近い",
  "どちらかといえばA",
  "どちらも同じくらい大切",
  "どちらかといえばB",
  "Bに近い",
];

/** 優先条件質問の前提文（Req 3.14：全質問で共通の型） */
const TRADEOFF_PREMISE = "限られた予算や人手の中で、どちらかを先に進める場面を考えてください";

const COMMON = {
  dataKind: "FIXTURE",
  author: "HUMAN",
  createdOn: CREATED_ON,
  version: 1,
  unsureLabel: "わからない",
  declineLabel: "回答しない",
  weight: 1,
  approval: null,
} as const;

export const DEMO_QUESTION_IDS = {
  educationImportance: "demo-education-importance",
  educationTradeoff: "demo-education-tradeoff",
  disasterImportance: "demo-disaster-importance",
  disasterTradeoff: "demo-disaster-tradeoff",
  populationImportance: "demo-population-importance",
  populationTradeoff: "demo-population-tradeoff",
} as const;

const DEMO_QUESTIONS: Question[] = [
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.educationImportance,
    kind: "IMPORTANCE",
    themeId: "EDUCATION_CHILDCARE",
    text: "教育・子育ては、あなたの暮らしにとってどのくらい大切ですか？",
    explanation:
      "教育・子育ては、学校や保育、子育ての支援などを指します。自分や家族の暮らしに直接関わるので、大切だと考える人がいます。子育ての時期が過ぎた人などは、ほかのテーマを先に考えることもあります。",
    opinionLabels: IMPORTANCE_LABELS,
    swapDirections: false,
  },
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.educationTradeoff,
    kind: "TRADEOFF",
    themeId: "EDUCATION_CHILDCARE",
    text: "教育・子育てで、先に進めたい考えはどちらに近いですか？",
    explanation:
      "教育環境の充実は、学校の設備や学びの場を整えることです。費用の負担の軽減は、保育料や教育費などの支払いを軽くすることです。子どもが学ぶ環境を重く見る考えと、家庭の支出を重く見る考えがあります。",
    opinionLabels: TRADEOFF_LABELS,
    premise: TRADEOFF_PREMISE,
    directionA: { text: "学校や学びの場など、教育環境を充実させる", category: "NEUTRAL" },
    directionB: { text: "子育て家庭の費用の負担を軽くする", category: "NEUTRAL" },
    swapDirections: false,
  },
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.disasterImportance,
    kind: "IMPORTANCE",
    themeId: "DISASTER_PREVENTION",
    text: "防災は、あなたの暮らしにとってどのくらい大切ですか？",
    explanation:
      "防災は、災害に備える取り組みや、災害が起きたときの避難などを指します。災害の危険が身近にあるので、大切だと考える人がいます。住んでいる場所によっては、ほかのテーマを先に考える人もいます。",
    opinionLabels: IMPORTANCE_LABELS,
    swapDirections: false,
  },
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.disasterTradeoff,
    kind: "TRADEOFF",
    themeId: "DISASTER_PREVENTION",
    text: "防災で、先に進めたい考えはどちらに近いですか？",
    explanation:
      "施設の整備は、堤防や避難所などを災害の前に整えることです。人の備えは、避難の訓練や、危険を知らせる仕組みを強めることです。施設で被害を防ぐ考えと、人の行動で被害を減らす考えがあります。",
    opinionLabels: TRADEOFF_LABELS,
    premise: TRADEOFF_PREMISE,
    directionA: { text: "堤防や避難所などの施設を前もって整備する", category: "NEUTRAL" },
    directionB: { text: "避難の訓練や情報の伝え方など、人の備えを強める", category: "NEUTRAL" },
    // 方向Aと方向Bの表示位置を入れ替える質問（Req 2.4、3.8）。回答値は入れ替えない
    swapDirections: true,
  },
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.populationImportance,
    kind: "IMPORTANCE",
    themeId: "POPULATION_REVITALIZATION",
    text: "人口減少・地域活性化は、あなたの暮らしにとってどのくらい大切ですか？",
    explanation:
      "人口減少・地域活性化は、住む人が減る中で、地域のにぎわいや暮らしを保つ取り組みです。地域の将来に関わるので、大切だと考える人がいます。今の暮らしに身近な課題を、先に考える人もいます。",
    opinionLabels: IMPORTANCE_LABELS,
    swapDirections: false,
  },
  {
    ...COMMON,
    questionId: DEMO_QUESTION_IDS.populationTradeoff,
    kind: "TRADEOFF",
    themeId: "POPULATION_REVITALIZATION",
    text: "人口減少・地域活性化で、先に進めたい考えはどちらに近いですか？",
    explanation:
      "移住や定住の促進は、ほかの地域から人を呼び、住み続けてもらう取り組みです。今の住民の暮らしの維持は、買い物や通院などの身近な暮らしを支えることです。新しい住民を重く見る考えと、今の住民を重く見る考えがあります。",
    opinionLabels: TRADEOFF_LABELS,
    premise: TRADEOFF_PREMISE,
    directionA: { text: "移住や定住を促して、地域に住む人を増やす", category: "CHANGE" },
    directionB: { text: "今住んでいる人の暮らしを支え、保ち続ける", category: "CONTINUE" },
    swapDirections: false,
  },
];

/** デモ用の質問バンク（6テーマ。クイック版の診断セットだけを持つ。完全版は将来） */
export const DEMO_QUESTION_BANK: QuestionBank = {
  schemaVersion: 1,
  dataKind: "FIXTURE",
  // テーマ定義順（順位ではない）
  themes: [
    { themeId: "TRANSPORT", label: "地域交通" },
    { themeId: "EDUCATION_CHILDCARE", label: "教育・子育て" },
    { themeId: "ECONOMY_EMPLOYMENT", label: "地域経済・雇用" },
    { themeId: "HEALTHCARE_WELFARE", label: "医療・福祉" },
    { themeId: "DISASTER_PREVENTION", label: "防災" },
    { themeId: "POPULATION_REVITALIZATION", label: "人口減少・地域活性化" },
  ],
  questions: DEMO_QUESTIONS,
  diagnosticSets: [
    {
      setKind: "QUICK",
      themeIds: ["EDUCATION_CHILDCARE", "DISASTER_PREVENTION", "POPULATION_REVITALIZATION"],
      questionIds: [
        DEMO_QUESTION_IDS.educationImportance,
        DEMO_QUESTION_IDS.educationTradeoff,
        DEMO_QUESTION_IDS.disasterImportance,
        DEMO_QUESTION_IDS.disasterTradeoff,
        DEMO_QUESTION_IDS.populationImportance,
        DEMO_QUESTION_IDS.populationTradeoff,
      ],
    },
  ],
};

/**
 * デモ用の固定の価値観マップ（ValuesMap の形）。利用者の回答からは計算していない。
 * generateValuesMap（tasks.md 3.6）が未実装のため、表示の確認用に固定値を使う。
 * 4つの状態（未出題・わからない・回答しない・未回答）と2つの軸の独立が画面で確かめられる例にしている。
 * - 教育・子育て：大切さ +2、優先条件 −1（方向B寄り、やや）
 * - 防災：大切さは「わからない」で判定できない、優先条件 +2（方向A寄り、強く）
 * - 人口減少・地域活性化：大切さ +1、優先条件は「回答しない」で判定できない
 * - ほかの3テーマ：未出題
 */
export const DEMO_VALUES_MAP: ValuesMap = {
  setKind: "QUICK",
  themes: [
    { themeId: "TRANSPORT", importance: { state: "NOT_ASKED" }, tradeoff: { state: "NOT_ASKED" } },
    {
      themeId: "EDUCATION_CHILDCARE",
      importance: { state: "DETERMINED", score: 200, level: 2 },
      tradeoff: { state: "DETERMINED", score: -100, level: -1 },
    },
    { themeId: "ECONOMY_EMPLOYMENT", importance: { state: "NOT_ASKED" }, tradeoff: { state: "NOT_ASKED" } },
    { themeId: "HEALTHCARE_WELFARE", importance: { state: "NOT_ASKED" }, tradeoff: { state: "NOT_ASKED" } },
    {
      themeId: "DISASTER_PREVENTION",
      importance: { state: "UNDETERMINED", reasons: ["UNSURE"] },
      tradeoff: { state: "DETERMINED", score: 200, level: 2 },
    },
    {
      themeId: "POPULATION_REVITALIZATION",
      importance: { state: "DETERMINED", score: 100, level: 1 },
      tradeoff: { state: "UNDETERMINED", reasons: ["DECLINE"] },
    },
  ],
  importanceGroups: [
    { level: 2, themeIds: ["EDUCATION_CHILDCARE"] },
    { level: 1, themeIds: ["POPULATION_REVITALIZATION"] },
    { level: 0, themeIds: [] },
    { level: -1, themeIds: [] },
    { level: -2, themeIds: [] },
  ],
  priority: { state: "NOT_ASKED" },
  hesitantThemes: [{ themeId: "DISASTER_PREVENTION", reasons: ["UNSURE"] }],
  declinedThemes: [{ themeId: "POPULATION_REVITALIZATION", reasons: ["DECLINE"] }],
  notAskedThemes: ["TRANSPORT", "ECONOMY_EMPLOYMENT", "HEALTHCARE_WELFARE"],
  excludedQuestions: [
    { questionId: DEMO_QUESTION_IDS.disasterImportance, reason: "UNSURE" },
    { questionId: DEMO_QUESTION_IDS.populationTradeoff, reason: "DECLINE" },
  ],
  counts: { askedThemes: 3, totalThemes: 6, usableQuestions: 4, askedQuestions: 6 },
  notices: { noThemeDifference: false, equalLevelGroupExists: false },
};

/** デモの活かし方の案内の対象テーマ（Req 6.6 の選び方で、大切さ +2 と +1 のテーマ。テーマ定義順） */
export const DEMO_GUIDANCE_THEME_IDS: readonly ThemeId[] = [
  "EDUCATION_CHILDCARE",
  "POPULATION_REVITALIZATION",
];

/**
 * デモ用の結果解説（テーマ × 軸 × 段階）。回答の事実と段階の意味だけを述べる。
 * 優先条件は Req 5.3 の型「どちらかを選ぶなら、◯◯では△△を先に進めたい考えに近い（やや／強く）」。
 * デモの固定結果で使う組合せだけを持つ。正式な結果解説は tasks.md 6.3 で用意される。
 */
export const DEMO_RESULT_TEXTS: readonly ResultTextEntry[] = [
  {
    themeId: "EDUCATION_CHILDCARE",
    axis: "IMPORTANCE",
    level: 2,
    text: "教育・子育ての大切さの質問で、「とても大切」を選びました。",
  },
  {
    themeId: "POPULATION_REVITALIZATION",
    axis: "IMPORTANCE",
    level: 1,
    text: "人口減少・地域活性化の大切さの質問で、「大切」を選びました。",
  },
  {
    themeId: "EDUCATION_CHILDCARE",
    axis: "TRADEOFF",
    level: -1,
    text: "どちらかを選ぶなら、教育・子育てでは子育て家庭の費用の負担を軽くすることを先に進めたい考えに近い（やや）",
  },
  {
    themeId: "DISASTER_PREVENTION",
    axis: "TRADEOFF",
    level: 2,
    text: "どちらかを選ぶなら、防災では施設を前もって整備することを先に進めたい考えに近い（強く）",
  },
];

/** デモ用の活かし方の問い（テーマ × 場面。文末が「か」の1文。Req 6.6、6.7） */
export const DEMO_GUIDANCE: readonly GuidanceEntry[] = [
  {
    themeId: "EDUCATION_CHILDCARE",
    scene: "ELECTION",
    text: "教育・子育てを大切にしたい場合は、候補者の政策資料で、子育ての支援への取組みを確認できますか",
  },
  {
    themeId: "EDUCATION_CHILDCARE",
    scene: "MOVE_OR_JOB",
    text: "教育・子育てを大切にしたい場合は、住む地域の保育や学校の情報を、自治体の公式情報で確かめられますか",
  },
  {
    themeId: "EDUCATION_CHILDCARE",
    scene: "DAILY_LIFE",
    text: "教育・子育てを大切にしたい場合は、身近な子育ての相談先を知っていますか",
  },
  {
    themeId: "POPULATION_REVITALIZATION",
    scene: "ELECTION",
    text: "人口減少・地域活性化を大切にしたい場合は、候補者の政策資料で、地域の暮らしを保つ取組みを確認できますか",
  },
  {
    themeId: "POPULATION_REVITALIZATION",
    scene: "MOVE_OR_JOB",
    text: "人口減少・地域活性化を大切にしたい場合は、移住や定住の支援の制度を、自治体の公式情報で確かめられますか",
  },
  {
    themeId: "POPULATION_REVITALIZATION",
    scene: "DAILY_LIFE",
    text: "人口減少・地域活性化を大切にしたい場合は、地域の行事や活動に関わる機会を知っていますか",
  },
];

/**
 * デモ用の用語の説明（質問IDごと）。人が書いた固定の文で、AIは使っていない。
 * 正式には課題カードの用語解説と、表示モデルの注釈つきの文（RichText）から受け取る。
 */
export const DEMO_GLOSSARY: Readonly<Record<string, readonly GlossaryEntry[]>> = {
  [DEMO_QUESTION_IDS.educationTradeoff]: [
    {
      term: "教育環境",
      description: "学校の設備や、図書館・学習の場など、子どもが学ぶための環境のことです。",
    },
  ],
  [DEMO_QUESTION_IDS.disasterImportance]: [
    { term: "避難所", description: "災害のときに、住民が一時的に過ごすための施設です。" },
  ],
  [DEMO_QUESTION_IDS.disasterTradeoff]: [
    {
      term: "ハザードマップ",
      description: "洪水・土砂災害・津波などで被害が出るおそれのある範囲や、避難場所を示した地図です。",
    },
  ],
  [DEMO_QUESTION_IDS.populationImportance]: [
    { term: "地域活性化", description: "地域の産業や行事、人のつながりを元気にする取り組みのことです。" },
  ],
  [DEMO_QUESTION_IDS.populationTradeoff]: [
    { term: "定住", description: "ある地域に住み続けることです。移住した人が、そのまま住み続けることも含みます。" },
  ],
};
