import type { GameMap, TileLayer } from "@nestst/core";
import { Container, Sprite } from "pixi.js";
import type { Application } from "pixi.js";
import {
  CHUNK_SIZE,
  chunkCoords,
  chunkKey,
  chunksToEvict,
  diffTiles,
  dirtyChunks,
  inRange,
  planMapUpdate,
  visibleChunkRange,
} from "./chunks.js";
import type { ChunkRange } from "./chunks.js";
import { tileTexture } from "./tileset.js";
import type { Tileset } from "./tileset.js";

/** Chunks this far outside the screen are built in advance but hidden. */
const BUILD_MARGIN = 1;
/** Chunks farther than this outside the screen are destroyed. */
const KEEP_MARGIN = 2;

export interface TileMapView {
  /** Holds one child container per map layer, in layer order. */
  container: Container;
  setMap(map: GameMap): void;
  /** `x`, `y`: world pixel at the top-left of the screen; `scale`: zoom. */
  setCamera(x: number, y: number, scale: number): void;
  /** Frees the scene and the ticker callback. The tileset stays with the caller. */
  destroy(): void;
}

interface LayerView {
  container: Container;
  chunks: Map<number, Container>;
}

/**
 * Draws a map in 16×16 chunks: only chunks on screen are visible, a one-chunk
 * ring around them is built but hidden, and anything farther than two chunks
 * out is destroyed. `setMap` redraws only the chunks whose cells changed.
 */
export function createTileMapView(app: Application, map: GameMap, tileset: Tileset): TileMapView {
  const container = new Container({ label: "tilemap" });
  let current = map;
  let layers: LayerView[] = [];
  let camera = { x: 0, y: 0, scale: 1 };
  let screenW = -1;
  let screenH = -1;
  let destroyed = false;

  const chunksX = () => Math.ceil(current.width / CHUNK_SIZE);

  const buildChunk = (layer: TileLayer, cx: number, cy: number): Container => {
    const { width, height, tileSize } = current;
    const chunk = new Container({ label: `${cx},${cy}` });
    chunk.position.set(cx * CHUNK_SIZE * tileSize, cy * CHUNK_SIZE * tileSize);
    const xEnd = Math.min(width, (cx + 1) * CHUNK_SIZE);
    const yEnd = Math.min(height, (cy + 1) * CHUNK_SIZE);
    for (let y = cy * CHUNK_SIZE; y < yEnd; y++) {
      for (let x = cx * CHUNK_SIZE; x < xEnd; x++) {
        const id = layer.tiles[y * width + x];
        if (!id) continue;
        const sprite = new Sprite(tileTexture(tileset, id));
        sprite.position.set((x - cx * CHUNK_SIZE) * tileSize, (y - cy * CHUNK_SIZE) * tileSize);
        sprite.setSize(tileSize, tileSize);
        chunk.addChild(sprite);
      }
    }
    return chunk;
  };

  const dropChunk = (lv: LayerView, key: number): void => {
    lv.chunks.get(key)?.destroy({ children: true });
    lv.chunks.delete(key);
  };

  const dropAllChunks = (lv: LayerView): void => {
    for (const key of [...lv.chunks.keys()]) dropChunk(lv, key);
  };

  const buildLayers = (): void => {
    for (const lv of layers) lv.container.destroy({ children: true });
    layers = current.layers.map((l) => {
      const lc = new Container({ label: l.id });
      container.addChild(lc);
      return { container: lc, chunks: new Map() };
    });
  };

  const update = (): void => {
    screenW = app.screen.width;
    screenH = app.screen.height;
    container.position.set(-camera.x * camera.scale, -camera.y * camera.scale);
    container.scale.set(camera.scale);
    const view = { x: camera.x, y: camera.y, width: screenW, height: screenH, scale: camera.scale };
    const shown = visibleChunkRange(view, current, CHUNK_SIZE, 0);
    const built = visibleChunkRange(view, current, CHUNK_SIZE, BUILD_MARGIN);
    const kept: ChunkRange = visibleChunkRange(view, current, CHUNK_SIZE, KEEP_MARGIN);
    const cx = chunksX();
    current.layers.forEach((layer, i) => {
      const lv = layers[i]!;
      lv.container.visible = layer.visible;
      if (!layer.visible) {
        dropAllChunks(lv);
        return;
      }
      for (const key of chunksToEvict(lv.chunks.keys(), kept, cx)) dropChunk(lv, key);
      for (let y = built.y0; y <= built.y1; y++) {
        for (let x = built.x0; x <= built.x1; x++) {
          const key = chunkKey(x, y, cx);
          let chunk = lv.chunks.get(key);
          if (chunk === undefined) {
            chunk = buildChunk(layer, x, y);
            lv.chunks.set(key, chunk);
            lv.container.addChild(chunk);
          }
          chunk.visible = inRange(shown, x, y);
        }
      }
      // Kept chunks outside the build ring stay cached but must not be drawn.
      for (const [key, chunk] of lv.chunks) {
        const c = chunkCoords(key, cx);
        if (!inRange(built, c.cx, c.cy)) chunk.visible = false;
      }
    });
  };

  const onTick = (): void => {
    if (app.screen.width !== screenW || app.screen.height !== screenH) update();
  };

  buildLayers();
  update();
  app.ticker.add(onTick);

  return {
    container,
    setMap(next) {
      if (destroyed) return;
      const plan = planMapUpdate(current, next);
      if (plan.full) {
        current = next;
        buildLayers();
        update();
        return;
      }
      for (const change of plan.layers) {
        const lv = layers[change.index]!;
        // Visibility is applied by update(); only changed cells need work here.
        if (!change.tilesChanged || lv.chunks.size === 0) continue;
        const cells = diffTiles(current.layers[change.index]!.tiles, next.layers[change.index]!.tiles);
        for (const key of dirtyChunks(cells, current.width, CHUNK_SIZE)) {
          if (lv.chunks.has(key)) dropChunk(lv, key);
        }
      }
      current = next;
      update();
    },
    setCamera(x, y, scale) {
      if (destroyed) return;
      if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RangeError(`camera must use finite numbers and a positive zoom, got ${x}, ${y}, ${scale}`);
      }
      camera = { x, y, scale };
      update();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      app.ticker.remove(onTick);
      for (const lv of layers) lv.chunks.clear();
      layers = [];
      container.destroy({ children: true });
    },
  };
}
