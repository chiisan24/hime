// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { createRoutesFromChildren, useLocation } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import { AppShell } from "../../shared/ui/AppShell.js";
import { VISITOR_ROUTE_CONTRACTS } from "../visitor/routeContracts.js";
import { ANALYST_NAV_ITEMS } from "./navigationItems.js";
import {
  ANALYST_ROUTE_CONTRACTS,
  selectAnalystRouteContract,
} from "./routeContracts.js";
import { AppRoutes } from "./routes.js";

const EXISTING_ANALYST_ROUTE_PATHS = [
  "/analyst/readiness",
  "/analyst/sources",
  "/analyst/runs",
  "/analyst/runs/:runId",
  "/analyst/verification/:artifactId",
  "/analyst/review/:artifactId",
  "/analyst/evaluation",
  "/analyst/p0",
  "/analyst/aws",
] as const;

const REMAINING_PUBLIC_ROUTE_PATHS = [
  "/",
  "/schedule",
  "/candidates",
  "/candidates/:candidateId",
  "/comparison",
  "/venue",
] as const;

const SAMPLE_PATH_PARAMETERS: Readonly<Record<string, string>> = {
  candidateId: "nakamura-tokihiro",
  runId: "run-example",
  artifactId: "artifact-example",
};

const WILDCARD_ENTRY_CASES = [
  "/sources",
  "/sources/",
  "/analyst/not-defined",
  "/analyst/sources/extra",
  "/not-a-p0-route",
  "/polling-place/election-day",
  "/chat",
  "/login",
] as const;

const ANALYST_HOME_LINK_CASES = [
  { link: "解析準備状態を見る", heading: "政策解析準備状態" },
  { link: "Source Manifest画面を見る", heading: "Source Manifest" },
  { link: "解析実行と履歴を見る", heading: "解析実行と履歴" },
  { link: "評価画面を見る", heading: "評価" },
  { link: "P0完成判定を見る", heading: "P0完成判定" },
  { link: "AWS診断画面を見る", heading: "AWS診断" },
] as const;

const ROUTED_CONTRACTS = ANALYST_ROUTE_CONTRACTS.filter(
  (contract) => contract.kind !== "WILDCARD",
);

function concretePath(pattern: string): string {
  return pattern.replace(/:(\w+)/gu, (_segment, name: string) => {
    const value = SAMPLE_PATH_PARAMETERS[name];
    if (value === undefined) {
      throw new Error(`No sample value for path parameter ${name}`);
    }
    return value;
  });
}

function normalizeRoutePath(route: RouteObject): string {
  if (route.index === true) {
    return "/";
  }
  if (route.path === "*") {
    return "*";
  }
  return `/${route.path ?? ""}`;
}

function registeredLayoutRoutes(): RouteObject[] {
  const routesElement = AppRoutes() as ReactElement<{ children: ReactNode }>;
  return createRoutesFromChildren(routesElement.props.children);
}

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function renderAnalystRoute(path: string) {
  return renderWithRouter(
    <>
      <AppRoutes />
      <CurrentPath />
    </>,
    { initialEntries: [path] },
  );
}

function sharedNavigation() {
  return screen.getByRole("navigation", { name: "共通ナビゲーション" });
}

function expectAnalystShell() {
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
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(
    within(sharedNavigation()).getByRole("link", { name: "分析状態" }),
  ).toHaveAttribute("href", "/analyst/readiness");
  expect(
    within(sharedNavigation())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/sources"),
  ).toHaveLength(0);
}

describe("Analyst route contract matrix", () => {
  it("lists the remaining public routes, every Existing Analyst Route, and the wildcard", () => {
    expect(ANALYST_ROUTE_CONTRACTS.map(({ path }) => path)).toEqual([
      ...REMAINING_PUBLIC_ROUTE_PATHS,
      ...EXISTING_ANALYST_ROUTE_PATHS,
      "*",
    ]);
    expect(ANALYST_ROUTE_CONTRACTS.map(({ path }) => path)).not.toContain(
      "/sources",
    );
    expect(
      ANALYST_ROUTE_CONTRACTS.filter(({ kind }) => kind === "ANALYST").map(
        ({ path }) => path,
      ),
    ).toEqual(EXISTING_ANALYST_ROUTE_PATHS);
  });

  it("keeps the same remaining public contracts as the Visitor matrix", () => {
    const publicContracts = (
      contracts: readonly Readonly<{ path: string; heading: string; kind: string }>[],
    ) =>
      contracts
        .filter(({ kind }) => kind === "PUBLIC")
        .map(({ path, heading }) => ({ path, heading }));

    expect(publicContracts(ANALYST_ROUTE_CONTRACTS)).toEqual(
      publicContracts(VISITOR_ROUTE_CONTRACTS),
    );
  });

  it.each(ROUTED_CONTRACTS)(
    "resolves a concrete $path entry to its own contract",
    (contract) => {
      expect(selectAnalystRouteContract(concretePath(contract.path))).toBe(
        contract,
      );
    },
  );

  it.each(WILDCARD_ENTRY_CASES)("resolves %s to the wildcard contract", (path) => {
    expect(selectAnalystRouteContract(path)).toEqual({
      path: "*",
      heading: "ページが見つかりません",
      kind: "WILDCARD",
    });
  });
});

