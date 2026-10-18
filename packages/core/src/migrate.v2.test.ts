import { describe, expect, it } from "vitest";
import { migrateRaw } from "./index.js";

const v1Map = () => ({
  schemaVersion: 1,
  id: "town",
  name: "Town",
  viewMode: "topdown",
  width: 2,
  height: 1,
  tileSize: 16,
  layers: [{ id: "ground", name: "Ground", visible: true, tiles: [1, 255] }],
});

const v1Manifest = () => ({
  schemaVersion: 1,
  name: "Game",
  resolution: { width: 1280, height: 720 },
  tileSize: 16,
  maps: [{ id: "town", file: "maps/town.json" }],
  startMapId: "town",
  extra: 1,
});

describe("migration 1 to 2", () => {
  it("adds empty objects to a map and keeps tiles", () => {
    const out = migrateRaw("map", v1Map()) as Record<string, unknown>;
    expect(out.schemaVersion).toBe(2);
    expect(out.objects).toEqual([]);
    expect(out.layers).toEqual(v1Map().layers);
  });

  it("only bumps the manifest version", () => {
    const out = migrateRaw("manifest", v1Manifest());
    expect(out).toEqual({ ...v1Manifest(), schemaVersion: 2 });
  });

  it("does not mutate the input", () => {
    const m = v1Map();
    migrateRaw("map", m);
    expect(m).toEqual(v1Map());
    const mf = v1Manifest();
    migrateRaw("manifest", mf);
    expect(mf).toEqual(v1Manifest());
  });

  it("rejects version 3 as too new", () => {
    expect(() => migrateRaw("map", { ...v1Map(), schemaVersion: 3 })).toThrow(
      expect.objectContaining({ code: "schema_too_new" }),
    );
    expect(() => migrateRaw("manifest", { ...v1Manifest(), schemaVersion: 3 })).toThrow(
      expect.objectContaining({ code: "schema_too_new" }),
    );
  });
});
