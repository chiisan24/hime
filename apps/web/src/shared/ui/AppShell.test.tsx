// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import { ANALYST_NAV_ITEMS } from "../../app/analyst/navigationItems.js";
import { AnalystHomePage } from "../../app/analyst/pages.js";
import {
  AppShell,
  type SharedNavigationItem,
  VISITOR_NAV_ITEMS,
} from "./AppShell.js";

const VISITOR_NAVIGATION = [
  { href: "/", name: "ホーム" },
  { href: "/schedule", name: "選挙日程" },
  { href: "/candidates", name: "候補者" },
  { href: "/comparison", name: "政策比較" },
  { href: "/venue", name: "会場閲覧" },
] as const;

function renderShell(
  navigationItems: readonly SharedNavigationItem[],
  initialEntry = "/candidates",
) {
  return renderWithRouter(
    <Routes>
      <Route element={<AppShell navigationItems={navigationItems} />}>
        <Route path="*" element={<h1>テスト画面</h1>} />
      </Route>
    </Routes>,
    { initialEntries: [initialEntry] },
  );
}

function navigationLinks() {
  const navigation = screen.getByRole("navigation", {
    name: "共通ナビゲーション",
  });

  return within(navigation).getAllByRole("link");
}

describe("AppShell navigation items", () => {
  it("renders only the five visitor navigation destinations", () => {
    renderShell(VISITOR_NAV_ITEMS);

    const links = navigationLinks();
    expect(
      links.map((link) => ({
        href: link.getAttribute("href"),
        name: link.textContent,
      })),
    ).toEqual(VISITOR_NAVIGATION);
    expect(links.every((link) => link.classList.contains("min-h-11"))).toBe(true);
    expect(links.every((link) => link.classList.contains("min-w-11"))).toBe(true);
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "候補者" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("adds explicit analyst access without adding the retired public sources destination", () => {
    renderShell(ANALYST_NAV_ITEMS, "/analyst/readiness");

    const links = navigationLinks();
    expect(links.slice(0, VISITOR_NAVIGATION.length).map((link) => link.getAttribute("href"))).toEqual(
      VISITOR_NAVIGATION.map(({ href }) => href),
    );
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "分析状態" })).toHaveAttribute(
      "href",
      "/analyst/readiness",
    );
    expect(links.filter((link) => link.getAttribute("href") === "/sources")).toHaveLength(0);
  });

  it("keeps visitor navigation fixed when URL and browser storage contain analyst-like values", () => {
    window.localStorage.setItem("mode", "analyst");
    window.sessionStorage.setItem("applicationMode", "ANALYST");

    renderShell(VISITOR_NAV_ITEMS, "/analyst/sources?mode=analyst#ANALYST");

    expect(navigationLinks().map((link) => link.getAttribute("href"))).toEqual(
      VISITOR_NAVIGATION.map(({ href }) => href),
    );
    expect(screen.queryByRole("link", { name: "分析状態" })).not.toBeInTheDocument();
  });

  it("preserves internal Source Manifest access from the analyst home composition", () => {
    renderWithRouter(
      <Routes>
        <Route element={<AppShell navigationItems={ANALYST_NAV_ITEMS} />}>
          <Route index element={<AnalystHomePage />} />
        </Route>
      </Routes>,
    );

    expect(screen.getByRole("link", { name: "Source Manifest画面を見る" })).toHaveAttribute(
      "href",
      "/analyst/sources",
    );
    expect(
      navigationLinks().filter((link) => link.getAttribute("href") === "/sources"),
    ).toHaveLength(0);
  });

  it("preserves shell safety, accessibility, data-kind, footer, and back-control contracts", () => {
    renderShell(VISITOR_NAV_ITEMS);

    expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("banner")).toHaveTextContent(
      "会場ローカルデモ・一般公開ではありません",
    );
    expect(screen.getByRole("banner")).toHaveTextContent(
      "2022年に終了した過去選挙です",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByText("データ種別: 2022年実資料・AI解析")).toHaveAttribute(
      "data-kind",
      "REAL_AI",
    );
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "政策解析準備状態: NOT_READY",
    );

    const backControl = screen.getByRole("button", { name: /前の画面に戻る/u });
    expect(backControl).toHaveAttribute("type", "button");
    expect(backControl).toHaveClass("min-h-11", "min-w-11");
  });
});
