import { BUILTIN_TILE_COUNT } from "@nestst/core";
import { BufferImageSource, Rectangle, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";

/** Textures for tile ids 1..n; index = id − 1. May carry its own placeholder. */
export type Tileset = readonly Texture[] & { readonly placeholder?: Texture };

/** The atlas is a 16×16 grid: cells 0..254 hold ids 1..255, cell 255 is the placeholder. */
const GRID = 16;
const PLACEHOLDER_CELL = GRID * GRID - 1;
/** Atlas cells are at most this big; sprites are stretched to the map tile size. */
const MAX_CELL = 32;

const MAGENTA: readonly [number, number, number] = [255, 0, 255];
const DARK: readonly [number, number, number] = [40, 0, 40];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Deterministic colour of a built-in tile: hues spread by the golden angle so
 * neighbouring ids look different, with lightness and saturation varied in bands.
 */
export function builtinTileColor(id: number): [number, number, number] {
  const hue = ((id - 1) * 137.508) % 360;
  const lightness = [0.42, 0.62, 0.32, 0.52][id % 4]!;
  const saturation = [0.85, 0.6, 0.75][Math.floor(id / 4) % 3]!;
  return hslToRgb(hue, saturation, lightness);
}

function fillCell(
  data: Uint8Array,
  stride: number,
  cell: number,
  size: number,
  colorAt: (x: number, y: number) => readonly [number, number, number],
): void {
  const ox = (cell % GRID) * size;
  const oy = Math.floor(cell / GRID) * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colorAt(x, y);
      const p = ((oy + y) * stride + ox + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
}

/** Magenta and dark checks, hard to mistake for a real tile. */
function placeholderColor(size: number) {
  const check = Math.max(1, Math.floor(size / 4));
  return (x: number, y: number) =>
    (Math.floor(x / check) + Math.floor(y / check)) % 2 === 0 ? MAGENTA : DARK;
}

let sharedPlaceholder: Texture | undefined;

/** Placeholder for tilesets that do not carry their own. */
function fallbackPlaceholder(): Texture {
  if (sharedPlaceholder === undefined) {
    const size = 4;
    const data = new Uint8Array(size * size * 4);
    fillCell(data, size, 0, size, placeholderColor(size));
    const source = new BufferImageSource({ resource: data, width: size, height: size, scaleMode: "nearest" });
    sharedPlaceholder = new Texture({ source, label: "nestst-tile-placeholder" });
  }
  return sharedPlaceholder;
}

/**
 * The built-in tileset: 255 coloured squares (ids 1..255, index = id − 1),
 * drawn once into a single small CPU atlas, so it needs no GPU work to create
 * and costs at most 512×512×4 bytes. `renderer` is accepted to keep the API
 * stable for image tilesets later; the built-in one does not use it.
 */
export function createBuiltinTileset(
  _renderer: Renderer,
  tileSize: number,
): Texture[] & { readonly placeholder: Texture } {
  if (!Number.isInteger(tileSize) || tileSize < 1) {
    throw new RangeError(`tile size must be a positive whole number, but it is ${tileSize}`);
  }
  const cell = Math.min(tileSize, MAX_CELL);
  const side = cell * GRID;
  const data = new Uint8Array(side * side * 4);
  const border = cell >= 8 ? 1 : 0;
  for (let id = 1; id <= BUILTIN_TILE_COUNT; id++) {
    const [r, g, b] = builtinTileColor(id);
    const edge: [number, number, number] = [r * 0.7, g * 0.7, b * 0.7].map(Math.round) as [
      number,
      number,
      number,
    ];
    const fill: [number, number, number] = [r, g, b];
    fillCell(data, side, id - 1, cell, (x, y) =>
      x < border || y < border || x >= cell - border || y >= cell - border ? edge : fill,
    );
  }
  fillCell(data, side, PLACEHOLDER_CELL, cell, placeholderColor(cell));
  const source = new BufferImageSource({
    resource: data,
    width: side,
    height: side,
    scaleMode: "nearest",
    label: "nestst-builtin-tileset",
  });
  const frame = (c: number) =>
    new Texture({
      source,
      frame: new Rectangle((c % GRID) * cell, Math.floor(c / GRID) * cell, cell, cell),
    });
  const textures: Texture[] = [];
  for (let id = 1; id <= BUILTIN_TILE_COUNT; id++) textures.push(frame(id - 1));
  return Object.assign(textures, { placeholder: frame(PLACEHOLDER_CELL) });
}

/** Texture for tile `id`; any id outside the tileset gets a visible magenta placeholder. */
export function tileTexture(tileset: Tileset, id: number): Texture {
  if (Number.isInteger(id) && id >= 1 && id <= tileset.length) {
    const t = tileset[id - 1];
    if (t !== undefined) return t;
  }
  return tileset.placeholder ?? fallbackPlaceholder();
}

const destroyedTilesets = new WeakSet<object>();

/**
 * Frees a tileset: every texture in it, its own placeholder and each texture
 * source (the shared atlas) exactly once. Safe to call again. The shared
 * fallback placeholder used by `tileTexture` is never destroyed.
 */
export function destroyTileset(tileset: Tileset): void {
  if (destroyedTilesets.has(tileset)) return;
  destroyedTilesets.add(tileset);
  const fallback = sharedPlaceholder;
  const textures = tileset.placeholder ? [...tileset, tileset.placeholder] : [...tileset];
  const sources = new Set<Texture["source"]>();
  for (const t of textures) {
    if (t === fallback) continue;
    sources.add(t.source);
    if (!t.destroyed) t.destroy(false);
  }
  for (const s of sources) if (!s.destroyed) s.destroy();
}
