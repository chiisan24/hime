/** 日付ユーティリティ（表示用フォーマット） */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** ISO日付文字列を「10月27日(日)」形式に整形 */
export function formatJpDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
}

/** ISO日付文字列を「10/11」形式に整形 */
export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 投票日まであと何日か（過去なら null） */
export function daysUntil(iso: string): number | null {
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((a - b) / 86_400_000)
  return diff >= 0 ? diff : null
}
