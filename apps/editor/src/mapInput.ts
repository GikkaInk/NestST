/**
 * Pure maths for the map canvas: screen ↔ world ↔ cell, pan, zoom about the
 * cursor and brush strokes. Kept apart from Pixi so it can be unit-tested.
 */
import { objectAt } from "@nestst/core";
import type { GameMap, TileEdit } from "@nestst/core";
import { MAX_SCALE, MIN_SCALE } from "@nestst/runtime";

/** Same convention as `TileMapView.setCamera`: world pixel at the screen's top-left, and zoom. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Cell {
  x: number;
  y: number;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.scale, y: cam.y + sy / cam.scale };
}

/** Cell under a screen point; rounds down, so points left of / above the map give negative cells. */
export function screenToCell(cam: Camera, sx: number, sy: number, tileSize: number): Cell {
  const w = screenToWorld(cam, sx, sy);
  return { x: Math.floor(w.x / tileSize), y: Math.floor(w.y / tileSize) };
}

/** Every cell on the line from `a` to `b`, both included (Bresenham). */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = a;
  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Zoom by `factor` (clamped to the runtime limits) keeping the world point under (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const scale = clampScale(cam.scale * factor);
  const w = screenToWorld(cam, sx, sy);
  return { x: w.x - sx / scale, y: w.y - sy / scale, scale };
}

/** Zoom factor for one wheel event: about ×1.16 per mouse notch (deltaY ≈ 100), at most ×2 / ×0.5. */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return Math.min(2, Math.max(0.5, Math.exp(-deltaY * 0.0015)));
}

/** Camera after dragging the view by (dx, dy) screen pixels. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x - dx / cam.scale, y: cam.y - dy / cam.scale, scale: cam.scale };
}

/** Camera that shows a `mapW`×`mapH` px map centred on a `screenW`×`screenH` screen. */
export function centeredCamera(
  mapW: number,
  mapH: number,
  screenW: number,
  screenH: number,
  scale: number,
): Camera {
  const s = clampScale(scale);
  return { x: (mapW - screenW / s) / 2, y: (mapH - screenH / s) / 2, scale: s };
}

/** Largest zoom (within limits, at most 2) at which the whole map fits on the screen with a margin. */
export function fitScale(mapW: number, mapH: number, screenW: number, screenH: number): number {
  const margin = 48;
  const s = Math.min((screenW - margin * 2) / mapW, (screenH - margin * 2) / mapH, 2);
  return clampScale(s);
}

/** A stroke follows only the pointer that started it; other pointers (a second touch, pen) are ignored. */
export function isStrokePointer(strokePointerId: number | null, eventPointerId: number): boolean {
  return strokePointerId !== null && strokePointerId === eventPointerId;
}

export interface Stroke {
  /** Adds the cell under the pointer; returns the new edits (line from the previous cell). */
  add(cell: Cell): TileEdit[];
  /** All edits of this stroke so far; each map cell at most once. */
  readonly edits: TileEdit[];
}

/** Collects one brush drag (pointerdown .. pointerup) on a `width`×`height` map. */
export function createStroke(
  map: { width: number; height: number },
  layerId: string,
  tile: number,
): Stroke {
  const edits: TileEdit[] = [];
  const seen = new Set<number>();
  let last: Cell | null = null;
  return {
    edits,
    add(cell) {
      const path = last === null ? [cell] : lineCells(last, cell);
      last = cell;
      const added: TileEdit[] = [];
      for (const c of path) {
        if (c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height) continue;
        const key = c.y * map.width + c.x;
        if (seen.has(key)) continue;
        seen.add(key);
        const edit = { layerId, x: c.x, y: c.y, tile };
        edits.push(edit);
        added.push(edit);
      }
      return added;
    },
  };
}

/**
 * What a click with the eraser does: remove the object on the cell if there is
 * one (no tile stroke then), otherwise erase tiles as a stroke.
 */
export function eraserAction(map: GameMap, cell: Cell): "object" | "tile" {
  return objectAt(map, cell.x, cell.y) === undefined ? "tile" : "object";
}

/** Indices (y * width + x) of cells holding a solid tile in any layer; tile 0 is never solid. */
export function solidCells(
  map: { width: number; height: number; layers: ReadonlyArray<{ tiles: ArrayLike<number> }> },
  solidTiles: readonly number[],
): number[] {
  const solid = new Set(solidTiles);
  solid.delete(0);
  const out: number[] = [];
  if (solid.size === 0) return out;
  const n = map.width * map.height;
  for (let i = 0; i < n; i++) {
    for (const layer of map.layers) {
      if (solid.has(layer.tiles[i] ?? 0)) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}
