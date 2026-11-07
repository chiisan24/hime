// @vitest-environment jsdom

import { render, within } from "@testing-library/react";
import fc from "fast-check";
import {
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  MemoryRouter,
  type RouteObject,
} from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import { AppShell } from "../../shared/ui/AppShell.js";
import {
  CandidateDetailPage,
  CandidatesPage,
  ComparisonPage,
  SchedulePage,
  VenuePage,
} from "../public/pages.js";
import { VISITOR_ROUTE_CONTRACTS } from "../visitor/routeContracts.js";
import { ANALYST_NAV_ITEMS } from "./navigationItems.js";
import * as analystPages from "./pages.js";
import {
  ANALYST_ROUTE_CONTRACTS,
  selectAnalystRouteContract,
} from "./routeContracts.js";
import { AppRoutes } from "./routes.js";

type RoutedContract = Exclude<
  (typeof ANALYST_ROUTE_CONTRACTS)[number],
  Readonly<{ kind: "WILDCARD" }>
>;

type EntrySource =
  | "EXISTING_ANALYST_ROUTE"
  | "REMAINING_PUBLIC_ROUTE"
  | "ANALYST_HOME_LINK"
  | "PUBLIC_HOME_LINK"
  | "NAVIGATION_DESTINATION";

type PresentedDestination = Readonly<{
  source: Extract<
    EntrySource,
    "ANALYST_HOME_LINK" | "PUBLIC_HOME_LINK" | "NAVIGATION_DESTINATION"
  >;
  href: string;
}>;

type AnalystRouterEntry = Readonly<{
  source: EntrySource;
  pathname: string;
  search: string;
  hash: string;
  /** Known only for generated route-contract instances. */
  expectedContract: RoutedContract | null;
  expectedParams: Readonly<Record<string, string>> | null;
}>;

const RETIRED_PUBLIC_SOURCES_PATH = "/sources";
const PATH_PARAMETER_PATTERN = /:([A-Za-z]+)/gu;

/**
 * Independent oracle for the existing screen correspondence: every routed
 * Analyst contract path and the page component that must render there.
 */
const PAGE_BY_CONTRACT_PATH = {
  "/": analystPages.AnalystHomePage,
  "/schedule": SchedulePage,
  "/candidates": CandidatesPage,
  "/candidates/:candidateId": CandidateDetailPage,
  "/comparison": ComparisonPage,
  "/venue": VenuePage,
  "/analyst/readiness": analystPages.AnalystReadinessPage,
  "/analyst/sources": analystPages.AnalystSourcesPage,
  "/analyst/runs": analystPages.AnalystRunsPage,
  "/analyst/runs/:runId": analystPages.AnalystRunDetailPage,
  "/analyst/verification/:artifactId": analystPages.AnalystVerificationPage,
  "/analyst/review/:artifactId": analystPages.AnalystReviewPage,
  "/analyst/evaluation": analystPages.AnalystEvaluationPage,
  "/analyst/p0": analystPages.AnalystP0Page,
  "/analyst/aws": analystPages.AnalystAwsPage,
} as const satisfies Readonly<Record<RoutedContract["path"], ComponentType>>;

const PAGE_BY_PATH: ReadonlyMap<string, ComponentType> = new Map<string, ComponentType>(
  Object.entries(PAGE_BY_CONTRACT_PATH),
);

const EXISTING_ANALYST_PAGE_EXPORTS = [
  "AnalystHomePage",
  "AnalystReadinessPage",
  "AnalystSourcesPage",
  "AnalystRunsPage",
  "AnalystRunDetailPage",
  "AnalystVerificationPage",
  "AnalystReviewPage",
  "AnalystEvaluationPage",
  "AnalystP0Page",
  "AnalystAwsPage",
] as const satisfies readonly (keyof typeof analystPages)[];

const ANALYST_PAGE_COMPONENTS: ReadonlySet<unknown> = new Set<unknown>(
  EXISTING_ANALYST_PAGE_EXPORTS.map((name) => analystPages[name]),
);

const ROUTED_CONTRACTS: readonly RoutedContract[] = ANALYST_ROUTE_CONTRACTS.filter(
  (contract): contract is RoutedContract => contract.kind !== "WILDCARD",
);
const EXISTING_ANALYST_CONTRACTS = ROUTED_CONTRACTS.filter(
  ({ kind }) => kind === "ANALYST",
);
const REMAINING_PUBLIC_CONTRACTS = ROUTED_CONTRACTS.filter(
  ({ kind }) => kind === "PUBLIC",
);

function elementType(node: ReactNode): unknown {
  return isValidElement(node) ? node.type : undefined;
}

/** Reads the route objects declared by the Analyst Router entry without mounting it. */
function readAnalystRouteObjects(): RouteObject[] {
  const routesElement: ReactElement<{ children?: ReactNode }> = AppRoutes();
  return createRoutesFromChildren(routesElement.props.children);
}

