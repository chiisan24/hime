/*
 * 利用者向け画面で使う表示用の型。
 * API のレスポンス形式ではない。API の形式は共同開発者と決めるまで確定させず、
 * 接続するときは services/ の関数の中でこの型へ変換する。
 */

/** 表示する選挙の基本情報 */
export type ElectionSummary = Readonly<{
  electionId: string;
  name: string;
  /** 投票日（YYYY-MM-DD、日本標準時の日付） */
  electionDate: string;
}>;

/** 選挙の状態（日本標準時で判定する） */
export type ElectionPhase = "PLANNED" | "ONGOING" | "ENDED";

/** 一覧と詳細で使う候補者の識別情報 */
export type CandidateSummary = Readonly<{
  candidateId: string;
  /** 画面に出す氏名（敬称付き） */
  name: string;
}>;
