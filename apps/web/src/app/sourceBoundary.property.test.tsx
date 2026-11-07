// @vitest-environment jsdom

import { within } from "@testing-library/react";
import fc from "fast-check";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  type RouteObject,
} from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
import {
  resolveBuildTarget,
  type ApplicationMode,
  type BuildTarget,
} from "../config/applicationMode.js";
import { AppShell, VISITOR_NAV_ITEMS } from "../shared/ui/AppShell.js";
import { ANALYST_NAV_ITEMS } from "./analyst/navigationItems.js";
import * as analystPageModule from "./analyst/pages.js";
import {
  ANALYST_ROUTE_CONTRACTS,
  selectAnalystRouteContract,
} from "./analyst/routeContracts.js";
import * as analystRouteModule from "./analyst/routes.js";
import * as publicPageModule from "./public/pages.js";
import { VISITOR_ROUTE_CONTRACTS } from "./visitor/routeContracts.js";
import * as visitorRouteModule from "./visitor/routes.js";

type RouteContract = Readonly<{
  path: string;
  heading: string;
  kind: string;
}>;

type RouteLocation = Readonly<{
  pathname: string;
  search: string;
  hash: string;
}>;

type LeafRouteDescriptor = Readonly<{
  path: string;
  element: ReactNode;
}>;

/** Signature shared by both selectable `#app-routes` entries. */
type AppRoutesComponent = typeof visitorRouteModule.AppRoutes;

type ModeRouteEntry = Readonly<{
  applicationMode: ApplicationMode;
  AppRoutes: AppRoutesComponent;
  routeObjects: RouteObject[];
  leafDescriptors: readonly LeafRouteDescriptor[];
  contracts: readonly RouteContract[];
  selectContract: (location: RouteLocation) => RouteContract | undefined;
}>;

type ResolvedBranch = Readonly<{
  depth: number;
  layoutType: unknown;
  navigationItems: unknown;
  leafPath: string | undefined;
  leafType: unknown;
}>;

/**
 * An evidence-bearing view and the embedded source-evidence field terms its
 * screen contract requires. `EACH_CANDIDATE` views must show every field once
 * inside each candidate article; `PAGE` views must show every field once in main.
 */
type EvidenceView = Readonly<{
  template: string;
  heading: string;
  page: unknown;
  scope: "PAGE" | "EACH_CANDIDATE";
  fields: readonly string[];
}>;

const WILDCARD_CONTRACT = {
  path: "*",
  heading: "ページが見つかりません",
  kind: "WILDCARD",
} as const;

const SOURCE_MANIFEST_CONTRACT = {
  path: "/analyst/sources",
  heading: "Source Manifest",
  kind: "ANALYST",
} as const;

const RETIRED_PUBLIC_SOURCES_PATH = "/sources";
const RETIRED_PUBLIC_SOURCES_COMPONENT = "SourcesPage";

/** The fixed Shared Navigation items each mode's route entry passes to AppShell. */
const NAV_ITEMS_BY_MODE: Readonly<Record<ApplicationMode, unknown>> = {
  VISITOR: VISITOR_NAV_ITEMS,
  ANALYST: ANALYST_NAV_ITEMS,
};

const PUBLIC_EVIDENCE_VIEWS: readonly EvidenceView[] = [
  {
    template: "/schedule",
    heading: "選挙日程",
    page: publicPageModule.SchedulePage,
    scope: "PAGE",
    fields: ["出典", "最終更新日"],
  },
  {
    template: "/candidates",
    heading: "候補者一覧",
    page: publicPageModule.CandidatesPage,
    scope: "EACH_CANDIDATE",
    fields: ["出典", "最終更新日"],
  },
  {
    template: "/candidates/:candidateId",
    heading: "候補者詳細",
    page: publicPageModule.CandidateDetailPage,
    scope: "PAGE",
    fields: ["採用資料", "出典", "最終更新日"],
  },
  {
    template: "/comparison",
    heading: "政策比較",
    page: publicPageModule.ComparisonPage,
    scope: "EACH_CANDIDATE",
    fields: ["根拠リンク"],
  },
];

