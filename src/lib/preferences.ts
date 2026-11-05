/*
 * 表示設定（文字サイズ・音声読み上げ）の保存と適用。
 * UI層で完結する設定。localStorage に保存し、起動時に適用する。
 */

export type FontSize = 'normal' | 'large' | 'xlarge'

export interface Preferences {
  fontSize: FontSize
  speech: boolean
}

const STORAGE_KEY = 'ehime-vote-navi:prefs'

const DEFAULT_PREFS: Preferences = {
  fontSize: 'normal',
  speech: false,
}

/** 文字サイズに対応するルート font-size（rem基準が全体に波及する） */
const FONT_SIZE_PX: Record<FontSize, string> = {
  normal: '16px',
  large: '18px',
  xlarge: '20px',
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 保存に失敗しても表示は継続する
  }
}

/** 文字サイズをページ全体に適用 */
export function applyFontSize(size: FontSize): void {
  document.documentElement.style.fontSize = FONT_SIZE_PX[size]
}

/** 起動時に保存済み設定を適用 */
export function applyStoredPreferences(): void {
  applyFontSize(loadPreferences().fontSize)
}
