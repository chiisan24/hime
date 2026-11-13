import { useEffect, useId, useRef, type ReactNode } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "../styles.js";

type ConfirmDialogProps = Readonly<{
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>;

/**
 * 回答を消す操作の確認（C-13）。ネイティブの <dialog> をモーダルで開く。
 * Esc キーと「キャンセル」で閉じる。フォーカスはダイアログの中に留まり、閉じると元の場所に戻る。
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-white p-0 text-ink shadow-[var(--shadow-card)] backdrop:bg-ink/40"
      onCancel={(event) => {
        // Esc キー：ブラウザーに閉じさせず、状態から閉じる
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <div className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-primary-dark" id={titleId}>
          {title}
        </h2>
        <div className="mt-2 text-sm leading-6 text-ink" id={bodyId}>
          {children}
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className={SECONDARY_BUTTON_CLASS} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className={PRIMARY_BUTTON_CLASS} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
