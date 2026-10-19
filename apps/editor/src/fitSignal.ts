/** What identifies the map view's content for the purpose of "fit to window". */
export interface FitKey {
  openSeq: number;
  mapId: string | null;
}

/**
 * Fit the camera only when a project was opened/created or the current map
 * changed. Edits, undo and redo (which replace the project object) must keep
 * the user's zoom and pan.
 */
export function shouldFit(prev: FitKey | null, next: FitKey): boolean {
  return prev === null || prev.openSeq !== next.openSeq || prev.mapId !== next.mapId;
}
