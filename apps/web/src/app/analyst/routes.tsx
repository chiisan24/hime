import { Route, Routes } from "react-router-dom";

import { AppShell } from "../../shared/ui/AppShell.js";
import {
  CandidateDetailPage,
  CandidatesPage,
  ComparisonPage,
  NotFoundPage,
  SchedulePage,
  VenuePage,
} from "../public/pages.js";
import { ANALYST_NAV_ITEMS } from "./navigationItems.js";
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
} from "./pages.js";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell navigationItems={ANALYST_NAV_ITEMS} />}>
        <Route index element={<AnalystHomePage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="candidates/:candidateId" element={<CandidateDetailPage />} />
        <Route path="comparison" element={<ComparisonPage />} />
        <Route path="venue" element={<VenuePage />} />
        <Route path="analyst/readiness" element={<AnalystReadinessPage />} />
        <Route path="analyst/sources" element={<AnalystSourcesPage />} />
        <Route path="analyst/runs" element={<AnalystRunsPage />} />
        <Route path="analyst/runs/:runId" element={<AnalystRunDetailPage />} />
        <Route
          path="analyst/verification/:artifactId"
          element={<AnalystVerificationPage />}
        />
        <Route path="analyst/review/:artifactId" element={<AnalystReviewPage />} />
        <Route path="analyst/evaluation" element={<AnalystEvaluationPage />} />
        <Route path="analyst/p0" element={<AnalystP0Page />} />
        <Route path="analyst/aws" element={<AnalystAwsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
