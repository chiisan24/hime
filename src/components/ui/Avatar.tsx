import { cn } from '../../lib/cn'

/**
 * 顔写真の表示。photoUrl があれば画像を、なければ氏名の頭文字を中立的な配色で表示する。
 * 候補者ごとに配色を変えず、強調の度合いを統一する（指示書 6）。
 */
export function Avatar({
  name,
  photoUrl,
  className,
}: {
  name: string
  photoUrl?: string
  className?: string
}) {
  const initial = name.trim().charAt(0)

  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-ink-soft',
        className,
      )}
      aria-hidden={photoUrl ? undefined : true}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={`${name}さんの顔写真`} className="size-full object-cover" />
      ) : (
        <span className="font-bold" style={{ fontSize: '42%' }}>
          {initial}
        </span>
      )}
    </div>
  )
}
