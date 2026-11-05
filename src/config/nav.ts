import type { LucideIcon } from 'lucide-react'
import {
  Home,
  Users,
  Scale,
  MapPin,
  MoreHorizontal,
  MessageCircleQuestion,
  Calendar,
  BookOpen,
  Bell,
  Settings,
} from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

/**
 * 画面下部ナビ / PCサイドバーで共通利用する主要ナビ（指示書 4.ナビゲーション）。
 * 将来の機能追加（ニュース要約・議員の活動・政策の進捗）を見据え、
 * ここに項目を足すだけで両ナビに反映される拡張しやすい構造にしている。
 */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'ホーム', path: '/', icon: Home },
  { label: '候補者', path: '/candidates', icon: Users },
  { label: '政策比較', path: '/compare', icon: Scale },
  { label: '投票所', path: '/polling', icon: MapPin },
  { label: 'その他', path: '/more', icon: MoreHorizontal },
]

/** 「その他」やメニューから辿れる補助的な画面 */
export const SECONDARY_NAV: NavItem[] = [
  { label: 'AIに質問', path: '/chat', icon: MessageCircleQuestion },
  { label: '投票日・選挙日程', path: '/schedule', icon: Calendar },
  { label: '投票方法ガイド', path: '/guide', icon: BookOpen },
  { label: '投票日リマインダー', path: '/reminder', icon: Bell },
  { label: '表示・読み上げ設定', path: '/settings', icon: Settings },
]
