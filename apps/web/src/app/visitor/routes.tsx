import { Route, Routes } from "react-router-dom";

import { ValuesDiagnosis } from "../../features/values/ValuesDiagnosis.js";
import { AppShell, VISITOR_NAV_ITEMS } from "../../shared/ui/AppShell.js";
import {
  CandidateDetailPage,
  CandidatesPage,
  ComparisonPage,
  NotFoundPage,
  SchedulePage,
  VenuePage,
  VisitorHomePage,
} from "../public/pages.js";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell navigationItems={VISITOR_NAV_ITEMS} />}>
        <Route index element={<VisitorHomePage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="candidates/:candidateId" element={<CandidateDetailPage />} />
        <Route path="comparison" element={<ComparisonPage />} />
        <Route path="venue" element={<VenuePage />} />
        <Route path="values" element={<ValuesDiagnosis />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
