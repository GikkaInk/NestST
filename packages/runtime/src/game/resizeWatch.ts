/**
 * Calls `onResize` whenever `host` changes size. Pixi's `resizeTo` only follows
 * window resizes, so a host that changes on its own (a banner above it goes
 * away) needs this. Returns the function that stops watching.
 */
export function watchResize(
  host: Element,
  onResize: () => void,
  Observer: typeof ResizeObserver = ResizeObserver,
): () => void {
  const observer = new Observer(() => onResize());
  observer.observe(host);
  return () => observer.disconnect();
}
