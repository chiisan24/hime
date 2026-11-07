// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import type { ApplicationMode } from "../config/applicationMode.js";
import { AppRoutes as AnalystAppRoutes } from "./analyst/routes.js";
import { AppRoutes as VisitorAppRoutes } from "./visitor/routes.js";

/*
 * Mode-separated focused route regression suite (visitor-analyst-mode-separation Task 3.2).
 *
 * Each mode's route entry is rendered directly. `App.test.tsx` checks that the
 * normally selected `#app-routes` entry is the Visitor entry.
 */

type NavigationItem = Readonly<{ href: string; name: string }>;

type ModeFixture = Readonly<{
  mode: ApplicationMode;
  AppRoutes: ComponentType;
  navigation: readonly NavigationItem[];
  homeLinkHrefs: readonly string[];
  hasAnalystHomeSection: boolean;
}>;

const NOT_FOUND_HEADING = "ページが見つかりません";
const RETIRED_SOURCES_HEADING = "出典一覧";
const ANALYST_HOME_SECTION_HEADING = "ローカル分析のP0画面";
const LOCAL_ONLY_TEXT = "会場ローカルデモ・一般公開ではありません";
const PAST_ELECTION_TEXT =
  "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません";
const REAL_AI_DATA_KIND_TEXT = "データ種別: 2022年実資料・AI解析";
const FIXTURE_DATA_KIND_TEXT = "データ種別: 架空fixture・UIテスト専用";
const BACK_CONTROL_NAME = /前の画面に戻る/u;

const PUBLIC_ROUTE_CASES = [
  { path: "/", heading: "えひめ投票ナビ" },
  { path: "/schedule", heading: "選挙日程" },
  { path: "/candidates", heading: "候補者一覧" },
  { path: "/candidates/nakamura-tokihiro", heading: "候補者詳細" },
  { path: "/comparison", heading: "政策比較" },
  { path: "/venue", heading: "会場閲覧" },
] as const;

const EXISTING_ANALYST_ROUTE_CASES = [
  { path: "/analyst/readiness", heading: "政策解析準備状態" },
  { path: "/analyst/sources", heading: "Source Manifest" },
  { path: "/analyst/runs", heading: "解析実行と履歴" },
  { path: "/analyst/runs/run-example", heading: "解析run詳細" },
  { path: "/analyst/verification/artifact-example", heading: "根拠検証" },
  { path: "/analyst/review/artifact-example", heading: "人間確認" },
  { path: "/analyst/evaluation", heading: "評価" },
  { path: "/analyst/p0", heading: "P0完成判定" },
  { path: "/analyst/aws", heading: "AWS診断" },
] as const;

const PUBLIC_HOME_LINK_CASES = [
  { link: "選挙日程を見る", heading: "選挙日程" },
  { link: "候補者一覧を見る", heading: "候補者一覧" },
  { link: "中村時広氏の詳細を見る", heading: "候補者詳細" },
  { link: "林紀子氏の詳細を見る", heading: "候補者詳細" },
  { link: "政策比較を見る", heading: "政策比較" },
  { link: "会場閲覧画面を見る", heading: "会場閲覧" },
] as const;

const PUBLIC_HOME_LINK_HREFS = [
  "/schedule",
  "/candidates",
  "/candidates/nakamura-tokihiro",
  "/candidates/hayashi-noriko",
  "/comparison",
  "/venue",
] as const;

const ANALYST_HOME_LINK_HREFS = [
  "/analyst/readiness",
  "/analyst/sources",
  "/analyst/runs",
  "/analyst/evaluation",
  "/analyst/p0",
  "/analyst/aws",
] as const;

const VISITOR_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", name: "ホーム" },
  { href: "/schedule", name: "選挙日程" },
  { href: "/candidates", name: "候補者" },
  { href: "/comparison", name: "政策比較" },
  { href: "/venue", name: "会場閲覧" },
];

const ANALYST_NAVIGATION: readonly NavigationItem[] = [
  ...VISITOR_NAVIGATION,
  { href: "/analyst/readiness", name: "分析状態" },
];

const VISITOR_MODE: ModeFixture = {
  mode: "VISITOR",
  AppRoutes: VisitorAppRoutes,
  navigation: VISITOR_NAVIGATION,
  homeLinkHrefs: PUBLIC_HOME_LINK_HREFS,
  hasAnalystHomeSection: false,
};

const ANALYST_MODE: ModeFixture = {
  mode: "ANALYST",
  AppRoutes: AnalystAppRoutes,
  navigation: ANALYST_NAVIGATION,
  homeLinkHrefs: [...PUBLIC_HOME_LINK_HREFS, ...ANALYST_HOME_LINK_HREFS],
  hasAnalystHomeSection: true,
};

const MODE_FIXTURES = [VISITOR_MODE, ANALYST_MODE] as const;

