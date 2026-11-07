// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import fc from "fast-check";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  Routes,
  type RouteObject,
} from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import { AppShell, VISITOR_NAV_ITEMS } from "../../shared/ui/AppShell.js";
import * as analystPageModule from "../analyst/pages.js";
import { NotFoundPage } from "../public/pages.js";
import {
  VISITOR_ROUTE_CONTRACTS,
  type VisitorRouteContract,
} from "./routeContracts.js";
import { AppRoutes } from "./routes.js";

/** Existing_Analyst_Route templates from the requirements glossary. */
const EXISTING_ANALYST_ROUTE_TEMPLATES = [
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

/** h1 shown by each analyst page in Analyst Mode; must never appear in Visitor Mode. */
const ANALYST_HEADING_BY_TEMPLATE = {
  "/analyst/readiness": "政策解析準備状態",
  "/analyst/sources": "Source Manifest",
  "/analyst/runs": "解析実行と履歴",
  "/analyst/runs/:runId": "解析run詳細",
  "/analyst/verification/:artifactId": "根拠検証",
  "/analyst/review/:artifactId": "人間確認",
  "/analyst/evaluation": "評価",
  "/analyst/p0": "P0完成判定",
  "/analyst/aws": "AWS診断",
} as const satisfies Record<(typeof EXISTING_ANALYST_ROUTE_TEMPLATES)[number], string>;

const PATH_PARAMETER_PATTERN = /:[A-Za-z]+/gu;

const ANALYST_PAGE_COMPONENTS: ReadonlySet<unknown> = new Set<unknown>(
  Object.values(analystPageModule).filter((value) => typeof value === "function"),
);

type LeafRouteDescriptor = Readonly<{
  path: string;
  element: ReactNode;
}>;

function elementType(node: ReactNode): unknown {
  return isValidElement(node) ? node.type : undefined;
}

/** Reads the route objects declared by the selected Visitor Router entry. */
function readVisitorRouteObjects(): RouteObject[] {
  const routesElement: ReactElement<{ children?: ReactNode }> = AppRoutes();
  return createRoutesFromChildren(routesElement.props.children);
}

/** Flattens layout nesting into normalized leaf descriptors such as `/candidates/:candidateId`. */
function collectLeafDescriptors(
  routes: readonly RouteObject[],
  parentSegments: readonly string[] = [],
): LeafRouteDescriptor[] {
  return routes.flatMap((route) => {
    const segments =
      route.path === undefined
        ? parentSegments
        : [...parentSegments, ...route.path.split("/").filter((segment) => segment !== "")];

    if (route.children !== undefined && route.children.length > 0) {
      return collectLeafDescriptors(route.children, segments);
    }

    const path =
      segments.length === 1 && segments[0] === "*" ? "*" : `/${segments.join("/")}`;
    return [{ path, element: route.element }];
  });
}

const VISITOR_ROUTE_OBJECTS = readVisitorRouteObjects();

const VISITOR_CONTRACT_ROUTE_OBJECTS: RouteObject[] = VISITOR_ROUTE_CONTRACTS.map(
  ({ path }) => ({ path }),
);

/** Pure visitor route selector over the shared Visitor route contract matrix. */
function selectVisitorContract(
  location: Readonly<{ pathname: string; search: string; hash: string }>,
): VisitorRouteContract | undefined {
  const leafPath = matchRoutes(VISITOR_CONTRACT_ROUTE_OBJECTS, location)?.at(-1)?.route.path;
  return VISITOR_ROUTE_CONTRACTS.find(({ path }) => path === leafPath);
}

function instantiateTemplate(template: string, parameter: string): string {
  return template.replace(PATH_PARAMETER_PATTERN, parameter);
}

/** URL-safe unreserved segment that never normalizes to `.` or `..`. */
const safeSegmentArbitrary = fc.stringMatching(/^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,23}$/);

const trailingSlashArbitrary = fc.boolean().map((enabled) => (enabled ? "/" : ""));

const existingAnalystRouteInstanceArbitrary = fc
  .tuple(
    fc.constantFrom(...EXISTING_ANALYST_ROUTE_TEMPLATES),
    safeSegmentArbitrary,
    fc.array(safeSegmentArbitrary, { maxLength: 4 }),
    trailingSlashArbitrary,
  )
  .map(([template, parameter, suffixSegments, trailingSlash]) => {
    const instance = instantiateTemplate(template, parameter);
    const suffix = suffixSegments.map((segment) => `/${segment}`).join("");
    return `${instance}${suffix}${trailingSlash}`;
  });

const unknownAnalystPathArbitrary = fc
  .tuple(fc.array(safeSegmentArbitrary, { maxLength: 5 }), trailingSlashArbitrary)
  .map(([segments, trailingSlash]) =>
    segments.length === 0 ? "/analyst/" : `/analyst/${segments.join("/")}${trailingSlash}`,
  );

