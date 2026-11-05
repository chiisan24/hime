import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <p className="text-ink-soft">お探しのページが見つかりませんでした。</p>
      <Link to="/">
        <Button>ホームに戻る</Button>
      </Link>
    </div>
  )
}
