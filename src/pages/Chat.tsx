import { useEffect, useRef, useState } from 'react'
import { Send, ExternalLink, Sparkles } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar'
import { cn } from '../lib/cn'
import type { ChatMessage } from '../data/types'

const EXAMPLE_QUESTIONS = [
  '期日前投票はいつからできますか？',
  '投票に必要な持ち物は？',
  '引っ越した場合はどこで投票できますか？',
  '子育ての政策を比べたい',
]

/** デモ用の仮応答（実際は共同開発者のAI/APIに差し替える） */
function createDemoReply(question: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'ご質問ありがとうございます。こちらはデモ用の回答です。実際の回答では、公式情報をもとにわかりやすくご案内します。' +
      `（お尋ね: 「${question}」）`,
    sources: [
      { label: '愛媛県選挙管理委員会（出典例）', url: 'https://example.com/ehime-senkan' },
    ],
  }
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = (text: string) => {
    const content = text.trim()
    if (!content || loading) return
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    // デモ: 擬似的な応答待ち
    setTimeout(() => {
      setMessages((prev) => [...prev, createDemoReply(content)])
      setLoading(false)
    }, 900)
  }

  const started = messages.length > 0

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col md:min-h-[calc(100dvh-8rem)]">
      <div className="mb-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink md:text-2xl">
          <Sparkles className="size-5 text-primary" aria-hidden="true" />
          AIに質問
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          選挙や投票の疑問を、気軽に質問できます。
        </p>
      </div>

      {/* メッセージ領域 */}
      <div className="flex-1 space-y-4 pb-4">
        {!started && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface/60 p-4">
            <p className="mb-3 text-sm font-semibold text-ink">こんな質問ができます</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-primary/30 bg-white px-3.5 py-2 text-sm font-medium text-primary hover:bg-primary-light"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {loading && <TypingBubble />}
        <div ref={endRef} />
      </div>

      {/* 入力欄（画面下部に固定） */}
      <div className="sticky bottom-16 z-10 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-[var(--radius-card)] md:border md:px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder="質問を入力…"
            aria-label="質問を入力"
            className="max-h-32 min-h-12 flex-1 resize-none rounded-[var(--radius-btn)] border border-line bg-white px-3.5 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="送信"
            className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-btn)] bg-primary text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            <Send className="size-5" aria-hidden="true" />
          </button>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-ink-faint">
          AIの回答は参考情報です。正確な内容は出典や公式情報をご確認ください。
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex items-start gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
      )}
      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-primary text-white'
            : 'rounded-bl-sm bg-surface text-ink',
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 border-t border-line/70 pt-2">
            <p className="mb-1 text-[11px] font-semibold text-ink-soft">出典</p>
            <ul className="space-y-1">
              {message.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                  >
                    {s.label}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {isUser && <Avatar name="あなた" className="size-9" />}
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex items-start gap-2" role="status" aria-live="polite">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
        <Sparkles className="size-5" aria-hidden="true" />
      </span>
      <div className="rounded-2xl rounded-bl-sm bg-surface px-4 py-3">
        <span className="flex gap-1">
          <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
        </span>
        <span className="sr-only">回答を生成中</span>
      </div>
    </div>
  )
}

function Dot({ delay = '0s' }: { delay?: string }) {
  return (
    <span
      className="inline-block size-2 animate-bounce rounded-full bg-ink-faint"
      style={{ animationDelay: delay }}
    />
  )
}
