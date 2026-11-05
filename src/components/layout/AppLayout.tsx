import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { MobileMenu } from './MobileMenu'

/**
 * 全画面共通のレイアウト。
 *  - スマートフォン: 上部ヘッダー + 下部固定ナビ + メニュードロワー
 *  - PC(md以上)   : 左サイドバー
 */
export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // 画面遷移したらメニューを閉じ、先頭までスクロール
  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-white">
      <Sidebar />
      <Header onMenuClick={() => setMenuOpen(true)} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* メインコンテンツ: PCはサイドバー分の左余白、スマホは下部ナビ分の下余白 */}
      <main className="md:pl-64">
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">
          <Outlet />
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
