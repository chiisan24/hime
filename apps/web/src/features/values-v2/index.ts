/*
 * 地域課題ジレンマ診断（v2）の入口。
 * まだどのルートにも登録していない。/values は v1 のまま（開発用のプレビューは values-v2-preview.html）。
 * 置き換える時期と方法は、v2 の計算の仕様（records/values-v2-axis-analysis.md）と、/values の切り替えについての
 * 共同開発者と利用者の承認が記録されてから決める。
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
