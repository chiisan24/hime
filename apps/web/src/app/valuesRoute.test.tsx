// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { AppRoutes as AnalystAppRoutes } from "./analyst/routes.js";
import { AppRoutes as VisitorAppRoutes } from "./visitor/routes.js";

/*
 * 価値観診断（/values）を既存アプリに追加したときの動作（regional-values-map tasks.md 14 の案Bの承認記録）。
 * - /values では2022年選挙専用の表示（過去選挙表示・データ種別・フッター）を出さない。
 * - ローカル限定表示、共通ナビ（5項目）、戻る操作は保つ。
 * - ホームの入口カードから診断を始め、6問に答えて、デモ用の固定結果を表示できる。
 */

const LOCAL_ONLY_TEXT = "デモ版・コンテスト審査用の試作アプリです";
const PAST_ELECTION_TEXT =
  "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません";
const FOOTER_NOT_READY_TEXT = "政策解析準備状態: NOT_READY";
const VISITOR_NAV_HREFS = ["/", "/schedule", "/candidates", "/comparison", "/venue"];

beforeAll(() => {
  // jsdom は window.scrollTo と <dialog> の showModal / close を実装していないため、最小限の代わりを置く
  window.scrollTo = () => undefined;
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function navigationHrefs(): (string | null)[] {
  const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
  return within(navigation)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function expectElectionIndependentShell() {
  expect(screen.getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(screen.queryByText(PAST_ELECTION_TEXT)).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(FOOTER_NOT_READY_TEXT);
  expect(screen.getByRole("note")).toHaveTextContent("デモ用の架空データです");
  expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute("href", "#main-content");
  expect(
    screen.getByRole("button", { name: "前の画面に戻る。履歴がない場合はホームへ移動" }),
  ).toBeInTheDocument();
}

function expectElectionShell() {
  expect(screen.getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(screen.getByText(PAST_ELECTION_TEXT)).toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind='REAL_AI']")).toHaveLength(1);
  expect(screen.getByRole("contentinfo")).toHaveTextContent(FOOTER_NOT_READY_TEXT);
}

function nextButton() {
  return screen.getByRole("button", { name: /次の質問へ|結果を見る/u });
}

describe("価値観診断のルート（/values）", () => {
  it.each([
    { mode: "visitor", Routes: VisitorAppRoutes },
    { mode: "analyst", Routes: AnalystAppRoutes },
  ])("$mode モードで /values に診断の開始画面を出し、選挙専用の表示を出さない", ({ Routes }) => {
    renderWithRouter(<Routes />, { initialEntries: ["/values"] });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
    expectElectionIndependentShell();
    // 共通ナビは既存の項目のまま（/values の項目は足さない）
    expect(navigationHrefs().slice(0, 5)).toEqual(VISITOR_NAV_HREFS);
    expect(navigationHrefs()).not.toContain("/values");
  });

  it.each(["/values/", "/Values", "/VALUES/"])(
    "%s も React Router と同じ規則で同じ画面として扱う",
    (path) => {
      renderWithRouter(<VisitorAppRoutes />, { initialEntries: [path] });
      expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
      expectElectionIndependentShell();
    },
  );

  it.each(["/", "/schedule", "/candidates", "/comparison", "/venue", "/not-a-p0-route"])(
    "既存の %s では、選挙専用の表示を今までどおり出す",
    (path) => {
      renderWithRouter(<VisitorAppRoutes />, { initialEntries: [path] });
      expectElectionShell();
    },
  );

  it("/values の下の未定義のURLは、選挙の表示を保った404にする", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/values/extra"] });
    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expectElectionShell();
  });
});

describe("ホーム画面の価値観診断の入口", () => {
  it("主要機能のメニューより前に入口カードを置き、既存のメニューを残す", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });

    const card = screen.getByRole("region", { name: "価値観診断をはじめる" });
    expect(card).toHaveTextContent("愛媛の地域課題について答えて、自分が大切にしていることを整理しよう。");
    expect(within(card).getByRole("link", { name: "診断をはじめる" })).toHaveAttribute("href", "/values");

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    // 入口カードは、文書の順序でメニューより前にある
    expect(card.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/nakamura-tokihiro",
      "/candidates/hayashi-noriko",
      "/comparison",
      "/venue",
    ]);
    expect(navigationHrefs()).toEqual(VISITOR_NAV_HREFS);
  });

  it("入口カードから診断を始め、6問に答えるとデモ用の固定結果を表示する", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });

    fireEvent.click(screen.getByRole("link", { name: "診断をはじめる" }));
    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
    expectElectionIndependentShell();

    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    const answers = ["とても大切", "どちらかといえばB", "わからない", "Aに近い", "大切", "回答しない"];
    answers.forEach((label, index) => {
      expect(screen.getByText(/6問中/u)).toHaveTextContent(`6問中 ${index + 1}問目`);
      fireEvent.click(screen.getByRole("radio", { name: label }));
      fireEvent.click(nextButton());
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "あなたの価値観マップ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/デモ用の固定結果です。あなたの回答から計算したものではありません/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "大切さ" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "優先条件" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/一致率|ランキング|[0-9０-９]+位/u);
    expectElectionIndependentShell();

    // 回答はブラウザーの保存領域に書き込まない
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("診断画面から戻る操作で、選挙の表示があるホームに戻る", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });
    fireEvent.click(screen.getByRole("link", { name: "診断をはじめる" }));
    fireEvent.click(
      screen.getByRole("button", { name: "前の画面に戻る。履歴がない場合はホームへ移動" }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" })).toBeInTheDocument();
    expectElectionShell();
  });
});