const UNKNOWN_ROUTE_CASES = [
  "/not-a-p0-route",
  "/analyst/not-defined",
  "/analyst/runs/run-example/extra",
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

const NOT_READY_ROUTE_CASES = [
  "/candidates",
  "/candidates/nakamura-tokihiro",
  "/candidates/hayashi-noriko",
  "/comparison",
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

function renderMode(fixture: ModeFixture, path = "/") {
  const { AppRoutes } = fixture;
  return renderWithRouter(<AppRoutes />, { initialEntries: [path] });
}

function sharedNavigation() {
  return screen.getByRole("navigation", { name: "共通ナビゲーション" });
}

function hrefsOf(elements: readonly HTMLElement[]): (string | null)[] {
  return elements.map((element) => element.getAttribute("href"));
}

function navigationItems(): NavigationItem[] {
  return within(sharedNavigation())
    .getAllByRole("link")
    .map((link) => ({
      href: link.getAttribute("href") ?? "",
      name: link.textContent ?? "",
    }));
}

function currentNavigationHrefs(): (string | null)[] {
  return hrefsOf(
    within(sharedNavigation())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page"),
  );
}

/** Grid column classes without a breakpoint prefix, which would apply at 360px. */
function unprefixedGridColumns(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []).filter((name) =>
    name.startsWith("grid-cols-"),
  );
}

function expectShell(fixture: ModeFixture) {
  const banner = screen.getByRole("banner");
  expect(within(banner).getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(within(banner).getByText(PAST_ELECTION_TEXT)).toBeInTheDocument();
  expect(screen.getByText(REAL_AI_DATA_KIND_TEXT)).toHaveAttribute(
    "data-kind",
    "REAL_AI",
  );
  expect(screen.queryByText(FIXTURE_DATA_KIND_TEXT)).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(navigationItems()).toEqual(fixture.navigation);
}

function expectNotFound(fixture: ModeFixture) {
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    screen.getByRole("heading", { level: 1, name: NOT_FOUND_HEADING }),
  ).toBeInTheDocument();
  expect(screen.getByText("404")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "ホームへ移動" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(
    screen.queryByRole("heading", { level: 1, name: RETIRED_SOURCES_HEADING }),
  ).not.toBeInTheDocument();
  expectShell(fixture);
}

function expectNoModeToggle() {
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveAccessibleName(BACK_CONTROL_NAME);
  for (const role of ["combobox", "checkbox", "switch", "radio"] as const) {
    expect(screen.queryAllByRole(role)).toHaveLength(0);
  }
  expect(
    screen.queryAllByRole("link", { name: /モード|mode|analyst/iu }),
  ).toHaveLength(0);
}

describe.each(MODE_FIXTURES)("$mode Mode shared route regression", (fixture) => {
  it.each(PUBLIC_ROUTE_CASES)(
    "renders the remaining public route $path with one h1 inside the shell",
    ({ path, heading }) => {
      renderMode(fixture, path);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expectShell(fixture);
    },
  );

  it("routes the retired /sources direct entry to the shell-preserving 404", () => {
    renderMode(fixture, "/sources");

    expectNotFound(fixture);
    expect(screen.queryByText(RETIRED_SOURCES_HEADING)).not.toBeInTheDocument();
  });

  it.each(UNKNOWN_ROUTE_CASES)(
    "routes the unknown path %s to the shell-preserving 404",
    (path) => {
      renderMode(fixture, path);

      expectNotFound(fixture);
    },
  );

  it.each(FUTURE_ROUTE_CASES)("keeps the P1/P2 route %s unregistered", (path) => {
    renderMode(fixture, path);

    expectNotFound(fixture);
  });

  it("shows the mode's Home links and Shared Navigation without /sources or a mode toggle", () => {
    renderMode(fixture, "/");

    expect(
      hrefsOf(within(screen.getByRole("main")).getAllByRole("link")),
    ).toEqual(fixture.homeLinkHrefs);
    expect(navigationItems()).toEqual(fixture.navigation);
    expect(
      screen.queryByRole("heading", { level: 2, name: ANALYST_HOME_SECTION_HEADING }) !==
        null,
    ).toBe(fixture.hasAnalystHomeSection);

    const documentHrefs = new Set(hrefsOf(screen.getAllByRole("link")));
    const expectedHrefs = new Set([
      "#main-content",
      "/",
      ...fixture.navigation.map(({ href }) => href),
      ...fixture.homeLinkHrefs,
    ]);
    expect(documentHrefs).toEqual(expectedHrefs);
    expect(documentHrefs.has("/sources")).toBe(false);
    expect(
      screen.queryByRole("link", { name: "出典一覧を見る" }),
    ).not.toBeInTheDocument();
    expectNoModeToggle();
  });

  it.each(PUBLIC_HOME_LINK_CASES)(
    "reaches $heading from the Home link $link",
    ({ link, heading }) => {
      renderMode(fixture, "/");

      fireEvent.click(screen.getByRole("link", { name: link }));

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    },
  );

  it("provides the skip link, landmarks, and aria-current while navigating", () => {
    renderMode(fixture, "/");

    expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(currentNavigationHrefs()).toEqual(["/"]);

    fireEvent.click(within(sharedNavigation()).getByRole("link", { name: "候補者" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "候補者一覧" }),
    ).toBeInTheDocument();
    expect(currentNavigationHrefs()).toEqual(["/candidates"]);

    fireEvent.click(
      screen.getByRole("link", { name: "中村時広氏の候補者詳細へ移動" }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
    ).toBeInTheDocument();
    expect(
      within(sharedNavigation()).getByRole("link", { name: "候補者" }),
    ).toHaveAttribute("aria-current", "page");
    expect(currentNavigationHrefs()).toEqual(["/candidates"]);
  });

  it("uses the candidateId segment and the same detail route structure", () => {
    renderMode(fixture, "/candidates");

    fireEvent.click(
      screen.getByRole("link", { name: "中村時広氏の候補者詳細へ移動" }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/候補者ID:/u)).toHaveTextContent("nakamura-tokihiro");
    for (const field of CANDIDATE_DETAIL_FIELDS) {
      expect(within(screen.getByRole("main")).getByText(field)).toBeInTheDocument();
    }
  });

  it("moves back exactly once to the immediately previous in-app route", () => {
    renderMode(fixture, "/");

    fireEvent.click(screen.getByRole("link", { name: "候補者一覧を見る" }));
    fireEvent.click(
      screen.getByRole("link", { name: "林紀子氏の候補者詳細へ移動" }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: BACK_CONTROL_NAME }));

    expect(
      screen.getByRole("heading", { level: 1, name: "候補者一覧" }),
    ).toBeInTheDocument();
    expectShell(fixture);
  });

  it("falls back to the same mode's Home when an analyst URL was entered directly", () => {
    renderMode(fixture, "/analyst/aws");

    fireEvent.click(screen.getByRole("button", { name: BACK_CONTROL_NAME }));

    expect(
      screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: ANALYST_HOME_SECTION_HEADING }) !==
        null,
    ).toBe(fixture.hasAnalystHomeSection);
    expectShell(fixture);
  });

  it("uses equal candidate cards and neutral common photo placeholders", () => {
    renderMode(fixture, "/candidates");

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toBe(cards[1]?.className);

    for (const card of cards) {
      const cardView = within(card);
      expect(
        cardView.getByRole("img", { name: "候補者写真の共通プレースホルダー" }),
      ).toBeInTheDocument();
      for (const field of CANDIDATE_LIST_FIELDS) {
        expect(cardView.getByText(field)).toBeInTheDocument();
      }
    }
  });

  it.each(NOT_READY_ROUTE_CASES)(
    "keeps %s in NOT_READY without simulated AI progress",
    (path) => {
      renderMode(fixture, path);

      expect(screen.getAllByText("NOT_READY").length).toBeGreaterThan(0);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText(/解析中|生成中/u)).not.toBeInTheDocument();
    },
  );

  it.each(["/candidates/nakamura-tokihiro", "/candidates/hayashi-noriko"])(
    "uses the complete common detail field order at %s",
    (path) => {
      renderMode(fixture, path);

      for (const field of CANDIDATE_DETAIL_FIELDS) {
        expect(within(screen.getByRole("main")).getByText(field)).toBeInTheDocument();
      }
      expect(
        screen.getByRole("img", { name: "候補者写真の共通プレースホルダー" }),
      ).toBeInTheDocument();
    },
  );

  it("shows only equal future comparison fields while the table is NOT_READY", () => {
    renderMode(fixture, "/comparison");

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

  it("keeps the mobile-first 360, md 768, and lg 1280 layout class contracts", () => {
    const candidatesView = renderMode(fixture, "/candidates");

    expect(screen.getByRole("main")).toHaveClass(
      "max-w-[1200px]",
      "px-4",
      "sm:px-6",
      "lg:px-8",
    );
    const cards = screen.getAllByRole("article");
    const candidateGrid = cards[0]?.parentElement;
    expect(candidateGrid).toHaveClass("grid", "md:grid-cols-2");
    expect(unprefixedGridColumns(candidateGrid)).toEqual([]);
    for (const card of cards) {
      expect(card.parentElement).toBe(candidateGrid);
      expect(card).toHaveClass("h-full", "min-h-[38rem]");
    }

    const controls = [
      ...within(sharedNavigation()).getAllByRole("link"),
      screen.getByRole("button", { name: BACK_CONTROL_NAME }),
      ...screen.getAllByRole("link", { name: /の候補者詳細へ移動$/u }),
    ];
    for (const control of controls) {
      expect(control).toHaveClass("min-h-11", "min-w-11");
    }
    candidatesView.unmount();

    const detailView = renderMode(fixture, "/candidates/nakamura-tokihiro");
    const detailLayout = screen.getByRole("img", {
      name: "候補者写真の共通プレースホルダー",
    }).parentElement;
    expect(detailLayout).toHaveClass("grid", "lg:grid-cols-[16rem_1fr]");
    expect(unprefixedGridColumns(detailLayout)).toEqual([]);
    detailView.unmount();

    renderMode(fixture, "/comparison");
    const comparisonGrid = screen.getAllByRole("article")[0]?.parentElement;
    expect(comparisonGrid).toHaveClass("grid", "md:grid-cols-2");
    expect(unprefixedGridColumns(comparisonGrid)).toEqual([]);
  });
});

describe("Visitor Mode route regression", () => {
  it.each(EXISTING_ANALYST_ROUTE_CASES)(
    "routes the direct entry $path to the 404 without rendering $heading",
    ({ path, heading }) => {
      renderMode(VISITOR_MODE, path);

      expectNotFound(VISITOR_MODE);
      expect(
        screen.queryByRole("heading", { level: 1, name: heading }),
      ).not.toBeInTheDocument();
    },
  );

  describe("with analyst-like query, hash, cookie, and Web Storage values", () => {
    const RUNTIME_SUFFIXES = [
      "?mode=analyst",
      "#analyst",
      "?applicationMode=ANALYST#mode=analyst",
    ] as const;

    const UNAVAILABLE_PATHS = [
      "/analyst/readiness",
      "/analyst/sources",
      "/analyst/runs/run-example",
      "/analyst/not-defined",
      "/sources",
    ] as const;

    const RUNTIME_CASES = UNAVAILABLE_PATHS.flatMap((path) =>
      RUNTIME_SUFFIXES.map((suffix) => ({ path, suffix })),
    );

    beforeEach(() => {
      window.localStorage.setItem("mode", "analyst");
      window.localStorage.setItem("applicationMode", "ANALYST");
      window.sessionStorage.setItem("mode", "analyst");
      window.sessionStorage.setItem("applicationMode", "ANALYST");
      document.cookie = "mode=analyst; path=/";
    });

    afterEach(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      document.cookie = "mode=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    });

    it.each(RUNTIME_CASES)(
      "keeps $path unavailable with $suffix",
      ({ path, suffix }) => {
        renderMode(VISITOR_MODE, `${path}${suffix}`);

        expectNotFound(VISITOR_MODE);
        expectNoModeToggle();
      },
    );

    it("keeps Visitor Home free of analyst content and mode toggles", () => {
      renderMode(VISITOR_MODE, "/?mode=analyst#analyst");

      expect(
        screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 2, name: ANALYST_HOME_SECTION_HEADING }),
      ).not.toBeInTheDocument();
      expect(
        hrefsOf(within(screen.getByRole("main")).getAllByRole("link")),
      ).toEqual(PUBLIC_HOME_LINK_HREFS);
      expect(
        hrefsOf(screen.getAllByRole("link")).filter(
          (href) => href === "/sources" || href?.startsWith("/analyst") === true,
        ),
      ).toEqual([]);
      expectShell(VISITOR_MODE);
      expectNoModeToggle();
    });
  });
});

