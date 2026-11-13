import { useEffect, useRef } from "react";

/**
 * 画面（または質問）が切り替わったときに、見出しへフォーカスを移す。
 * URL を変えずに画面を切り替えるため、読み上げの利用者に切り替えを伝える目的。
 * enabled が false のとき（最初の表示など）は動かさない。
 */
export function useHeadingFocus<T extends HTMLElement>(key: unknown, enabled: boolean) {
  const headingRef = useRef<T>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [key, enabled]);

  return headingRef;
}
