import type { TradeoffCode } from "../values/contractTypes.js";
import type { UiDilemmaQuestion, UiValueAxis } from "./uiTypes.js";

/*
 * 地域課題ジレンマ診断（v2）の UI 専用の仮データ。すべて架空のデモ用。
 *
 * - 質問は「価値観診断 再設計の仕様提案（地域課題ジレンマ方式・C案）」§3.2 の6問をそのまま使う。
 *   提示順は、テーマ定義順（地域交通 → 教育・子育て → 地域経済・雇用 → 医療・福祉 → 防災 → 人口減少・地域活性化）。
 * - 状況文は「ある町で」とし、実在の自治体名や愛媛県の実際の状況、数値を書かない。
 * - 価値観の6軸の名称と説明は暫定案（人の承認前）。各軸が2問に現れ、1回はA側、1回はB側になるように割り当てている。
 *   回答からの計算は axisAnalysis.ts（仕様は records/values-v2-axis-analysis.md。共同開発者の承認は未記録）。
 * - 中立性の点検と人間の承認を経ていない。正式な質問バンクは共同開発者の v2 の契約で用意する。
 */

/** 価値観の暫定6軸（仕様提案 §4.1 の定義案） */
export const UI_VALUE_AXES: readonly UiValueAxis[] = [
  {
    axisId: "FAIRNESS",
    label: "公平性",
    definition: "住む場所や事情にかかわらず、同じようにサービスを受けられることを大切にする考え方",
  },
  {
    axisId: "STABILITY",
    label: "暮らしの安定",
    definition: "今の暮らしや負担の見通しが立つことを大切にする考え方",
  },
  {
    axisId: "FUTURE",
    label: "将来への投資",
    definition: "すぐに成果が出なくても、先の世代や地域の将来のために取り組むことを大切にする考え方",
  },
  {
    axisId: "OPPORTUNITY",
    label: "個人の可能性",
    definition: "一人ひとりが学んだり挑戦したりする機会が広がることを大切にする考え方",
  },
  {
    axisId: "COMMUNITY",
    label: "地域のつながり",
    definition: "住民どうしや地元の事業者の結びつきで、地域を支えることを大切にする考え方",
  },
  {
    axisId: "INFRASTRUCTURE",
    label: "公共基盤の充実",
    definition: "施設・設備・拠点など、形のある共通の基盤を整えることを大切にする考え方",
  },
];

/** 全問で共通の問いかけ（状況文のあとに出す） */
export const DILEMMA_PROMPT = "あなたの考えは、AとBのどちらに近いですか？";

/** 5段階の選択肢（左がA寄り、右がB寄り）。回答値は既存の優先条件の5段階を使う */
export const DILEMMA_SCALE: readonly Readonly<{ code: TradeoffCode; label: string }>[] = [
  { code: "A_STRONG", label: "Aを強く重視" },
  { code: "A_LEAN", label: "Aをやや重視" },
  { code: "BALANCED", label: "同程度" },
  { code: "B_LEAN", label: "Bをやや重視" },
  { code: "B_STRONG", label: "Bを強く重視" },
];

export const DEMO_DILEMMAS: readonly UiDilemmaQuestion[] = [
  {
    questionId: "demo-dilemma-transport",
    themeId: "TRANSPORT",
    themeLabel: "地域交通",
    situation: "ある町で、利用者の少ないバス路線の運行をどうするか話し合っています。",
    optionA: { text: "利用が少ない地域にも路線を残す", valueAxisId: "FAIRNESS" },
    optionB: {
      text: "利用が多い路線の便を増やし、通勤や通学の足を安定させる",
      valueAxisId: "STABILITY",
    },
    isDemo: true,
  },
  {
    questionId: "demo-dilemma-education",
    themeId: "EDUCATION_CHILDCARE",
    themeLabel: "教育・子育て",
    situation: "ある町で、子育て支援の進め方を話し合っています。",
    optionA: { text: "子育て家庭の今の費用の負担を軽くする", valueAxisId: "STABILITY" },
    optionB: { text: "子どもが新しい分野を学べる機会を増やす", valueAxisId: "OPPORTUNITY" },
    isDemo: true,
  },
  {
    questionId: "demo-dilemma-economy",
    themeId: "ECONOMY_EMPLOYMENT",
    themeLabel: "地域経済・雇用",
    situation: "ある町で、地域の産業を支える方法を話し合っています。",
    optionA: { text: "新しい産業を育てるための支援に取り組む", valueAxisId: "FUTURE" },
    optionB: { text: "地元の事業者どうしの結びつきを支える", valueAxisId: "COMMUNITY" },
    isDemo: true,
  },
  {
    questionId: "demo-dilemma-healthcare",
    themeId: "HEALTHCARE_WELFARE",
    themeLabel: "医療・福祉",
    situation: "ある地域で、医療の体制をどう整えるか話し合っています。",
    optionA: { text: "専門の医療を行う拠点の設備を整える", valueAxisId: "INFRASTRUCTURE" },
    optionB: { text: "どの地域でも近くで受診できる体制を保つ", valueAxisId: "FAIRNESS" },
    isDemo: true,
  },
  {
    questionId: "demo-dilemma-disaster",
    themeId: "DISASTER_PREVENTION",
    themeLabel: "防災",
    situation: "ある町で、大雨に備える取り組みの進め方を話し合っています。",
    optionA: {
      text: "住民どうしで声をかけ合って避難する仕組みを育てる",
      valueAxisId: "COMMUNITY",
    },
    optionB: { text: "堤防や避難所などの施設を前もって整える", valueAxisId: "INFRASTRUCTURE" },
    isDemo: true,
  },
  {
    questionId: "demo-dilemma-population",
    themeId: "POPULATION_REVITALIZATION",
    themeLabel: "人口減少・地域活性化",
    situation: "ある町で、人口が減る中での地域づくりを話し合っています。",
    optionA: { text: "若い世代が地域で挑戦できる機会を広げる", valueAxisId: "OPPORTUNITY" },
    optionB: { text: "将来の地域を支える人を長い目で育てる", valueAxisId: "FUTURE" },
    isDemo: true,
  },
];
