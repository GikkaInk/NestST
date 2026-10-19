import type { Dialog, GameMap, MapObject, Project, VariableDef } from "@nestst/core";

export function makeProject(opts: {
  width?: number;
  height?: number;
  solidTiles?: number[];
  layers?: Record<number, number>[];
  objects?: MapObject[];
  variables?: VariableDef[];
  dialogs?: Dialog[];
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
      schemaVersion: 4,
      name: "T",
      resolution: { width: 320, height: 240 },
      tileSize: 16,
      maps: [{ id: "main", file: "maps/main.json" }],
      startMapId: "main",
      solidTiles: opts.solidTiles ?? [9],
      variables: opts.variables ?? [],
      dialogs: (opts.dialogs ?? []).map((d) => ({ id: d.id, file: `dialogs/${d.id}.json` })),
    },
    maps: { main: map },
    dialogs: Object.fromEntries((opts.dialogs ?? []).map((d) => [d.id, d])),
  };
}

export function makeDialog(id: string, start: string | null, nodes: Record<string, unknown>[]): Dialog {
  return {
    schemaVersion: 1,
    id,
    name: `Dialog ${id}`,
    start,
    nodes: nodes.map((n) => ({ x: 0, y: 0, ...n })),
  } as Dialog;
}
