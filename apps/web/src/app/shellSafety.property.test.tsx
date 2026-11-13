// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import fc from "fast-check";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  type RouteObject,
} from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import type { ApplicationMode } from "../config/applicationMode.js";
import { AppShell, VISITOR_NAV_ITEMS } from "../shared/ui/AppShell.js";
import { ANALYST_NAV_ITEMS } from "./analyst/navigationItems.js";
import {
  AnalystAwsPage,
  AnalystEvaluationPage,
  AnalystHomePage,
  AnalystP0Page,
  AnalystReadinessPage,
  AnalystReviewPage,
  AnalystRunDetailPage,
  AnalystRunsPage,
  AnalystSourcesPage,
  AnalystVerificationPage,
} from "./analyst/pages.js";
import { selectAnalystRouteContract } from "./analyst/routeContracts.js";
import { AppRoutes as AnalystAppRoutes } from "./analyst/routes.js";
import {
  CandidateDetailPage,
  CandidatesPage,
  ComparisonPage,
  NotFoundPage,
  SchedulePage,
  VenuePage,
  VisitorHomePage,
} from "./public/pages.js";
import { VISITOR_ROUTE_CONTRACTS } from "./visitor/routeContracts.js";
import { AppRoutes as VisitorAppRoutes } from "./visitor/routes.js";
import { ValuesDiagnosis } from "../features/values/ValuesDiagnosis.js";

/*
 * Feature: visitor-analyst-mode-separation, Property 6: preserved shell and route safety contracts
 *
 * The two route entries are imported directly instead of through `#app-routes`,
 * because that alias selects only one entry (Visitor in the default Vitest mode).
 *
 * Test split: mounting React and running role queries for every generated case
 * is slow in jsdom, so the property is checked in two layers.
 * 1. A pure fast-check property (300 runs) runs `matchRoutes` over the route
 *    objects that each mode's route entry declares. Inputs are generated for
 *    both Application Modes and every route category. The property checks that
 *    every location resolves inside exactly one AppShell layout of the mode's
 *    navigation items (with no data-kind override), that available routes
 *    select the expected page component, that unavailable routes select the
 *    wildcard NotFoundPage, and that the mode's route contract matrix agrees.
 * 2. A bounded mounted matrix renders every route template plus representative
 *    unknown, P1, P2, and retired `/sources` paths in both modes. It checks the
 *    DOM contracts the pure layer cannot see: banners, one data-kind label, one
 *    h1, skip link, landmarks, back behavior, aria-current, 44px controls,
 *    NOT_READY, and zero simulated AI progress.
 */

type RouteCategory =
  | "PUBLIC"
  | "ANALYST"
  | "UNKNOWN"
  | "P1"
  | "P2"
  | "RETIRED_SOURCES";

type TerminalState = "NOT_READY" | "no-data" | "404";

type AvailableRouteSpec = Readonly<{
  category: "PUBLIC" | "ANALYST";
  template: string;
  heading: string;
  pageByMode: Readonly<Record<ApplicationMode, unknown>>;
  currentNavHref: string | null;
  terminalStates: readonly TerminalState[];
}>;

type RouteCase = Readonly<{
  category: RouteCategory;
  pathname: string;
  spec: AvailableRouteSpec | null;
}>;

type ExpectedSelection =
  | Readonly<{ available: true; spec: AvailableRouteSpec; page: unknown; heading: string }>
  | Readonly<{ available: false; heading: string }>;

const APPLICATION_MODES = ["VISITOR", "ANALYST"] as const satisfies readonly ApplicationMode[];

const NOT_FOUND_HEADING = "ページが見つかりません";
const LOCAL_ONLY_TEXT = "会場ローカルデモ・一般公開ではありません";
const PAST_ELECTION_TEXT =
  "2022年に終了した過去選挙です。現在または将来の投票所判断には使えません";
const REAL_AI_DATA_KIND_TEXT = "データ種別: 2022年実資料・AI解析";
const FIXTURE_DATA_KIND_LABEL = "架空fixture・UIテスト専用";
const FOOTER_NOT_READY_TEXT = "政策解析準備状態: NOT_READY";
const BACK_CONTROL_NAME = "前の画面に戻る。履歴がない場合はホームへ移動";
const SIMULATED_AI_PROGRESS_PATTERN = /解析中|生成中|処理中/u;

function samePage(page: unknown): Readonly<Record<ApplicationMode, unknown>> {
  return { VISITOR: page, ANALYST: page };
}

