import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE } from "@nestst/runtime";
import {
  centeredCamera,
  clampScale,
  createStroke,
  isStrokePointer,
  lineCells,
  panBy,
  screenToCell,
  screenToWorld,
  wheelZoomFactor,
  zoomAt,
} from "./mapInput.js";

describe("screenToCell", () => {
  it("maps screen pixels to cells at scale 1 and no offset", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    expect(screenToCell(cam, 0, 0, 32)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(cam, 31.9, 31.9, 32)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(cam, 32, 64, 32)).toEqual({ x: 1, y: 2 });
  });

  it("accounts for camera position and zoom", () => {
    const cam = { x: 100, y: 50, scale: 2 };
    // screen (60, 30) -> world (130, 65) -> cell (4, 2)
    expect(screenToWorld(cam, 60, 30)).toEqual({ x: 130, y: 65 });
    expect(screenToCell(cam, 60, 30, 32)).toEqual({ x: 4, y: 2 });
    const zoomedOut = { x: 0, y: 0, scale: 0.5 };
    expect(screenToCell(zoomedOut, 40, 40, 32)).toEqual({ x: 2, y: 2 });
  });

  it("rounds negatives down, so the area left of the map is cell -1, not 0", () => {
    const cam = { x: -64, y: -10, scale: 1 };
    expect(screenToCell(cam, 0, 0, 32)).toEqual({ x: -2, y: -1 });
    expect(screenToCell(cam, 63, 9, 32)).toEqual({ x: -1, y: -1 });
    expect(screenToCell(cam, 64, 10, 32)).toEqual({ x: 0, y: 0 });
  });
});

describe("lineCells (Bresenham)", () => {
  it("returns one cell for a zero-length line", () => {
    expect(lineCells({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  it("draws horizontal and vertical lines in both directions", () => {
    expect(lineCells({ x: 0, y: 1 }, { x: 3, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(lineCells({ x: 2, y: 2 }, { x: 2, y: -1 })).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: -1 },
    ]);
  });

  it("draws a 45° diagonal", () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 3, y: -3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      { x: 2, y: -2 },
      { x: 3, y: -3 },
    ]);
  });

  it("draws a steep line with one cell per row and no gaps", () => {
    const cells = lineCells({ x: 0, y: 0 }, { x: 2, y: 7 });
    expect(cells).toHaveLength(8);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 2, y: 7 });
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.y - cells[i - 1]!.y).toBe(1);
      expect(Math.abs(cells[i]!.x - cells[i - 1]!.x)).toBeLessThanOrEqual(1);
    }
  });

  it("draws a shallow line with one cell per column", () => {
    const cells = lineCells({ x: 5, y: 0 }, { x: -5, y: 3 });
    expect(cells).toHaveLength(11);
    for (let i = 1; i < cells.length; i++) expect(cells[i]!.x - cells[i - 1]!.x).toBe(-1);
  });
});

describe("zoom", () => {
  it("clamps the scale to the runtime limits", () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("keeps the world point under the cursor fixed", () => {
    const cam = { x: 37, y: -12, scale: 1.3 };
    const before = screenToWorld(cam, 250, 140);
    const next = zoomAt(cam, 250, 140, 1.7);
    expect(next.scale).toBeCloseTo(1.3 * 1.7);
    const after = screenToWorld(next, 250, 140);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("keeps the point fixed even when the zoom is clamped", () => {
    const cam = { x: 10, y: 10, scale: 7 };
    const before = screenToWorld(cam, 100, 80);
    const next = zoomAt(cam, 100, 80, 10);
    expect(next.scale).toBe(MAX_SCALE);
    const after = screenToWorld(next, 100, 80);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt({ x: 0, y: 0, scale: MIN_SCALE }, 5, 5, 0.1)).toEqual({ x: 0, y: 0, scale: MIN_SCALE });
  });

  it("wheel up zooms in, wheel down zooms out, both bounded per event", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100000)).toBeLessThanOrEqual(2);
    expect(wheelZoomFactor(100000)).toBeGreaterThanOrEqual(0.5);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });
});

describe("pan and centring", () => {
  it("moves the camera opposite to the drag, in world units", () => {
    expect(panBy({ x: 10, y: 20, scale: 2 }, 40, -10)).toEqual({ x: -10, y: 25, scale: 2 });
  });

  it("centres the map on the screen", () => {
    // map 640x480 px on a 1000x800 screen at scale 1 -> map offset (180, 160)
    expect(centeredCamera(640, 480, 1000, 800, 1)).toEqual({ x: -180, y: -160, scale: 1 });
    expect(centeredCamera(640, 480, 1000, 800, 2)).toEqual({ x: 70, y: 40, scale: 2 });
  });
});

describe("createStroke", () => {
  const map = { width: 10, height: 5 };

  it("collects edits for the first cell and each new cell along the drag", () => {
    const stroke = createStroke(map, "ground", 4);
    expect(stroke.add({ x: 1, y: 1 })).toEqual([{ layerId: "ground", x: 1, y: 1, tile: 4 }]);
    // A fast jump fills the cells in between.
    expect(stroke.add({ x: 4, y: 1 }).map((e) => e.x)).toEqual([2, 3, 4]);
    expect(stroke.edits).toHaveLength(4);
  });

  it("does not repeat cells already painted in this stroke", () => {
    const stroke = createStroke(map, "ground", 1);
    stroke.add({ x: 0, y: 0 });
    expect(stroke.add({ x: 0, y: 0 })).toEqual([]);
    stroke.add({ x: 2, y: 0 });
    expect(stroke.add({ x: 0, y: 0 })).toEqual([]);
    expect(stroke.edits.map((e) => e.x)).toEqual([0, 1, 2]);
  });

  it("skips cells outside the map but keeps interpolating across the edge", () => {
    const stroke = createStroke(map, "ground", 2);
    expect(stroke.add({ x: -2, y: 0 })).toEqual([]);
    expect(stroke.add({ x: 1, y: 0 }).map((e) => e.x)).toEqual([0, 1]);
    expect(stroke.add({ x: 1, y: 7 }).map((e) => e.y)).toEqual([1, 2, 3, 4]);
  });
});

describe("isStrokePointer", () => {
  it("accepts only the pointer that started the stroke", () => {
    expect(isStrokePointer(3, 3)).toBe(true);
    expect(isStrokePointer(3, 4)).toBe(false);
    expect(isStrokePointer(null, 3)).toBe(false);
  });
});

