import { useState } from 'react'
import { Volume2, Check } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import {
  loadPreferences,
  savePreferences,
  applyFontSize,
  type FontSize,
  type Preferences,
} from '../lib/preferences'
import { cn } from '../lib/cn'

const FONT_OPTIONS: { value: FontSize; label: string; sample: string }[] = [
  { value: 'normal', label: '標準', sample: 'あA' },
  { value: 'large', label: '大きめ', sample: 'あA' },
  { value: 'xlarge', label: '特大', sample: 'あA' },
]

const SAMPLE_SIZE: Record<FontSize, string> = {
  normal: 'text-base',
  large: 'text-lg',
  xlarge: 'text-2xl',
}

export function Settings() {
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences())

  const update = (next: Preferences) => {
    setPrefs(next)
    savePreferences(next)
  }

  const setFont = (fontSize: FontSize) => {
    applyFontSize(fontSize)
    update({ ...prefs, fontSize })
  }

  const toggleSpeech = () => update({ ...prefs, speech: !prefs.speech })

  return (
    <div className="space-y-5">
      <PageTitle
        title="表示・読み上げ設定"
        description="見やすい文字サイズや読み上げを設定できます。"
      />

      {/* 文字サイズ */}
      <Card className="p-5">
        <h2 className="mb-1 text-base font-bold text-ink">文字サイズ</h2>
        <p className="mb-4 text-sm text-ink-soft">アプリ全体の文字の大きさを変更します。</p>
        <div className="grid grid-cols-3 gap-3">
          {FONT_OPTIONS.map((opt) => {
            const selected = prefs.fontSize === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setFont(opt.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-[var(--radius-btn)] border p-4 transition-colors',
                  selected
                    ? 'border-primary bg-primary-light'
                    : 'border-line bg-white hover:bg-surface',
                )}
              >
                <span className={cn('font-bold text-ink', SAMPLE_SIZE[opt.value])}>
                  {opt.sample}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold',
                    selected ? 'text-primary-dark' : 'text-ink-soft',
                  )}
                >
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* 音声読み上げ */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-light text-accent-dark">
              <Volume2 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">音声読み上げ</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                画面の文章を音声で読み上げます。
              </p>
            </div>
          </div>
          <Switch checked={prefs.speech} onChange={toggleSpeech} label="音声読み上げ" />
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-ink-faint">
        <Check className="size-4 text-primary" aria-hidden="true" />
        設定はこの端末に保存され、次回も引き継がれます。
      </p>
    </div>
  )
}

/** アクセシブルなトグルスイッチ */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          'absolute top-1 size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}
