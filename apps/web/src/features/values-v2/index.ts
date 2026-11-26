/*
 * 地域課題ジレンマ診断（v2）の入口。
 * /values/v2 に、v1 とは別のルートとして登録している（一次審査で六角形の価値観レーダーを見せるためのデモ。
 * 架空の質問で、中立性の点検前）。/values は v1 のまま。ルートは ValuesDiagnosisV2.tsx を直接読み込む。
 * /values を v2 に置き換えるかどうかと、その時期と方法は、承認が記録されてから決める
 * （records/values-v2-axis-analysis.md の8〜10）。
 */
export { ValuesDiagnosisV2 } from "./ValuesDiagnosisV2.js";
export { ValueAxisRadar } from "./components/ValueAxisRadar.js";
export {
  analyzeValueAxes,
  computeValueAxes,
  SAMPLE_AXIS_VALUES,
  traceAxisAnswers,
  validateAxisAnalysisInput,
} from "./axisAnalysis.js";
export type * from "./uiTypes.js";
