import { NestError } from "./errors.js";
import type { Project } from "./project.js";
import { MAX_TILE_ID } from "./schema.js";
import type { GameMap } from "./schema.js";

/** One tile change: put `tile` at (`x`, `y`) of layer `layerId`; `tile: 0` erases. */
export interface TileEdit {
  layerId: string;
  x: number;
  y: number;
  tile: number;
}

/** A reversible change to a project; one command is one undo step. */
export type Command = {
  label: string;
  apply(p: Project): Project;
  revert(p: Project): Project;
};

function isIndex(v: number, size: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < size;
}

/** Index of the layer for every edit; throws `invalid_edit` on the first bad one. */
function checkEdits(map: GameMap, edits: readonly TileEdit[]): number[] {
  const layerIndex = new Map(map.layers.map((l, i) => [l.id, i] as const));
  return edits.map((e, i) => {
    const fail = (why: string): never => {
      throw new NestError("invalid_edit", `in map "${map.name}", edit ${i}: ${why}`);
    };
    const li = layerIndex.get(e.layerId);
    if (li === undefined) fail(`layer "${e.layerId}" does not exist`);
    if (!isIndex(e.x, map.width)) {
      fail(`x must be a whole number from 0 to ${map.width - 1}, but it is ${e.x}`);
    }
    if (!isIndex(e.y, map.height)) {
      fail(`y must be a whole number from 0 to ${map.height - 1}, but it is ${e.y}`);
    }
    if (!Number.isInteger(e.tile) || e.tile < 0 || e.tile > MAX_TILE_ID) {
      fail(`tile must be a whole number from 0 to ${MAX_TILE_ID}, but it is ${e.tile}`);
    }
    return li!;
  });
}

/**
 * Returns a new map with the edits applied in order (the last edit of a cell
 * wins). All edits are checked first: if any is invalid, a NestError
 * `invalid_edit` is thrown and nothing changes. Only edited layers get a new
 * `tiles` array; everything else is shared with `map`. An empty list returns
 * `map` itself.
 */
export function paintTiles(map: GameMap, edits: readonly TileEdit[]): GameMap {
  if (edits.length === 0) return map;
  const layerOf = checkEdits(map, edits);
  const layers = map.layers.slice();
  const copied = new Set<number>();
  edits.forEach((e, i) => {
    const li = layerOf[i]!;
    if (!copied.has(li)) {
      copied.add(li);
      layers[li] = { ...layers[li]!, tiles: layers[li]!.tiles.slice() };
    }
    layers[li]!.tiles[e.y * map.width + e.x] = e.tile;
  });
  return { ...map, layers };
}

function updateMap(p: Project, mapId: string, edits: readonly TileEdit[]): Project {
  const map = Object.hasOwn(p.maps, mapId) ? p.maps[mapId] : undefined;
  if (map === undefined) {
    throw new NestError("unknown_map", `map "${mapId}" does not exist in the project`);
  }
  const next = paintTiles(map, edits);
  if (next === map) return p;
  return { ...p, maps: { ...p.maps, [mapId]: next } };
}

/**
 * Command that paints `edits` on map `mapId`. `before` is that map as it is
 * right before the command runs: the old value of every touched cell is
 * remembered now, so `revert` puts back exactly those cells.
 */
export function paintCommand(mapId: string, edits: readonly TileEdit[], before: GameMap): Command {
  const layerOf = checkEdits(before, edits);
  const forward = edits.map((e) => ({ ...e }));
  const backward: TileEdit[] = [];
  const seen = new Set<string>();
  edits.forEach((e, i) => {
    const key = `${layerOf[i]}:${e.x}:${e.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    const tile = before.layers[layerOf[i]!]!.tiles[e.y * before.width + e.x]!;
    backward.push({ layerId: e.layerId, x: e.x, y: e.y, tile });
  });
  return {
    label: "Paint tiles",
    apply: (p) => updateMap(p, mapId, forward),
    revert: (p) => updateMap(p, mapId, backward),
  };
}

/** Several commands as one undo step (e.g. one brush drag): apply in order, revert in reverse. */
export function mergeCommands(label: string, cmds: readonly Command[]): Command {
  const list = cmds.slice();
  return {
    label,
    apply: (p) => list.reduce((acc, c) => c.apply(acc), p),
    revert: (p) => list.reduceRight((acc, c) => c.revert(acc), p),
  };
}
