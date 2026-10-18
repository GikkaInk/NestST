/**
 * The few window features the editor uses. Outside Tauri (plain browser, tests)
 * they fall back to the document, so the UI still works.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function setWindowTitle(title: string): void {
  document.title = title;
  if (inTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined);
}

/**
 * Calls `shouldBlock` when the user tries to close the window; if it returns
 * true the window stays open (the caller then asks and calls `closeWindow`).
 * Returns the function that removes the handler.
 */
export function onCloseRequested(shouldBlock: () => boolean): () => void {
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (shouldBlock()) e.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);
  let unlisten: (() => void) | null = null;
  let removed = false;
  if (inTauri()) {
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (shouldBlock()) event.preventDefault();
      })
      .then((fn) => {
        if (removed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
  }
  return () => {
    removed = true;
    window.removeEventListener("beforeunload", beforeUnload);
    unlisten?.();
  };
}

export function closeWindow(): void {
  if (inTauri()) void getCurrentWindow().destroy();
  else window.close();
}
