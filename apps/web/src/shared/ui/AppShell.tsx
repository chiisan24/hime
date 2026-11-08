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

/**
 * 共通ナビゲーション。画面に1つだけ置き、画面幅で位置を切り替える。
 * スマホ（767px以下）: 画面の下に固定。768px以上: ヘッダーの下に横並びで、スクロールしても上に残る。
 */
export function SharedNavigation({
  items,
}: Readonly<{ items: readonly SharedNavigationItem[] }>) {
  return (
    <nav
      aria-label="共通ナビゲーション"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-nav)] md:sticky md:top-0 md:border-b md:border-t-0 md:pb-0 md:shadow-none"
    >
      <ul
        className="mx-auto flex w-full max-w-[1200px] md:gap-1 md:px-6 md:py-2 lg:px-8"
        role="list"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li className="min-w-0 flex-1 md:flex-none" key={item.to}>
              <AppNavLink
                className={({ isActive }) =>
                  [
                    "flex h-16 min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold transition",
                    "md:h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm",
                    isActive
                      ? "text-primary md:bg-primary md:text-white"
                      : "text-ink-soft hover:text-primary md:hover:bg-primary-light md:hover:text-primary-dark",
                  ].join(" ")
                }
                end={item.end}
                to={item.to}
              >
                <Icon aria-hidden="true" className="size-6 shrink-0 md:size-4" />
                <span className="whitespace-nowrap">{item.label}</span>
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
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink-soft shadow-[var(--shadow-card)] transition hover:border-primary/50 hover:text-primary"
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
    // スマホでは、下部固定ナビの高さ分だけ下に余白を取り、フッターが隠れないようにする
    <div className="flex min-h-screen flex-col bg-surface pb-[calc(4rem+env(safe-area-inset-bottom))] text-ink md:pb-0">
      <a
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-lg bg-ink px-4 py-3 font-semibold text-white shadow-lg transition focus:translate-y-0"
        href="#main-content"
      >
        本文へ移動
      </a>

      <header className="bg-white">
        {/* 必須表示（文言は変更しない） */}
        <div className="bg-primary-dark px-4 py-1 text-center text-xs font-bold leading-5 text-white">
          会場ローカルデモ・一般公開ではありません
        </div>
        <div className="bg-accent-light px-4 py-1 text-center text-xs font-bold leading-5 text-accent-dark">
          2022年に終了した過去選挙です。現在または将来の投票所判断には使えません
        </div>

        <div className="border-b border-line md:border-b-0">
          <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 sm:px-6 lg:px-8">
            <AppLink
              aria-label="えひめ投票ナビのホーム"
              className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg"
              to="/"
            >
              <BrandLogo className="size-8 shrink-0 md:size-9" />
              <span className="text-lg font-black tracking-tight text-primary-dark md:text-xl">
                えひめ投票ナビ
              </span>
            </AppLink>
            <p
              className="mb-1.5 inline-flex min-h-7 items-center rounded-full bg-primary-light px-3 text-xs font-bold text-primary-dark sm:mb-0 sm:ml-auto"
              data-kind={dataKind}
            >
              データ種別: {DATA_KIND_LABELS[dataKind]}
            </p>
          </div>
        </div>
      </header>

      <SharedNavigation items={navigationItems} />

      <main
        className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-4 sm:px-6 md:py-6 lg:px-8"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mb-3 md:mb-4">
          <BackControl />
        </div>
        <Outlet />
      </main>

      <footer className="border-t border-line bg-white px-4 py-5 text-center text-xs leading-5 text-ink-soft">
        <p>対象: 令和4年（2022年）第20回愛媛県知事選挙</p>
        <p className="mt-1">政策解析準備状態: NOT_READY</p>
      </footer>
    </div>
  );
}
