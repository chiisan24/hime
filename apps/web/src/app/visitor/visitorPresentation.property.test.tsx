// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import fc from "fast-check";
import { Circle, type LucideIcon } from "lucide-react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../../tests/harness/react-renderer.js";
import {
  AppShell,
  SharedNavigation,
  VISITOR_NAV_ITEMS,
} from "../../shared/ui/AppShell.js";
import { ANALYST_NAV_ITEMS } from "../analyst/navigationItems.js";
import { AnalystHomePage } from "../analyst/pages.js";
import { FeatureLinkGrid, VISITOR_HOME_LINKS } from "../public/pages.js";
import { projectVisitorPresentation } from "../public/visitorPresentation.js";
import { AppRoutes } from "./routes.js";

type PresentationItem = Readonly<{
  to: string;
  label: string;
  description: string;
  end: boolean;
  icon: LucideIcon;
}>;

type PresentationEntry = Readonly<{
  category: "PUBLIC" | "ANALYST" | "RETIRED_SOURCES";
  item: PresentationItem;
}>;

type CurrentAnalystContent = Readonly<{
  seeds: readonly PresentationItem[];
  sectionTexts: readonly string[];
}>;

// Text of the retired standalone public sources Home link and navigation item.
const RETIRED_SOURCES_LABEL = "出典一覧を見る";
const RETIRED_SOURCES_NAV_LABEL = "出典一覧";
const RETIRED_SOURCES_DESCRIPTION = "出典と来歴の表示枠を確認します。";

// Icon for generated and DOM-collected items. Icons render aria-hidden with no text.
const GENERATED_ICON: LucideIcon = Circle;

// Markers that never occur in visitor copy, so generated excluded text is unambiguous.
const ANALYST_MARKER = "［分析者内部］";
const RETIRED_MARKER = "［廃止出典一覧］";

const ANALYST_OPERATION_PATTERN =
  /分析|Source Manifest|解析|\brun\b|検証|承認|評価|P0完成判定|P0判定|AWS|analyst|モード|mode/iu;

const EXISTING_ANALYST_ROUTE_PATTERNS = [
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

const PUBLIC_DESTINATION_BASES = [
  "/",
  "/schedule",
  "/candidates",
  "/comparison",
  "/venue",
  "/candidates/:candidateId",
] as const;

const CONFIGURED_NAV_ENTRIES: readonly PresentationEntry[] = VISITOR_NAV_ITEMS.map(
  (item): PresentationEntry => ({
    category: "PUBLIC",
    item: { to: item.to, label: item.label, description: "", end: item.end, icon: item.icon },
  }),
);

const CONFIGURED_HOME_ENTRIES: readonly PresentationEntry[] = VISITOR_HOME_LINKS.map(
  (link): PresentationEntry => ({
    category: "PUBLIC",
    item: { ...link, end: true },
  }),
);

/** Independent test oracle: resolves an href the way the browser would. */
function destinationPathname(href: string): string {
  const pathname = new URL(href, "http://visitor.test").pathname.toLowerCase();
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

function isAnalystDestination(href: string): boolean {
  const pathname = destinationPathname(href);
  return pathname === "/analyst" || pathname.startsWith("/analyst/");
}

function isRetiredSourcesDestination(href: string): boolean {
  return destinationPathname(href) === "/sources";
}

/** Reads the analyst Home links and analyst navigation items that the app renders today. */
function collectCurrentAnalystContent(): CurrentAnalystContent {
  const view = renderWithRouter(
    <Routes>
      <Route element={<AppShell navigationItems={ANALYST_NAV_ITEMS} />}>
        <Route index element={<AnalystHomePage />} />
      </Route>
    </Routes>,
  );

  try {
    const analystSection = within(view.container).getByRole("region", {
      name: "ローカル分析のP0画面",
    });
    const homeSeeds = within(analystSection)
      .getAllByRole("link")
      .map((link): PresentationItem => {
        const spans = link.querySelectorAll("span");
        return {
          to: link.getAttribute("href") ?? "",
          label: link.getAttribute("aria-label") ?? "",
          description: spans.item(spans.length - 1)?.textContent ?? "",
          end: true,
          icon: GENERATED_ICON,
        };
      });

    const navigation = within(view.container).getByRole("navigation", {
      name: "共通ナビゲーション",
    });
    const navigationSeeds = within(navigation)
      .getAllByRole("link")
      .filter((link) => isAnalystDestination(link.getAttribute("href") ?? ""))
      .map(
        (link): PresentationItem => ({
          to: link.getAttribute("href") ?? "",
          label: link.textContent ?? "",
          description: "",
          end: true,
          icon: GENERATED_ICON,
        }),
      );

    const sectionTexts = Array.from(analystSection.querySelectorAll("h2, p"))
      .map((element) => element.textContent ?? "")
      .filter((text) => text !== "");

    return { seeds: [...homeSeeds, ...navigationSeeds], sectionTexts };
  } finally {
    view.unmount();
  }
}

const slugArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,11}$/);

