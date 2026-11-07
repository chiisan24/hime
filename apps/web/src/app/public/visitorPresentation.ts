/**
 * Static destinations registered by the Visitor Router. The projection is an
 * allowlist, so it never needs to name analyst or retired paths: anything that
 * is not a remaining public route (analyst routes, the retired standalone
 * `/sources` route, unknown paths) is dropped.
 */
const VISITOR_STATIC_DESTINATIONS: ReadonlySet<string> = new Set([
  "/",
  "/schedule",
  "/candidates",
  "/comparison",
  "/venue",
]);
const CANDIDATE_DETAIL_PREFIX = "/candidates/";

/**
 * Normalizes an in-app destination to the pathname React Router would match.
 * React Router matches paths case-insensitively by default, so the comparison is
 * lowercased to keep case variants of excluded paths excluded.
 */
function normalizedDestinationPath(to: string): string {
  const pathname = to.split(/[?#]/u, 1)[0] ?? "";
  const withoutTrailingSlash = pathname.replace(/\/+$/u, "");

  return (withoutTrailingSlash === "" ? "/" : withoutTrailingSlash).toLowerCase();
}

function isVisitorPresentationDestination(to: string): boolean {
  const pathname = normalizedDestinationPath(to);
  if (VISITOR_STATIC_DESTINATIONS.has(pathname)) {
    return true;
  }

  // `/candidates/:candidateId` takes exactly one non-empty segment.
  const candidateId = pathname.startsWith(CANDIDATE_DETAIL_PREFIX)
    ? pathname.slice(CANDIDATE_DETAIL_PREFIX.length)
    : "";
  return candidateId !== "" && !candidateId.includes("/");
}

/**
 * Projects Home or Shared Navigation items for Visitor Mode. Only items that
 * target a remaining Visitor Router route are kept, in their original order and
 * object identity; analyst routes and the retired standalone `/sources` route
 * are dropped.
 */
export function projectVisitorPresentation<T extends Readonly<{ to: string }>>(
  items: readonly T[],
): readonly T[] {
  return items.filter((item) => isVisitorPresentationDestination(item.to));
}
