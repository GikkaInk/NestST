import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Application } from "pixi.js";

export interface TileMapData {
  width: number;
  height: number;
  tileSize: number;
  layers: { name: string; tiles: number[] }[];
}

export class MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapError";
  }
}

export function validateTileMap(data: unknown): TileMapData {
  const d = data as Partial<TileMapData> | null;
  if (!d || typeof d !== "object") throw new MapError("Некорректные данные карты.");
  const { width, height, tileSize, layers } = d;
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) {
    throw new MapError("Ширина и высота карты должны быть больше нуля.");
  }
  if (typeof tileSize !== "number" || !(tileSize > 0)) {
    throw new MapError("Размер тайла должен быть больше нуля.");
  }
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new MapError("В карте нет ни одного слоя.");
  }
  for (const layer of layers) {
    if (!layer || !Array.isArray(layer.tiles) || layer.tiles.length !== width * height) {
      throw new MapError(
        `Неверный размер слоя «${layer?.name ?? "?"}»: ожидалось ${width * height} тайлов.`,
      );
    }
  }
  return d as TileMapData;
}

/** Tile ids: 0 = empty, 1..TILE_KINDS = tileset cells (left to right). */
export const TILE_KINDS = 6;

export function generateTestMap(width: number, height: number): TileMapData {
  const n = width * height;
  const ground = new Array<number>(n);
  const decor = new Array<number>(n);
  const top = new Array<number>(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      ground[i] = ((x * 7 + y * 13) % 4) + 1;
      decor[i] = (x * 31 + y * 17) % 11 === 0 ? 5 : 0;
      top[i] = (x * 13 + y * 7) % 29 === 0 ? 6 : 0;
    }
  }
  return {
    width,
    height,
    tileSize: 16,
    layers: [
      { name: "ground", tiles: ground },
      { name: "decor", tiles: decor },
      { name: "top", tiles: top },
    ],
  };
}

const CHUNK = 16;
/** Chunks farther than this many chunks outside the viewport are destroyed. */
const KEEP_MARGIN = 2;

/**
 * Draws only the chunks (16x16 tiles) that intersect the screen. The tileset is a
 * horizontal strip of tileSize x tileSize cells. Pan/zoom by moving/scaling `container`.
 */
export function createTileMapView(
  app: Application,
  data: TileMapData,
  tileset: Texture,
): { container: Container; destroy(): void } {
  const { width, height, tileSize, layers } = data;
  const container = new Container();
  const cells: Texture[] = [];
  for (let i = 0; i < TILE_KINDS; i++) {
    cells.push(
      new Texture({
        source: tileset.source,
        frame: new Rectangle(i * tileSize, 0, tileSize, tileSize),
      }),
    );
  }
  const chunksX = Math.ceil(width / CHUNK);
  const chunksY = Math.ceil(height / CHUNK);
  const cache = new Map<number, Container>();

  const buildChunk = (cx: number, cy: number): Container => {
    const chunk = new Container();
    chunk.position.set(cx * CHUNK * tileSize, cy * CHUNK * tileSize);
    const x1 = Math.min(width, (cx + 1) * CHUNK);
    const y1 = Math.min(height, (cy + 1) * CHUNK);
    for (const layer of layers) {
      for (let y = cy * CHUNK; y < y1; y++) {
        for (let x = cx * CHUNK; x < x1; x++) {
          const id = layer.tiles[y * width + x];
          if (!id) continue;
          const sprite = new Sprite(cells[id - 1]);
          sprite.position.set((x - cx * CHUNK) * tileSize, (y - cy * CHUNK) * tileSize);
          chunk.addChild(sprite);
        }
      }
    }
    return chunk;
  };

  const update = (): void => {
    const s = container.scale.x;
    const span = CHUNK * tileSize;
    const minCx = Math.max(0, Math.floor(-container.x / s / span));
    const minCy = Math.max(0, Math.floor(-container.y / s / span));
    const maxCx = Math.min(chunksX - 1, Math.floor((app.screen.width - container.x) / s / span));
    const maxCy = Math.min(chunksY - 1, Math.floor((app.screen.height - container.y) / s / span));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = cy * chunksX + cx;
        if (!cache.has(key)) {
          const chunk = buildChunk(cx, cy);
          cache.set(key, chunk);
          container.addChild(chunk);
        }
      }
    }
    for (const [key, chunk] of cache) {
      const cx = key % chunksX;
      const cy = Math.floor(key / chunksX);
      if (
        cx < minCx - KEEP_MARGIN ||
        cx > maxCx + KEEP_MARGIN ||
        cy < minCy - KEEP_MARGIN ||
        cy > maxCy + KEEP_MARGIN
      ) {
        chunk.destroy({ children: true });
        cache.delete(key);
      }
    }
  };

  app.ticker.add(update);
  update();

  return {
    container,
    destroy() {
      app.ticker.remove(update);
      container.destroy({ children: true });
      cache.clear();
      for (const t of cells) t.destroy(false);
    },
  };
}
