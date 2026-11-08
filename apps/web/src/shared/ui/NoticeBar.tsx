import { Info } from "lucide-react";
import type { ReactNode } from "react";

type NoticeBarProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/** 並び順の注記などの控えめなお知らせ（見た目だけの部品） */
export function NoticeBar({ children, className = "" }: NoticeBarProps) {
  return (
    <p
      className={`flex gap-2 rounded-lg border-l-4 border-primary bg-surface px-4 py-3 text-sm leading-6 text-ink ${className}`}
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{children}</span>
    </p>
  );
}
