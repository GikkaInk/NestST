import { describe, expect, it } from "vitest";
import { NestError, parseManifest, parseMap } from "./index.js";

const ENGLISH = /Invalid input|expected|received|Too small|Too big|Required|undefined|\bNaN\b/i;

function validMap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "town",
    name: "Город",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    layers: [
      { id: "ground", name: "Земля", visible: true, tiles: new Array(12).fill(1) },
      { id: "deco", name: "Декор", visible: false, tiles: new Array(12).fill(0) },
    ],
    ...over,
  };
}

function validManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "Моя игра",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [
      { id: "town", file: "maps/town.json" },
      { id: "cave", file: "maps/cave.json" },
    ],
    startMapId: "town",
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

  it.each([256, -1, 2.5])("tile id %s is rejected", (t) => {
    const layers = [{ id: "g", name: "З", visible: true, tiles: [0, 0, t, ...new Array(9).fill(0)] }];
    const err = mapError(validMap({ layers }));
    expect(err.message).toContain("layers[0].tiles[2]");
    expect(err.message).toContain("from 0 to 255");
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
    expect(mapError(validMap({ schemaVersion: 0 })).message).toContain("format version must be 1");
    const err = mapError(validMap({ schemaVersion: 2 }), "maps/town.json");
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("format version must be 1");
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
