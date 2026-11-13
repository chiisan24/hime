// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../../../../tests/harness/react-renderer.js";
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
import {
  CandidateDetailPage,
  ComparisonPage,
  VisitorHomePage,
} from "./public/pages.js";

const ANALYST_PAGE_CASES = [
  { heading: "政策解析準備状態", Page: AnalystReadinessPage },
  { heading: "Source Manifest", Page: AnalystSourcesPage },
  { heading: "解析実行と履歴", Page: AnalystRunsPage },
  { heading: "評価", Page: AnalystEvaluationPage },
  { heading: "P0完成判定", Page: AnalystP0Page },
  { heading: "AWS診断", Page: AnalystAwsPage },
] as const;

describe("split public and analyst page modules", () => {
  it("keeps Visitor Home limited to remaining visitor destinations", () => {
    renderWithRouter(<VisitorHomePage />);

    const destinations = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(destinations).toEqual([
      // 価値観診断の入口カード（regional-values-map tasks.md 14 の案Bの承認記録）
      "/values",
      "/schedule",
      "/candidates",
      "/candidates/nakamura-tokihiro",
      "/candidates/hayashi-noriko",
      "/comparison",
      "/venue",
    ]);
    expect(screen.queryByText("ローカル分析のP0画面")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "出典一覧を見る" })).not.toBeInTheDocument();
  });

  it("composes Analyst Home from public content and internal analyst links", () => {
    renderWithRouter(<AnalystHomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "えひめ投票ナビ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "ローカル分析のP0画面" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source Manifest画面を見る" })).toHaveAttribute(
      "href",
      "/analyst/sources",
    );
    expect(screen.queryByRole("link", { name: "出典一覧を見る" })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/sources"),
    ).toHaveLength(0);
  });

  it.each(ANALYST_PAGE_CASES)("preserves the $heading analyst page contract", ({ heading, Page }) => {
    renderWithRouter(<Page />);

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("preserves analyst path parameter displays", () => {
    renderWithRouter(
      <Routes>
        <Route path="analyst/runs/:runId" element={<AnalystRunDetailPage />} />
        <Route
          path="analyst/verification/:artifactId"
          element={<AnalystVerificationPage />}
        />
        <Route path="analyst/review/:artifactId" element={<AnalystReviewPage />} />
      </Routes>,
      { initialEntries: ["/analyst/runs/run-123"] },
    );

    expect(screen.getByText(/run ID:/u)).toHaveTextContent("run-123");
  });

  it.each([
    {
      path: "/analyst/verification/artifact-verify",
      route: "analyst/verification/:artifactId",
      Page: AnalystVerificationPage,
      expected: "artifact-verify",
    },
    {
      path: "/analyst/review/artifact-review",
      route: "analyst/review/:artifactId",
      Page: AnalystReviewPage,
      expected: "artifact-review",
    },
  ])("preserves the artifactId at $path", ({ path, route, Page, expected }) => {
    renderWithRouter(
      <Routes>
        <Route path={route} element={<Page />} />
      </Routes>,
      { initialEntries: [path] },
    );

    expect(screen.getByText(/artifact ID:/u)).toHaveTextContent(expected);
  });

  it("retains embedded source and evidence fields in public pages", () => {
    const { unmount } = renderWithRouter(
      <Routes>
        <Route path="candidates/:candidateId" element={<CandidateDetailPage />} />
      </Routes>,
      { initialEntries: ["/candidates/nakamura-tokihiro"] },
    );

    expect(screen.getByText("出典")).toBeInTheDocument();
    expect(screen.getByText("採用資料")).toBeInTheDocument();

    unmount();
    renderWithRouter(<ComparisonPage />);
    expect(screen.getAllByText("根拠リンク")).toHaveLength(2);
  });
});
