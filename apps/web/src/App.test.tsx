// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppRoutes as SelectedAppRoutes } from "#app-routes";

import { renderWithRouter } from "../../../tests/harness/react-renderer.js";
import { App } from "./App.js";
import { AppRoutes as AnalystAppRoutes } from "./app/analyst/routes.js";
import { AppRoutes as VisitorAppRoutes } from "./app/visitor/routes.js";

const VISITOR_NAVIGATION_HREFS = [
  "/",
  "/schedule",
  "/candidates",
  "/comparison",
  "/venue",
] as const;

function hrefsOf(elements: readonly HTMLElement[]): (string | null)[] {
  return elements.map((element) => element.getAttribute("href"));
}

describe("App with the normally selected route entry", () => {
  it("selects the Visitor route entry through #app-routes", () => {
    expect(SelectedAppRoutes).toBe(VisitorAppRoutes);
    expect(SelectedAppRoutes).not.toBe(AnalystAppRoutes);
  });

  it("renders Visitor Home inside the local-only shell", () => {
    renderWithRouter(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText("デモ版・コンテスト審査用の試作アプリです"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("NOT_READY").length).toBeGreaterThan(0);

    const navigation = screen.getByRole("navigation", {
      name: "共通ナビゲーション",
    });
    expect(hrefsOf(within(navigation).getAllByRole("link"))).toEqual(
      VISITOR_NAVIGATION_HREFS,
    );
    expect(
      screen.queryByRole("heading", { level: 2, name: "ローカル分析のP0画面" }),
    ).not.toBeInTheDocument();

    const allHrefs = hrefsOf(screen.getAllByRole("link"));
    expect(allHrefs.filter((href) => href?.startsWith("/analyst") === true)).toEqual(
      [],
    );
    expect(allHrefs.filter((href) => href === "/sources")).toEqual([]);
  });

  it.each(["/analyst/readiness", "/analyst/sources", "/sources"])(
    "routes the direct entry %s to the shell-preserving 404",
    (path) => {
      renderWithRouter(<App />, { initialEntries: [path] });

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
      ).toBeInTheDocument();
      expect(screen.getByText("404")).toBeInTheDocument();
      expect(
        screen.getByText("デモ版・コンテスト審査用の試作アプリです"),
      ).toBeInTheDocument();
    },
  );
});
