import type { GameMap, MapObject, Project } from "@nestst/core";

export function makeProject(opts: {
  width?: number;
  height?: number;
  solidTiles?: number[];
  layers?: Record<number, number>[];
  objects?: MapObject[];
}): Project {
  const width = opts.width ?? 5;
  const height = opts.height ?? 5;
  const layerSpecs = opts.layers ?? [{}, {}];
  const map: GameMap = {
    schemaVersion: 2,
    id: "main",
    name: "Main",
    viewMode: "topdown",
    width,
    height,
    tileSize: 16,
    layers: layerSpecs.map((spec, i) => {
      const tiles = new Array<number>(width * height).fill(0);
      for (const [cell, tile] of Object.entries(spec)) tiles[Number(cell)] = tile;
      return { id: `l${i}`, name: `L${i}`, visible: true, tiles };
    }),
    objects: opts.objects ?? [{ id: "s", kind: "spawn", x: 0, y: 0, props: {} }],
  };
  return {
    manifest: {
      schemaVersion: 3,
      name: "T",
      resolution: { width: 320, height: 240 },
      tileSize: 16,
      maps: [{ id: "main", file: "maps/main.json" }],
      startMapId: "main",
      solidTiles: opts.solidTiles ?? [9],
    },
    maps: { main: map },
  };
}
