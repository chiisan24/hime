// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { AppRoutes as VisitorRoutes } from "./visitor/routes.js";

/*
 * モックデータの一部だけが提供されたときの表示を確認する（日程と候補者だけが提供された場合）。
 * 提供された項目のページだけがモックデータ表示になり、提供されていないページは「開発中」の空状態になる。
 * ナビゲーションとホームの入口は、提供されていないページの分も残る。
 * 下の値はテストのためだけの仮の文字列で、アプリのデータには入らない。
 */
vi.mock("../data/mock/electionMockData.js", () => ({
  ELECTION_MOCK_DATA: {
    schedule: {
      election: {
        electionId: "test-election",
        name: "テスト用の選挙",
        electionDate: "2030-01-06",
      },
    },
    candidates: [{ candidateId: "test-candidate-a", name: "テスト候補者Aさん" }],
  },
}));

const NOTICE_TEXT = "モックデータ（試作用の仮データ）で表示しています。公式の情報ではありません。";

beforeAll(() => {
  window.scrollTo = () => undefined;
});

function navigationHrefs(): (string | null)[] {
  const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
  return within(navigation)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

describe("モックデータの一部だけが提供されたときの利用者向け画面", () => {
  it("共通ナビゲーションには、提供されていないページの項目も残る", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    expect(navigationHrefs()).toEqual(["/", "/schedule", "/candidates", "/comparison", "/venue"]);
  });

  it.each([
    { path: "/schedule", heading: "選挙日程", text: "テスト用の選挙" },
    { path: "/candidates", heading: "候補者一覧", text: "テスト候補者Aさん" },
    { path: "/candidates/test-candidate-a", heading: "候補者詳細", text: "テスト候補者Aさん" },
  ])("$path はモックデータを表示する", ({ path, heading, text }) => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
    expect(document.querySelector("[data-election-demo-status='mock-data']")).not.toBeNull();
  });

  it.each([
    { path: "/comparison", heading: "政策比較" },
    { path: "/venue", heading: "会場閲覧" },
  ])("提供されていない $path は、空状態のままになる", ({ path, heading }) => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: [path] });

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "表示できる情報はまだありません" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument();
    expect(document.querySelector("[data-election-demo-status='no-data']")).not.toBeNull();
  });

  it("ホームは、すべての入口を表示し、提供されていないページの入口だけに「開発中」と示す", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/test-candidate-a",
      "/comparison",
      "/venue",
    ]);
    // 「開発中」は、提供されていない政策比較と会場閲覧の入口の2つだけ
    expect(within(menu).getAllByText("開発中")).toHaveLength(2);
    expect(within(menu).getByRole("link", { name: "政策比較を見る" })).toHaveAccessibleDescription(
      "政策の違いを見る、開発中",
    );
    expect(within(menu).getByRole("link", { name: "選挙日程を見る" })).toHaveAccessibleDescription(
      "投票日を確認",
    );
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("選挙に関する情報は準備中です")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "診断をはじめる" })).toHaveAttribute("href", "/values");
  });
});
