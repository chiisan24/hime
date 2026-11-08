import type { ReactNode } from "react";

import { Badge } from "./Badge.js";

type FrameProps = Readonly<{
  children: ReactNode;
}>;

/**
 * 「AI要約」の枠（見た目だけの部品）。
 * 原文・出典の枠と色で区別する（AI要約＝薄い青、原文＝白）。
 * 表示してよいAI情報がないときは、中身の代わりに理由を渡す。
 */
export function AiSummaryFrame({ children }: FrameProps) {
  return (
    <div className="rounded-xl bg-primary-light p-4">
      <Badge tone="primary">AI要約</Badge>
      <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
    </div>
  );
}

/** 「原文・出典」の枠（見た目だけの部品） */
export function SourceFrame({ children }: FrameProps) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <Badge>原文・出典</Badge>
      <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
    </div>
  );
}
