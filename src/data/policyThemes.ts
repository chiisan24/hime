import type { PolicyTheme } from './types'

/**
 * 政策テーマの仮データ（子育て・教育・経済・防災 など）。
 * 政策比較画面やタグ表示で共通利用する。
 */
export const policyThemes: PolicyTheme[] = [
  { id: 'childcare', label: '子育て' },
  { id: 'education', label: '教育' },
  { id: 'economy', label: '経済' },
  { id: 'disaster', label: '防災' },
  { id: 'welfare', label: '医療・福祉' },
  { id: 'transport', label: '地域交通' },
  { id: 'environment', label: '環境' },
  { id: 'industry', label: '産業・雇用' },
]

const themeMap = new Map(policyThemes.map((t) => [t.id, t]))

/** テーマIDからラベルを取得（未知IDはそのまま返す） */
export function themeLabel(id: string): string {
  return themeMap.get(id)?.label ?? id
}
