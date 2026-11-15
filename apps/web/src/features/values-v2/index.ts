/*
 * 地域課題ジレンマ診断（v2）の入口。
 * まだどのルートにも登録していない。/values は v1 のまま（開発用のプレビューは values-v2-preview.html）。
 * 置き換える時期と方法は、共同開発者の v2 の契約（6軸の定義と計算方法を含む）ができてから決める。
 */
export { ValuesDiagnosisV2 } from "./ValuesDiagnosisV2.js";
export { ValueAxisRadar } from "./components/ValueAxisRadar.js";
export { analyzeValueAxes, SAMPLE_AXIS_VALUES, traceAxisAnswers } from "./axisAnalysis.js";
export type * from "./uiTypes.js";