const optionalSuffixArbitrary = fc
  .tuple(
    fc.option(slugArbitrary, { nil: undefined }),
    fc.option(slugArbitrary, { nil: undefined }),
  )
  .map(
    ([query, hash]) =>
      `${query === undefined ? "" : `?q=${query}`}${hash === undefined ? "" : `#${hash}`}`,
  );

function markedTextArbitrary(marker: string): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 12 }).map((text) => `${marker}${text}`);
}

const analystPatternArbitrary: fc.Arbitrary<string> = fc.constantFrom(
  ...EXISTING_ANALYST_ROUTE_PATTERNS,
  "/analyst",
);

const analystDestinationArbitrary: fc.Arbitrary<string> = fc
  .record({
    pattern: analystPatternArbitrary,
    parameter: slugArbitrary,
    extraSegments: fc.array(slugArbitrary, { maxLength: 2 }),
    prefix: fc.constantFrom("/analyst", "/Analyst", "/ANALYST"),
    trailingSlash: fc.boolean(),
    suffix: optionalSuffixArbitrary,
  })
  .map(({ pattern, parameter, extraSegments, prefix, trailingSlash, suffix }) => {
    const concretePath = pattern
      .replace(/:[A-Za-z]+/u, parameter)
      .replace(/^\/analyst/u, prefix);
    const path = [concretePath, ...extraSegments].join("/");
    return `${path}${trailingSlash ? "/" : ""}${suffix}`;
  });

function analystEntryArbitrary(
  seeds: readonly PresentationItem[],
): fc.Arbitrary<PresentationEntry> {
  const seedArbitrary = fc.constantFrom(...seeds);

  return fc
    .oneof(
      seedArbitrary,
      fc
        .tuple(seedArbitrary, analystDestinationArbitrary)
        .map(([seed, to]): PresentationItem => ({ ...seed, to })),
      fc.record({
        to: analystDestinationArbitrary,
        label: markedTextArbitrary(ANALYST_MARKER),
        description: markedTextArbitrary(ANALYST_MARKER),
        end: fc.boolean(),
        icon: fc.constant(GENERATED_ICON),
      }),
    )
    .map((item): PresentationEntry => ({ category: "ANALYST", item }));
}

const retiredSourcesEntryArbitrary: fc.Arbitrary<PresentationEntry> = fc
  .record({
    to: fc
      .record({
        path: fc.constantFrom("/sources", "/Sources", "/SOURCES"),
        trailingSlash: fc.boolean(),
        suffix: optionalSuffixArbitrary,
      })
      .map(({ path, trailingSlash, suffix }) => `${path}${trailingSlash ? "/" : ""}${suffix}`),
    label: fc.oneof(
      fc.constantFrom(RETIRED_SOURCES_LABEL, RETIRED_SOURCES_NAV_LABEL),
      markedTextArbitrary(RETIRED_MARKER),
    ),
    description: fc.oneof(
      fc.constant(RETIRED_SOURCES_DESCRIPTION),
      markedTextArbitrary(RETIRED_MARKER),
    ),
    end: fc.boolean(),
    icon: fc.constant(GENERATED_ICON),
  })
  .map((item): PresentationEntry => ({ category: "RETIRED_SOURCES", item }));

