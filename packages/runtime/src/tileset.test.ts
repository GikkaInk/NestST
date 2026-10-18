import { describe, expect, it } from "vitest";
import { BUILTIN_TILE_COUNT } from "@nestst/core";
import type { Renderer, Texture } from "pixi.js";
import { builtinTileColor, createBuiltinTileset, destroyTileset, tileTexture } from "./tileset.js";

// The built-in tileset is drawn into a CPU buffer, so no real renderer is needed.
const renderer = {} as Renderer;

describe("builtinTileColor", () => {
  it("is deterministic and gives each id its own colour", () => {
    const seen = new Set<string>();
    for (let id = 1; id <= BUILTIN_TILE_COUNT; id++) {
      const c = builtinTileColor(id);
      expect(builtinTileColor(id)).toEqual(c);
      for (const v of c) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
      seen.add(c.join(","));
    }
    expect(seen.size).toBe(BUILTIN_TILE_COUNT);
  });

  it("keeps neighbouring ids clearly different", () => {
    for (let id = 1; id < BUILTIN_TILE_COUNT; id++) {
      const [r1, g1, b1] = builtinTileColor(id);
      const [r2, g2, b2] = builtinTileColor(id + 1);
      const dist = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      expect(dist).toBeGreaterThan(60);
    }
  });
});

describe("createBuiltinTileset", () => {
  it("returns one texture per tile id 1..255, all cut from one small atlas", () => {
    const set = createBuiltinTileset(renderer, 16);
    expect(set).toHaveLength(BUILTIN_TILE_COUNT);
    const source = set[0]!.source;
    const frames = new Set<string>();
    for (const t of set) {
      expect(t).toBeDefined();
      expect(t.source).toBe(source);
      frames.add(`${t.frame.x},${t.frame.y}`);
    }
    expect(frames.size).toBe(BUILTIN_TILE_COUNT);
    // 16×16 cells of 16 px, 4 bytes per pixel = 256 KiB.
    expect(source.width * source.height * 4).toBeLessThanOrEqual(256 * 1024);
  });

  it("keeps the atlas small for large tiles", () => {
    const set = createBuiltinTileset(renderer, 256);
    const source = set[0]!.source;
    expect(source.width * source.height * 4).toBeLessThanOrEqual(1024 * 1024);
  });

  it("works for tiny tiles", () => {
    expect(createBuiltinTileset(renderer, 1)).toHaveLength(BUILTIN_TILE_COUNT);
  });

  it("rejects a tile size that is not a positive whole number", () => {
    for (const size of [0, -16, 1.5, Number.NaN]) {
      expect(() => createBuiltinTileset(renderer, size)).toThrow(RangeError);
    }
  });
});

describe("tileTexture", () => {
  it("returns the tileset texture for ids in the set (index = id − 1)", () => {
    const set = createBuiltinTileset(renderer, 16);
    expect(tileTexture(set, 1)).toBe(set[0]);
    expect(tileTexture(set, 255)).toBe(set[254]);
  });

  it("never returns undefined: unknown ids get the placeholder", () => {
    const set = createBuiltinTileset(renderer, 16);
    const placeholder = tileTexture(set, 256);
    expect(placeholder).toBeDefined();
    expect(set).not.toContain(placeholder);
    for (const id of [0, -1, 1.5, 256, 1000, Number.NaN]) {
      expect(tileTexture(set, id)).toBe(placeholder);
    }
  });

  it("uses a shared placeholder for a hand-made tileset shorter than the id", () => {
    const small = createBuiltinTileset(renderer, 16).slice(0, 6) as Texture[];
    expect(tileTexture(small, 6)).toBe(small[5]);
    const p = tileTexture(small, 7);
    expect(p).toBeDefined();
    expect(small).not.toContain(p);
    expect(tileTexture([], 1)).toBe(p);
  });
});

describe("destroyTileset", () => {
  it("destroys every texture and the shared atlas once, and is safe to repeat", () => {
    const set = createBuiltinTileset(renderer, 16);
    const source = set[0]!.source;
    destroyTileset(set);
    expect(set.every((t) => t.destroyed)).toBe(true);
    expect(set.placeholder.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
    expect(() => destroyTileset(set)).not.toThrow();
  });

  it("does not destroy the shared fallback placeholder", () => {
    const small = createBuiltinTileset(renderer, 16).slice(0, 3);
    const fallback = tileTexture(small, 99);
    destroyTileset(small);
    expect(small.every((t) => t.destroyed)).toBe(true);
    expect(fallback.destroyed).toBe(false);
    expect(tileTexture(small, 99)).toBe(fallback);
  });
});
