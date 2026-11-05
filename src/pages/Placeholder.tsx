import { Hammer } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'

/**
 * 後続STEPで実装予定の画面の仮表示。
 * レイアウト/ナビの動作確認のために用意している。
 */
export function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <PageTitle title={title} description={description} />
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-surface text-ink-faint">
          <Hammer className="size-7" aria-hidden="true" />
        </span>
        <p className="font-semibold text-ink">この画面は準備中です</p>
        <p className="max-w-sm text-sm text-ink-soft">
          次のステップでデザインを実装します。
        </p>
      </Card>
    </div>
  )
}
