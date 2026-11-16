import type { Level, ThemeId, TradeoffCode } from "../values/contractTypes.js";

/*
 * 地域課題ジレンマ診断（v2）の画面専用の仮の型。
 *
 * 【正式な契約ではない】共同開発者の v2 の契約（DilemmaQuestion、ValueAxisDef、ValuesProfile、
 * generateValuesProfile）はまだ実装されていない。正式な契約ができたら、この型を置き換える。
 * 名前の先頭に Ui を付け、正式な契約の名前と混同しないようにしている。
 * 回答値は、既存の契約の優先条件の5段階（TradeoffCode）をそのまま使う。
 */

/**
 * 価値観の6軸。名称と説明文は暫定（人の承認前）。
 * 計算方法は .kiro/specs/regional-values-map/records/values-v2-axis-analysis.md で定め、axisAnalysis.ts に実装した
 * （共同開発者の承認の記録はまだない）。
 */
export type UiValueAxisId =
  | "FAIRNESS"
  | "STABILITY"
  | "FUTURE"
  | "OPPORTUNITY"
  | "COMMUNITY"
  | "INFRASTRUCTURE";

export type UiValueAxis = Readonly<{
  axisId: UiValueAxisId;
  label: string;
  /** 画面に出す説明文の案（未承認） */
  definition: string;
}>;

export type UiDilemmaOption = Readonly<{
  text: string;
  /**
   * この考え方に割り当てた暫定の価値観軸。質問の画面には出さない（回答を誘導しないため）。
   * 結果画面で、回答と軸の対応を示すのに使う（axisAnalysis.ts の traceAxisAnswers）
   */
  valueAxisId: UiValueAxisId;
}>;

export type UiDilemmaQuestion = Readonly<{
  questionId: string;
  themeId: ThemeId;
  themeLabel: string;
  /** 具体的な状況。数値や実在の事実を含めない */
  situation: string;
  optionA: UiDilemmaOption;
  optionB: UiDilemmaOption;
  /** デモ用の仮の質問なら true */
  isDemo: boolean;
}>;

/**
 * 1問への回答。5段階のどれか、または「スキップ」。
 * スキップは中立（BALANCED）や0点として扱わない。未回答の質問はキーを持たない。
 */
export type DilemmaAnswer = TradeoffCode | "SKIPPED";

export type DilemmaAnswers = Readonly<Record<string, DilemmaAnswer>>;

/**
 * 軸を分析できない理由。質問をスキップした（SKIPPED）と、質問に答えていない（UNANSWERED）を分けて持つ。
 * どちらも0点や中立（同程度）にしない。
 */
export type UiAxisMissingReason = "SKIPPED" | "UNANSWERED";

/**
 * 価値観レーダーに渡す、軸ごとの表示用の値。
 * - DETERMINED  : 回答から水準（−2〜+2）を計算できた軸。usableQuestions は計算に使った質問の数
 * - UNDETERMINED: この軸の質問はあるが、回答がない（スキップまたは未回答）。reasons はその内訳
 * - NOT_ASKED   : この診断に、この軸の質問がない（未出題）
 * 回答からこの値を作るのは UiAxisAnalyzer（axisAnalysis.ts の analyzeValueAxes）。
 */
export type UiAxisDisplayValue =
  | Readonly<{ axisId: UiValueAxisId; state: "DETERMINED"; level: Level; usableQuestions: number }>
  | Readonly<{ axisId: UiValueAxisId; state: "UNDETERMINED"; reasons?: readonly UiAxisMissingReason[] }>
  | Readonly<{ axisId: UiValueAxisId; state: "NOT_ASKED" }>;

/** 符号つきの回答値（A_STRONG を +2、B_STRONG を −2 とする） */
export type UiSignedAnswer = -2 | -1 | 0 | 1 | 2;

/** 軸の計算の根拠になった（または、回答がないため使えなかった）1つの質問と回答 */
export type UiAxisEvidence = Readonly<{
  questionId: string;
  themeLabel: string;
  /** この軸が、質問の考え方Aか考え方Bか */
  side: "A" | "B";
  /** 比べた相手の考え方の軸（同じ質問の反対側） */
  opposingAxisId: UiValueAxisId;
  answer: DilemmaAnswer | undefined;
  /** この軸への寄与（A側なら回答値、B側なら符号を反転した値）。スキップと未回答は null（0にしない） */
  contribution: UiSignedAnswer | null;
}>;

