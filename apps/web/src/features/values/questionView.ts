import type {
  AnswerValue,
  ImportanceCode,
  Question,
  ThemeDef,
  ThemeId,
  TradeoffCode,
} from "./contractTypes.js";
import { NON_OPINION_LABELS } from "./labels.js";

/*
 * 質問を画面に出す形に整える（仮の表示モデル）。
 *
 * 正式には domain の presentQuestion（tasks.md 5.5）が返す QuestionPresentation を描画する。
 * それまでのあいだ、契約の Question から、表示順の選択肢と方向の説明だけを作る。
 * 文言は質問バンクの値（opinionLabels、unsureLabel、declineLabel、premise、directionA/B）をそのまま使う。
 */

/** 回答値の並び（+2 から −2）。契約の IMPORTANCE_VALUE と同じ順（questionView.test.ts で確認） */
export const IMPORTANCE_CODE_ORDER = [
  "VERY_IMPORTANT",
  "IMPORTANT",
  "NEUTRAL",
  "NOT_VERY_IMPORTANT",
  "NOT_IMPORTANT",
] as const satisfies readonly ImportanceCode[];

/** 回答値の並び（+2＝方向A寄り から −2＝方向B寄り）。契約の TRADEOFF_VALUE と同じ順 */
export const TRADEOFF_CODE_ORDER = [
  "A_STRONG",
  "A_LEAN",
  "BALANCED",
  "B_LEAN",
  "B_STRONG",
] as const satisfies readonly TradeoffCode[];

/** 画面で選べる回答（UNANSWERED は画面が書き込まない） */
export type SelectableCode = ImportanceCode | TradeoffCode | "UNSURE" | "DECLINE";

export type AnswerOption = Readonly<{
  code: SelectableCode;
  label: string;
}>;

export type DirectionView = Readonly<{ side: "A" | "B"; text: string }>;

export type QuestionView = Readonly<{
  questionId: string;
  kind: "IMPORTANCE" | "TRADEOFF";
  themeId: ThemeId;
  themeLabel: string;
  text: string;
  explanation: string;
  /** 優先条件質問の前提文。方向の説明と選択肢の直前に出す（Req 2.4） */
  premise: string | null;
  /** 表示順の方向の説明。swapDirections を反映済み */
  directions: readonly DirectionView[] | null;
  /** 表示順の7つの選択肢（5段階、わからない、回答しない）。回答値は入れ替えない */
  options: readonly AnswerOption[];
}>;

function themeLabelOf(themes: readonly ThemeDef[], themeId: ThemeId): string {
  return themes.find((theme) => theme.themeId === themeId)?.label ?? themeId;
}

/**
 * 契約の Question を、画面に出す形にする。
 * 最優先テーマの選択（PRIORITY_PICK）は完全版だけの質問で、MVP の画面は対応していないため null を返す。
 */
export function toQuestionView(question: Question, themes: readonly ThemeDef[]): QuestionView | null {
  if (question.kind === "PRIORITY_PICK") {
    return null;
  }

  const tail: AnswerOption[] = [
    { code: "UNSURE", label: question.unsureLabel },
    { code: "DECLINE", label: question.declineLabel },
  ];

  if (question.kind === "IMPORTANCE") {
    return {
      questionId: question.questionId,
      kind: "IMPORTANCE",
      themeId: question.themeId,
      themeLabel: themeLabelOf(themes, question.themeId),
      text: question.text,
      explanation: question.explanation,
      premise: null,
      directions: null,
      options: [
        ...IMPORTANCE_CODE_ORDER.map((code, index) => ({
          code,
          label: question.opinionLabels[index] ?? code,
        })),
        ...tail,
      ],
    };
  }

  const opinion: AnswerOption[] = TRADEOFF_CODE_ORDER.map((code, index) => ({
    code,
    label: question.opinionLabels[index] ?? code,
  }));
  const directions: DirectionView[] = [
    { side: "A", text: question.directionA.text },
    { side: "B", text: question.directionB.text },
  ];

  // 表示位置を入れ替える質問では、方向の説明と5段階を逆順に並べる（回答値は変えない。Req 2.4）
  return {
    questionId: question.questionId,
    kind: "TRADEOFF",
    themeId: question.themeId,
    themeLabel: themeLabelOf(themes, question.themeId),
    text: question.text,
    explanation: question.explanation,
    premise: question.premise,
    directions: question.swapDirections ? [...directions].reverse() : directions,
    options: [...(question.swapDirections ? [...opinion].reverse() : opinion), ...tail],
  };
}

/** 回答の振り返りで出す、利用者の回答の文言（Req 6.1） */
export function answerLabelOf(question: Question, answer: AnswerValue | undefined): string {
  if (answer === undefined || answer === "UNANSWERED") {
    return NON_OPINION_LABELS.UNANSWERED;
  }
  if (answer === "UNSURE") {
    return question.unsureLabel;
  }
  if (answer === "DECLINE") {
    return question.declineLabel;
  }
  if (typeof answer !== "string" || question.kind === "PRIORITY_PICK") {
    // 最優先テーマの選択は MVP の画面では扱わない
    return NON_OPINION_LABELS.UNANSWERED;
  }
  const order: readonly string[] =
    question.kind === "IMPORTANCE" ? IMPORTANCE_CODE_ORDER : TRADEOFF_CODE_ORDER;
  const index = order.indexOf(answer);
  return index === -1 ? NON_OPINION_LABELS.UNANSWERED : (question.opinionLabels[index] ?? answer);
}