const analystPathArbitrary = fc.oneof(
  { arbitrary: existingAnalystRouteInstanceArbitrary, weight: 3 },
  { arbitrary: unknownAnalystPathArbitrary, weight: 1 },
);

const directEntryLocationArbitrary = fc.record({
  pathname: analystPathArbitrary,
  search: fc.option(
    fc.stringMatching(/^[A-Za-z0-9=&_-]{0,16}$/).map((query) => `?${query}`),
    { nil: "" },
  ),
  hash: fc.option(
    fc.stringMatching(/^[A-Za-z0-9_-]{0,16}$/).map((fragment) => `#${fragment}`),
    { nil: "" },
  ),
});

describe("Visitor Router route registration", () => {
  it("is declared through Routes and registers exactly the visitor contract descriptors", () => {
    expect(elementType(AppRoutes())).toBe(Routes);

    const descriptorPaths = collectLeafDescriptors(VISITOR_ROUTE_OBJECTS).map(
      ({ path }) => path,
    );

    expect(descriptorPaths).toEqual(VISITOR_ROUTE_CONTRACTS.map(({ path }) => path));
  });

  it("registers zero analyst route descriptors and zero analyst page elements", () => {
    const descriptors = collectLeafDescriptors(VISITOR_ROUTE_OBJECTS);

    expect(ANALYST_PAGE_COMPONENTS.size).toBeGreaterThan(0);
    expect(
      descriptors.filter(({ path }) => /^\/analyst(?:\/|$)/u.test(path)),
    ).toEqual([]);
    expect(
      descriptors.filter(({ element }) => ANALYST_PAGE_COMPONENTS.has(elementType(element))),
    ).toEqual([]);
  });
});

describe("Property 3: Visitor Router excludes every analyst path", () => {
  // Feature: visitor-analyst-mode-separation, Property 3: Visitor Router excludes every analyst path
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  it("selects the shell-preserving wildcard 404 for every analyst route instance and /analyst/ suffix", () => {
    fc.assert(
      fc.property(directEntryLocationArbitrary, (location) => {
        expect(selectVisitorContract(location)).toEqual({
          path: "*",
          heading: "ページが見つかりません",
          kind: "WILDCARD",
        });

        const matches = matchRoutes(VISITOR_ROUTE_OBJECTS, location);
        expect(matches).not.toBeNull();
        const branch = matches ?? [];
        expect(branch).toHaveLength(2);

        const [layoutMatch, leafMatch] = branch;
        const layoutElement = layoutMatch?.route.element;
        expect(elementType(layoutElement)).toBe(AppShell);
        expect(
          isValidElement<{ navigationItems?: unknown }>(layoutElement)
            ? layoutElement.props.navigationItems
            : undefined,
        ).toBe(VISITOR_NAV_ITEMS);

        expect(leafMatch?.route.path).toBe("*");
        expect(elementType(leafMatch?.route.element)).toBe(NotFoundPage);

        const renderedAnalystPages = branch.filter(({ route }) =>
          ANALYST_PAGE_COMPONENTS.has(elementType(route.element)),
        );
        expect(renderedAnalystPages).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

const DIRECT_ENTRY_PARAMETER = "visitor-direct-entry-param";

const DIRECT_ENTRY_CASES = EXISTING_ANALYST_ROUTE_TEMPLATES.map((template) => ({
  path: instantiateTemplate(template, DIRECT_ENTRY_PARAMETER),
  analystHeading: ANALYST_HEADING_BY_TEMPLATE[template],
}));

describe("Visitor Router direct entry into analyst URLs", () => {
  it.each([
    ...DIRECT_ENTRY_CASES,
    { path: "/analyst/not-defined/visitor-direct-entry-param", analystHeading: undefined },
  ])(
    "renders the shell-preserving 404 instead of the analyst page for $path",
    ({ path, analystHeading }) => {
      renderWithRouter(<AppRoutes />, { initialEntries: [path] });

      expect(
        screen.getByRole("heading", { level: 1, name: "ページが見つかりません" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      if (analystHeading !== undefined) {
        expect(screen.queryByRole("heading", { name: analystHeading })).not.toBeInTheDocument();
      }
      expect(document.body).not.toHaveTextContent(DIRECT_ENTRY_PARAMETER);
      expect(document.body).not.toHaveTextContent(/run ID:|artifact ID:/u);

      expect(screen.getByText("404")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "ホームへ移動" })).toHaveAttribute("href", "/");

      expect(
        screen.getByText("会場ローカルデモ・一般公開ではありません"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("データ種別: 2022年実資料・AI解析")).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
      expect(
        screen.getByRole("button", { name: "前の画面に戻る。履歴がない場合はホームへ移動" }),
      ).toBeInTheDocument();

      const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
      const destinations = within(navigation)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href") ?? "");
      expect(destinations.filter((href) => href.startsWith("/analyst"))).toEqual([]);
      expect(
        screen.queryByRole("button", { name: /analyst|分析者|モード|mode/iu }),
      ).not.toBeInTheDocument();
    },
  );
});