const ANALYST_EVIDENCE_VIEWS: readonly EvidenceView[] = [
  {
    template: "/analyst/sources",
    heading: "Source Manifest",
    page: analystPageModule.AnalystSourcesPage,
    scope: "PAGE",
    fields: ["資料版", "revision", "source checksum", "利用条件確認状態", "採否理由"],
  },
  {
    template: "/analyst/verification/:artifactId",
    heading: "根拠検証",
    page: analystPageModule.AnalystVerificationPage,
    scope: "PAGE",
    fields: ["対応原文", "根拠引用", "locator"],
  },
  {
    template: "/analyst/review/:artifactId",
    heading: "人間確認",
    page: analystPageModule.AnalystReviewPage,
    scope: "PAGE",
    fields: ["原文", "locator"],
  },
];

const EVIDENCE_VIEWS_BY_MODE: Readonly<Record<ApplicationMode, readonly EvidenceView[]>> = {
  VISITOR: PUBLIC_EVIDENCE_VIEWS,
  ANALYST: [...PUBLIC_EVIDENCE_VIEWS, ...ANALYST_EVIDENCE_VIEWS],
};

const PAGE_AND_ROUTE_MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "app/public/pages": publicPageModule,
  "app/analyst/pages": analystPageModule,
  "app/visitor/routes": visitorRouteModule,
  "app/analyst/routes": analystRouteModule,
};

function hrefOf({ pathname, search, hash }: RouteLocation): string {
  return `${pathname}${search}${hash}`;
}

/** Matches React Router's default case-insensitive, trailing-slash-tolerant matching. */
function isRetiredPublicSourcesPath(path: string): boolean {
  const withoutTrailingSlash = path.replace(/\/+$/u, "");
  return withoutTrailingSlash.toLowerCase() === RETIRED_PUBLIC_SOURCES_PATH;
}

function elementType(node: ReactNode): unknown {
  return isValidElement(node) ? node.type : undefined;
}

function componentName(node: ReactNode): string | undefined {
  const type = elementType(node);
  return typeof type === "function" ? type.name : undefined;
}

function readRouteObjects(appRoutes: AppRoutesComponent): RouteObject[] {
  const routesElement: ReactElement<{ children?: ReactNode }> = appRoutes();
  return createRoutesFromChildren(routesElement.props.children);
}

/** Flattens layout nesting into normalized leaf descriptors such as `/analyst/sources`. */
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

/** Pure contract selector over a route contract matrix with React Router matching rules. */
function selectContractByMatch(
  contracts: readonly RouteContract[],
  location: RouteLocation,
): RouteContract | undefined {
  const routeObjects: RouteObject[] = contracts.map(({ path }) => ({ path }));
  const leafPath = matchRoutes(routeObjects, hrefOf(location))?.at(-1)?.route.path;
  return contracts.find(({ path }) => path === leafPath);
}

/** Pure route selection against the route objects a mode's Router registers. */
function resolveBranch(entry: ModeRouteEntry, location: RouteLocation): ResolvedBranch {
  const matches = matchRoutes(entry.routeObjects, hrefOf(location)) ?? [];
  const layout = matches[0]?.route.element;
  const leaf = matches.at(-1)?.route;

  return {
    depth: matches.length,
    layoutType: elementType(layout),
    navigationItems: isValidElement<{ navigationItems?: unknown }>(layout)
      ? layout.props.navigationItems
      : undefined,
    leafPath: leaf?.index === true ? "/" : leaf?.path,
    leafType: elementType(leaf?.element),
  };
}

function createModeRouteEntry(
  applicationMode: ApplicationMode,
  AppRoutes: AppRoutesComponent,
  contracts: readonly RouteContract[],
  selectContract: (location: RouteLocation) => RouteContract | undefined,
): ModeRouteEntry {
  const routeObjects = readRouteObjects(AppRoutes);

  return {
    applicationMode,
    AppRoutes,
    routeObjects,
    leafDescriptors: collectLeafDescriptors(routeObjects),
    contracts,
    selectContract,
  };
}

/** Route entries keyed exactly as the Vite `#app-routes` alias selects them. */
const ROUTE_ENTRY_BY_TARGET: Readonly<Record<BuildTarget["routeEntry"], ModeRouteEntry>> = {
  visitor: createModeRouteEntry(
    "VISITOR",
    visitorRouteModule.AppRoutes,
    VISITOR_ROUTE_CONTRACTS,
    (location) => selectContractByMatch(VISITOR_ROUTE_CONTRACTS, location),
  ),
  analyst: createModeRouteEntry(
    "ANALYST",
    analystRouteModule.AppRoutes,
    ANALYST_ROUTE_CONTRACTS,
    (location) => selectAnalystRouteContract(location.pathname),
  ),
};

