import {
  CalendarDays,
  Eye,
  Home,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import {
  AppLink,
  AppNavLink,
  getAppHistoryDepth,
  HOME_NAVIGATION_STATE,
} from "../../app/navigation.js";
import { projectVisitorPresentation } from "../../app/public/visitorPresentation.js";
import { BrandLogo } from "./BrandLogo.js";
import { SetouchiScene } from "./SetouchiScene.js";

const DATA_KIND_LABELS = {
  REAL_AI: "2022年実資料・AI解析",
  FIXTURE: "架空fixture・UIテスト専用",
} as const;

type DataKind = keyof typeof DATA_KIND_LABELS;

export type SharedNavigationItem = Readonly<{
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
}>;

type AppShellProps = Readonly<{
  dataKind?: DataKind;
  /**
   * Fixed Shared Navigation items supplied by the selected route entry. The
   * shell holds no mode table of its own, so analyst-only items live only in
   * analyst-side modules and never reach the Visitor Build.
   */
  navigationItems: readonly SharedNavigationItem[];
}>;

const PUBLIC_NAV_ITEMS = [
  { to: "/", label: "ホーム", end: true, icon: Home },
  { to: "/schedule", label: "選挙日程", end: true, icon: CalendarDays },
  { to: "/candidates", label: "候補者", end: false, icon: Users },
  { to: "/comparison", label: "政策比較", end: true, icon: Scale },
  { to: "/venue", label: "会場閲覧", end: true, icon: Eye },
] as const;

export const VISITOR_NAV_ITEMS = projectVisitorPresentation(PUBLIC_NAV_ITEMS);

export function SharedNavigation({
  items,
}: Readonly<{ items: readonly SharedNavigationItem[] }>) {
  return (
    <nav aria-label="共通ナビゲーション">
      {/* スマホは横スクロール、PCは折り返しで散らばらせない */}
      <ul
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0"
        role="list"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li className="shrink-0" key={item.to}>
              <AppNavLink
                className={({ isActive }) =>
                  [
                    "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-[var(--radius-btn)] px-3 py-2 text-sm font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    isActive
                      ? "bg-primary text-white"
                      : "bg-surface text-ink-soft hover:bg-surface-2",
                  ].join(" ")
                }
                end={item.end}
                to={item.to}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </AppNavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

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
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft shadow-sm transition hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={handleBack}
      type="button"
    >
      <span aria-hidden="true">←</span>
      前の画面に戻る
    </button>
  );
}

export function AppShell({
  dataKind = "REAL_AI",
  navigationItems,
}: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <a
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-ink px-4 py-3 font-semibold text-white shadow-lg transition focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-accent"
        href="#main-content"
      >
        本文へ移動
      </a>

      <header className="border-b border-line bg-white shadow-sm">
        <div className="bg-ink px-4 py-2 text-center text-xs font-bold tracking-wide text-white sm:text-sm">
          会場ローカルデモ・一般公開ではありません
        </div>
        <div className="border-b border-accent/30 bg-accent-light px-4 py-2.5 text-center text-xs font-semibold text-accent-dark sm:text-sm">
          2022年に終了した過去選挙です。現在または将来の投票所判断には使えません
        </div>

        <div className="relative overflow-hidden">
          {/* 愛媛らしさを感じる控えめな装飾（瀬戸内海＋みかん） */}
          <div className="pointer-events-none absolute inset-0 opacity-40">
            <SetouchiScene className="h-full w-full" />
          </div>

          <div className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <AppLink
                aria-label="えひめ投票ナビのホーム"
                className="inline-flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                to="/"
              >
                <BrandLogo className="size-9 shrink-0 sm:size-10" />
                <span className="text-lg font-black tracking-tight text-ink sm:text-xl">
                  えひめ投票ナビ
                </span>
              </AppLink>
              <p
                className="inline-flex w-fit min-h-9 items-center rounded-full border border-primary/30 bg-primary-light px-3.5 py-1.5 text-xs font-bold text-primary-dark sm:text-sm"
                data-kind={dataKind}
              >
                データ種別: {DATA_KIND_LABELS[dataKind]}
              </p>
            </div>

            <SharedNavigation items={navigationItems} />
          </div>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6 lg:px-8"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mb-6">
          <BackControl />
        </div>
        <Outlet />
      </main>

      <footer className="border-t border-line bg-white px-4 py-6 text-center text-sm text-ink-soft">
        <p>対象: 令和4年（2022年）第20回愛媛県知事選挙</p>
        <p className="mt-1">政策解析準備状態: NOT_READY</p>
      </footer>
    </div>
  );
}
