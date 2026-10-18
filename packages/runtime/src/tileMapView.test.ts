import { describe, expect, it } from "vitest";
import { paintTiles } from "@nestst/core";
import type { GameMap } from "@nestst/core";
import type { Application, Container, Renderer, Sprite } from "pixi.js";
import { createBuiltinTileset, tileTexture } from "./tileset.js";
import { MAX_SCALE, MIN_SCALE, createTileMapView } from "./tileMapView.js";
import { CHUNK_SIZE } from "./chunks.js";

/**
 * A stand-in for `Application`: the view only reads `screen` and uses `ticker`.
 * Pixi's scene graph (Container, Sprite, Texture) works in Node without WebGL,
 * so the culling and incremental update logic is tested on the real objects.
 */
function fakeApp(width = 1280, height = 720) {
  const callbacks = new Set<() => void>();
  const app = {
    screen: { width, height },
    ticker: {
      add(fn: () => void) {
        callbacks.add(fn);
        return this;
      },
      remove(fn: () => void) {
        callbacks.delete(fn);
        return this;
      },
    },
  };
  return {
    app: app as unknown as Application,
    screen: app.screen,
    callbacks,
    tick() {
      for (const fn of callbacks) fn();
    },
  };
}

function makeMap(width: number, height: number, layers = 2): GameMap {
  const n = width * height;
  return {
    schemaVersion: 1,
    id: "m",
    name: "M",
    viewMode: "topdown",
    width,
    height,
    tileSize: 16,
    layers: Array.from({ length: layers }, (_, i) => ({
      id: `l${i}`,
      name: `Layer ${i}`,
      visible: true,
      tiles: Array.from({ length: n }, (_, c) => (i === 0 ? (c % 255) + 1 : c % 7 === 0 ? 3 : 0)),
    })),
  };
}

const tileset = createBuiltinTileset({} as Renderer, 16);

function layerContainer(view: { container: Container }, i: number): Container {
  return view.container.children[i] as Container;
}

function chunks(view: { container: Container }, layer: number): Map<string, Container> {
  const out = new Map<string, Container>();
  for (const c of layerContainer(view, layer).children) out.set(c.label, c as Container);
  return out;
}

function visibleLabels(view: { container: Container }, layer: number): string[] {
  return [...chunks(view, layer).values()]
    .filter((c) => c.visible)
    .map((c) => c.label)
    .sort();
}

