import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type SectionCardProps = Readonly<{
  title: string;
  icon?: LucideIcon;
  /** 見出しの右側に置く小さな要素（バッジなど） */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}>;

/**
 * 見出し付きの白いカード（角丸・薄い影）。見た目だけの部品。
 * 見出しは h2 にし、各画面の h1 を1つに保つ。
 */
export function SectionCard({
  title,
  icon: Icon,
  aside,
  children,
  className = "",
}: SectionCardProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* アイコンと見出しは同じ行に保ち、長い見出しは見出しの中で折り返す */}
        <div className="flex min-w-0 items-start gap-2">
          {Icon === undefined ? null : (
            <Icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
          )}
          <h2 className="min-w-0 text-lg font-bold text-primary-dark sm:text-xl" id={headingId}>
            {title}
          </h2>
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