const generatedPublicEntriesArbitrary: fc.Arbitrary<readonly PresentationEntry[]> = fc
  .uniqueArray(
    fc.record({
      base: fc.constantFrom(...PUBLIC_DESTINATION_BASES),
      slug: slugArbitrary,
      end: fc.boolean(),
    }),
    { maxLength: 4, selector: ({ slug }) => slug },
  )
  .map((values) =>
    values.map(
      ({ base, slug, end }): PresentationEntry => ({
        category: "PUBLIC",
        item: {
          to:
            base === "/candidates/:candidateId"
              ? `/candidates/generated-${slug}`
              : `${base}?ref=${slug}`,
          label: `公開項目 ${slug}`,
          description: `公開説明 ${slug}`,
          end,
          icon: GENERATED_ICON,
        },
      }),
    ),
  );

/** Configured items plus generated public, analyst, and retired items in random order. */
function presentationEntriesArbitrary(
  configured: readonly PresentationEntry[],
  seeds: readonly PresentationItem[],
): fc.Arbitrary<readonly PresentationEntry[]> {
  return fc
    .tuple(
      generatedPublicEntriesArbitrary,
      fc.array(analystEntryArbitrary(seeds), { minLength: 1, maxLength: 6 }),
      fc.array(retiredSourcesEntryArbitrary, { minLength: 1, maxLength: 3 }),
    )
    .chain(([generatedPublic, analyst, retired]) => {
      const entries = [...configured, ...generatedPublic, ...analyst, ...retired];
      return fc.shuffledSubarray(entries, {
        minLength: entries.length,
        maxLength: entries.length,
      });
    });
}

function publicItems(entries: readonly PresentationEntry[]): readonly PresentationItem[] {
  return entries
    .filter(({ category }) => category === "PUBLIC")
    .map(({ item }) => item);
}

function excludedTexts(entries: readonly PresentationEntry[]): readonly string[] {
  return entries
    .filter(({ category }) => category !== "PUBLIC")
    .flatMap(({ item }) => [item.label, item.description])
    .filter((text) => text !== "");
}

function hrefsOf(elements: readonly HTMLElement[]): string[] {
  return elements.map((element) => element.getAttribute("href") ?? "");
}

