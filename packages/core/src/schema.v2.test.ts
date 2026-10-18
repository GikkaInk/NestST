import { describe, expect, it } from "vitest";
import { NestError, createEmptyProject, paintCommand, paintTiles, parseMap } from "./index.js";

function rawMap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: "town",
    name: "Town",
    viewMode: "topdown",
    width: 2,
    height: 2,
    tileSize: 16,
    objects: [],
    layers: [{ id: "ground", name: "Ground", visible: true, tiles: [0, 1, 2, 3] }],
    ...overrides,
  };
}

function withTiles(tiles: number[]): Record<string, unknown> {
  return rawMap({ layers: [{ id: "ground", name: "Ground", visible: true, tiles }] });
}

function mapError(raw: unknown): NestError {
  try {
    parseMap(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected a rejection");
}

describe("wide tile ids", () => {
  it.each([255, 256, 65535])("accepts tile %i", (t) => {
    expect(parseMap(withTiles([0, t, 0, 0])).layers[0].tiles[1]).toBe(t);
  });

  it.each([65536, -1])("rejects tile %i", (t) => {
    const err = mapError(withTiles([0, t, 0, 0]));
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("must be a whole number from 0 to 65535");
  });
});

describe("map objects", () => {
  const obj = (o: Record<string, unknown> = {}) => ({ id: "a", kind: "chest", x: 0, y: 0, props: {}, ...o });

  it("accepts an empty list and an unknown kind", () => {
    expect(parseMap(rawMap({ objects: [] })).objects).toEqual([]);
    expect(parseMap(rawMap({ objects: [obj()] })).objects).toHaveLength(1);
  });

  it("rejects an object outside the map", () => {
    const err = mapError(rawMap({ objects: [obj({ id: "far", x: 2 })] }));
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("far");
  });

  it("rejects y equal to height", () => {
    expect(mapError(rawMap({ objects: [obj({ id: "low", y: 2 })] })).message).toContain("low");
  });

  it("rejects duplicate object ids", () => {
    const err = mapError(rawMap({ objects: [obj({ id: "dup" }), obj({ id: "dup", x: 1 })] }));
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("dup");
  });

  it("rejects a map without objects", () => {
    const raw = rawMap();
    delete raw.objects;
    expect(mapError(raw).code).toBe("invalid_map");
  });
});

describe("painting keeps objects", () => {
  it("does not change objects", () => {
    const map = parseMap(rawMap({ objects: [{ id: "a", kind: "chest", x: 1, y: 1, props: { gold: 5 } }] }));
    const before = structuredClone(map.objects);
    const painted = paintTiles(map, [{ layerId: "ground", x: 0, y: 0, tile: 300 }]);
    expect(painted.objects).toEqual(before);
    const cmd = paintCommand("town", [{ layerId: "ground", x: 1, y: 0, tile: 7 }], map);
    const project = { manifest: createEmptyProject("P").manifest, maps: { town: map } };
    expect(cmd.apply(project).maps.town!.objects).toEqual(before);
    expect(map.objects).toEqual(before);
  });
});
