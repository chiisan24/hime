/** クラス名を結合するユーティリティ（falsy を除去） */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
