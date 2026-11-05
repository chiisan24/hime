import { Outlet, useLocation, useNavigate } from "react-router-dom";

import {
  AppLink,
  AppNavLink,
  getAppHistoryDepth,
  HOME_NAVIGATION_STATE,
} from "../../app/navigation.js";

const DATA_KIND_LABELS = {
  REAL_AI: "2022年実資料・AI解析",
  FIXTURE: "架空fixture・UIテスト専用",
} as const;

type DataKind = keyof typeof DATA_KIND_LABELS;

type AppShellProps = Readonly<{
  dataKind?: DataKind;
}>;

const COMMON_NAV_ITEMS = [
  { to: "/", label: "ホーム", end: true },
  { to: "/schedule", label: "選挙日程", end: true },
  { to: "/candidates", label: "候補者", end: false },
  { to: "/comparison", label: "政策比較", end: true },
  { to: "/sources", label: "出典", end: true },
  { to: "/venue", label: "会場閲覧", end: true },
  { to: "/analyst/readiness", label: "分析状態", end: true },
] as const;

function BackControl() {
  const location = useLocation();
  const navigate = useNavigate();
  const historyDepth = getAppHistoryDepth(location.state);

  const handleBack = () => {
    if (historyDepth > 0) {
      navigate(-1);
      return;
    }

    navigate("/", {
      replace: true,
      state: HOME_NAVIGATION_STATE,
    });
  };

  return (
    <button
      aria-label="前の画面に戻る。履歴がない場合はホームへ移動"
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-orange-400 hover:text-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
      onClick={handleBack}
      type="button"
    >
      <span aria-hidden="true">←</span>
      前の画面に戻る
    </button>
  );
}

export function AppShell({ dataKind = "REAL_AI" }: AppShellProps) {
  return (
    <div className="min-h-screen bg-orange-50 text-slate-900">
      <a
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-slate-950 px-4 py-3 font-semibold text-white shadow-lg transition focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-orange-400"
        href="#main-content"
      >
        本文へ移動
      </a>

      <header className="border-b border-orange-200 bg-white shadow-sm">
        <div className="bg-slate-950 px-4 py-2 text-center text-sm font-bold tracking-wide text-white">
          会場ローカルデモ・一般公開ではありません
        </div>
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-950">
          2022年に終了した過去選挙です。現在または将来の投票所判断には使えません
        </div>

        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AppLink
              aria-label="えひめ投票ナビのホーム"
              className="inline-flex min-h-11 items-center rounded-lg text-xl font-black tracking-tight text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-700"
              to="/"
            >
              えひめ投票ナビ
            </AppLink>
            <p
              className="inline-flex w-fit min-h-11 items-center rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-950"
              data-kind={dataKind}
            >
              データ種別: {DATA_KIND_LABELS[dataKind]}
            </p>
          </div>

          <nav aria-label="共通ナビゲーション">
            <ul className="flex flex-wrap gap-2" role="list">
              {COMMON_NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <AppNavLink
                    className={({ isActive }) =>
                      [
                        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700",
                        isActive
                          ? "bg-orange-700 text-white"
                          : "bg-orange-100 text-slate-800 hover:bg-orange-200",
                      ].join(" ")
                    }
                    end={item.end}
                    to={item.to}
                  >
                    {item.label}
                  </AppNavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main
        className="mx-auto min-h-[60vh] max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mb-6">
          <BackControl />
        </div>
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
        <p>対象: 令和4年（2022年）第20回愛媛県知事選挙</p>
        <p className="mt-1">政策解析準備状態: NOT_READY</p>
      </footer>
    </div>
  );
}