/** Module export metadata: every export that is, or is named as, the retired public page. */
function retiredSourcesPageExports(): string[] {
  return Object.entries(PAGE_AND_ROUTE_MODULES).flatMap(([moduleName, moduleExports]) =>
    Object.entries(moduleExports)
      .filter(
        ([exportName, value]) =>
          exportName === RETIRED_PUBLIC_SOURCES_COMPONENT ||
          (typeof value === "function" && value.name === RETIRED_PUBLIC_SOURCES_COMPONENT),
      )
      .map(([exportName]) => `${moduleName}#${exportName}`),
  );
}

/** Field terms missing from, or duplicated in, the scopes an evidence view requires. */
function evidenceFieldViolations(main: HTMLElement, view: EvidenceView): string[] {
  const scopes =
    view.scope === "EACH_CANDIDATE" ? within(main).queryAllByRole("article") : [main];
  const expectedScopeCount =
    view.scope === "EACH_CANDIDATE" ? publicPageModule.CANDIDATE_SKELETONS.length : 1;

  if (scopes.length !== expectedScopeCount) {
    return [`scope count ${scopes.length} !== ${expectedScopeCount}`];
  }

  return scopes.flatMap((scope, index) =>
    view.fields
      .filter(
        (field) =>
          within(scope)
            .queryAllByText(field)
            .filter((element) => element.tagName === "DT").length !== 1,
      )
      .map((field) => `${view.template}[${index}]: ${field}`),
  );
}

function caseVariantArbitrary(word: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((upper) =>
      Array.from(word, (character, index) =>
        upper[index] === true ? character.toUpperCase() : character,
      ).join(""),
    );
}

const trailingSlashArbitrary = fc.constantFrom("", "/");

/** Query strings, including mode-like values that must never change the route set. */
const searchArbitrary = fc.oneof(
  fc.constant(""),
  fc.constantFrom("?mode=analyst", "?applicationMode=ANALYST", "?view=sources"),
  fc.stringMatching(/^[A-Za-z0-9=&_-]{0,16}$/).map((query) => `?${query}`),
);

/** URL hashes, including analyst-looking values that must never change the route set. */
const hashArbitrary = fc.oneof(
  fc.constant(""),
  fc.constantFrom("#analyst", "#/analyst/sources", "#sources"),
  fc.stringMatching(/^[A-Za-z0-9_-]{0,16}$/).map((fragment) => `#${fragment}`),
);

const retiredSourcesLocationArbitrary: fc.Arbitrary<RouteLocation> = fc.record({
  pathname: fc
    .tuple(caseVariantArbitrary("sources"), trailingSlashArbitrary)
    .map(([segment, trailingSlash]) => `/${segment}${trailingSlash}`),
  search: searchArbitrary,
  hash: hashArbitrary,
});

const analystSourcesLocationArbitrary: fc.Arbitrary<RouteLocation> = fc.record({
  pathname: fc
    .tuple(
      caseVariantArbitrary("analyst"),
      caseVariantArbitrary("sources"),
      trailingSlashArbitrary,
    )
    .map(([prefix, segment, trailingSlash]) => `/${prefix}/${segment}${trailingSlash}`),
  search: searchArbitrary,
  hash: hashArbitrary,
});

/** Vite mode inputs: the exact analyst token, Vite defaults, near misses, and junk. */
const modeInputArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant("analyst"),
  fc.oneof(
    fc.constantFrom<unknown>(
      undefined,
      null,
      "",
      "development",
      "production",
      "test",
      "visitor",
      "ANALYST",
      " analyst",
      "analyst ",
    ),
    fc.string({ maxLength: 12 }),
    fc.integer(),
  ),
);

const pathParameterArbitrary = fc.oneof(
  fc.constantFrom(
    ...publicPageModule.CANDIDATE_SKELETONS.map(({ candidateId }) => candidateId),
  ),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,16}$/),
);

function evidenceLocationArbitrary(
  views: readonly EvidenceView[],
): fc.Arbitrary<Readonly<{ view: EvidenceView; location: RouteLocation }>> {
  return fc
    .record({
      view: fc.constantFrom(...views),
      parameter: pathParameterArbitrary,
      trailingSlash: trailingSlashArbitrary,
      search: searchArbitrary,
      hash: hashArbitrary,
    })
    .map(({ view, parameter, trailingSlash, search, hash }) => ({
      view,
      location: {
        pathname: `${view.template.replace(/:[A-Za-z]+/gu, parameter)}${trailingSlash}`,
        search,
        hash,
      },
    }));
}

