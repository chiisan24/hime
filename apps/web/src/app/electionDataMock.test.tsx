// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { AppRoutes as VisitorRoutes } from "./visitor/routes.js";

/*
 * モックデータが提供されたときの表示を確認する（4ページすべてが提供された場合）。
 * 設定は出荷時のまま（MOCK）で、モックデータの中身だけを、テスト用の値に差し替える。
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
      votingHours: "テスト用の投票時間",
      earlyVoting: "テスト用の期日前投票の期間",
      note: "テスト用の日程の補足",
    },
    candidates: [
      {
        candidateId: "test-candidate-a",
        name: "テスト候補者Aさん",
        party: "テスト党派A",
        summary: "テスト用の政策の要約A",
      },
      { candidateId: "test-candidate-b", name: "テスト候補者Bさん", profile: "テスト用の経歴B" },
    ],
    comparison: {
      themes: ["テスト用テーマ1", "テスト用テーマ2"],
      entries: [
        { candidateId: "test-candidate-a", theme: "テスト用テーマ1", summary: "テーマ1のAの内容" },
        { candidateId: "test-candidate-b", theme: "テスト用テーマ1", summary: "テーマ1のBの内容" },
      ],
    },
    venue: {
      sections: [{ heading: "テスト用の会場の見出し", body: "テスト用の会場の本文" }],
    },
  },
}));

const NOTICE_TEXT = "モックデータ（試作用の仮データ）で表示しています。公式の情報ではありません。";
const PAST_ELECTION_DATA = /2022|令和4年|第20回|中村|林紀子|nakamura|hayashi|過去選挙|実資料/iu;

beforeAll(() => {
  window.scrollTo = () => undefined;
});

function navigationHrefs(): (string | null)[] {
  const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
  return within(navigation)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function expectMockNoticeAndNoPastElectionData() {
  expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(PAST_ELECTION_DATA);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
  // 空状態ではない
  expect(document.querySelector("[data-terminal-state='no-data']")).toBeNull();
}

describe("モックデータが提供されたときの利用者向け画面", () => {
  it("共通ナビゲーションに、提供された選挙関連ページが戻る", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    expect(navigationHrefs()).toEqual(["/", "/schedule", "/candidates", "/comparison", "/venue"]);
  });

  it("/schedule はモックデータの日程を、モックデータであることを示して表示する", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/schedule"] });

    expect(screen.getByRole("heading", { level: 1, name: "選挙日程" })).toBeInTheDocument();
    expect(screen.getByText("テスト用の選挙")).toBeInTheDocument();
    expect(screen.getByText("2030年1月6日（日）")).toBeInTheDocument();
    expect(screen.getByText("テスト用の投票時間")).toBeInTheDocument();
    expect(screen.getByText("テスト用の期日前投票の期間")).toBeInTheDocument();
    expect(screen.getByText("テスト用の日程の補足")).toBeInTheDocument();
    expectMockNoticeAndNoPastElectionData();
  });

  it("/candidates は提供された候補者だけを同じ形式で並べ、提供された項目だけを表示する", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/candidates"] });

    expect(screen.getByRole("heading", { level: 1, name: "候補者一覧" })).toBeInTheDocument();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("テスト党派A")).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).queryByText("党派", { selector: "dt" })).not.toBeNull();
    // 提供されていない項目の行は作らない（「資料で確認できません」などで埋めない）
    expect(within(cards[1] as HTMLElement).queryByText("党派", { selector: "dt" })).toBeNull();
    expect(within(cards[1] as HTMLElement).getByText("テスト用の経歴B")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "テスト候補者Aさんの候補者詳細へ移動" }),
    ).toHaveAttribute("href", "/candidates/test-candidate-a");
    expectMockNoticeAndNoPastElectionData();
  });

  it("/candidates/:candidateId は該当する候補者のモックデータを表示する", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/candidates/test-candidate-a"] });

    expect(screen.getByRole("heading", { level: 1, name: "候補者詳細" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "テスト候補者Aさん" })).toBeInTheDocument();
    expect(screen.getByText("テスト用の政策の要約A")).toBeInTheDocument();
    expectMockNoticeAndNoPastElectionData();
  });

  it("/candidates/:candidateId は、提供されていない候補者IDでは過去の候補者を出さず、該当なしを示す", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/candidates/nakamura-tokihiro"] });

    expect(screen.getByRole("heading", { level: 1, name: "候補者詳細" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "この候補者の情報はありません" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PAST_ELECTION_DATA);
  });

  it("/comparison はテーマごとに、提供された内容だけを候補者名つきで並べる", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/comparison"] });

    expect(screen.getByRole("heading", { level: 1, name: "政策比較" })).toBeInTheDocument();
    const theme1 = screen.getByRole("region", { name: "テスト用テーマ1" });
    expect(within(theme1).getByText("テスト候補者Aさん")).toBeInTheDocument();
    expect(within(theme1).getByText("テーマ1のAの内容")).toBeInTheDocument();
    expect(within(theme1).getByText("テーマ1のBの内容")).toBeInTheDocument();
    const theme2 = screen.getByRole("region", { name: "テスト用テーマ2" });
    expect(theme2).toHaveTextContent("このテーマの情報は提供されていません。");
    expectMockNoticeAndNoPastElectionData();
  });

  it("/venue はモックデータの見出しと本文を表示する", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/venue"] });

    expect(screen.getByRole("heading", { level: 1, name: "会場閲覧" })).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "テスト用の会場の見出し" });
    expect(section).toHaveTextContent("テスト用の会場の本文");
    expectMockNoticeAndNoPastElectionData();
  });

  it("ホームは提供されたページの入口と選挙情報を、モックデータであることを示して表示する", () => {
    renderWithRouter(<VisitorRoutes />, { initialEntries: ["/"] });

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/test-candidate-a",
      "/candidates/test-candidate-b",
      "/comparison",
      "/venue",
    ]);
    expect(within(menu).getByRole("link", { name: "テスト候補者Aさんの詳細を見る" })).toBeInTheDocument();
    const info = screen.getByRole("region", { name: "選挙情報" });
    expect(info).toHaveTextContent("テスト用の選挙");
    expect(info).toHaveTextContent("2030年1月6日（日）");
    // 価値観診断の入口は残る
    expect(screen.getByRole("link", { name: "診断をはじめる" })).toHaveAttribute("href", "/values");
    // 「準備中」の表示は出ない
    expect(screen.queryByText("選挙に関する情報は準備中です")).not.toBeInTheDocument();
    expectMockNoticeAndNoPastElectionData();
  });
});
