import { matchPath } from "react-router-dom";

export type AnalystRouteContract = Readonly<{
  path: string;
  heading: string;
  kind: "PUBLIC" | "ANALYST" | "WILDCARD";
}>;

const ANALYST_WILDCARD_CONTRACT = {
  path: "*",
  heading: "ページが見つかりません",
  kind: "WILDCARD",
} as const satisfies AnalystRouteContract;

/**
 * Route matrix for the Analyst Router: the remaining public routes, every
 * Existing Analyst Route, and the shared wildcard 404. The retired public
 * `/sources` path is intentionally absent and resolves to the wildcard.
 */
export const ANALYST_ROUTE_CONTRACTS = [
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
  { path: "/values", heading: "価値観マップ", kind: "PUBLIC" },
  {
    path: "/analyst/readiness",
    heading: "政策解析準備状態",
    kind: "ANALYST",
  },
  { path: "/analyst/sources", heading: "Source Manifest", kind: "ANALYST" },
  { path: "/analyst/runs", heading: "解析実行と履歴", kind: "ANALYST" },
  { path: "/analyst/runs/:runId", heading: "解析run詳細", kind: "ANALYST" },
  {
    path: "/analyst/verification/:artifactId",
    heading: "根拠検証",
    kind: "ANALYST",
  },
  {
    path: "/analyst/review/:artifactId",
    heading: "人間確認",
    kind: "ANALYST",
  },
  { path: "/analyst/evaluation", heading: "評価", kind: "ANALYST" },
  { path: "/analyst/p0", heading: "P0完成判定", kind: "ANALYST" },
  { path: "/analyst/aws", heading: "AWS診断", kind: "ANALYST" },
  ANALYST_WILDCARD_CONTRACT,
] as const satisfies readonly AnalystRouteContract[];

/**
 * Resolves a pathname against the Analyst route matrix with React Router
 * matching rules. Any path without a registered contract, including `/sources`,
 * resolves to the wildcard 404 contract.
 */
export function selectAnalystRouteContract(
  pathname: string,
): AnalystRouteContract {
  for (const contract of ANALYST_ROUTE_CONTRACTS) {
    if (
      contract.kind !== "WILDCARD" &&
      matchPath({ path: contract.path, end: true }, pathname) !== null
    ) {
      return contract;
    }
  }

  return ANALYST_WILDCARD_CONTRACT;
}
