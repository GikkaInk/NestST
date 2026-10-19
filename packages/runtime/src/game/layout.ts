/**
 * Camera layout. The TileMapView positions and scales its own container in
 * `setCamera` (position = -cam * scale, scale = scale), so it goes straight on
 * the stage. Everything else (objects, player) lives in one `scene` container
 * that must get the same transform, which is what this returns.
 */
export function sceneTransform(
  cam: { x: number; y: number },
  scale: number,
): { x: number; y: number; scale: number } {
  return { x: -cam.x * scale, y: -cam.y * scale, scale };
}