const PUBLIC_ROUTE_SPECS: readonly AvailableRouteSpec[] = [
  {
    category: "PUBLIC",
    template: "/",
    heading: "えひめ投票ナビ",
    pageByMode: { VISITOR: VisitorHomePage, ANALYST: AnalystHomePage },
    currentNavHref: "/",
    terminalStates: ["NOT_READY"],
  },
  {
    category: "PUBLIC",
    template: "/schedule",
    heading: "選挙日程",
    pageByMode: samePage(SchedulePage),
    currentNavHref: "/schedule",
    terminalStates: ["no-data"],
  },
  {
    category: "PUBLIC",
    template: "/candidates",
    heading: "候補者一覧",
    pageByMode: samePage(CandidatesPage),
    currentNavHref: "/candidates",
    terminalStates: ["NOT_READY"],
  },
  {
    category: "PUBLIC",
    template: "/candidates/:candidateId",
    heading: "候補者詳細",
    pageByMode: samePage(CandidateDetailPage),
    currentNavHref: "/candidates",
    terminalStates: ["NOT_READY"],
  },
  {
    category: "PUBLIC",
    template: "/comparison",
    heading: "政策比較",
    pageByMode: samePage(ComparisonPage),
    currentNavHref: "/comparison",
    terminalStates: ["NOT_READY"],
  },
  {
    category: "PUBLIC",
    template: "/venue",
    heading: "会場閲覧",
    pageByMode: samePage(VenuePage),
    currentNavHref: "/venue",
    terminalStates: ["NOT_READY"],
  },
  {
    // 価値観診断（regional-values-map tasks.md 14 の案Bの承認記録）。共通ナビの項目はない
    category: "PUBLIC",
    template: "/values",
    heading: "価値観マップ",
    pageByMode: samePage(ValuesDiagnosis),
    currentNavHref: null,
    terminalStates: [],
  },
];

/**
 * 選挙に依存しない画面。2022年選挙専用の表示（過去選挙表示・データ種別・フッター）を出さず、
 * デモ用の架空データであることを出す。ローカル限定表示・ナビ・戻る操作などの共通の枠は保つ。
 */
const ELECTION_INDEPENDENT_TEMPLATES: ReadonlySet<string> = new Set(["/values"]);
const DEMO_DATA_TEXT = "デモ用の架空データです";

