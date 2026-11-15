import type { ElectionSummary } from "../types.js";

/*
 * 選挙関連ページに差し替えるモックデータの型。
 * どの項目も省略でき、省略した画面は、既存のデザインのまま「表示できる情報はまだありません」の空状態になる。
 * 省略した項目を、画面が推測や架空の値で補うことはしない。
 */

/** 選挙日程ページ */
export type MockSchedule = Readonly<{
  election: ElectionSummary;
  /** 当日の投票時間（例: 「7時から20時まで」）。省略すると項目ごと表示しない */
  votingHours?: string;
  /** 期日前投票の期間。省略すると項目ごと表示しない */
  earlyVoting?: string;
  /** 補足の説明 */
  note?: string;
}>;

/** 候補者一覧と候補者詳細ページ */
export type MockCandidate = Readonly<{
  /** URL（/candidates/:candidateId）に使う識別子 */
  candidateId: string;
  /** 画面に出す氏名（敬称付き） */
  name: string;
  party?: string;
  profile?: string;
  /** 政策などの要約 */
  summary?: string;
}>;

/** 政策比較ページ。テーマごとに、候補者の要約を並べる */
export type MockComparisonEntry = Readonly<{
  candidateId: string;
  theme: string;
  summary: string;
}>;

export type MockComparison = Readonly<{
  themes: readonly string[];
  entries: readonly MockComparisonEntry[];
}>;

/** 会場閲覧ページ。見出しと本文の組を並べる */
export type MockVenueSection = Readonly<{
  heading: string;
  body: string;
}>;

export type MockVenue = Readonly<{
  sections: readonly MockVenueSection[];
}>;

export type ElectionMockData = Readonly<{
  schedule?: MockSchedule;
  candidates?: readonly MockCandidate[];
  comparison?: MockComparison;
  venue?: MockVenue;
}>;