describe("Analyst Router registration", () => {
  it("registers exactly the contract matrix inside the ANALYST AppShell", () => {
    const layoutRoutes = registeredLayoutRoutes();

    expect(layoutRoutes).toHaveLength(1);
    const [layout] = layoutRoutes;
    const shell = layout?.element as ReactElement<{
      navigationItems: unknown;
    }>;
    expect(shell.type).toBe(AppShell);
    expect(shell.props.navigationItems).toBe(ANALYST_NAV_ITEMS);

    const registeredPaths = (layout?.children ?? []).map(normalizeRoutePath);
    expect(registeredPaths).toEqual(
      ANALYST_ROUTE_CONTRACTS.map(({ path }) => path),
    );
    expect(registeredPaths).not.toContain("/sources");
  });
});

describe("Analyst Router", () => {
  it.each(ROUTED_CONTRACTS)(
    "renders $path with the existing $heading page inside the analyst shell",
    ({ path, heading }) => {
      const entry = concretePath(path);
      renderAnalystRoute(entry);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByTestId("current-path")).toHaveTextContent(entry);
      expectAnalystShell();
    },
  );

  it.each([
    { path: "/analyst/runs/run-123", label: /run ID:/u, value: "run-123" },
    {
      path: "/analyst/verification/artifact-verify",
      label: /artifact ID:/u,
      value: "artifact-verify",
    },
    {
      path: "/analyst/review/artifact-review",
      label: /artifact ID:/u,
      value: "artifact-review",
    },
  ])("passes the path parameter through at $path", ({ path, label, value }) => {
    renderAnalystRoute(path);

    expect(screen.getByText(label)).toHaveTextContent(value);
  });

  it("shows Source Manifest management at /analyst/sources", () => {
    renderAnalystRoute("/analyst/sources");

    expect(
      screen.getByRole("heading", { level: 1, name: "Source Manifest" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "出典一覧" }),
    ).not.toBeInTheDocument();
  });

  it.each(WILDCARD_ENTRY_CASES)(
    "routes the direct entry %s to the shared shell-preserving 404",
    (path) => {
      renderAnalystRoute(path);

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
        screen.queryByRole("heading", { level: 1, name: "出典一覧" }),
      ).not.toBeInTheDocument();
      expectAnalystShell();
    },
  );

  it("renders Analyst Home at the index with analyst links and no public /sources link", () => {
    renderAnalystRoute("/");

    expect(
      screen.getByRole("heading", { level: 2, name: "ローカル分析のP0画面" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Source Manifest画面を見る" }),
    ).toHaveAttribute("href", "/analyst/sources");
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/sources"),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("link", { name: "出典一覧を見る" }),
    ).not.toBeInTheDocument();
  });

  it.each(ANALYST_HOME_LINK_CASES)(
    "reaches $heading from the Analyst Home link $link",
    ({ link, heading }) => {
      renderAnalystRoute("/");

      fireEvent.click(screen.getByRole("link", { name: link }));

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
    },
  );

  it("reaches the analyst entry from shared navigation and marks it current", () => {
    renderAnalystRoute("/schedule");

    fireEvent.click(
      within(sharedNavigation()).getByRole("link", { name: "分析状態" }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "政策解析準備状態" }),
    ).toBeInTheDocument();
    expect(
      within(sharedNavigation()).getByRole("link", { name: "分析状態" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("adds no login, account, authorization, or mode toggle controls", () => {
    renderAnalystRoute("/");

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(
      "前の画面に戻る。履歴がない場合はホームへ移動",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryAllByRole("link", {
        name: /ログイン|login|sign in|アカウント|account|認証|モード|mode/iu,
      }),
    ).toHaveLength(0);
  });
});
