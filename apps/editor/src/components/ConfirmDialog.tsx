import { useEffect, useId, useRef } from "react";

interface Props {
  title: string;
  message: string;
  /** Label of the button that throws the changes away. */
  discardLabel: string;
  onSave(): void;
  onDiscard(): void;
  onCancel(): void;
}

/** Modal "unsaved changes" question. Escape and the backdrop cancel. */
export function ConfirmDialog({ title, message, discardLabel, onSave, onDiscard, onCancel }: Props) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-m`}
      >
        <h2 id={`${id}-t`} className="card__title">
          {title}
        </h2>
        <p id={`${id}-m`}>{message}</p>
        <div className="dialog__buttons">
          <button ref={cancelRef} type="button" className="button button--ghost" onClick={onCancel}>
            Keep editing
          </button>
          <button type="button" className="button button--danger" onClick={onDiscard}>
            {discardLabel}
          </button>
          <button type="button" className="button button--primary" onClick={onSave}>
            Save first
          </button>
        </div>
      </div>
    </div>
  );
}