/** analyzeValueAxes が返す軸ごとの結果。表示用の値（UiAxisDisplayValue）に、根拠と得点を足したもの */
export type UiAxisResult =
  | Readonly<{
      axisId: UiValueAxisId;
      state: "DETERMINED";
      level: Level;
      /** 寄与の平均を、最大の傾きに対する百分率にした整数（−200〜+200）。画面には出さない */
      score: number;
      usableQuestions: number;
      /** 計算に使えなかった質問の理由（例: 2問のうち1問をスキップ） */
      reasons: readonly UiAxisMissingReason[];
      evidence: readonly UiAxisEvidence[];
    }>
  | Readonly<{
      axisId: UiValueAxisId;
      state: "UNDETERMINED";
      reasons: readonly UiAxisMissingReason[];
      evidence: readonly UiAxisEvidence[];
    }>
  | Readonly<{ axisId: UiValueAxisId; state: "NOT_ASKED"; evidence: readonly UiAxisEvidence[] }>;

/** 分析の入力の誤り。誤りがあれば値を作らず、すべてを返す（入力の順に並べる） */
export type UiAxisAnalysisIssue =
  | Readonly<{ code: "DUPLICATE_AXIS_ID"; axisId: string }>
  | Readonly<{ code: "DUPLICATE_QUESTION_ID"; questionId: string }>
  | Readonly<{ code: "UNKNOWN_AXIS_ID"; questionId: string; side: "A" | "B"; axisId: string }>
  | Readonly<{ code: "SAME_AXIS_ON_BOTH_SIDES"; questionId: string; axisId: string }>
  | Readonly<{ code: "UNKNOWN_QUESTION_ID"; questionId: string }>
  | Readonly<{ code: "INVALID_ANSWER_VALUE"; questionId: string }>;

/**
 * 価値観6軸の分析の結果。
 * - ANALYZED: 回答から計算した軸ごとの値（axes の順）。結果画面は、レーダーを分析結果として描く。
 * - INVALID : 質問、軸、回答のどれかに誤りがある。値を作らない。結果画面は、レーダーを描かない。
 * - PENDING : 回答から値を計算していない（計算を差し替えた場合のため）。結果画面は、レーダーをサンプル表示にする。
 */
export type UiAxisAnalysis =
  | Readonly<{ status: "ANALYZED"; values: readonly UiAxisDisplayValue[] }>
  | Readonly<{ status: "INVALID"; issues: readonly UiAxisAnalysisIssue[] }>
  | Readonly<{ status: "PENDING" }>;

export type UiAxisAnalysisInput = Readonly<{
  questions: readonly UiDilemmaQuestion[];
  axes: readonly UiValueAxis[];
  /** スキップ（SKIPPED）と未回答（キーなし）は、0点や中立に変えずにそのまま渡す */
  answers: DilemmaAnswers;
}>;

/** 回答から価値観6軸の分析の結果を作る関数 */
export type UiAxisAnalyzer = (input: UiAxisAnalysisInput) => UiAxisAnalysis;

/** computeValueAxes の結果（軸ごとの結果に、根拠と得点を持つ） */
export type UiAxisComputation =
  | Readonly<{ status: "ANALYZED"; values: readonly UiAxisResult[] }>
  | Readonly<{ status: "INVALID"; issues: readonly UiAxisAnalysisIssue[] }>;

/** 1つの軸が、ある質問のA側またはB側に現れることと、その質問への回答（計算はしない） */
export type UiAxisTraceLink = Readonly<{
  question: UiDilemmaQuestion;
  side: "A" | "B";
  answer: DilemmaAnswer | undefined;
}>;

/** 軸ごとの、回答との対応（質問の提示順） */
export type UiAxisTrace = Readonly<{
  axis: UiValueAxis;
  links: readonly UiAxisTraceLink[];
}>;
