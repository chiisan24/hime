// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import {
  getActivePastElection,
  getElectionDataSource,
  isElectionPageAvailable,
  listActiveCandidates,
} from "../services/electionData.js";
import { CANDIDATE_SKELETONS } from "./public/pages.js";
import { AppRoutes as VisitorRoutes } from "./visitor/routes.js";

/*
 * 利用者向けの公開ビルドと同じ組み合わせ（#past-election が、過去の選挙を含まない差し替えの
 * public/pastElectionExcluded.ts）での表示を確認する。公開ビルドに過去の選挙のデータが入らないことは
 * config/buildBoundary.test.ts でビルドの成果物を調べて確認し、ここでは画面の動きを確認する。
 * 設定を PAST_REAL に書き換えても、過去の選挙の画面・データと、共通の枠の過去の選挙の表示
 * （過去選挙の帯・データ種別・フッター）を出さず、モックデータ（未提供）の画面を表示する。
 */
vi.mock("../data/electionDataSource.js", () => ({ ELECTION_DATA_SOURCE: "PAST_REAL" }));
vi.mock("#past-election", () => import("./public/pastElectionExcluded.js"));

const PAST_ELECTION_DATA = /2022|令和4年|第20回|中村|林紀子|nakamura|hayashi|過去選挙|実資料/iu;
const ELECTION_PAGES = [
  { path: "/schedule", heading: "選挙日程" },
  { path: "/candidates", heading: "候補者一覧" },
  { path: "/candidates/nakamura-tokihiro", heading: "候補者詳細" },
  { path: "/comparison", heading: "政策比較" },
  { path: "/venue", heading: "会場閲覧" },
] as const;

beforeAll(() => {
  // jsdom は window.scrollTo を実装していない
  window.scrollTo = () => undefined;
});

function expectNoPastElection() {
  expect(document.body.textContent).not.toMatch(PAST_ELECTION_DATA);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
}

describe("過去の選挙を含まないビルドで、設定を PAST_REAL にしたとき", () => {
  it("過去の選挙は使えず、モックデータを使う", () => {
    expect(getActivePastElection()).toBeNull();
    expect(getElectionDataSource()).toBe("MOCK");
    expect(listActiveCandidates()).toEqual([]);
    expect(isElectionPageAvailable("schedule")).toBe(false);
    expect(CANDIDATE_SKELETONS).toEqual([]);
  });

  it.each(ELECTION_PAGES)(
    "$path は、モックデータが未設定の空状態を表示し、過去の選挙を表示しない",
    ({ path, heading }) => {
      renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: "表示できる情報はまだありません" }),
      ).toBeInTheDocument();
      expect(document.querySelector("[data-election-demo-status='no-data']")).not.toBeNull();
      expectNoPastElection();
    },
  );

  it("ホームは、選挙関連の4つの入口に「開発中」と示し、過去の選挙の情報を出さない", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/comparison",
      "/venue",
    ]);
    expect(within(menu).getAllByText("開発中")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "選挙情報" })).toHaveTextContent("デモ用データ未設定");
    expectNoPastElection();
  });

  it.each(["/values", "/values/v2", "/not-a-route"])("%s にも、過去の選挙の表示を出さない", (path) => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expectNoPastElection();
  });
});
