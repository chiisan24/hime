import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElectionDataSource } from "../data/electionDataSource.js";
import type { ElectionMockData } from "../data/mock/types.js";
import {
  candidateDetailPath,
  electionPageOfDestination,
  isElectionDestinationAvailable,
  isElectionPageAvailable,
  listActiveCandidates,
  projectAvailableElectionDestinations,
  type ElectionPageId,
} from "./electionData.js";

/*
 * データの種類とモックデータの中身を、テストごとに差し替えて判定を確認する。
 * 下のモックデータの値はテストのためだけの仮の文字列で、アプリのデータには入らない。
 */
const state = vi.hoisted(() => ({
  source: "MOCK" as ElectionDataSource,
  mock: {} as ElectionMockData,
}));

vi.mock("../data/electionDataSource.js", () => ({
  get ELECTION_DATA_SOURCE() {
    return state.source;
  },
}));
vi.mock("../data/mock/electionMockData.js", () => ({
  get ELECTION_MOCK_DATA() {
    return state.mock;
  },
}));

const PAGES: readonly ElectionPageId[] = ["schedule", "candidates", "comparison", "venue"];
const SCHEDULE = {
  election: { electionId: "test-election", name: "テスト用の選挙", electionDate: "2030-01-06" },
} as const;

beforeEach(() => {
  state.source = "MOCK";
  state.mock = {};
});

describe("isElectionPageAvailable", () => {
  it("MOCK でモックデータが未提供なら、どのページも表示できない", () => {
    expect(PAGES.map((page) => isElectionPageAvailable(page))).toEqual([false, false, false, false]);
  });

  it("MOCK では、提供された項目のページだけが表示できる", () => {
    state.mock = {
      schedule: SCHEDULE,
      comparison: { themes: ["テスト用テーマ"], entries: [] },
    };

    expect(PAGES.map((page) => isElectionPageAvailable(page))).toEqual([true, false, true, false]);
  });

  it("MOCK では、空の候補者・テーマ・セクションは「提供された」とみなさない", () => {
    state.mock = {
      candidates: [],
      comparison: { themes: [], entries: [] },
      venue: { sections: [] },
    };

    expect(PAGES.map((page) => isElectionPageAvailable(page))).toEqual([false, false, false, false]);
  });

  it("PAST_REAL では、モックデータにかかわらずすべてのページが表示できる", () => {
    state.source = "PAST_REAL";

    expect(PAGES.map((page) => isElectionPageAvailable(page))).toEqual([true, true, true, true]);
  });
});

describe("electionPageOfDestination", () => {
  it.each([
    ["/schedule", "schedule"],
    ["/candidates", "candidates"],
    ["/candidates/some-id", "candidates"],
    ["/comparison", "comparison"],
    ["/venue", "venue"],
    // React Router と同じ規則: 末尾の /、大文字小文字、クエリ、ハッシュを区別しない
    ["/Schedule/", "schedule"],
    ["/CANDIDATES/Some-Id/", "candidates"],
    ["/venue?x=1#y", "venue"],
  ] as const)("%s は %s ページ", (to, page) => {
    expect(electionPageOfDestination(to)).toBe(page);
  });

  it.each(["/", "/values", "/analyst/readiness", "/sources", "/not-a-route", ""])(
    "%s は選挙関連ページではない",
    (to) => {
      expect(electionPageOfDestination(to)).toBeUndefined();
    },
  );
});

describe("isElectionDestinationAvailable と projectAvailableElectionDestinations", () => {
  const ITEMS = [
    { to: "/" },
    { to: "/schedule" },
    { to: "/candidates" },
    { to: "/candidates/test-candidate-a" },
    { to: "/comparison" },
    { to: "/venue" },
    { to: "/values" },
  ] as const;

  it("選挙関連でない行き先は、常に残る", () => {
    expect(isElectionDestinationAvailable("/")).toBe(true);
    expect(isElectionDestinationAvailable("/values")).toBe(true);
  });

  it("モックデータが未提供なら、選挙関連の項目だけが外れ、残りの順序と同一性が保たれる", () => {
    const projected = projectAvailableElectionDestinations(ITEMS);

    expect(projected.map(({ to }) => to)).toEqual(["/", "/values"]);
    expect(projected[0]).toBe(ITEMS[0]);
    expect(projected[1]).toBe(ITEMS[6]);
  });

  it("提供されたページの項目が戻る（候補者詳細は候補者ページと同じ扱い）", () => {
    state.mock = { candidates: [{ candidateId: "test-candidate-a", name: "テスト候補者Aさん" }] };

    expect(projectAvailableElectionDestinations(ITEMS).map(({ to }) => to)).toEqual([
      "/",
      "/candidates",
      "/candidates/test-candidate-a",
      "/values",
    ]);
  });

  it("PAST_REAL ではすべての項目が残る", () => {
    state.source = "PAST_REAL";

    expect(projectAvailableElectionDestinations(ITEMS)).toHaveLength(ITEMS.length);
  });
});

describe("listActiveCandidates", () => {
  it("MOCK でモックデータが未提供なら、候補者は0人", () => {
    expect(listActiveCandidates()).toEqual([]);
  });

  it("MOCK では、モックデータの候補者の識別子と氏名だけを返す", () => {
    state.mock = {
      candidates: [
        { candidateId: "test-candidate-a", name: "テスト候補者Aさん", party: "テスト党派" },
      ],
    };

    expect(listActiveCandidates()).toEqual([
      { candidateId: "test-candidate-a", name: "テスト候補者Aさん" },
    ]);
  });

  it("PAST_REAL では、過去の選挙の既存の候補者を返し、モックデータは混ぜない", () => {
    state.source = "PAST_REAL";
    state.mock = { candidates: [{ candidateId: "test-candidate-a", name: "テスト候補者Aさん" }] };

    expect(listActiveCandidates().map(({ candidateId }) => candidateId)).toEqual([
      "nakamura-tokihiro",
      "hayashi-noriko",
    ]);
  });
});

describe("candidateDetailPath", () => {
  it("識別子をURLの1区間として符号化する", () => {
    expect(candidateDetailPath("test-candidate-a")).toBe("/candidates/test-candidate-a");
    expect(candidateDetailPath("a/b c")).toBe("/candidates/a%2Fb%20c");
  });
});