describe("Property 2: Visitor presentation omits analyst and retired standalone-source content", () => {
  // Feature: visitor-analyst-mode-separation, Property 2: Visitor presentation omits analyst and retired standalone-source content
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 8.1, 8.2**
  it(
    "renders zero analyst or /sources destinations and keeps every remaining visitor destination",
    { timeout: 60_000 },
    () => {
      const { seeds } = collectCurrentAnalystContent();
      expect(seeds.length).toBeGreaterThan(0);

      fc.assert(
        fc.property(
          presentationEntriesArbitrary(CONFIGURED_NAV_ENTRIES, seeds),
          presentationEntriesArbitrary(CONFIGURED_HOME_ENTRIES, seeds),
          (navigationEntries, homeEntries) => {
            const navigationItems = projectVisitorPresentation(
              navigationEntries.map(({ item }) => item),
            );
            const homeLinks = projectVisitorPresentation(
              homeEntries.map(({ item }) => item),
            );

            expect(navigationItems).toEqual(publicItems(navigationEntries));
            expect(homeLinks).toEqual(publicItems(homeEntries));

            const view = render(
              <MemoryRouter>
                <SharedNavigation items={navigationItems} />
                <section aria-label="Visitor Home links">
                  <FeatureLinkGrid links={homeLinks} />
                </section>
              </MemoryRouter>,
            );

            try {
              const container = within(view.container);
              const navigationLinks = within(
                container.getByRole("navigation", { name: "共通ナビゲーション" }),
              ).queryAllByRole("link");
              const homeLinkElements = within(
                container.getByRole("region", { name: "Visitor Home links" }),
              ).queryAllByRole("link");
              const renderedLinks = [...navigationLinks, ...homeLinkElements];
              const renderedHrefs = hrefsOf(renderedLinks);
              const accessibleNames = renderedLinks.map(
                (link) => link.getAttribute("aria-label") ?? link.textContent ?? "",
              );
              const renderedText = view.container.textContent ?? "";

              expect(renderedHrefs.filter(isAnalystDestination)).toEqual([]);
              expect(renderedHrefs.filter(isRetiredSourcesDestination)).toEqual([]);

              const leakedTexts = excludedTexts([
                ...navigationEntries,
                ...homeEntries,
              ]).filter(
                (text) =>
                  renderedText.includes(text) ||
                  accessibleNames.some((name) => name.includes(text)),
              );
              expect(leakedTexts).toEqual([]);
              expect(renderedText).not.toContain(ANALYST_MARKER);
              expect(renderedText).not.toContain(RETIRED_MARKER);

              expect(hrefsOf(navigationLinks)).toEqual(
                navigationItems.map(({ to }) => to),
              );
              expect(hrefsOf(homeLinkElements)).toEqual(homeLinks.map(({ to }) => to));
              expect(hrefsOf(navigationLinks)).toEqual(
                expect.arrayContaining(VISITOR_NAV_ITEMS.map(({ to }) => to)),
              );
              expect(hrefsOf(homeLinkElements)).toEqual(
                expect.arrayContaining(VISITOR_HOME_LINKS.map(({ to }) => to)),
              );
            } finally {
              view.unmount();
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

describe("Visitor Home and navigation fixed examples", () => {
  it("omit the current analyst link labels, descriptions, and the retired sources link", () => {
    const { seeds, sectionTexts } = collectCurrentAnalystContent();
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every(({ to }) => isAnalystDestination(to))).toBe(true);

    renderWithRouter(<AppRoutes />, { initialEntries: ["/"] });

    expect(
      screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" }),
    ).toBeInTheDocument();

    for (const seed of seeds) {
      expect(screen.queryByRole("link", { name: seed.label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: RETIRED_SOURCES_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByText(RETIRED_SOURCES_LABEL)).not.toBeInTheDocument();

    const bodyText = document.body.textContent ?? "";
    const leakedTexts = [
      ...seeds.flatMap(({ label, description }) => [label, description]),
      ...sectionTexts,
      RETIRED_SOURCES_LABEL,
      RETIRED_SOURCES_NAV_LABEL,
      RETIRED_SOURCES_DESCRIPTION,
    ].filter((text) => text !== "" && bodyText.includes(text));
    expect(leakedTexts).toEqual([]);

    const allHrefs = hrefsOf(screen.getAllByRole("link"));
    expect(allHrefs.filter(isAnalystDestination)).toEqual([]);
    expect(allHrefs.filter(isRetiredSourcesDestination)).toEqual([]);

    const navigation = screen.getByRole("navigation", { name: "共通ナビゲーション" });
    expect(hrefsOf(within(navigation).getAllByRole("link"))).toEqual([
      "/",
      "/schedule",
      "/candidates",
      "/comparison",
      "/venue",
    ]);
    const visitorLinks = screen.getByRole("region", { name: "会場閲覧のP0画面" });
    expect(hrefsOf(within(visitorLinks).getAllByRole("link"))).toEqual([
      "/schedule",
      "/candidates",
      "/candidates/nakamura-tokihiro",
      "/candidates/hayashi-noriko",
      "/comparison",
      "/venue",
    ]);

    const operationNames = [
      ...screen.getAllByRole("link"),
      ...screen.getAllByRole("button"),
    ].map((element) => element.getAttribute("aria-label") ?? element.textContent ?? "");
    expect(operationNames.filter((name) => ANALYST_OPERATION_PATTERN.test(name))).toEqual(
      [],
    );
  });
});
