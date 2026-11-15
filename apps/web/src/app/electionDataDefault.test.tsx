// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { ELECTION_DATA_SOURCE } from "../data/electionDataSource.js";
import { ELECTION_MOCK_DATA } from "../data/mock/electionMockData.js";
import { AppRoutes as AnalystRoutes } from "./analyst/routes.js";
import { AppRoutes as VisitorRoutes } from "./visitor/routes.js";

/*
 * 出荷時の設定（モックデータ・未提供）での表示を確認する。
 * このファイルはデータの設定を差し替えない。設定が変わったときにも、この表示が崩れないことを守る。
 * - 過去の選挙（2022年）のデータが、どの画面にも出ない（URLを直接開いた場合を含む）。
 * - 選挙関連ページは空状態になり、ナビゲーションとホームの入口から外れる。
 * - 価値観診断の入口と画面は、これまでどおり使える。
 */

const PAST_ELECTION_DATA = /2022|令和4年|第20回|中村|林紀子|nakamura|hayashi|過去選挙|実資料/iu;
const ELECTION_PAGES = [
  { path: "/schedule", heading: "選挙日程" },
  { path: "/candidates", heading: "候補者一覧" },
  { path: "/candidates/nakamura-tokihiro", heading: "候補者詳細" },
  { path: "/candidates/hayashi-noriko", heading: "候補者詳細" },
  { path: "/comparison", heading: "政策比較" },
  { path: "/venue", heading: "会場閲覧" },
  // React Router と同じ規則（末尾の / と大文字小文字を区別しない）で開いても同じ
  { path: "/schedule/", heading: "選挙日程" },
  { path: "/Candidates", heading: "候補者一覧" },
  { path: "/COMPARISON", heading: "政策比較" },
] as const;

beforeAll(() => {
  // jsdom は window.scrollTo を実装していない
  window.scrollTo = () => undefined;
});

function navigationHrefs(): (string | null)[] {
  const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
  return within(navigation)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function expectNoPastElectionData() {
  expect(document.body.textContent).not.toMatch(PAST_ELECTION_DATA);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
}

describe("出荷時の設定", () => {
  it("モックデータを使い、モックデータは未提供である", () => {
    expect(ELECTION_DATA_SOURCE).toBe("MOCK");
    expect(ELECTION_MOCK_DATA).toEqual({});
  });
});

describe("利用者向け画面（visitor）", () => {
  it.each(ELECTION_PAGES)(
    "$path は空状態を表示し、過去の選挙のデータを表示しない",
    ({ path, heading }) => {
      renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: "表示できる情報はまだありません" }),
      ).toBeInTheDocument();
      expect(document.querySelector("[data-terminal-state='no-data']")).not.toBeNull();
      expect(document.querySelector("[data-mock-data-notice]")).toBeNull();
      expect(screen.getByRole("link", { name: /価値観診断をはじめる/u })).toHaveAttribute(
        "href",
        "/values",
      );
      // 公開形態の表示（デモ版）は残す
      expect(screen.getByText("デモ版・コンテスト審査用の試作アプリです")).toBeInTheDocument();
      expectNoPastElectionData();
    },
  );

  it("候補者詳細のURLに過去の候補者IDを入れても、IDも氏名も表示しない", () => {
    renderWithRouter(<VisitorRoutes />, {
      initialEntries: ["/candidates/nakamura-tokihiro?from=past#hayashi-noriko"],
    });

    expect(screen.getByRole("heading", { level: 1, name: "候補者詳細" })).toBeInTheDocument();
    expectNoPastElectionData();
  });

  it.each(["/", ...ELECTION_PAGES.map(({ path }) => path), "/values", "/not-a-route"])(
    "%s の共通ナビゲーションは、選挙関連ページの項目を外してホームだけを残す",
    (path) => {
      renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

      expect(navigationHrefs()).toEqual(["/"]);
    },
  );

  it("ホームは価値観診断の入口を残し、選挙関連の入口と過去の選挙の情報を出さない", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    expect(screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "価値観診断をはじめる" });
    expect(within(card).getByRole("link", { name: "診断をはじめる" })).toHaveAttribute(
      "href",
      "/values",
    );
    expect(screen.queryByRole("region", { name: "会場閲覧のP0画面" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "選挙に関する情報は準備中です" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-mock-data-notice]")).toBeNull();

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
    expect(
      hrefs.filter((href) => /^\/(?:schedule|candidates|comparison|venue)/u.test(href)),
    ).toEqual([]);
    expectNoPastElectionData();
  });

  it("存在しないURLは、過去の選挙の表示がない404になる", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/not-a-route"] });

    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expectNoPastElectionData();
  });

  it("価値観診断（/values）は、これまでどおり使える", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/values"] });

    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /診断をはじめる/u })).toBeInTheDocument();
    expectNoPastElectionData();
  });

  it("ホームの入口から価値観診断の画面へ進める", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    fireEvent.click(screen.getByRole("link", { name: "診断をはじめる" }));

    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
  });

  it("空状態のページからも、価値観診断の画面へ進める", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/schedule"] });

    fireEvent.click(screen.getByRole("link", { name: /価値観診断をはじめる/u }));

    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
  });
});

describe("分析者向け画面（analyst）でも、選挙関連ページに過去の選挙のデータを出さない", () => {
  it.each(ELECTION_PAGES)("$path は空状態を表示する", ({ path, heading }) => {
    renderWithRouter(<AnalystRoutes />, { initialEntries: [path] });

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "表示できる情報はまだありません" }),
    ).toBeInTheDocument();
    expectNoPastElectionData();
  });

  it("共通ナビゲーションは、ホームと分析状態だけになる", () => {
    renderWithRouter(<AnalystRoutes />, { initialEntries: ["/analyst/readiness"] });

    expect(navigationHrefs()).toEqual(["/", "/analyst/readiness"]);
  });
});
