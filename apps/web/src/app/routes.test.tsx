// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { App } from "../App.js";

const P0_ROUTE_CASES = [
  { path: "/", heading: "えひめ投票ナビ" },
  { path: "/schedule", heading: "選挙日程" },
  { path: "/candidates", heading: "候補者一覧" },
  { path: "/candidates/nakamura-tokihiro", heading: "候補者詳細" },
  { path: "/comparison", heading: "政策比較" },
  { path: "/sources", heading: "出典一覧" },
  { path: "/venue", heading: "会場閲覧" },
  { path: "/analyst/readiness", heading: "政策解析準備状態" },
  { path: "/analyst/sources", heading: "Source Manifest" },
  { path: "/analyst/runs", heading: "解析実行と履歴" },
  { path: "/analyst/runs/run-example", heading: "解析run詳細" },
  {
    path: "/analyst/verification/artifact-example",
    heading: "根拠検証",
  },
  { path: "/analyst/review/artifact-example", heading: "人間確認" },
  { path: "/analyst/evaluation", heading: "評価" },
  { path: "/analyst/p0", heading: "P0完成判定" },
  { path: "/analyst/aws", heading: "AWS診断" },
] as const;

const HOME_ROUTE_LINK_CASES = [
  { link: "選挙日程を見る", heading: "選挙日程" },
  { link: "候補者一覧を見る", heading: "候補者一覧" },
  { link: "中村時広氏の詳細を見る", heading: "候補者詳細" },
  { link: "林紀子氏の詳細を見る", heading: "候補者詳細" },
  { link: "政策比較を見る", heading: "政策比較" },
  { link: "出典一覧を見る", heading: "出典一覧" },
  { link: "会場閲覧画面を見る", heading: "会場閲覧" },
  { link: "解析準備状態を見る", heading: "政策解析準備状態" },
  { link: "Source Manifest画面を見る", heading: "Source Manifest" },
  { link: "解析実行と履歴を見る", heading: "解析実行と履歴" },
  { link: "評価画面を見る", heading: "評価" },
  { link: "P0完成判定を見る", heading: "P0完成判定" },
  { link: "AWS診断画面を見る", heading: "AWS診断" },
] as const;

const FUTURE_ROUTE_CASES = [
  "/polling-place/election-day",
  "/polling-place/early",
  "/chat",
  "/voting-guide",
  "/three-dimensional-policy",
  "/notifications",
  "/speech",
  "/calendar",
] as const;

const CANDIDATE_LIST_FIELDS = [
  "氏名",
  "情報源上の氏名表記",
  "党派",
  "選挙結果",
  "出典",
  "最終更新日",
] as const;

const CANDIDATE_DETAIL_FIELDS = [
  "氏名",
  "情報源上の氏名表記",
  "党派",
  "経歴",
  "採用資料",
  "資料量",
  "出典",
  "最終更新日",
] as const;

const COMPARISON_FIELDS = [
  "対象",
  "内容",
  "条件",
  "例外",
  "否定",
  "実施段階",
  "期限",
  "根拠リンク",
  "自動状態",
  "人間状態",
] as const;

