import { describe, expect, it } from "vitest";
import { NestError, parseManifest, parseMap } from "./index.js";

const ENGLISH = /Invalid input|expected|received|Too small|Too big|Required|undefined|\bNaN\b/i;

function validMap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: "town",
    name: "Город",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    objects: [],
    layers: [
      { id: "ground", name: "Земля", visible: true, tiles: new Array(12).fill(1) },
      { id: "deco", name: "Декор", visible: false, tiles: new Array(12).fill(0) },
    ],
    ...over,
  };
}

function validManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 3,
    name: "Моя игра",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [
      { id: "town", file: "maps/town.json" },
      { id: "cave", file: "maps/cave.json" },
    ],
    startMapId: "town",
    solidTiles: [],
    ...over,
  };
}

function mapError(raw: unknown, file?: string): NestError {
  try {
    parseMap(raw, file);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    const err = e as NestError;
    expect(err.message).not.toMatch(ENGLISH);
    return err;
  }
  throw new Error("expected a rejection, but the map was accepted");
}

function manifestError(raw: unknown, file?: string): NestError {
  try {
    parseManifest(raw, file);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    const err = e as NestError;
    expect(err.message).not.toMatch(ENGLISH);
    return err;
  }
  throw new Error("expected a rejection, but the manifest was accepted");
}

describe("parseMap", () => {
  it("accepts a valid 4×3 map with two layers", () => {
    const map = parseMap(validMap());
    expect(map.width).toBe(4);
    expect(map.layers).toHaveLength(2);
  });

  it("rejects a layer whose size is not width*height", () => {
    const err = mapError(validMap({ layers: [{ id: "g", name: "Земля", visible: true, tiles: [1, 2] }] }));
    expect(err.message).toContain("layer size");
    expect(err.message).toContain("Земля");
  });

  it.each([0, 2049, 1.5, -3])("width: %s is rejected with path and range", (w) => {
    const err = mapError(validMap({ width: w }));
    expect(err.message).toBe('in map "Город", field width: must be a whole number from 1 to 2048');
  });

  it.each([65536, -1, 2.5])("tile id %s is rejected", (t) => {
    const layers = [{ id: "g", name: "З", visible: true, tiles: [0, 0, t, ...new Array(9).fill(0)] }];
    const err = mapError(validMap({ layers }));
    expect(err.message).toContain("layers[0].tiles[2]");
    expect(err.message).toContain("from 0 to 65535");
  });

  it("viewMode sideview is rejected", () => {
    const err = mapError(validMap({ viewMode: "sideview" }));
    expect(err.message).toContain("viewMode");
  });

  it.each(["../x", "A", "", "a/b", "x".repeat(65)])("id %j is rejected", (id) => {
    const err = mapError(validMap({ id }));
    expect(err.message).toContain("field id");
  });

  it("keeps unknown keys on the map and layer", () => {
    const raw = validMap({ extra: 1 });
    (raw.layers as Record<string, unknown>[])[0].extra2 = { a: 1 };
    const map = parseMap(raw);
    expect(map.extra).toBe(1);
    expect(map.layers[0].extra2).toEqual({ a: 1 });
  });

  it.each([null, "x", [], 5, undefined])("non-object %j is rejected in English", (raw) => {
    const err = mapError(raw);
    expect(err.message).toContain("must be an object");
  });

  it("empty layers and more than 16 layers", () => {
    expect(mapError(validMap({ layers: [] })).message).toContain("field layers");
    const many = Array.from({ length: 17 }, (_, i) => ({
      id: `l${i}`, name: "n", visible: true, tiles: new Array(12).fill(0),
    }));
    expect(mapError(validMap({ layers: many })).message).toContain("must not be greater than 16 items");
  });

  it("duplicate layer ids", () => {
    const l = { id: "g", name: "З", visible: true, tiles: new Array(12).fill(0) };
    expect(mapError(validMap({ layers: [l, { ...l }] })).message).toContain("used more than once");
  });

  it("missing field, wrong type, empty and too long text", () => {
    const raw = validMap();
    delete raw.height;
    expect(mapError(raw).message).toContain("field height: this field is missing");
    expect(mapError(validMap({ name: 5 })).message).toContain("field name: must be text");
    expect(mapError(validMap({ name: "" })).message).toContain("must not be empty");
    expect(mapError(validMap({ name: "я".repeat(201) })).message).toContain("must not be greater than 200 characters");
    const badLayer = [{ id: "g", name: "З", visible: "да", tiles: new Array(12).fill(0) }];
    expect(mapError(validMap({ layers: badLayer })).message).toContain("layers[0].visible: must be true or false");
    expect(mapError(validMap({ layers: "x" })).message).toContain("must be a list");
  });

  it("schemaVersion: wrong versions", () => {
    expect(mapError(validMap({ schemaVersion: 0 })).message).toContain("format version must be 2");
    const err = mapError(validMap({ schemaVersion: 1 }), "maps/town.json");
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("format version must be 2");
    expect(err.file).toBe("maps/town.json");
  });

  it("file name appears in the message and NestError.file", () => {
    const err = mapError(validMap({ width: 0 }), "maps/town.json");
    expect(err.file).toBe("maps/town.json");
    expect(err.message).toContain("maps/town.json");
  });
});

