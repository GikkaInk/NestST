import type { ReactNode } from "react";

/** Small line icons drawn with the current text colour; decorative (labels live on the buttons). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconNew = () => (
  <Icon>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M12 10v6M9 13h6" />
  </Icon>
);
export const IconOpen = () => (
  <Icon>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const IconSave = () => (
  <Icon>
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M8 3v5h7V3M8 21v-6h8v6" />
  </Icon>
);
export const IconUndo = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);
export const IconRedo = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Icon>
);
export const IconBrush = () => (
  <Icon>
    <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13z" />
    <path d="M7 14.5c-2 0-3.5 1.6-3.5 3.6 0 1.4-.8 2.2-1.5 2.4 1 .9 2.4 1.5 4 1.5 2.5 0 4.5-2 4.5-4.5z" />
  </Icon>
);
export const IconEraser = () => (
  <Icon>
    <path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L12 21z" />
    <path d="M7 21h14M9 10l6 6" />
  </Icon>
);
export const IconZoomIn = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M11 8v6M8 11h6" />
  </Icon>
);
export const IconZoomOut = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M8 11h6" />
  </Icon>
);
export const IconFit = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const IconSpawn = () => (
  <Icon>
    <path d="M6 21V4" />
    <path d="M6 4h11l-2.5 4L17 12H6" />
  </Icon>
);
export const IconNpc = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
  </Icon>
);

export const IconPlay = () => (
  <Icon>
    <path d="M7 4.5v15l12-7.5z" />
  </Icon>
);
export const IconStop = () => (
  <Icon>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);
