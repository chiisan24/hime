import type { LinkProps, NavLinkProps } from "react-router-dom";
import { Link, NavLink, useLocation } from "react-router-dom";

const APP_HISTORY_DEPTH_KEY = "ehimeAppHistoryDepth";

type AppNavigationState = Readonly<{
  [APP_HISTORY_DEPTH_KEY]: number;
}>;

export const HOME_NAVIGATION_STATE: AppNavigationState = {
  [APP_HISTORY_DEPTH_KEY]: 0,
};

export function getAppHistoryDepth(state: unknown): number {
  if (typeof state !== "object" || state === null) {
    return 0;
  }

  const value = Reflect.get(state, APP_HISTORY_DEPTH_KEY);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function useNextNavigationState(): AppNavigationState {
  const location = useLocation();

  return {
    [APP_HISTORY_DEPTH_KEY]: getAppHistoryDepth(location.state) + 1,
  };
}

type AppLinkProps = Omit<LinkProps, "state">;

export function AppLink(props: AppLinkProps) {
  const state = useNextNavigationState();

  return <Link {...props} state={state} />;
}

type AppNavLinkProps = Omit<NavLinkProps, "state">;

export function AppNavLink(props: AppNavLinkProps) {
  const state = useNextNavigationState();

  return <NavLink {...props} state={state} />;
}
