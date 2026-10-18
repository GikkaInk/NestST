import { IconClose } from "./icons.js";

interface Props {
  message: string | null;
  onDismiss(): void;
}

/** Gentle info strip under the top bar (not an error); dismissible. Renders nothing without a message. */
export function NoticeBanner({ message, onDismiss }: Props) {
  if (message === null) return null;
  return (
    <div className="notice-banner" role="status">
      <span className="notice-banner__face" aria-hidden="true">
        (◕‿◕)
      </span>
      <p className="notice-banner__text">{message}</p>
      <button
        type="button"
        className="icon-button notice-banner__close"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        title="Dismiss notice"
      >
        <IconClose />
      </button>
    </div>
  );
}
