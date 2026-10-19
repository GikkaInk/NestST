export interface CameraArgs {
  mapPx: { w: number; h: number };
  viewPx: { w: number; h: number };
  playerPx: { x: number; y: number };
  scale: number;
}

function axis(map: number, view: number, player: number): number {
  if (map <= view) return (map - view) / 2;
  return Math.min(Math.max(player - view / 2, 0), map - view);
}

/** Top-left corner of the view in world pixels. */
export function cameraFor(args: CameraArgs): { x: number; y: number } {
  const { mapPx, viewPx, playerPx, scale } = args;
  return {
    x: axis(mapPx.w, viewPx.w / scale, playerPx.x),
    y: axis(mapPx.h, viewPx.h / scale, playerPx.y),
  };
}
