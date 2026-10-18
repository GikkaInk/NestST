import { IconClose } from "./icons.js";

interface Props {
  message: string | null;
  onDismiss(): void;
}

/** Friendly error strip under the top bar; dismissible. Renders nothing without a message. */
export function ErrorBanner({ message, onDismiss }: Props) {
  if (message === null) return null;
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__face" aria-hidden="true">
        (・_・;)
      </span>
      <p className="error-banner__text">{message}</p>
      <button
        type="button"
        className="icon-button error-banner__close"
        onClick={onDismiss}
        aria-label="Dismiss message"
        title="Dismiss message"
      >
        <IconClose />
      </button>
    </div>
  );
}
