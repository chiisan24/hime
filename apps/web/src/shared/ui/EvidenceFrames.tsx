import type { ReactNode } from "react";

import { Badge } from "./Badge.js";

type FrameProps = Readonly<{
  children: ReactNode;
}>;

/**
 * 「原文・出典」の枠（見た目だけの部品）。白い枠で、AI要約（AiContent の薄い青の枠）と区別する。
 */
export function SourceFrame({ children }: FrameProps) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <Badge>原文・出典</Badge>
      <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
    </div>
  );
}