describe("P0 route skeleton", () => {
  it.each(P0_ROUTE_CASES)(
    "registers $path inside one persistent shell",
    ({ path, heading }) => {
      renderWithRouter(<App />, { initialEntries: [path] });

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
      expect(
        screen.getByRole("navigation", { name: "共通ナビゲーション" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("会場ローカルデモ・一般公開ではありません"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("データ種別: 2022年実資料・AI解析")).toHaveAttribute(
        "data-kind",
        "REAL_AI",
      );
      expect(
        screen.queryByText("データ種別: 架空fixture・UIテスト専用"),
      ).not.toBeInTheDocument();
    },
  );

  it.each(HOME_ROUTE_LINK_CASES)(
    "reaches $heading from the Home link $link",
    ({ link, heading }) => {
      renderWithRouter(<App />);

      fireEvent.click(screen.getByRole("link", { name: link }));

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
    },
  );

  it("provides a skip link, landmarks, common navigation, and current route", () => {
    renderWithRouter(<App />, { initialEntries: ["/candidates/nakamura-tokihiro"] });

    expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", {
      name: "共通ナビゲーション",
    });
    expect(within(navigation).getByRole("link", { name: "候補者" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("uses the candidateId segment and the same detail route structure", () => {
    renderWithRouter(<App />, { initialEntries: ["/candidates"] });

    fireEvent.click(
      screen.getByRole("link", {
        name: "中村時広氏の候補者詳細へ移動",
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/候補者ID:/)).toHaveTextContent(
      "nakamura-tokihiro",
    );
    for (const field of CANDIDATE_DETAIL_FIELDS) {
      expect(
        within(screen.getByRole("main")).getByText(field),
      ).toBeInTheDocument();
    }
  });

  it("moves back exactly once to the immediately previous in-app route", () => {
    renderWithRouter(<App />);

    fireEvent.click(screen.getByRole("link", { name: "候補者一覧を見る" }));
    fireEvent.click(
      screen.getByRole("link", {
        name: "林紀子氏の候補者詳細へ移動",
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /前の画面に戻る/ }));

    expect(
      screen.getByRole("heading", { level: 1, name: "候補者一覧" }),
    ).toBeInTheDocument();
  });

  it("falls back to Home when the current route was entered directly", () => {
    renderWithRouter(<App />, { initialEntries: ["/analyst/aws"] });

    fireEvent.click(screen.getByRole("button", { name: /前の画面に戻る/ }));

    expect(
      screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
    ).toBeInTheDocument();
  });

  it("shows a shell-preserving 404 with a Home link", () => {
    renderWithRouter(<App />, { initialEntries: ["/not-a-p0-route"] });

    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームへ移動" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByText("会場ローカルデモ・一般公開ではありません"),
    ).toBeInTheDocument();
  });

  it.each(FUTURE_ROUTE_CASES)("keeps the P1/P2 route %s unregistered", (path) => {
    renderWithRouter(<App />, { initialEntries: [path] });

    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
  });
});

describe("candidate and comparison fail-closed frames", () => {
  it("uses equal candidate cards and neutral common photo placeholders", () => {
    renderWithRouter(<App />, { initialEntries: ["/candidates"] });

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toBe(cards[1]?.className);

    for (const card of cards) {
      const cardView = within(card);
      expect(
        cardView.getByRole("img", {
          name: "候補者写真の共通プレースホルダー",
        }),
      ).toBeInTheDocument();
      for (const field of CANDIDATE_LIST_FIELDS) {
        expect(cardView.getByText(field)).toBeInTheDocument();
      }
    }
  });

  it.each([
    "/candidates",
    "/candidates/nakamura-tokihiro",
    "/candidates/hayashi-noriko",
    "/comparison",
  ])("keeps %s in NOT_READY without simulated AI progress", (path) => {
    renderWithRouter(<App />, { initialEntries: [path] });

    expect(screen.getAllByText("NOT_READY").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/解析中|生成中/u)).not.toBeInTheDocument();
  });

  it.each([
    "/candidates/nakamura-tokihiro",
    "/candidates/hayashi-noriko",
  ])("uses the complete common detail field order at %s", (path) => {
    renderWithRouter(<App />, { initialEntries: [path] });

    for (const field of CANDIDATE_DETAIL_FIELDS) {
      expect(
        within(screen.getByRole("main")).getByText(field),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("img", { name: "候補者写真の共通プレースホルダー" }),
    ).toBeInTheDocument();
  });

  it("shows only equal future comparison fields while the table is NOT_READY", () => {
    renderWithRouter(<App />, { initialEntries: ["/comparison"] });

    const candidateFrames = screen.getAllByRole("article");
    expect(candidateFrames).toHaveLength(2);
    expect(candidateFrames[0]?.className).toBe(candidateFrames[1]?.className);

    for (const frame of candidateFrames) {
      const frameView = within(frame);
      for (const field of COMPARISON_FIELDS) {
        expect(frameView.getByText(field)).toBeInTheDocument();
      }
      expect(frameView.getAllByText("NOT_READY")).toHaveLength(
        COMPARISON_FIELDS.length,
      );
    }
  });
});
