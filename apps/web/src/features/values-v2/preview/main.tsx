import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell, VISITOR_NAV_ITEMS } from "../../../shared/ui/AppShell.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { SAMPLE_AXIS_VALUES } from "../axisAnalysis.js";
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
 * 結果画面のレーダーも、計算方法が決まるまでは同じサンプル値で表示する（axisAnalysis.ts）。
 * v2 をルートに登録したら、このフォルダーと values-v2-preview.html は削除してよい。
 */

function RadarSample() {
  return (
    <div className="mt-6">
      <SectionCard title="表示部品の確認用（サンプル値。分析結果ではありません）">
        <ValueAxisRadar axes={UI_VALUE_AXES} sample values={SAMPLE_AXIS_VALUES} />
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