const scenarioArbitrary = modeInputArbitrary.chain((modeInput) =>
  fc.record({
    modeInput: fc.constant(modeInput),
    retiredSources: retiredSourcesLocationArbitrary,
    analystSources: analystSourcesLocationArbitrary,
    evidence: evidenceLocationArbitrary(
      EVIDENCE_VIEWS_BY_MODE[resolveBuildTarget(modeInput).applicationMode],
    ),
  }),
);

describe("Property 7: standalone public sources removal preserves source evidence boundaries", () => {
  // Feature: visitor-analyst-mode-separation, Property 7: standalone public sources removal preserves source evidence boundaries
  // **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9**
  it(
    "routes every /sources variant to the shared 404 while keeping embedded evidence and /analyst/sources",
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(scenarioArbitrary, (scenario) => {
          const target = resolveBuildTarget(scenario.modeInput);
          const entry = ROUTE_ENTRY_BY_TARGET[target.routeEntry];
          expect(entry.applicationMode).toBe(target.applicationMode);

          // `/sources` reaches the shared wildcard 404 inside the mode's own shell.
          const expectedNavigationItems = NAV_ITEMS_BY_MODE[target.applicationMode];
          expect(entry.selectContract(scenario.retiredSources)).toEqual(WILDCARD_CONTRACT);
          const retiredBranch = resolveBranch(entry, scenario.retiredSources);
          expect(retiredBranch).toEqual({
            depth: 2,
            layoutType: AppShell,
            navigationItems: expectedNavigationItems,
            leafPath: "*",
            leafType: publicPageModule.NotFoundPage,
          });
          expect(retiredBranch.navigationItems).toBe(expectedNavigationItems);

          // Neither the contract matrix nor the registered Router holds a `/sources` descriptor.
          expect(
            entry.contracts.filter(({ path }) => isRetiredPublicSourcesPath(path)),
          ).toEqual([]);
          expect(
            entry.leafDescriptors.filter(({ path }) => isRetiredPublicSourcesPath(path)),
          ).toEqual([]);
          expect(
            entry.leafDescriptors.filter(
              ({ element }) => componentName(element) === RETIRED_PUBLIC_SOURCES_COMPONENT,
            ),
          ).toEqual([]);

          // Module export metadata: no public SourcesPage; AnalystSourcesPage stays analyst-only.
          expect(retiredSourcesPageExports()).toEqual([]);
          expect(Object.keys(publicPageModule)).not.toContain("AnalystSourcesPage");
          expect(typeof analystPageModule.AnalystSourcesPage).toBe("function");

          // `/analyst/sources` is Source Manifest management in Analyst Mode only.
          const analystMode = target.applicationMode === "ANALYST";
          expect(entry.selectContract(scenario.analystSources)).toEqual(
            analystMode ? SOURCE_MANIFEST_CONTRACT : WILDCARD_CONTRACT,
          );
          const analystSourcesBranch = resolveBranch(entry, scenario.analystSources);
          expect(analystSourcesBranch).toEqual({
            depth: 2,
            layoutType: AppShell,
            navigationItems: expectedNavigationItems,
            leafPath: analystMode ? "analyst/sources" : "*",
            leafType: analystMode
              ? analystPageModule.AnalystSourcesPage
              : publicPageModule.NotFoundPage,
          });
          expect(analystSourcesBranch.navigationItems).toBe(expectedNavigationItems);
          expect(
            entry.leafDescriptors
              .filter(({ element }) => elementType(element) === analystPageModule.AnalystSourcesPage)
              .map(({ path }) => path),
          ).toEqual(analystMode ? ["/analyst/sources"] : []);

          // Evidence-bearing views keep every embedded source-evidence field.
          const { view, location } = scenario.evidence;
          expect(resolveBranch(entry, location).leafType).toBe(view.page);
          expect(entry.selectContract(location)).toMatchObject({
            path: view.template,
            heading: view.heading,
          });

          const { AppRoutes } = entry;
          const rendered = renderWithRouter(<AppRoutes />, {
            initialEntries: [hrefOf(location)],
          });

          try {
            const main = within(rendered.container).getByRole("main");
            expect(
              within(main).getAllByRole("heading", { level: 1 }).map(
                (heading) => heading.textContent,
              ),
            ).toEqual([view.heading]);
            expect(evidenceFieldViolations(main, view)).toEqual([]);
          } finally {
            rendered.unmount();
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});
