// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// 過去の選挙（2022年）の既存の表示を確認するテスト。
// 選挙データの設定を PAST_REAL にして、既存の期待値を変えずに検証する。
// 既定の設定（MOCK）の表示は electionDataDefault.test.tsx と electionDataMock.test.tsx で確認する。
vi.mock("../data/electionDataSource.js", () => ({ ELECTION_DATA_SOURCE: "PAST_REAL" }));

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import { AppRoutes as AnalystAppRoutes } from "./analyst/routes.js";
import { AppRoutes as VisitorAppRoutes } from "./visitor/routes.js";

/*
 * 地域課題ジレンマ診断（v2）のデモを、/values（v1）とは別のルート /values/v2 に置いたときの動作
 * （regional-values-map records/values-v2-axis-analysis.md の10の方針確認5。正式な承認の記録はまだない）。
 * - /values は v1 のまま。/values/v2 では v2 の開始画面を出す。
 * - /values/v2 でも、2022年選挙専用の表示（過去選挙表示・データ種別・フッター）を出さない。
 *   ローカル限定表示、共通ナビ（5項目）、戻る操作は保つ。共通ナビに v2 の項目は足さない。
 * - 架空のデモ用の質問であることと、中立性の点検前であることを出す。
 * - ホームの v2 の入口カードから診断を始め、結果画面で、回答から計算した六角形の価値観レーダーを見られる。
 */

const LOCAL_ONLY_TEXT = "デモ版・コンテスト審査用の試作アプリです";
const PAST_ELECTION_TEXT =
  "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません";
const FOOTER_NOT_READY_TEXT = "政策解析準備状態: NOT_READY";
const DEMO_DATA_TEXT = "デモ用の架空データです";
const VISITOR_NAV_HREFS = ["/", "/schedule", "/candidates", "/comparison", "/venue"];
const BACK_CONTROL_NAME = "前の画面に戻る。履歴がない場合はホームへ移動";
const V2_PATH = "/values/v2";
const V2_HEADING = "地域課題ジレンマ診断";
const V2_CARD_NAME = "地域課題ジレンマ診断（試作）";
const V2_HOME_LINK = "ジレンマ診断の試作版を見る";

const MODES = [
  { mode: "visitor", Routes: VisitorAppRoutes },
  { mode: "analyst", Routes: AnalystAppRoutes },
] as const;

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

function sharedNavigation(): HTMLElement {
  return screen.getByRole("navigation", { name: "共通ナビゲーション" });
}

function navigationHrefs(): (string | null)[] {
  return within(sharedNavigation())
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function currentNavigationHrefs(): (string | null)[] {
  return within(sharedNavigation())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));
}

