import type { GameMap } from "@nestst/core";

/** The map is drawn in square chunks of this many tiles per side. */
export const CHUNK_SIZE = 16;

/** What the camera shows: top-left corner in world pixels, screen size in screen pixels, zoom. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface MapSize {
  width: number;
  height: number;
  tileSize: number;
}

/** Inclusive range of chunk coordinates. */
export interface ChunkRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Chunks that intersect the viewport, widened by `margin` chunks on each side
 * and clamped to the map. The range is never empty: a camera that looks past
 * the map edge gets the nearest edge chunks.
 */
export function visibleChunkRange(
  view: ViewRect,
  map: MapSize,
  chunkSize: number,
  margin: number,
): ChunkRange {
  if (!(view.scale > 0) || !Number.isFinite(view.scale)) {
    throw new RangeError(`zoom must be a positive number, but it is ${view.scale}`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunk size must be a positive whole number, but it is ${chunkSize}`);
  }
  const span = chunkSize * map.tileSize;
  const chunksX = Math.ceil(map.width / chunkSize);
  const chunksY = Math.ceil(map.height / chunkSize);
  const right = view.x + view.width / view.scale;
  const bottom = view.y + view.height / view.scale;
  // The right/bottom edge is exclusive: a screen that ends exactly on a chunk
  // border does not touch the next chunk.
  const x0 = Math.floor(view.x / span) - margin;
  const y0 = Math.floor(view.y / span) - margin;
  const x1 = Math.ceil(right / span) - 1 + margin;
  const y1 = Math.ceil(bottom / span) - 1 + margin;
  const cx0 = clamp(x0, 0, chunksX - 1);
  const cy0 = clamp(y0, 0, chunksY - 1);
  return {
    x0: cx0,
    y0: cy0,
    x1: clamp(x1, cx0, chunksX - 1),
    y1: clamp(y1, cy0, chunksY - 1),
  };
}

export function inRange(r: ChunkRange, cx: number, cy: number): boolean {
  return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
}

export function chunkKey(cx: number, cy: number, chunksX: number): number {
  return cy * chunksX + cx;
}

export function chunkCoords(key: number, chunksX: number): { cx: number; cy: number } {
  return { cx: key % chunksX, cy: Math.floor(key / chunksX) };
}

/** Indexes of cells that differ between two tile arrays of the same layer. */
export function diffTiles(a: readonly number[], b: readonly number[]): number[] {
  if (a === b) return [];
  if (a.length !== b.length) {
    throw new RangeError(`layer sizes differ: ${a.length} and ${b.length} tiles`);
  }
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/** Keys of the chunks that contain the given cell indexes. */
export function dirtyChunks(
  cells: readonly number[],
  mapWidth: number,
  chunkSize: number,
): Set<number> {
  const chunksX = Math.ceil(mapWidth / chunkSize);
  const keys = new Set<number>();
  for (const i of cells) {
    const x = i % mapWidth;
    const y = Math.floor(i / mapWidth);
    keys.add(chunkKey(Math.floor(x / chunkSize), Math.floor(y / chunkSize), chunksX));
  }
  return keys;
}

/** Cached chunk keys that lie outside `keep` and should be destroyed. */
export function chunksToEvict(
  cached: Iterable<number>,
  keep: ChunkRange,
  chunksX: number,
): number[] {
  const out: number[] = [];
  for (const key of cached) {
    const { cx, cy } = chunkCoords(key, chunksX);
    if (!inRange(keep, cx, cy)) out.push(key);
  }
  return out;
}

export interface LayerChange {
  index: number;
  tilesChanged: boolean;
  visibilityChanged: boolean;
}

export type MapUpdatePlan = { full: true } | { full: false; layers: LayerChange[] };

/**
 * What must be redrawn to go from `prev` to `next`. Layers are compared by
 * their `tiles` array identity: `paintTiles` in core keeps the arrays of
 * untouched layers, so an unchanged layer costs nothing.
 */
export function planMapUpdate(prev: GameMap | undefined, next: GameMap): MapUpdatePlan {
  if (
    prev === undefined ||
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.tileSize !== next.tileSize ||
    prev.layers.length !== next.layers.length ||
    prev.layers.some((l, i) => l.id !== next.layers[i]!.id)
  ) {
    return { full: true };
  }
  const layers: LayerChange[] = [];
  next.layers.forEach((l, index) => {
    const old = prev.layers[index]!;
    const tilesChanged = old.tiles !== l.tiles;
    const visibilityChanged = old.visible !== l.visible;
    if (tilesChanged || visibilityChanged) layers.push({ index, tilesChanged, visibilityChanged });
  });
  return { full: false, layers };
}
