import type { ElectionPhase } from "../data/types.js";

/*
 * 選挙の状態を日本標準時で判定する（Req 18.1、18.3）。
 * - 投票日の前日まで: PLANNED（予定）
 * - 投票日当日: ONGOING（実施中）
 * - 投票日の翌日 0:00 以降: ENDED（終了）
 * 期日前投票期間は一次情報が未登録のため、実施中の判定には使わない。
 *
 * 共同開発者の選挙レジストリ（config/election/elections.json）の status とは別の、画面表示用の判定。
 * レジストリの "CURRENT" は「解析の対象として選んでいる選挙」の意味で、開催中という意味ではない。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** その時刻の日本標準時の日付（YYYY-MM-DD） */
function jstDate(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function electionPhaseAt(electionDate: string, now: Date): ElectionPhase {
  const today = jstDate(now);
  if (today < electionDate) {
    return "PLANNED";
  }
  return today === electionDate ? "ONGOING" : "ENDED";
}

export const ELECTION_PHASE_LABELS: Readonly<Record<ElectionPhase, string>> = {
  PLANNED: "予定",
  ONGOING: "実施中",
  ENDED: "終了済み",
};
