// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import { VISITOR_ROUTE_CONTRACTS } from "./routeContracts.js";
import { AppRoutes } from "./routes.js";

const PUBLIC_ROUTE_CASES = [
  { path: "/", heading: "えひめ投票ナビ" },
  { path: "/schedule", heading: "選挙日程" },
  { path: "/candidates", heading: "候補者一覧" },
  { path: "/candidates/nakamura-tokihiro", heading: "候補者詳細" },
  { path: "/comparison", heading: "政策比較" },
  { path: "/venue", heading: "会場閲覧" },
] as const;

const UNAVAILABLE_ROUTE_CASES = [
  "/analyst/readiness",
  "/analyst/sources",
  "/analyst/runs",
  "/analyst/runs/run-example",
  "/analyst/verification/artifact-example",
  "/analyst/review/artifact-example",
  "/analyst/evaluation",
  "/analyst/p0",
  "/analyst/aws",
  "/analyst/not-defined",
  "/sources",
  "/not-a-p0-route",
  "/polling-place/election-day",
  "/chat",
] as const;

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function renderVisitorRoute(path: string) {
  return renderWithRouter(
    <>
      <AppRoutes />
      <CurrentPath />
    </>,
    { initialEntries: [path] },
  );
}

describe("Visitor route contract matrix", () => {
  it("contains only the remaining public routes and wildcard", () => {
    expect(VISITOR_ROUTE_CONTRACTS).toEqual([
      { path: "/", heading: "えひめ投票ナビ", kind: "PUBLIC" },
      { path: "/schedule", heading: "選挙日程", kind: "PUBLIC" },
      { path: "/candidates", heading: "候補者一覧", kind: "PUBLIC" },
      {
        path: "/candidates/:candidateId",
        heading: "候補者詳細",
        kind: "PUBLIC",
      },
      { path: "/comparison", heading: "政策比較", kind: "PUBLIC" },
      { path: "/venue", heading: "会場閲覧", kind: "PUBLIC" },
      { path: "*", heading: "ページが見つかりません", kind: "WILDCARD" },
    ]);

    const registeredPaths = VISITOR_ROUTE_CONTRACTS.map(({ path }) => path);
    expect(registeredPaths).not.toContain("/sources");
    expect(registeredPaths.some((path) => path.startsWith("/analyst"))).toBe(false);
  });
});

describe("Visitor Router", () => {
  it.each(PUBLIC_ROUTE_CASES)(
    "renders the public route $path inside the visitor shell",
    ({ path, heading }) => {
      renderVisitorRoute(path);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByTestId("current-path")).toHaveTextContent(path);
      expect(
        screen.getByText("会場ローカルデモ・一般公開ではありません"),
      ).toBeInTheDocument();
    },
  );

  it.each(UNAVAILABLE_ROUTE_CASES)(
    "routes the direct entry %s to the same shell-preserving 404",
    (path) => {
      renderVisitorRoute(path);

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "ページが見つかりません",
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByText("404")).toBeInTheDocument();
      expect(screen.getByTestId("current-path")).toHaveTextContent(path);
      expect(screen.getByRole("link", { name: "ホームへ移動" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(
        screen.getByText("会場ローカルデモ・一般公開ではありません"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
        ),
      ).toBeInTheDocument();

      const navigation = screen.getByRole("navigation", {
        name: "共通ナビゲーション",
      });
      const destinations = within(navigation)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(destinations).toEqual([
        "/",
        "/schedule",
        "/candidates",
        "/comparison",
        "/venue",
      ]);
      expect(
        screen.queryByRole("button", { name: /analyst|分析者|モード|mode/iu }),
      ).not.toBeInTheDocument();
    },
  );
});
