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
 * 開発中の画面確認専用。
 * `npm run dev` のあと http://127.0.0.1:5173/values-v2-preview.html で開く。
 * Vite のビルドは index.html だけを入口にするため、この画面は dist に入らない。
 * v2 の診断は /values/v2 に登録したため、アプリの中ではそちらで確かめられる。この画面は、主に
 * #radar-sample（URL の末尾に付けて開くと、診断の代わりに、レーダーの表示部品をサンプル値で確かめられる。
 * 分析結果ではない）のために残している。
 * 共通の枠は /values/v2 と同じ見た目にするため、MemoryRouter の "/values/v2" の上に AppShell を置く。
 * 診断の結果画面のレーダーは、回答から計算した値で描く（axisAnalysis.ts）。サンプル値は #radar-sample の欄だけに出す。
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

/** 分析結果とサンプル値を同じ画面に並べないよう、#radar-sample のときはサンプルの欄だけを出す */
function PreviewPage() {
  return window.location.hash === "#radar-sample" ? <RadarSample /> : <ValuesDiagnosisV2 />;
}

const rootElement = document.querySelector<HTMLElement>("#root");
if (rootElement === null) {
  throw new Error("Root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/values/v2"]}>
      <Routes>
        <Route element={<AppShell navigationItems={VISITOR_NAV_ITEMS} />}>
          <Route element={<PreviewPage />} path="*" />
        </Route>
      </Routes>
    </MemoryRouter>
  </StrictMode>,
);