describe("Analyst Mode route regression", () => {
  it.each(EXISTING_ANALYST_ROUTE_CASES)(
    "renders the direct entry $path with the existing $heading page",
    ({ path, heading }) => {
      renderMode(ANALYST_MODE, path);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expectShell(ANALYST_MODE);
    },
  );

  it("shows Source Manifest at /analyst/sources and keeps /sources a separate 404", () => {
    const manifestView = renderMode(ANALYST_MODE, "/analyst/sources");

    expect(
      screen.getByRole("heading", { level: 1, name: "Source Manifest" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: RETIRED_SOURCES_HEADING }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
    manifestView.unmount();

    renderMode(ANALYST_MODE, "/sources");

    expectNotFound(ANALYST_MODE);
    expect(
      screen.queryByRole("heading", { level: 1, name: "Source Manifest" }),
    ).not.toBeInTheDocument();
  });

  it("reaches Source Manifest from the Analyst Home link, not a public /sources link", () => {
    renderMode(ANALYST_MODE, "/");

    const manifestLink = screen.getByRole("link", {
      name: "Source Manifest画面を見る",
    });
    expect(manifestLink).toHaveAttribute("href", "/analyst/sources");

    fireEvent.click(manifestLink);

    expect(
      screen.getByRole("heading", { level: 1, name: "Source Manifest" }),
    ).toBeInTheDocument();
    expectShell(ANALYST_MODE);
  });
});