const ANALYST_ROUTE_OBJECTS = readAnalystRouteObjects();

function normalizedLeafPath(route: RouteObject): string {
  if (route.index === true) {
    return "/";
  }
  if (route.path === "*") {
    return "*";
  }
  return `/${route.path ?? ""}`;
}

function collectLeafPages(routes: readonly RouteObject[]): unknown[] {
  return routes.flatMap((route) =>
    route.children !== undefined && route.children.length > 0
      ? collectLeafPages(route.children)
      : [elementType(route.element)],
  );
}

/** Renders each mapped page once and records its single h1 as the heading oracle. */
function collectPageHeadings(): ReadonlyMap<unknown, string> {
  const headings = new Map<unknown, string>();

  for (const Page of new Set(PAGE_BY_PATH.values())) {
    const view = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    try {
      const pageHeadings = within(view.container).getAllByRole("heading", { level: 1 });
      expect(pageHeadings).toHaveLength(1);
      headings.set(Page, pageHeadings[0]?.textContent ?? "");
    } finally {
      view.unmount();
    }
  }

  return headings;
}

/** Reads the Analyst Home links and Shared Navigation destinations rendered at `/`. */
function collectPresentedDestinations(): readonly PresentedDestination[] {
  const view = renderWithRouter(<AppRoutes />, { initialEntries: ["/"] });

  try {
    const container = within(view.container);
    const hrefsIn = (element: HTMLElement): string[] =>
      within(element)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href") ?? "");

    const analystHomeHrefs = hrefsIn(
      container.getByRole("region", { name: "ローカル分析のP0画面" }),
    );
    const publicHomeHrefs = hrefsIn(
      container.getByRole("region", { name: "会場閲覧のP0画面" }),
    );
    const navigationHrefs = hrefsIn(
      container.getByRole("navigation", { name: "共通ナビゲーション" }),
    );

    return [
      ...analystHomeHrefs.map(
        (href): PresentedDestination => ({ source: "ANALYST_HOME_LINK", href }),
      ),
      ...publicHomeHrefs.map(
        (href): PresentedDestination => ({ source: "PUBLIC_HOME_LINK", href }),
      ),
      ...navigationHrefs.map(
        (href): PresentedDestination => ({ source: "NAVIGATION_DESTINATION", href }),
      ),
    ];
  } finally {
    view.unmount();
  }
}

function instantiateContract(
  source: Extract<EntrySource, "EXISTING_ANALYST_ROUTE" | "REMAINING_PUBLIC_ROUTE">,
  contract: RoutedContract,
  parameter: string,
  trailingSlash: boolean,
  search: string,
  hash: string,
): AnalystRouterEntry {
  const parameterNames = Array.from(
    contract.path.matchAll(PATH_PARAMETER_PATTERN),
    (match) => match[1] ?? "",
  );
  const concretePath = contract.path.replace(PATH_PARAMETER_PATTERN, parameter);

  return {
    source,
    pathname: trailingSlash && concretePath !== "/" ? `${concretePath}/` : concretePath,
    search,
    hash,
    expectedContract: contract,
    expectedParams: Object.fromEntries(parameterNames.map((name) => [name, parameter])),
  };
}

function expectedKind(entry: AnalystRouterEntry): "PUBLIC" | "ANALYST" {
  switch (entry.source) {
    case "EXISTING_ANALYST_ROUTE":
    case "ANALYST_HOME_LINK":
      return "ANALYST";
    case "REMAINING_PUBLIC_ROUTE":
    case "PUBLIC_HOME_LINK":
      return "PUBLIC";
    case "NAVIGATION_DESTINATION":
      return entry.pathname.startsWith("/analyst/") ? "ANALYST" : "PUBLIC";
  }
}

/** ID-like path parameter made of URL unreserved characters, never `.` or `..`. */
const pathParameterArbitrary = fc.stringMatching(/^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,31}$/);

const searchArbitrary = fc.option(
  fc.stringMatching(/^[A-Za-z0-9=&_-]{0,16}$/).map((query) => `?${query}`),
  { nil: "" },
);

const hashArbitrary = fc.option(
  fc.stringMatching(/^[A-Za-z0-9_-]{0,16}$/).map((fragment) => `#${fragment}`),
  { nil: "" },
);

function contractInstanceArbitrary(
  source: Extract<EntrySource, "EXISTING_ANALYST_ROUTE" | "REMAINING_PUBLIC_ROUTE">,
  contracts: readonly RoutedContract[],
): fc.Arbitrary<AnalystRouterEntry> {
  return fc
    .record({
      contract: fc.constantFrom(...contracts),
      parameter: pathParameterArbitrary,
      trailingSlash: fc.boolean(),
      search: searchArbitrary,
      hash: hashArbitrary,
    })
    .map(({ contract, parameter, trailingSlash, search, hash }) =>
      instantiateContract(source, contract, parameter, trailingSlash, search, hash),
    );
}

