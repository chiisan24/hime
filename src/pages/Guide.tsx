import { CreditCard, MapPin, PenLine, CheckCircle2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'

interface Step {
  icon: LucideIcon
  title: string
  description: string
}

const STEPS: Step[] = [
  {
    icon: CreditCard,
    title: '投票所入場券を持って行く',
    description:
      '自宅に届く入場券を持参します。なくしても本人確認ができれば投票できる場合があります。',
  },
  {
    icon: MapPin,
    title: '受付で名前を確認',
    description: '指定の投票所へ行き、受付で入場券を渡して本人確認を受けます。',
  },
  {
    icon: PenLine,
    title: '投票用紙に記入',
    description: '投票用紙を受け取り、記載台で候補者名などを記入します。',
  },
  {
    icon: CheckCircle2,
    title: '投票箱に入れる',
    description: '記入した用紙を投票箱に入れれば完了です。',
  },
]

export function Guide() {
  return (
    <div>
      <PageTitle
        title="投票方法ガイド"
        description="はじめての方へ。投票の流れをやさしく解説します。"
      />

      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="flex items-start gap-4 p-5">
              <div className="flex flex-col items-center">
                <span className="grid size-10 place-items-center rounded-full bg-primary text-base font-bold text-white">
                  {i + 1}
                </span>
                {i < STEPS.length - 1 && <span className="mt-2 h-8 w-px bg-line" />}
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center gap-2">
                  <step.icon className="size-5 text-primary" aria-hidden="true" />
                  <h2 className="font-bold text-ink">{step.title}</h2>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.description}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-4 bg-surface/60 p-5">
        <h2 className="mb-2 font-bold text-ink">持ち物チェック</h2>
        <ul className="space-y-1.5 text-sm text-ink-soft">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            投票所入場券（届いている場合）
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            本人確認ができるもの（求められた場合）
          </li>
        </ul>
      </Card>
    </div>
  )
}
