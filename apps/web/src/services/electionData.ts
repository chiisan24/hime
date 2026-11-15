import { PAST_ELECTION } from "#past-election";

import type { PastElection } from "../app/public/pastElectionTypes.js";
import { ELECTION_DATA_SOURCE, type ElectionDataSource } from "../data/electionDataSource.js";
import { ELECTION_MOCK_DATA } from "../data/mock/electionMockData.js";
import type { ElectionMockData } from "../data/mock/types.js";
import type { CandidateSummary } from "../data/types.js";

/*
 * 選挙関連ページ（選挙日程・候補者・政策比較・会場閲覧）の表示データを選ぶ窓口。
 * 使うデータの種類は data/electionDataSource.ts の設定で決まる。読み込みの経路は種類ごとに分ける。
 * - MOCK      : data/mock/ のモックデータ。提供された項目のページだけが「表示できる」ページになる。
 * - PAST_REAL : 過去の選挙の既存データ。#past-election（vite.config.ts）からだけ読み込む。
 *               すべてのページが「表示できる」ページになる。
 *               利用者向けのビルドには過去の選挙が含まれない（PAST_ELECTION が null）ため、
 *               設定が PAST_REAL でもモックデータを使う。
 * 各ページとホームのカードは、表示できるかどうか（モックデータ表示か、開発中の空状態か）をここで判定する。
 * ナビゲーションとホームの入口は、表示できるかどうかにかかわらず残す。
 * projectAvailableElectionDestinations は、入口を外す必要が出たときのために残している（今は画面から使っていない）。
 */

export type ElectionPageId = "schedule" | "candidates" | "comparison" | "venue";

/**
 * 表示する過去の選挙（画面と表示データ）。設定が PAST_REAL で、このビルドに過去の選挙が
 * 含まれるときだけ返す。それ以外は null で、選挙関連ページはモックデータで表示する。
 */
export function getActivePastElection(): PastElection | null {
  return ELECTION_DATA_SOURCE === "PAST_REAL" ? PAST_ELECTION : null;
}

/** 実際に表示に使うデータの種類（このビルドで使えない PAST_REAL は MOCK になる） */
export function getElectionDataSource(): ElectionDataSource {
  return getActivePastElection() === null ? "MOCK" : "PAST_REAL";
}

export function getMockElectionData(): ElectionMockData {
  return ELECTION_MOCK_DATA;
}

/** そのページに表示するデータが、いま選んでいるデータの種類で提供されているか */
export function isElectionPageAvailable(page: ElectionPageId): boolean {
  if (getElectionDataSource() === "PAST_REAL") {
    return true;
  }

  const mock = getMockElectionData();
  switch (page) {
    case "schedule":
      return mock.schedule !== undefined;
    case "candidates":
      return (mock.candidates?.length ?? 0) > 0;
    case "comparison":
      return (mock.comparison?.themes.length ?? 0) > 0;
    case "venue":
      return (mock.venue?.sections.length ?? 0) > 0;
  }
}

const DESTINATION_PAGES: Readonly<Record<string, ElectionPageId>> = {
  "/schedule": "schedule",
  "/candidates": "candidates",
  "/comparison": "comparison",
  "/venue": "venue",
};
const CANDIDATE_DETAIL_PREFIX = "/candidates/";

/** React Router と同じ規則（大文字小文字を区別しない、末尾の / を許す）で行き先を正規化する */
function normalizedPathname(to: string): string {
  const pathname = to.split(/[?#]/u, 1)[0] ?? "";
  const withoutTrailingSlash = pathname.replace(/\/+$/u, "");

  return (withoutTrailingSlash === "" ? "/" : withoutTrailingSlash).toLowerCase();
}

/** アプリ内の行き先が、どの選挙関連ページに当たるか。選挙関連でなければ undefined */
export function electionPageOfDestination(to: string): ElectionPageId | undefined {
  const pathname = normalizedPathname(to);

  return (
    DESTINATION_PAGES[pathname] ??
    (pathname.startsWith(CANDIDATE_DETAIL_PREFIX) ? "candidates" : undefined)
  );
}

/** 選挙関連でない行き先は常に true。選挙関連の行き先は、そのページが表示できるときだけ true */
export function isElectionDestinationAvailable(to: string): boolean {
  const page = electionPageOfDestination(to);

  return page === undefined || isElectionPageAvailable(page);
}

/**
 * ナビゲーションとホームの項目から、表示できない選挙関連ページへの項目を外す。
 * 残す項目は、元の順序とオブジェクトのまま返す。
 */
export function projectAvailableElectionDestinations<T extends Readonly<{ to: string }>>(
  items: readonly T[],
): readonly T[] {
  return items.filter((item) => isElectionDestinationAvailable(item.to));
}

/** いま選んでいるデータの種類で表示する候補者 */
export function listActiveCandidates(): readonly CandidateSummary[] {
  const pastElection = getActivePastElection();
  if (pastElection !== null) {
    return pastElection.candidates;
  }

  return (getMockElectionData().candidates ?? []).map(({ candidateId, name }) => ({
    candidateId,
    name,
  }));
}

export function candidateDetailPath(candidateId: string): string {
  return `${CANDIDATE_DETAIL_PREFIX}${encodeURIComponent(candidateId)}`;
}