function presentedDestinationArbitrary(
  destinations: readonly PresentedDestination[],
): fc.Arbitrary<AnalystRouterEntry> {
  return fc
    .record({
      destination: fc.constantFrom(...destinations),
      search: searchArbitrary,
      hash: hashArbitrary,
    })
    .map(
      ({ destination, search, hash }): AnalystRouterEntry => ({
        source: destination.source,
        pathname: destination.href,
        search,
        hash,
        expectedContract: null,
        expectedParams: null,
      }),
    );
}

describe("Property 4: Analyst Router preserves existing route contracts", () => {
  // Feature: visitor-analyst-mode-separation, Property 4: Analyst Router preserves existing route contracts
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 8.7**
  it(
    "resolves every analyst and remaining public route instance, Home link, and navigation destination to its existing page and heading",
    { timeout: 30_000 },
    () => {
      const headingByPage = collectPageHeadings();
      const destinations = collectPresentedDestinations();

      expect(EXISTING_ANALYST_CONTRACTS.length).toBeGreaterThan(0);
      expect(REMAINING_PUBLIC_CONTRACTS.length).toBeGreaterThan(0);
      expect(
        destinations.filter(({ source }) => source === "ANALYST_HOME_LINK").length,
      ).toBeGreaterThan(0);
      expect(
        destinations.filter(
          ({ source, href }) =>
            source === "NAVIGATION_DESTINATION" && href.startsWith("/analyst/"),
        ).length,
      ).toBeGreaterThan(0);

      const sourceManifestContract = EXISTING_ANALYST_CONTRACTS.find(
        ({ path }) => path === "/analyst/sources",
      );
      if (sourceManifestContract === undefined) {
        throw new Error("The /analyst/sources contract is missing from the Analyst matrix");
      }

      const entryArbitrary = fc.oneof(
        {
          arbitrary: contractInstanceArbitrary(
            "EXISTING_ANALYST_ROUTE",
            EXISTING_ANALYST_CONTRACTS,
          ),
          weight: 4,
        },
        {
          arbitrary: contractInstanceArbitrary(
            "REMAINING_PUBLIC_ROUTE",
            REMAINING_PUBLIC_CONTRACTS,
          ),
          weight: 2,
        },
        { arbitrary: presentedDestinationArbitrary(destinations), weight: 2 },
      );

      fc.assert(
        fc.property(entryArbitrary, (entry) => {
          const selected = selectAnalystRouteContract(entry.pathname);
          expect(selected.kind).toBe(expectedKind(entry));
          if (entry.expectedContract !== null) {
            expect(selected).toBe(entry.expectedContract);
          }

          const branch =
            matchRoutes(ANALYST_ROUTE_OBJECTS, {
              pathname: entry.pathname,
              search: entry.search,
              hash: entry.hash,
            }) ?? [];
          expect(branch).toHaveLength(2);
          const [layoutMatch, leafMatch] = branch;

          const layoutElement = layoutMatch?.route.element;
          expect(elementType(layoutElement)).toBe(AppShell);
          expect(
            isValidElement<{ navigationItems?: unknown }>(layoutElement)
              ? layoutElement.props.navigationItems
              : undefined,
          ).toBe(ANALYST_NAV_ITEMS);

          if (leafMatch === undefined) {
            throw new Error(`No leaf route matched ${entry.pathname}`);
          }
          const leafPath = normalizedLeafPath(leafMatch.route);
          expect(leafPath).toBe(selected.path);
          expect(leafPath).not.toBe(RETIRED_PUBLIC_SOURCES_PATH);

          const page = elementType(leafMatch.route.element);
          expect(page).toBeDefined();
          expect(page).toBe(PAGE_BY_PATH.get(selected.path));
          expect(headingByPage.get(page)).toBe(selected.heading);

          if (entry.expectedParams !== null) {
            expect({ ...leafMatch.params }).toEqual(entry.expectedParams);
          }

          if (selected.kind === "ANALYST") {
            expect(ANALYST_PAGE_COMPONENTS.has(page)).toBe(true);
          } else {
            expect(
              VISITOR_ROUTE_CONTRACTS.find(({ path }) => path === selected.path)?.heading,
            ).toBe(selected.heading);
          }
        }),
        {
          numRuns: 200,
          examples: [
            [
              instantiateContract(
                "EXISTING_ANALYST_ROUTE",
                sourceManifestContract,
                "unused",
                false,
                "",
                "",
              ),
            ],
          ],
        },
      );
    },
  );
});

describe("Analyst page module preservation", () => {
  it("keeps every existing analyst page component and wires each into exactly one Analyst Router route", () => {
    const leafPages = collectLeafPages(ANALYST_ROUTE_OBJECTS);

    for (const name of EXISTING_ANALYST_PAGE_EXPORTS) {
      const page: unknown = analystPages[name];
      expect(typeof page, name).toBe("function");
      expect(leafPages.filter((leafPage) => leafPage === page), name).toHaveLength(1);
    }
  });
});
