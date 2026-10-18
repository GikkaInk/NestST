import { describe, expect, it } from "vitest";
import type { GameMap } from "@nestst/core";
import {
  CHUNK_SIZE,
  chunkCoords,
  chunkKey,
  chunksToEvict,
  diffTiles,
  dirtyChunks,
  planMapUpdate,
  visibleChunkRange,
} from "./chunks.js";
import type { ChunkRange } from "./chunks.js";

const BIG = { width: 1000, height: 1000, tileSize: 16 };
// 1000 / 16 = 62.5 → 63 chunks per side, last index 62.
const LAST = 62;
const SCREEN = { width: 1280, height: 720 };

/** Small seeded PRNG (mulberry32) so property tests are repeatable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("visibleChunkRange", () => {
  it("covers exactly the chunks on screen at scale 1 with no margin", () => {
    const r = visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale: 1 }, BIG, 16, 0);
    // 1280 px / 256 px per chunk = 5 chunks (0..4); 720 / 256 = 2.8 → 0..2.
    expect(r).toEqual({ x0: 0, y0: 0, x1: 4, y1: 2 });
  });

  it("handles a camera in the middle of the map", () => {
    const r = visibleChunkRange({ x: 1000, y: 2000, ...SCREEN, scale: 1 }, BIG, 16, 0);
    // x: 1000..2280 → chunks 3..8; y: 2000..2720 → chunks 7..10.
    expect(r).toEqual({ x0: 3, y0: 7, x1: 8, y1: 10 });
  });

  it("grows when zoomed out to 0.25 but stays inside the map", () => {
    const one = visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale: 1 }, BIG, 16, 0);
    const quarter = visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale: 0.25 }, BIG, 16, 0);
    // 1280 / 0.25 = 5120 px → 20 chunks; 720 / 0.25 = 2880 px → 11.25 → 0..11.
    expect(quarter).toEqual({ x0: 0, y0: 0, x1: 19, y1: 11 });
    expect(quarter.x1 - quarter.x0).toBeGreaterThan(one.x1 - one.x0);
    const far = visibleChunkRange({ x: 14000, y: 14000, ...SCREEN, scale: 0.25 }, BIG, 16, 0);
    expect(far.x1).toBe(LAST);
    expect(far.y1).toBe(LAST);
  });

  it("adds the margin on each side and clamps it at the map edge", () => {
    const view = { x: 1000, y: 2000, ...SCREEN, scale: 1 };
    expect(visibleChunkRange(view, BIG, 16, 2)).toEqual({ x0: 1, y0: 5, x1: 10, y1: 12 });
    expect(visibleChunkRange({ ...view, x: 0, y: 0 }, BIG, 16, 2)).toEqual({
      x0: 0,
      y0: 0,
      x1: 6,
      y1: 4,
    });
  });

  it("returns the whole map when the map is smaller than the screen", () => {
    const tiny = { width: 20, height: 5, tileSize: 16 };
    expect(visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale: 1 }, tiny, 16, 0)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
    });
    expect(visibleChunkRange({ x: -50, y: -50, ...SCREEN, scale: 0.25 }, tiny, 16, 2)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
    });
    const single = { width: 1, height: 1, tileSize: 16 };
    expect(visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale: 4 }, single, 16, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
    });
  });

  it("clamps a negative camera to 0", () => {
    const r = visibleChunkRange({ x: -300, y: -5000, ...SCREEN, scale: 1 }, BIG, 16, 0);
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    // x: -300..980 → chunks up to 3; y: -5000..-4280 is above the map → clamped to row 0.
    expect(r.x1).toBe(3);
    expect(r.y1).toBe(0);
  });

  it("does not include the next chunk when the screen edge falls exactly on a chunk border", () => {
    const r = visibleChunkRange({ x: 0, y: 0, width: 512, height: 256, scale: 1 }, BIG, 16, 0);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
  });

  it("rejects a zoom that is not a positive number", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => visibleChunkRange({ x: 0, y: 0, ...SCREEN, scale }, BIG, 16, 0)).toThrow(
        RangeError,
      );
    }
  });

  it("property: the range is inside the map and covers every chunk that touches the screen", () => {
    const rand = rng(20261018);
    for (let i = 0; i < 2000; i++) {
      const map = {
        width: 1 + Math.floor(rand() * 2048),
        height: 1 + Math.floor(rand() * 2048),
        tileSize: [8, 16, 32, 48][Math.floor(rand() * 4)]!,
      };
      const chunkSize = [8, 16, 32][Math.floor(rand() * 3)]!;
      const margin = Math.floor(rand() * 3);
      const scale = 0.1 + rand() * 4;
      const span = chunkSize * map.tileSize;
      const worldW = map.width * map.tileSize;
      const worldH = map.height * map.tileSize;
      const view = {
        x: (rand() * 1.4 - 0.2) * worldW,
        y: (rand() * 1.4 - 0.2) * worldH,
        width: 1 + Math.floor(rand() * 3000),
        height: 1 + Math.floor(rand() * 2000),
        scale,
      };
      const r = visibleChunkRange(view, map, chunkSize, margin);
      const chunksX = Math.ceil(map.width / chunkSize);
      const chunksY = Math.ceil(map.height / chunkSize);
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.y0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(chunksX - 1);
      expect(r.y1).toBeLessThanOrEqual(chunksY - 1);
      expect(r.x0).toBeLessThanOrEqual(r.x1);
      expect(r.y0).toBeLessThanOrEqual(r.y1);
      for (const v of [r.x0, r.y0, r.x1, r.y1]) expect(Number.isInteger(v)).toBe(true);
      // Every chunk whose area overlaps the viewport must be inside the range.
      const vx1 = view.x + view.width / scale;
      const vy1 = view.y + view.height / scale;
      for (let cx = 0; cx < chunksX; cx++) {
        const hitX = cx * span < vx1 && (cx + 1) * span > view.x;
        if (!hitX) continue;
        for (let cy = 0; cy < chunksY; cy++) {
          const hitY = cy * span < vy1 && (cy + 1) * span > view.y;
          if (!hitY) continue;
          expect(cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1).toBe(true);
        }
      }
      // With no margin the range holds no chunk far from the viewport.
      if (margin === 0 && view.x >= 0 && view.y >= 0 && vx1 <= worldW && vy1 <= worldH) {
        expect(r.x0 * span).toBeLessThanOrEqual(view.x);
        expect((r.x1 + 1) * span).toBeGreaterThanOrEqual(vx1);
        expect(r.x0 * span).toBeGreaterThan(view.x - span);
        expect(r.x1 * span).toBeLessThan(vx1);
      }
    }
  });
});

describe("chunkKey / chunkCoords", () => {
  it("round-trips and is unique per chunk", () => {
    const chunksX = 7;
    const seen = new Set<number>();
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const k = chunkKey(cx, cy, chunksX);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(chunkCoords(k, chunksX)).toEqual({ cx, cy });
      }
    }
  });
});

describe("diffTiles", () => {
  it("returns nothing for the same array (fast path)", () => {
    const a = [1, 2, 3];
    expect(diffTiles(a, a)).toEqual([]);
  });

  it("returns the indexes of changed cells", () => {
    expect(diffTiles([0, 1, 2, 3, 4], [0, 9, 2, 3, 0])).toEqual([1, 4]);
    expect(diffTiles([5, 5], [5, 5])).toEqual([]);
  });

  it("refuses layers of different sizes", () => {
    expect(() => diffTiles([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
});

describe("dirtyChunks", () => {
  it("maps changed cells to the keys of their chunks", () => {
    const width = 40; // 3 chunks per row with chunk size 16
    const cell = (x: number, y: number) => y * width + x;
    const keys = dirtyChunks([cell(0, 0), cell(15, 15), cell(16, 0), cell(39, 20)], width, 16);
    expect([...keys].sort((a, b) => a - b)).toEqual([0, 1, chunkKey(2, 1, 3)]);
  });
});

describe("chunksToEvict", () => {
  it("evicts only chunks outside the kept range", () => {
    const chunksX = 10;
    const keep: ChunkRange = { x0: 2, y0: 2, x1: 5, y1: 5 };
    const cached = [chunkKey(2, 2, chunksX), chunkKey(5, 5, chunksX), chunkKey(1, 3, chunksX), chunkKey(6, 3, chunksX), chunkKey(3, 9, chunksX)];
    expect(chunksToEvict(cached, keep, chunksX).sort((a, b) => a - b)).toEqual(
      [chunkKey(1, 3, chunksX), chunkKey(6, 3, chunksX), chunkKey(3, 9, chunksX)].sort((a, b) => a - b),
    );
  });
});

function makeMap(over: Partial<GameMap> = {}): GameMap {
  const n = 4 * 3;
  return {
    schemaVersion: 2,
    objects: [],
    id: "m",
    name: "M",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    layers: [
      { id: "ground", name: "Ground", visible: true, tiles: new Array<number>(n).fill(1) },
      { id: "top", name: "Top", visible: true, tiles: new Array<number>(n).fill(0) },
    ],
    ...over,
  };
}

describe("planMapUpdate", () => {
  it("asks for a full rebuild when there is no previous map", () => {
    expect(planMapUpdate(undefined, makeMap())).toEqual({ full: true });
  });

  it("asks for a full rebuild when size, tile size or layer list differ", () => {
    const a = makeMap();
    expect(planMapUpdate(a, { ...a, width: 5 })).toEqual({ full: true });
    expect(planMapUpdate(a, { ...a, tileSize: 32 })).toEqual({ full: true });
    expect(planMapUpdate(a, { ...a, layers: [a.layers[0]!] })).toEqual({ full: true });
    expect(planMapUpdate(a, { ...a, layers: [a.layers[1]!, a.layers[0]!] })).toEqual({ full: true });
  });

  it("reports nothing to do for an identical map", () => {
    const a = makeMap();
    expect(planMapUpdate(a, a)).toEqual({ full: false, layers: [] });
    expect(planMapUpdate(a, { ...a, name: "renamed" })).toEqual({ full: false, layers: [] });
  });

  it("reports only layers whose tiles array or visibility changed", () => {
    const a = makeMap();
    const tiles = [...a.layers[1]!.tiles];
    tiles[3] = 7;
    const b = { ...a, layers: [a.layers[0]!, { ...a.layers[1]!, tiles }] };
    expect(planMapUpdate(a, b)).toEqual({
      full: false,
      layers: [{ index: 1, tilesChanged: true, visibilityChanged: false }],
    });
    const c = { ...a, layers: [{ ...a.layers[0]!, visible: false }, a.layers[1]!] };
    expect(planMapUpdate(a, c)).toEqual({
      full: false,
      layers: [{ index: 0, tilesChanged: false, visibilityChanged: true }],
    });
  });
});

it("uses 16×16 chunks", () => {
  expect(CHUNK_SIZE).toBe(16);
});
