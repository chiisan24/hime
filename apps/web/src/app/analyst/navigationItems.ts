import {
  type SharedNavigationItem,
  VISITOR_NAV_ITEMS,
} from "../../shared/ui/AppShell.js";

/**
 * Shared Navigation for Analyst Mode: the remaining public destinations plus the
 * explicit analyst entry. It is defined only on the analyst side and reached only
 * from the analyst route entry, so the Visitor Build never bundles its route
 * strings or labels.
 */
export const ANALYST_NAV_ITEMS: readonly SharedNavigationItem[] = [
  ...VISITOR_NAV_ITEMS,
  { to: "/analyst/readiness", label: "分析状態", end: true },
];
