// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { AppRoutes as VisitorRoutes } from "./visitor/routes.js";

/*
 * モックデータの一部だけが提供されたときの表示を確認する（日程と候補者だけが提供された場合）。
 * 提供された項目のページだけがモックデータ表示になり、提供されていないページは空状態のまま、
 * ナビゲーションとホームからも外れたままになる。
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
  it("共通ナビゲーションに、提供されたページだけが戻る", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    expect(navigationHrefs()).toEqual(["/", "/schedule", "/candidates"]);
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
  });

  it("ホームは、提供されたページの入口だけを表示し、「準備中」の表示は出さない", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/test-candidate-a",
    ]);
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("選挙に関する情報は準備中です")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "診断をはじめる" })).toHaveAttribute("href", "/values");
  });
});