describe("createTileMapView", () => {
  it("creates one container per layer, in order", () => {
    const { app } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64, 3), tileset);
    expect(view.container.children.map((c) => c.label)).toEqual(["l0", "l1", "l2"]);
    view.destroy();
  });

  it("shows only chunks on screen; the margin ring is built but hidden", () => {
    const { app } = fakeApp(512, 256); // exactly 2×1 chunks of 256 px
    const view = createTileMapView(app, makeMap(200, 200), tileset);
    view.setCamera(256 * 3, 256 * 3, 1);
    expect(visibleLabels(view, 0)).toEqual(["3,3", "4,3"]);
    const all = [...chunks(view, 0).keys()];
    // The build ring (margin 1 around 3..4 × 3..3 → 2..5 × 2..4) is all present.
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 5; x++) expect(all).toContain(`${x},${y}`);
    // Everything cached lies inside the keep ring (margin 2 → 1..6 × 1..5);
    // chunks left over from the first camera at 0,0 may stay there, hidden.
    for (const label of all) {
      const [x, y] = label.split(",").map(Number) as [number, number];
      expect(x >= 1 && x <= 6 && y >= 1 && y <= 5).toBe(true);
    }
    view.destroy();
  });

  it("draws sprites only for non-empty tiles, sized to the map tile size", () => {
    const { app } = fakeApp(256, 256);
    const map = makeMap(16, 16, 2);
    const view = createTileMapView(app, map, tileset);
    const ground = chunks(view, 0).get("0,0")!;
    expect(ground.children).toHaveLength(256);
    const top = chunks(view, 1).get("0,0")!;
    const expected = map.layers[1]!.tiles.filter((t) => t !== 0).length;
    expect(top.children).toHaveLength(expected);
    const s = ground.children[0] as Sprite;
    expect(s.width).toBe(16);
    expect(s.height).toBe(16);
    view.destroy();
  });

  it("positions the world from the camera", () => {
    const { app } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64), tileset);
    view.setCamera(100, 50, 2);
    expect(view.container.x).toBe(-200);
    expect(view.container.y).toBe(-100);
    expect(view.container.scale.x).toBe(2);
    view.destroy();
  });

  it("clamps the zoom to MIN_SCALE..MAX_SCALE and ignores invalid values", () => {
    const { app } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64), tileset);
    const scale = () => view.container.scale.x;
    expect(MIN_SCALE).toBe(0.5);
    expect(MAX_SCALE).toBe(8);
    view.setCamera(0, 0, 0.1);
    expect(scale()).toBe(MIN_SCALE);
    view.setCamera(0, 0, 0.5);
    expect(scale()).toBe(0.5);
    view.setCamera(0, 0, 8);
    expect(scale()).toBe(8);
    view.setCamera(0, 0, 100);
    expect(scale()).toBe(MAX_SCALE);
    view.setCamera(0, 0, 2);
    // Invalid zoom keeps the previous valid one instead of failing.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      view.setCamera(10, 20, bad);
      expect(scale()).toBe(2);
      expect(view.container.x).toBe(-20);
      expect(view.container.y).toBe(-40);
    }
    // Invalid position keeps the previous position.
    view.setCamera(Number.NaN, Number.POSITIVE_INFINITY, 1);
    expect(scale()).toBe(1);
    expect(view.container.x).toBe(-10);
    expect(view.container.y).toBe(-20);
    view.destroy();
  });

  it("an invalid first zoom falls back to a valid one", () => {
    const { app } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64), tileset);
    view.setCamera(0, 0, Number.NaN);
    expect(view.container.scale.x).toBeGreaterThanOrEqual(MIN_SCALE);
    expect(view.container.scale.x).toBeLessThanOrEqual(MAX_SCALE);
    view.destroy();
  });

  it("pins the cost of the widest zoom: built sprites stay bounded", () => {
    const W = 1280;
    const H = 720;
    const span = CHUNK_SIZE * 16 * MIN_SCALE; // screen pixels per chunk at minimum zoom
    // Worst case: screen not aligned to chunks (+1 per axis), plus the hidden build ring (+2).
    const maxChunks = (Math.ceil(W / span) + 3) * (Math.ceil(H / span) + 3);
    const bound = maxChunks * CHUNK_SIZE * CHUNK_SIZE;
    expect(bound).toBeLessThanOrEqual(30_000);
    const { app } = fakeApp(W, H);
    let max = 0;
    for (const [x, y] of [
      [0, 0],
      [5000, 5000],
      [5100, 4950],
      [9000, 2000],
    ] as const) {
      // Fresh view per position so leftovers from earlier cameras do not count.
      const v = createTileMapView(app, makeMap(1000, 1000, 1), tileset);
      v.setCamera(x, y, 0.01);
      expect(v.container.scale.x).toBe(MIN_SCALE);
      const n = (v.container.children[0] as Container).children.reduce(
        (s, c) => s + (c as Container).children.length,
        0,
      );
      max = Math.max(max, n);
      v.destroy();
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(bound);
  });

  it("setMap with an added layer rebuilds with one container per layer", () => {
    const { app } = fakeApp();
    const map = makeMap(64, 64, 2);
    const view = createTileMapView(app, map, tileset);
    const extra = makeMap(64, 64, 3).layers[2]!;
    view.setMap({ ...map, layers: [...map.layers, extra] });
    expect(view.container.children.map((c) => c.label)).toEqual(["l0", "l1", "l2"]);
    expect(layerContainer(view, 2).children.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("setMap with a renamed layer id rebuilds that layer under the new id", () => {
    const { app } = fakeApp();
    const map = makeMap(64, 64, 2);
    const view = createTileMapView(app, map, tileset);
    const old = layerContainer(view, 1);
    view.setMap({ ...map, layers: [map.layers[0]!, { ...map.layers[1]!, id: "renamed" }] });
    expect(old.destroyed).toBe(true);
    expect(view.container.children.map((c) => c.label)).toEqual(["l0", "renamed"]);
    view.destroy();
  });

  it("setMap with a new tile size redraws chunks at the new size", () => {
    const { app } = fakeApp(512, 512);
    const map = makeMap(64, 64, 1);
    const view = createTileMapView(app, map, tileset);
    view.setMap({ ...map, tileSize: 32 });
    const c = chunks(view, 0).get("1,0")!;
    expect(c.x).toBe(16 * 32);
    const s = c.children[0] as Sprite;
    expect(s.width).toBe(32);
    expect(s.height).toBe(32);
    // 512 px screen now shows exactly one 512 px chunk.
    expect(visibleLabels(view, 0)).toEqual(["0,0"]);
    view.destroy();
  });

  it("a cell painted outside the cached chunks shows up after panning to it", () => {
    const { app } = fakeApp(256, 256);
    const map = makeMap(200, 200, 1);
    const view = createTileMapView(app, map, tileset);
    expect(chunks(view, 0).has("10,10")).toBe(false);
    const x = 10 * 16 + 5;
    const y = 10 * 16 + 7;
    const next = paintTiles(map, [{ layerId: "l0", x, y, tile: 200 }]);
    view.setMap(next);
    view.setCamera(10 * 256, 10 * 256, 1);
    const chunk = chunks(view, 0).get("10,10")!;
    expect(chunk.visible).toBe(true);
    const sprite = chunk.children.find((s) => s.x === 5 * 16 && s.y === 7 * 16) as Sprite;
    expect(sprite.texture).toBe(tileTexture(tileset, 200));
    view.destroy();
  });

  it("bounds the cache: chunks far from the screen are destroyed", () => {
    const { app } = fakeApp(512, 512);
    const view = createTileMapView(app, makeMap(512, 512, 1), tileset);
    const first = chunks(view, 0).get("0,0")!;
    // Move one chunk: 0,0 is now in the margin ring and stays hidden in the cache.
    view.setCamera(256, 256, 1);
    expect(first.destroyed).toBe(false);
    expect(first.visible).toBe(false);
    // Move far away: 0,0 is more than 2 chunks out and is destroyed.
    view.setCamera(256 * 10, 256 * 10, 1);
    expect(first.destroyed).toBe(true);
    expect(chunks(view, 0).has("0,0")).toBe(false);
    // Pan across the whole map: the cache never grows beyond the keep ring.
    let max = 0;
    for (let x = 0; x < 512 * 16; x += 300) {
      view.setCamera(x, x, 1);
      max = Math.max(max, layerContainer(view, 0).children.length);
    }
    // screen 2×2 (+1 on partial) chunks, keep ring 2 → at most 7×7.
    expect(max).toBeLessThanOrEqual(49);
    view.destroy();
  });

  it("zoomed out to the minimum still draws only what is needed", () => {
    const { app } = fakeApp(1280, 720);
    const view = createTileMapView(app, makeMap(1000, 1000, 1), tileset);
    view.setCamera(0, 0, 0.25); // clamped to MIN_SCALE = 0.5
    // 2560×1440 world px → visible 10×6 chunks, built with margin 1 at the corner → 11×7.
    expect(visibleLabels(view, 0)).toHaveLength(10 * 6);
    expect(layerContainer(view, 0).children).toHaveLength(11 * 7);
    view.destroy();
  });

  it("skips layers that are not visible", () => {
    const { app } = fakeApp();
    const map = makeMap(64, 64, 2);
    map.layers[1] = { ...map.layers[1]!, visible: false };
    const view = createTileMapView(app, map, tileset);
    expect(layerContainer(view, 1).visible).toBe(false);
    expect(layerContainer(view, 1).children).toHaveLength(0);
    // Turning it on builds its chunks; turning it off again frees them.
    const on = { ...map, layers: [map.layers[0]!, { ...map.layers[1]!, visible: true }] };
    view.setMap(on);
    expect(layerContainer(view, 1).visible).toBe(true);
    expect(layerContainer(view, 1).children.length).toBeGreaterThan(0);
    const before = chunks(view, 0);
    view.setMap({ ...on, layers: [on.layers[0]!, { ...on.layers[1]!, visible: false }] });
    expect(layerContainer(view, 1).children).toHaveLength(0);
    // The untouched layer kept its chunks.
    for (const [label, c] of chunks(view, 0)) expect(before.get(label)).toBe(c);
    view.destroy();
  });

  it("setMap after painting one cell rebuilds only that chunk of that layer", () => {
    const { app } = fakeApp(1280, 720);
    const map = makeMap(100, 100, 2);
    const view = createTileMapView(app, map, tileset);
    const before0 = chunks(view, 0);
    const before1 = chunks(view, 1);
    const next = paintTiles(map, [{ layerId: "l1", x: 20, y: 3, tile: 9 }]);
    expect(next.layers[0]!.tiles).toBe(map.layers[0]!.tiles);
    view.setMap(next);
    const after0 = chunks(view, 0);
    const after1 = chunks(view, 1);
    for (const [label, c] of after0) expect(before0.get(label)).toBe(c);
    const rebuilt = [...after1].filter(([label, c]) => before1.get(label) !== c).map(([l]) => l);
    expect(rebuilt).toEqual(["1,0"]);
    expect(before1.get("1,0")!.destroyed).toBe(true);
    // The new chunk shows the painted tile.
    const sprite = after1
      .get("1,0")!
      .children.find((s) => s.x === (20 - 16) * 16 && s.y === 3 * 16) as Sprite;
    expect(sprite.texture).toBe(tileTexture(tileset, 9));
    view.destroy();
  });

  it("setMap with a differently sized map rebuilds everything", () => {
    const { app } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64, 2), tileset);
    const old = layerContainer(view, 0);
    view.setMap(makeMap(32, 32, 3));
    expect(old.destroyed).toBe(true);
    expect(view.container.children).toHaveLength(3);
    view.destroy();
  });

  it("draws unknown tile ids with the placeholder instead of failing", () => {
    const { app } = fakeApp(256, 256);
    const map = makeMap(16, 16, 1);
    // Bypass core validation on purpose: the runtime must not crash on bad data.
    map.layers[0]!.tiles[0] = 999;
    const small = tileset.slice(0, 4);
    const view = createTileMapView(app, map, small);
    const sprites = chunks(view, 0).get("0,0")!.children as Sprite[];
    const first = sprites.find((s) => s.x === 0 && s.y === 0)!;
    expect(first.texture).toBeDefined();
    expect(first.texture).toBe(tileTexture(small, 999));
    expect(sprites.every((s) => s.texture !== undefined)).toBe(true);
    view.destroy();
  });

  it("reacts to a screen resize on the next tick", () => {
    const { app, screen, tick } = fakeApp(256, 256);
    const view = createTileMapView(app, makeMap(200, 200, 1), tileset);
    expect(visibleLabels(view, 0)).toEqual(["0,0"]);
    screen.width = 512;
    tick();
    expect(visibleLabels(view, 0)).toEqual(["0,0", "1,0"]);
    view.destroy();
  });

  it("destroy releases the scene and its ticker callback, and is safe to repeat", () => {
    const { app, callbacks } = fakeApp();
    const view = createTileMapView(app, makeMap(64, 64), tileset);
    expect(callbacks.size).toBe(1);
    const layer = layerContainer(view, 0);
    view.destroy();
    expect(callbacks.size).toBe(0);
    expect(view.container.destroyed).toBe(true);
    expect(layer.destroyed).toBe(true);
    // The tileset belongs to the caller and stays usable.
    expect(tileset[0]!.destroyed).toBe(false);
    view.destroy();
    view.setCamera(10, 10, 1);
    view.setMap(makeMap(8, 8));
  });
});

it("pixi.js loads in the Node test environment", async () => {
  const pixi = await import("pixi.js");
  expect(typeof pixi.Container).toBe("function");
});