describe("parseManifest", () => {
  it("accepts a valid manifest and keeps unknown keys", () => {
    const m = parseManifest(validManifest({ extra: true }));
    expect(m.maps).toHaveLength(2);
    expect(m.extra).toBe(true);
  });

  it("maps[].file must be maps/<id>.json", () => {
    const err = manifestError(validManifest({ maps: [{ id: "town", file: "../town.json" }] }));
    expect(err.message).toContain("maps[0].file");
    expect(err.message).toContain("maps/town.json");
  });

  it("startMapId must be among maps", () => {
    const err = manifestError(validManifest({ startMapId: "nowhere" }));
    expect(err.message).toContain("startMapId");
    expect(err.message).toContain("is not among the project maps");
  });

  it("duplicate map ids", () => {
    const maps = [{ id: "town", file: "maps/town.json" }, { id: "town", file: "maps/town.json" }];
    expect(manifestError(validManifest({ maps })).message).toContain("more than once");
  });

  it("unsafe map id and startMapId", () => {
    expect(manifestError(validManifest({ maps: [{ id: "../x", file: "maps/../x.json" }] })).message).toContain("maps[0].id");
    expect(manifestError(validManifest({ startMapId: "A" })).message).toContain("startMapId");
  });

  it("Windows reserved device names are refused as ids", () => {
    const reserved = ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"];
    for (const id of reserved) {
      const maps = [{ id, file: `maps/${id}.json` }];
      const m = manifestError(validManifest({ maps, startMapId: id }));
      expect(m.message).toContain("maps[0].id");
      expect(m.message).toContain("reserved");
      expect(manifestError(validManifest({ startMapId: id })).message).toContain("startMapId");
      const e = mapError(validMap({ id }));
      expect(e.message).toContain("field id");
      expect(e.message).toContain("reserved");
    }
    for (const id of ["con1", "com0", "com10", "lpt", "console", "nul_", "aux-map"]) {
      expect(() => parseMap(validMap({ id }))).not.toThrow();
    }
  });

  it("resolution, non-object, missing fields, wrong version", () => {
    expect(manifestError(validManifest({ resolution: { width: 0, height: 360 } })).message).toContain(
      "resolution.width: must be a whole number from 1 to 16384",
    );
    expect(manifestError(null).message).toContain("must be an object");
    const raw = validManifest();
    delete raw.maps;
    expect(manifestError(raw).message).toContain("field maps: this field is missing");
    expect(manifestError(validManifest({ schemaVersion: 9 })).code).toBe("invalid_manifest");
  });

  it("project name with Cyrillic and spaces is fine, empty is not", () => {
    expect(parseManifest(validManifest({ name: "Моя  игра №1" })).name).toBe("Моя  игра №1");
    expect(manifestError(validManifest({ name: "" })).message).toContain("field name");
  });
});

describe("parseMap on huge maps", () => {
  function hugeMap(fill: number, layers = 1): Record<string, unknown> {
    const size = 2048;
    return validMap({
      width: size,
      height: size,
      layers: Array.from({ length: layers }, (_, i) => ({
        id: `l${i}`,
        name: `Слой ${i}`,
        visible: true,
        tiles: new Array(size * size).fill(fill),
      })),
    });
  }

  it("rejects a 2048×2048 layer full of invalid tiles with a NestError, quickly", () => {
    const raw = hugeMap(99999);
    const started = performance.now();
    const err = mapError(raw, "maps/town.json");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(err.code).toBe("invalid_map");
    expect(err.message).toMatch(/layers\[0\]\.tiles\[0\]/);
    expect(err.message).toMatch(/from 0 to 65535/);
  });

  it("rejects three full-size layers because of the size limit", () => {
    expect(() => parseMap(hugeMap(99999, 3))).toThrow(
      expect.objectContaining({ code: "invalid_map", message: expect.stringContaining("map is too big") }),
    );
  });

  it("still validates tiles of every layer within the limit", () => {
    const raw = validMap({
      width: 1024,
      height: 2048,
      layers: [0, 1].map((i) => ({
        id: `l${i}`,
        name: `L${i}`,
        visible: true,
        tiles: new Array(1024 * 2048).fill(i === 1 ? 99999 : 1),
      })),
    });
    expect(mapError(raw).message).toMatch(/layers\[1\]\.tiles\[0\]/);
  });

  it("reports the first bad tile of a large layer", () => {
    const raw = hugeMap(1);
    const tiles = (raw.layers as Array<{ tiles: unknown[] }>)[0]!.tiles;
    tiles[5000] = "x";
    tiles[6000] = 1.5;
    expect(mapError(raw).message).toMatch(/layers\[0\]\.tiles\[5000\]: must be a whole number from 0 to 65535/);
  });

  it("still parses a valid 2048×2048 map fast", () => {
    const raw = hugeMap(7, 1);
    const started = performance.now();
    const map = parseMap(raw);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]!.tiles[2048 * 2048 - 1]).toBe(7);
  });
});
