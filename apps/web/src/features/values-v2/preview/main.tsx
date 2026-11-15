import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell, VISITOR_NAV_ITEMS } from "../../../shared/ui/AppShell.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { ValueAxisRadar } from "../components/ValueAxisRadar.js";
import { UI_VALUE_AXES } from "../demoDilemmas.js";
import { ValuesDiagnosisV2 } from "../ValuesDiagnosisV2.js";
import "../../../styles.css";

/*
 * 開発中の画面確認専用（v2 はどのルートにも登録していないため）。
 * `npm run dev` のあと http://127.0.0.1:5173/values-v2-preview.html で開く。
 * Vite のビルドは index.html だけを入口にするため、この画面は dist に入らない。
 * 共通の枠は /values と同じ見た目にするため、MemoryRouter の "/values" の上に AppShell を置く。
 * URL の末尾に #radar-sample を付けると、レーダーの表示部品をサンプル値で確かめられる（分析結果ではない）。
 * v2 をルートに登録したら、このフォルダーと values-v2-preview.html は削除してよい。
 */

function RadarSample() {
  return (
    <div className="mt-6">
      <SectionCard title="表示部品の確認用（サンプル値。分析結果ではありません）">
        <ValueAxisRadar
          axes={UI_VALUE_AXES}
          values={[
            { axisId: "FAIRNESS", state: "DETERMINED", level: 2, usableQuestions: 2 },
            { axisId: "STABILITY", state: "DETERMINED", level: -1, usableQuestions: 2 },
            { axisId: "FUTURE", state: "DETERMINED", level: 0, usableQuestions: 2 },
            { axisId: "OPPORTUNITY", state: "UNDETERMINED" },
            { axisId: "COMMUNITY", state: "DETERMINED", level: 1, usableQuestions: 1 },
            { axisId: "INFRASTRUCTURE", state: "DETERMINED", level: -2, usableQuestions: 2 },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function PreviewPage() {
  return (
    <>
      <ValuesDiagnosisV2 />
      {window.location.hash === "#radar-sample" ? <RadarSample /> : null}
    </>
  );
}

const rootElement = document.querySelector<HTMLElement>("#root");
if (rootElement === null) {
  throw new Error("Root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/values"]}>
      <Routes>
        <Route element={<AppShell navigationItems={VISITOR_NAV_ITEMS} />}>
          <Route element={<PreviewPage />} path="*" />
        </Route>
      </Routes>
    </MemoryRouter>
  </StrictMode>,
);
