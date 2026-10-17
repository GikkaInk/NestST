import { describe, expect, it } from "vitest";
import { MapError, generateTestMap, validateTileMap } from "./tilemap";
import { GPU_ERROR_MESSAGE, describeGraphicsError } from "./graphics-error";

describe("validateTileMap", () => {
  it("rejects a layer whose size does not match width*height", () => {
    const bad = { width: 2, height: 2, tileSize: 16, layers: [{ name: "a", tiles: [1, 2, 3] }] };
    expect(() => validateTileMap(bad)).toThrow(MapError);
    expect(() => validateTileMap(bad)).toThrow(/размер слоя/);
  });

  it("rejects width 0", () => {
    const bad = { width: 0, height: 2, tileSize: 16, layers: [{ name: "a", tiles: [] }] };
    expect(() => validateTileMap(bad)).toThrow(MapError);
  });

  it("rejects a map without layers", () => {
    expect(() => validateTileMap({ width: 1, height: 1, tileSize: 16, layers: [] })).toThrow(MapError);
  });

  it("accepts a generated map", () => {
    const map = generateTestMap(10, 10);
    expect(validateTileMap(map)).toEqual(map);
  });
});

describe("generateTestMap", () => {
  it("builds 3 layers of 1_000_000 tiles for 1000x1000", () => {
    const map = generateTestMap(1000, 1000);
    expect(map.layers).toHaveLength(3);
    for (const layer of map.layers) expect(layer.tiles).toHaveLength(1_000_000);
  });

  it("is deterministic", () => {
    expect(generateTestMap(50, 40)).toEqual(generateTestMap(50, 40));
  });
});

describe("describeGraphicsError", () => {
  it("returns the Russian message for any error", () => {
    expect(describeGraphicsError(new Error("webgl failed"))).toBe(GPU_ERROR_MESSAGE);
    expect(describeGraphicsError("x")).toBe(GPU_ERROR_MESSAGE);
    expect(GPU_ERROR_MESSAGE).toBe(
      "Не удалось запустить графику. Обновите драйвер видеокарты или откройте журнал.",
    );
  });
});
