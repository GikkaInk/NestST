const KEY = "nestst.onboardingHidden";

/** Whether the user closed the first-steps panel for good. Any storage failure reads as "not hidden". */
export function readOnboardingHidden(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage may be blocked; the panel just comes back next time.
  }
}