const ANALYST_ROUTE_SPECS: readonly AvailableRouteSpec[] = [
  {
    category: "ANALYST",
    template: "/analyst/readiness",
    heading: "政策解析準備状態",
    pageByMode: samePage(AnalystReadinessPage),
    currentNavHref: "/analyst/readiness",
    terminalStates: ["NOT_READY"],
  },
  {
    category: "ANALYST",
    template: "/analyst/sources",
    heading: "Source Manifest",
    pageByMode: samePage(AnalystSourcesPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
  {
    category: "ANALYST",
    template: "/analyst/runs",
    heading: "解析実行と履歴",
    pageByMode: samePage(AnalystRunsPage),
    currentNavHref: null,
    terminalStates: ["NOT_READY"],
  },
  {
    category: "ANALYST",
    template: "/analyst/runs/:runId",
    heading: "解析run詳細",
    pageByMode: samePage(AnalystRunDetailPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
  {
    category: "ANALYST",
    template: "/analyst/verification/:artifactId",
    heading: "根拠検証",
    pageByMode: samePage(AnalystVerificationPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
  {
    category: "ANALYST",
    template: "/analyst/review/:artifactId",
    heading: "人間確認",
    pageByMode: samePage(AnalystReviewPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
  {
    category: "ANALYST",
    template: "/analyst/evaluation",
    heading: "評価",
    pageByMode: samePage(AnalystEvaluationPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
  {
    category: "ANALYST",
    template: "/analyst/p0",
    heading: "P0完成判定",
    pageByMode: samePage(AnalystP0Page),
    currentNavHref: null,
    terminalStates: ["NOT_READY"],
  },
  {
    category: "ANALYST",
    template: "/analyst/aws",
    heading: "AWS診断",
    pageByMode: samePage(AnalystAwsPage),
    currentNavHref: null,
    terminalStates: ["no-data"],
  },
];

/** P1 routes named by the ehime-vote-navigator design; they stay unregistered. */
const P1_ROUTES = [
  "/polling-place/election-day",
  "/polling-place/early",
  "/chat",
  "/voting-guide",
] as const;

/** P2 routes used by the existing route regression suite; they stay unregistered. */
const P2_ROUTES = [
  "/three-dimensional-policy",
  "/notifications",
  "/speech",
  "/calendar",
] as const;

/** First path segments that belong to a defined category and must not be generated as "unknown". */
const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  "values",
  "schedule",
  "candidates",
  "comparison",
  "venue",
  "analyst",
  "sources",
  "polling-place",
  "chat",
  "voting-guide",
  "three-dimensional-policy",
  "notifications",
  "speech",
  "calendar",
]);

const RESERVED_ANALYST_SEGMENTS: ReadonlySet<string> = new Set([
  "readiness",
  "sources",
  "runs",
  "verification",
  "review",
  "evaluation",
  "p0",
  "aws",
]);

/**
 * Templates that become unregistered when extra segments are appended. `/` and
 * the parameterless parents of parameterized routes are excluded because one
 * extra segment would land on another registered route.
 */
const OVERLONG_BASE_TEMPLATES = [...PUBLIC_ROUTE_SPECS, ...ANALYST_ROUTE_SPECS]
  .map(({ template }) => template)
  .filter((template) => !["/", "/candidates", "/analyst/runs"].includes(template));

const NAV_HREFS_BY_MODE = {
  VISITOR: ["/", "/schedule", "/candidates", "/comparison", "/venue"],
  ANALYST: [
    "/",
    "/schedule",
    "/candidates",
    "/comparison",
    "/venue",
    "/analyst/readiness",
  ],
} as const satisfies Record<ApplicationMode, readonly string[]>;

/** The fixed Shared Navigation items each mode's route entry passes to AppShell. */
const NAV_ITEMS_BY_MODE = {
  VISITOR: VISITOR_NAV_ITEMS,
  ANALYST: ANALYST_NAV_ITEMS,
} as const satisfies Record<ApplicationMode, unknown>;

const PATH_PARAMETER_PATTERN = /:[A-Za-z]+/gu;

function instantiateTemplate(template: string, parameter: string): string {
  return template.replace(PATH_PARAMETER_PATTERN, parameter);
}

function elementType(node: ReactNode): unknown {
  return isValidElement(node) ? node.type : undefined;
}

function elementProps(node: ReactNode): unknown {
  return isValidElement(node) ? node.props : undefined;
}

function readRouteObjects(routes: () => ReactElement<{ children?: ReactNode }>): RouteObject[] {
  return createRoutesFromChildren(routes().props.children);
}

const ROUTE_OBJECTS_BY_MODE: Readonly<Record<ApplicationMode, RouteObject[]>> = {
  VISITOR: readRouteObjects(VisitorAppRoutes),
  ANALYST: readRouteObjects(AnalystAppRoutes),
};

const VISITOR_CONTRACT_ROUTE_OBJECTS: RouteObject[] = VISITOR_ROUTE_CONTRACTS.map(
  ({ path }) => ({ path }),
);

function normalizedLeafPath(route: RouteObject | undefined): string | undefined {
  if (route === undefined) {
    return undefined;
  }
  if (route.index === true) {
    return "/";
  }
  return route.path === "*" ? "*" : `/${route.path ?? ""}`;
}

/** Heading selected by the mode's own route contract matrix. */
function selectContractHeading(
  mode: ApplicationMode,
  location: Readonly<{ pathname: string; search: string; hash: string }>,
): string | undefined {
  if (mode === "ANALYST") {
    return selectAnalystRouteContract(location.pathname).heading;
  }
  const leafPath = matchRoutes(VISITOR_CONTRACT_ROUTE_OBJECTS, location)?.at(-1)?.route.path;
  return VISITOR_ROUTE_CONTRACTS.find(({ path }) => path === leafPath)?.heading;
}

function expectedSelection(mode: ApplicationMode, routeCase: RouteCase): ExpectedSelection {
  const { spec } = routeCase;
  if (spec !== null && (spec.category === "PUBLIC" || mode === "ANALYST")) {
    return { available: true, spec, page: spec.pageByMode[mode], heading: spec.heading };
  }
  return { available: false, heading: NOT_FOUND_HEADING };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** URL-safe unreserved segment that never normalizes to `.` or `..`. */
const safeSegmentArbitrary = fc.stringMatching(/^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,23}$/);

const trailingSlashArbitrary = fc.boolean().map((enabled) => (enabled ? "/" : ""));

const extraSegmentsArbitrary = (minLength: number) =>
  fc
    .array(safeSegmentArbitrary, { minLength, maxLength: 3 })
    .map((segments) => segments.map((segment) => `/${segment}`).join(""));

function availableRouteCaseArbitrary(
  specs: readonly AvailableRouteSpec[],
): fc.Arbitrary<RouteCase> {
  return fc
    .tuple(fc.constantFrom(...specs), safeSegmentArbitrary, trailingSlashArbitrary)
    .map(([spec, parameter, trailingSlash]): RouteCase => ({
      category: spec.category,
      pathname:
        spec.template === "/"
          ? "/"
          : `${instantiateTemplate(spec.template, parameter)}${trailingSlash}`,
      spec,
    }));
}

const unknownRootPathArbitrary = fc
  .tuple(
    safeSegmentArbitrary.filter(
      (segment) => !RESERVED_ROOT_SEGMENTS.has(segment.toLowerCase()),
    ),
    extraSegmentsArbitrary(0),
    trailingSlashArbitrary,
  )
  .map(([first, rest, trailingSlash]) => `/${first}${rest}${trailingSlash}`);

const unknownAnalystPathArbitrary = fc
  .tuple(
    fc.option(
      safeSegmentArbitrary.filter(
        (segment) => !RESERVED_ANALYST_SEGMENTS.has(segment.toLowerCase()),
      ),
      { nil: undefined },
    ),
    extraSegmentsArbitrary(0),
    trailingSlashArbitrary,
  )
  .map(([first, rest, trailingSlash]) =>
    first === undefined ? `/analyst${trailingSlash}` : `/analyst/${first}${rest}${trailingSlash}`,
  );

const overlongKnownPathArbitrary = fc
  .tuple(
    fc.constantFrom(...OVERLONG_BASE_TEMPLATES),
    safeSegmentArbitrary,
    extraSegmentsArbitrary(1),
    trailingSlashArbitrary,
  )
  .map(
    ([template, parameter, extra, trailingSlash]) =>
      `${instantiateTemplate(template, parameter)}${extra}${trailingSlash}`,
  );

const unknownRouteCaseArbitrary: fc.Arbitrary<RouteCase> = fc
  .oneof(unknownRootPathArbitrary, unknownAnalystPathArbitrary, overlongKnownPathArbitrary)
  .map((pathname): RouteCase => ({ category: "UNKNOWN", pathname, spec: null }));

function futureRouteCaseArbitrary(
  category: "P1" | "P2",
  routes: readonly string[],
): fc.Arbitrary<RouteCase> {
  return fc
    .tuple(fc.constantFrom(...routes), trailingSlashArbitrary)
    .map(([route, trailingSlash]): RouteCase => ({
      category,
      pathname: `${route}${trailingSlash}`,
      spec: null,
    }));
}

const retiredSourcesRouteCaseArbitrary: fc.Arbitrary<RouteCase> = fc
  .tuple(
    fc.constantFrom("/sources", "/Sources", "/SOURCES"),
    extraSegmentsArbitrary(0),
    trailingSlashArbitrary,
  )
  .map(([base, extra, trailingSlash]): RouteCase => ({
    category: "RETIRED_SOURCES",
    pathname: `${base}${extra}${trailingSlash}`,
    spec: null,
  }));

const routeCaseArbitrary: fc.Arbitrary<RouteCase> = fc.oneof(
  availableRouteCaseArbitrary(PUBLIC_ROUTE_SPECS),
  availableRouteCaseArbitrary(ANALYST_ROUTE_SPECS),
  unknownRouteCaseArbitrary,
  futureRouteCaseArbitrary("P1", P1_ROUTES),
  futureRouteCaseArbitrary("P2", P2_ROUTES),
  retiredSourcesRouteCaseArbitrary,
);

/** Query and hash values, including analyst-looking tokens that must not change selection. */
const searchArbitrary = fc.oneof(
  fc.constant(""),
  fc.constantFrom("?mode=analyst", "?applicationMode=ANALYST", "?analyst"),
  fc.stringMatching(/^[A-Za-z0-9=&_-]{0,16}$/).map((query) => `?${query}`),
);

const hashArbitrary = fc.oneof(
  fc.constant(""),
  fc.constantFrom("#analyst", "#ANALYST", "#mode=analyst"),
  fc.stringMatching(/^[A-Za-z0-9_-]{0,16}$/).map((fragment) => `#${fragment}`),
);

describe("Property 6: preserved shell and route safety contracts", () => {
  // Feature: visitor-analyst-mode-separation, Property 6: preserved shell and route safety contracts
  // **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**
  it("resolves every mode and route category inside the mode's shell to the right page or the 404", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...APPLICATION_MODES),
        routeCaseArbitrary,
        searchArbitrary,
        hashArbitrary,
        (mode, routeCase, search, hash) => {
          const location = { pathname: routeCase.pathname, search, hash };
          const expected = expectedSelection(mode, routeCase);

          const branch = matchRoutes(ROUTE_OBJECTS_BY_MODE[mode], location) ?? [];
          expect(branch).toHaveLength(2);
          const [layoutMatch, leafMatch] = branch;

          // Exactly one shared AppShell layout, fixed to the mode's navigation items and
          // the default exclusive REAL_AI data kind (no override from the route entry).
          const layoutElement = layoutMatch?.route.element;
          expect(elementType(layoutElement)).toBe(AppShell);
          expect(elementProps(layoutElement)).toEqual({
            navigationItems: NAV_ITEMS_BY_MODE[mode],
          });
          expect(
            isValidElement<{ navigationItems?: unknown }>(layoutElement)
              ? layoutElement.props.navigationItems
              : undefined,
          ).toBe(NAV_ITEMS_BY_MODE[mode]);
          expect(elementType(leafMatch?.route.element)).not.toBe(AppShell);

          if (expected.available) {
            expect(normalizedLeafPath(leafMatch?.route)).toBe(expected.spec.template);
            expect(elementType(leafMatch?.route.element)).toBe(expected.page);
          } else {
            expect(normalizedLeafPath(leafMatch?.route)).toBe("*");
            expect(elementType(leafMatch?.route.element)).toBe(NotFoundPage);
          }

          expect(selectContractHeading(mode, location)).toBe(expected.heading);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Bounded mounted shell matrix
// ---------------------------------------------------------------------------

const MOUNTED_PATH_PARAMETERS: Readonly<Record<string, string>> = {
  candidateId: "nakamura-tokihiro",
  runId: "run-example",
  artifactId: "artifact-example",
};

function concretePath(template: string): string {
  return template.replace(/:(\w+)/gu, (_segment, name: string) => {
    const value = MOUNTED_PATH_PARAMETERS[name];
    if (value === undefined) {
      throw new Error(`No sample value for path parameter ${name}`);
    }
    return value;
  });
}

type MountedCase = Readonly<{
  mode: ApplicationMode;
  routeCase: RouteCase;
}>;

const MOUNTED_ROUTE_CASES: readonly RouteCase[] = [
  ...[...PUBLIC_ROUTE_SPECS, ...ANALYST_ROUTE_SPECS].map((spec) => ({
    category: spec.category,
    pathname: concretePath(spec.template),
    spec,
  })),
  { category: "UNKNOWN", pathname: "/not-a-p0-route", spec: null },
  { category: "UNKNOWN", pathname: "/analyst/not-defined", spec: null },
  ...P1_ROUTES.map((pathname) => ({ category: "P1" as const, pathname, spec: null })),
  ...P2_ROUTES.map((pathname) => ({ category: "P2" as const, pathname, spec: null })),
  { category: "RETIRED_SOURCES", pathname: "/sources", spec: null },
];

const MOUNTED_CASES: readonly MountedCase[] = APPLICATION_MODES.flatMap((mode) =>
  MOUNTED_ROUTE_CASES.map((routeCase) => ({ mode, routeCase })),
);

function routesForMode(mode: ApplicationMode) {
  return mode === "ANALYST" ? <AnalystAppRoutes /> : <VisitorAppRoutes />;
}

function sharedNavigationLinks(): HTMLElement[] {
  const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
  return within(navigation).getAllByRole("link");
}

function expectPreservedShell(mode: ApplicationMode, template: string | null = null) {
  const electionIndependent = template !== null && ELECTION_INDEPENDENT_TEMPLATES.has(template);
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  const banner = screen.getByRole("banner");
  expect(within(banner).getByText(LOCAL_ONLY_TEXT)).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(FIXTURE_DATA_KIND_LABEL);

  if (electionIndependent) {
    expect(within(banner).queryByText(PAST_ELECTION_TEXT)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(0);
    expect(screen.queryAllByRole("contentinfo")).toHaveLength(0);
    expect(screen.getByRole("note")).toHaveTextContent(DEMO_DATA_TEXT);
  } else {
    expect(within(banner).getByText(PAST_ELECTION_TEXT)).toBeInTheDocument();
    const dataKindLabels = Array.from(document.querySelectorAll("[data-kind]"));
    expect(dataKindLabels).toHaveLength(1);
    expect(dataKindLabels[0]).toHaveAttribute("data-kind", "REAL_AI");
    expect(dataKindLabels[0]).toHaveTextContent(REAL_AI_DATA_KIND_TEXT);
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(FOOTER_NOT_READY_TEXT);
  }

  expect(screen.getByRole("link", { name: "本文へ移動" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");

  const navigationLinks = sharedNavigationLinks();
  expect(navigationLinks.map((link) => link.getAttribute("href"))).toEqual(
    NAV_HREFS_BY_MODE[mode],
  );
  for (const link of navigationLinks) {
    expect(link).toHaveClass("min-h-11", "min-w-11");
  }

  const backControl = screen.getByRole("button", { name: BACK_CONTROL_NAME });
  expect(backControl).toHaveAttribute("type", "button");
  expect(backControl).toHaveClass("min-h-11", "min-w-11");
}

function expectNoSimulatedAiProgress() {
  expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  expect(document.querySelectorAll("progress, [aria-busy='true']")).toHaveLength(0);
  expect(document.body).not.toHaveTextContent(SIMULATED_AI_PROGRESS_PATTERN);
}

function currentNavigationHrefs(): (string | null)[] {
  return sharedNavigationLinks()
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));
}

describe("Property 6 mounted shell contracts (bounded matrix)", () => {
  // Feature: visitor-analyst-mode-separation, Property 6: preserved shell and route safety contracts
  // **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**
  it.each(MOUNTED_CASES)(
    "keeps the shell, safety displays, and back fallback for $mode $routeCase.category $routeCase.pathname",
    ({ mode, routeCase }) => {
      const expected = expectedSelection(mode, routeCase);
      renderWithRouter(routesForMode(mode), { initialEntries: [routeCase.pathname] });

      expectPreservedShell(mode, routeCase.spec?.template ?? null);
      expectNoSimulatedAiProgress();

      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent(expected.heading);

      const terminalStates = Array.from(
        screen.getByRole("main").querySelectorAll("[data-terminal-state]"),
      ).map((element) => element.getAttribute("data-terminal-state"));
      const expectedCurrentHref = expected.available ? expected.spec.currentNavHref : null;

      if (expected.available) {
        expect([...new Set(terminalStates)]).toEqual(expected.spec.terminalStates);
      } else {
        expect(terminalStates).toEqual(["404"]);
        expect(screen.getByText("404")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "ホームへ移動" })).toHaveAttribute(
          "href",
          "/",
        );
      }
      expect(currentNavigationHrefs()).toEqual(
        expectedCurrentHref === null ? [] : [expectedCurrentHref],
      );

      // Direct entry has no in-app history, so back falls back to the mode's Home
      // inside the same shell and navigation items.
      fireEvent.click(screen.getByRole("button", { name: BACK_CONTROL_NAME }));

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
      ).toBeInTheDocument();
      expectPreservedShell(mode);
      expect(currentNavigationHrefs()).toEqual(["/"]);
      expect(
        screen.queryByRole("heading", { level: 2, name: "ローカル分析のP0画面" }) !== null,
      ).toBe(mode === "ANALYST");
    },
  );

  it.each(APPLICATION_MODES)(
    "moves back exactly once to the previous in-app route in %s mode",
    (mode) => {
      renderWithRouter(routesForMode(mode), { initialEntries: ["/"] });

      fireEvent.click(
        within(screen.getByRole("navigation", { name: "共通ナビゲーション" })).getByRole(
          "link",
          { name: "候補者" },
        ),
      );
      fireEvent.click(screen.getByRole("link", { name: "中村時広氏の候補者詳細へ移動" }));
      expect(
        screen.getByRole("heading", { level: 1, name: "候補者詳細" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: BACK_CONTROL_NAME }));

      expect(
        screen.getByRole("heading", { level: 1, name: "候補者一覧" }),
      ).toBeInTheDocument();
      expect(currentNavigationHrefs()).toEqual(["/candidates"]);
      expectPreservedShell(mode);
    },
  );
});
