export type VisitorRouteContract = Readonly<{
  path: string;
  heading: string;
  kind: "PUBLIC" | "WILDCARD";
}>;

export const VISITOR_ROUTE_CONTRACTS = [
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
  { path: "*", heading: "ページが見つかりません", kind: "WILDCARD" },
] as const satisfies readonly VisitorRouteContract[];