function expectElectionIndependentShell() {
  expect(screen.getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(screen.queryByText(PAST_ELECTION_TEXT)).not.toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(FOOTER_NOT_READY_TEXT);
  expect(screen.getByRole("note")).toHaveTextContent(DEMO_DATA_TEXT);
  expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute("href", "#main-content");
  expect(screen.getByRole("button", { name: BACK_CONTROL_NAME })).toBeInTheDocument();
}

function expectElectionShell() {
  expect(screen.getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(screen.getByText(PAST_ELECTION_TEXT)).toBeInTheDocument();
  expect(document.querySelectorAll("[data-kind='REAL_AI']")).toHaveLength(1);
  expect(screen.getByRole("contentinfo")).toHaveTextContent(FOOTER_NOT_READY_TEXT);
}

/** 架空のデモ用の質問であることと、中立性の点検前であることの表示 */
function expectDemoAndNeutralityLabels() {
  expect(screen.getByRole("note")).toHaveTextContent(DEMO_DATA_TEXT);
  expect(within(screen.getByRole("main")).getByText("デモ版")).toBeInTheDocument();
  expect(document.querySelector("[data-provisional-axes='true']")).toHaveTextContent("中立性の点検前");
}

function choose(labelStart: string) {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${labelStart}：`, "u") }));
}

function nextButton() {
  return screen.getByRole("button", { name: /次の質問へ|結果を見る/u });
}

describe("地域課題ジレンマ診断（v2）のルート（/values/v2）", () => {
  it.each(MODES)("$mode モードで /values/v2 に v2 の開始画面を出し、選挙専用の表示を出さない", ({ Routes }) => {
    renderWithRouter(<Routes />, { initialEntries: [V2_PATH] });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: V2_HEADING })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /診断をはじめる/u })).toBeInTheDocument();
    expectElectionIndependentShell();
    expectDemoAndNeutralityLabels();
    expect(screen.getByText(/画面を確かめるための架空のデモ用の質問です/u)).toBeInTheDocument();
    // 共通ナビは既存の項目のまま（/values と /values/v2 の項目は足さない）。どの項目も現在地にしない
    expect(navigationHrefs().slice(0, 5)).toEqual(VISITOR_NAV_HREFS);
    expect(navigationHrefs()).not.toContain("/values");
    expect(navigationHrefs()).not.toContain(V2_PATH);
    expect(currentNavigationHrefs()).toEqual([]);
  });

  it.each(MODES)("$mode モードの /values は、これまでどおり v1 の価値観マップのまま", ({ Routes }) => {
    renderWithRouter(<Routes />, { initialEntries: ["/values"] });

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "価値観マップ" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: V2_HEADING })).not.toBeInTheDocument();
    expect(document.querySelector("[data-provisional-axes]")).toBeNull();
    expectElectionIndependentShell();
  });

  it.each(["/values/v2/", "/Values/V2", "/VALUES/v2/"])(
    "%s も React Router と同じ規則で v2 の画面として扱う",
    (path) => {
      renderWithRouter(<VisitorAppRoutes />, { initialEntries: [path] });
      expect(screen.getByRole("heading", { level: 1, name: V2_HEADING })).toBeInTheDocument();
      expectElectionIndependentShell();
    },
  );

  it.each(["/values/v2/extra", "/values/v3"])("%s は、選挙の表示を保った404にする", (path) => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: [path] });
    expect(
      screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expectElectionShell();
  });
});

describe("ホーム画面の地域課題ジレンマ診断（v2）の入口", () => {
  it("v1 の入口カードの下、メインメニューより前に v2 の入口カードを置き、既存のメニューと共通ナビは変えない", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });

    const v1Card = screen.getByRole("region", { name: "価値観診断をはじめる" });
    expect(within(v1Card).getByRole("link", { name: "診断をはじめる" })).toHaveAttribute("href", "/values");

    const v2Card = screen.getByRole("region", { name: V2_CARD_NAME });
    expect(within(v2Card).getByRole("link", { name: V2_HOME_LINK })).toHaveAttribute("href", V2_PATH);
    expect(within(v2Card).getAllByRole("link")).toHaveLength(1);
    expect(within(v2Card).getByText("デモ版")).toBeInTheDocument();
    expect(within(v2Card).getByText("中立性の点検前")).toBeInTheDocument();
    expect(v2Card).toHaveTextContent("質問は架空のデモ用です。");
    expect(v2Card).toHaveTextContent("六角形の価値観レーダー");

    const menu = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    // 文書の順序: v1 の入口カード → v2 の入口カード → メインメニュー
    expect(v1Card.compareDocumentPosition(v2Card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(v2Card.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/nakamura-tokihiro",
      "/candidates/hayashi-noriko",
      "/comparison",
      "/venue",
    ]);
    expect(navigationHrefs()).toEqual(VISITOR_NAV_HREFS);
    // ホームは選挙の表示を保つ
    expectElectionShell();
  });

  it("v2 の入口カードから診断を始め、6問に答えると、回答から計算した六角形の価値観レーダーを表示する", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });

    fireEvent.click(screen.getByRole("link", { name: V2_HOME_LINK }));
    expect(screen.getByRole("heading", { level: 1, name: V2_HEADING })).toBeInTheDocument();
    expectElectionIndependentShell();

    fireEvent.click(screen.getByRole("button", { name: /診断をはじめる/u }));
    // Aを強く重視とBを強く重視を交互に選ぶ。公平性 +4 → +2、暮らしの安定 −4 → −2、将来への投資 +4 → +2、
    // 個人の可能性 0、地域のつながり 0、公共基盤の充実 −4 → −2
    for (let index = 0; index < 6; index += 1) {
      expect(screen.getByText(/6問中/u)).toHaveTextContent(`6問中 ${index + 1}問目`);
      choose(index % 2 === 0 ? "Aを強く重視" : "Bを強く重視");
      fireEvent.click(nextButton());
    }

    expect(
      screen.getByRole("heading", { level: 1, name: "あなたの地域課題マップ" }),
    ).toBeInTheDocument();
    expectDemoAndNeutralityLabels();
    const radar = screen.getByRole("region", { name: "価値観レーダー" });
    const figure = radar.querySelector("figure");
    expect(figure).toHaveAttribute("data-radar-mode", "analysis");
    expect(figure?.querySelectorAll("polygon[data-level]")).toHaveLength(5);
    expect(figure?.querySelectorAll("circle")).toHaveLength(6);
    expect(radar.querySelector("[data-axis-description='FAIRNESS']")).toHaveTextContent(
      "この考え方の側を選ぶことが多かった",
    );
    expect(radar.querySelector("[data-axis-description='STABILITY']")).toHaveTextContent(
      "もう一方の考え方を選ぶことが多かった",
    );
    expect(radar.querySelector("[data-axis-description='OPPORTUNITY']")).toHaveTextContent(
      "差し引きで0になった（中立という意味ではない）",
    );
    // 0 でない軸があるので、傾き0の注記は出さない
    expect(radar.querySelector("[data-radar-all-zero]")).toBeNull();
    expect(radar).not.toHaveTextContent(/準備中|サンプル|見本/u);
    expect(document.body).not.toHaveTextContent("同じくらい");
    expect(document.body).not.toHaveTextContent(/一致率|ランキング|[0-9０-９]+位/u);
    expectElectionIndependentShell();

    // 回答はブラウザーの保存領域に書き込まない
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("v2 の画面から戻る操作で、選挙の表示があるホームに戻る", () => {
    renderWithRouter(<VisitorAppRoutes />, { initialEntries: ["/"] });
    fireEvent.click(screen.getByRole("link", { name: V2_HOME_LINK }));
    expect(screen.getByRole("heading", { level: 1, name: V2_HEADING })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: BACK_CONTROL_NAME }));
    expect(screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" })).toBeInTheDocument();
    expectElectionShell();
  });
});
