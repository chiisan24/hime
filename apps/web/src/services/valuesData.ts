import type {
  Answers,
  DiagnosticSet,
  Question,
  QuestionBank,
  SetKind,
  ThemeDef,
  ThemeId,
} from "../features/values/contractTypes.js";
import {
  DEMO_GLOSSARY,
  DEMO_GUIDANCE,
  DEMO_GUIDANCE_THEME_IDS,
  DEMO_QUESTION_BANK,
  DEMO_RESULT_TEXTS,
  DEMO_VALUES_MAP,
} from "../features/values/demoData.js";
import type {
  GlossaryEntry,
  GuidanceEntry,
  ResultTextEntry,
  ValuesResultSource,
} from "../features/values/types.js";

/*
 * 価値観診断の画面がデータを受け取る窓口（visitorData.ts と同じ考え方）。
 * 今はデモ用の固定データを返すだけ。正式には、公開バンドル（/regional-values/bundle.json）を
 * domain の loadBundle で読み、検証済みの内容を返す形に替える（design.md「バンドルの読み込み」）。
 * 回答はブラウザーのメモリーの中だけで使い、サーバー・AIには送らない（Req 9.1、9.2、9.6）。
 */

/** 1回の診断で出題する内容。質問は診断セットの提示順（固定。ランダムにしない） */
export type DiagnosisContent = Readonly<{
  setKind: SetKind;
  dataKind: QuestionBank["dataKind"];
  /** テーマ定義順（順位ではない） */
  themes: readonly ThemeDef[];
  /** この診断セットで出題するテーマ（テーマ定義順） */
  askedThemeIds: DiagnosticSet["themeIds"];
  questions: readonly Question[];
}>;

function getQuestionBank(): QuestionBank {
  return DEMO_QUESTION_BANK;
}

/**
 * 診断セットの内容を返す。問数は固定せず、診断セットの質問IDの数で決まる（Req 2.1、2.11）。
 * 公開バンドルに診断セットが1つだけのときは、選択を求めずにその診断セットを使う（Req 2.15）。
 */
export function getDiagnosisContent(setKind: SetKind = "QUICK"): DiagnosisContent | undefined {
  const bank = getQuestionBank();
  const set = bank.diagnosticSets.find((candidate) => candidate.setKind === setKind);
  if (set === undefined) {
    return undefined;
  }
  const questions = set.questionIds.flatMap((questionId) => {
    const question = bank.questions.find((candidate) => candidate.questionId === questionId);
    return question === undefined ? [] : [question];
  });
  if (questions.length !== set.questionIds.length) {
    // 診断セットが質問バンクにない質問を指している（正式には bundle の参照整合の検証で弾く）
    return undefined;
  }
  return {
    setKind: set.setKind,
    dataKind: bank.dataKind,
    themes: bank.themes,
    askedThemeIds: set.themeIds,
    questions,
  };
}

/**
 * 価値観マップの結果を返す。
 * generateValuesMap（tasks.md 3.6）が未実装のため、回答を使わずデモ用の固定結果を返す。
 * 接続するときは、この関数の中身だけを、回答から生成した結果（またはマップ生成のエラー）を返す形に替える。
 */
export function getValuesResult(answers: Answers): ValuesResultSource {
  void answers;
  return {
    origin: "DEMO_FIXED",
    map: DEMO_VALUES_MAP,
    guidanceThemeIds: DEMO_GUIDANCE_THEME_IDS,
  };
}

/** 結果解説（テーマ × 軸 × 段階の固定文言） */
export function listResultTexts(): readonly ResultTextEntry[] {
  return DEMO_RESULT_TEXTS;
}

/** 活かし方の問い（テーマ × 場面） */
export function listGuidance(themeIds: readonly ThemeId[]): readonly GuidanceEntry[] {
  return DEMO_GUIDANCE.filter((entry) => themeIds.includes(entry.themeId));
}

/** 質問に対応する用語の説明 */
export function listGlossary(questionId: string): readonly GlossaryEntry[] {
  return DEMO_GLOSSARY[questionId] ?? [];
}
