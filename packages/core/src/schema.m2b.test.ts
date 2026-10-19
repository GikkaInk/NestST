import { describe, expect, it } from "vitest";
import { FORMAT_VERSIONS, MAX_MAP_CELLS, NestError, parseManifest, parseMap } from "./index.js";

function validMap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: "town",
    name: "Town",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    objects: [],
    layers: [{ id: "ground", name: "Ground", visible: true, tiles: new Array(12).fill(1) }],
    ...over,
  };
}

function validManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 4,
    name: "Game",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [{ id: "town", file: "maps/town.json" }],
    startMapId: "town",
    solidTiles: [3, 7],
    variables: [],
    dialogs: [],
    ...over,
  };
}

function err(fn: () => unknown): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected a rejection");
}

const obj = (id: string, kind: string, x: number, y: number) => ({ id, kind, x, y, props: {} });

describe("manifest v3", () => {
  it("has current versions", () => {
    expect(FORMAT_VERSIONS).toEqual({ manifest: 4, map: 2, dialog: 1 });
    expect(MAX_MAP_CELLS).toBe(4194304);
  });

  it("accepts solidTiles", () => {
    expect(parseManifest(validManifest()).solidTiles).toEqual([3, 7]);
  });

  it("rejects duplicates, 0 and 65536", () => {
    for (const solidTiles of [[3, 3], [0], [65536], [1.5]]) {
      expect(err(() => parseManifest(validManifest({ solidTiles }))).code).toBe("invalid_manifest");
    }
  });

  it("requires solidTiles", () => {
    const raw = validManifest();
    delete raw.solidTiles;
    expect(err(() => parseManifest(raw)).code).toBe("invalid_manifest");
  });
});

describe("map size limit and object rules", () => {
  function big(layers: number): Record<string, unknown> {
    return validMap({
      width: 2048,
      height: 2048,
      layers: Array.from({ length: layers }, (_, i) => ({
        id: `l${i}`,
        name: `L${i}`,
        visible: true,
        tiles: new Array(2048 * 2048).fill(1),
      })),
    });
  }

  it("accepts exactly 4194304 cells", () => {
    expect(parseMap(big(1)).layers).toHaveLength(1);
  });

  it("rejects more cells, before the layer length check", () => {
    const e = err(() => parseMap(big(2)));
    expect(e.code).toBe("invalid_map");
    expect(e.message).toContain(
      "map is too big: 8388608 cells (width × height × layers), the limit is 4194304",
    );
    const short = validMap({
      width: 2048,
      height: 2048,
      layers: [
        { id: "a", name: "A", visible: true, tiles: [1] },
        { id: "b", name: "B", visible: true, tiles: [1] },
      ],
    });
    expect(err(() => parseMap(short)).message).toContain("map is too big");
  });

  it("rejects two spawns", () => {
    const e = err(() => parseMap(validMap({ objects: [obj("s1", "spawn", 0, 0), obj("s2", "spawn", 1, 1)] })));
    expect(e.code).toBe("invalid_map");
    expect(e.message).toContain("s1");
    expect(e.message).toContain("s2");
  });

  it("rejects two objects in one cell", () => {
    const e = err(() => parseMap(validMap({ objects: [obj("a", "npc", 1, 2), obj("b", "chest", 1, 2)] })));
    expect(e.code).toBe("invalid_map");
    expect(e.message).toContain('"a"');
    expect(e.message).toContain('"b"');
    expect(e.message).toContain("(1, 2)");
  });

  it("accepts one spawn and objects in different cells", () => {
    const m = parseMap(validMap({ objects: [obj("s", "spawn", 0, 0), obj("a", "npc", 1, 0)] }));
    expect(m.objects).toHaveLength(2);
  });

  function sized(width: number, height: number, layers: number): Record<string, unknown> {
    return validMap({
      width,
      height,
      layers: Array.from({ length: layers }, (_, i) => ({
        id: `l${i}`,
        name: `L${i}`,
        visible: true,
        tiles: new Array(width * height).fill(1),
      })),
    });
  }

  it("accepts exactly the limit with several layers (1024 × 2048 × 2)", () => {
    expect(parseMap(sized(1024, 2048, 2)).layers).toHaveLength(2);
  });

  it("rejects just over the limit (2048 × 1025 × 2 = 4198400)", () => {
    const e = err(() => parseMap(sized(2048, 1025, 2)));
    expect(e.code).toBe("invalid_map");
    expect(e.message).toContain("map is too big: 4198400 cells");
  });

  it("rejects 16 raw layers of 2048 × 2048 quickly", () => {
    const raw = sized(2048, 2048, 1);
    const layer = (raw.layers as unknown[])[0];
    raw.layers = Array.from({ length: 16 }, () => layer);
    const started = performance.now();
    const e = err(() => parseMap(raw));
    expect(performance.now() - started).toBeLessThan(500);
    expect(e.message).toContain("map is too big: 67108864 cells");
  });
});
