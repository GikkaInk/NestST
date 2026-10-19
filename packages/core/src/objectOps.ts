import { NestError } from "./errors.js";
import type { Command } from "./mapOps.js";
import type { Project } from "./project.js";
import { checkObjectRefs } from "./refs.js";
import { MAX_TILE_ID } from "./schema.js";
import type { GameMap, MapObject, ProjectManifest } from "./schema.js";

const OBJECT_KINDS: readonly string[] = ["spawn", "npc", "event"];

function kindName(kind: string): string {
  return kind === "spawn" ? "spawn" : kind === "event" ? "event" : "NPC";
}

function fail(why: string): never {
  throw new NestError("invalid_edit", why);
}

function isIndex(v: number, size: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < size;
}

function getMap(p: Project, mapId: string): GameMap {
  const map = Object.hasOwn(p.maps, mapId) ? p.maps[mapId] : undefined;
  if (map === undefined) {
    throw new NestError("unknown_map", `map "${mapId}" does not exist in the project`);
  }
  return map;
}

/** Map of `p`, or `invalid_edit` when it is missing (e.g. the project changed since the command was made). */
function mapOf(p: Project, mapId: string): GameMap {
  const map = Object.hasOwn(p.maps, mapId) ? p.maps[mapId] : undefined;
  if (map === undefined) fail(`map "${mapId}" does not exist in the project`);
  return map!;
}

function withObjects(p: Project, mapId: string, edit: (objects: MapObject[]) => MapObject[]): Project {
  const map = mapOf(p, mapId);
  return { ...p, maps: { ...p.maps, [mapId]: { ...map, objects: edit(map.objects) } } };
}

function insertAt(objects: MapObject[], index: number, obj: MapObject): MapObject[] {
  const next = objects.slice();
  next.splice(Math.min(index, next.length), 0, obj);
  return next;
}

/** True when `tile` is listed as impassable in the manifest. */
export function isSolidTile(manifest: ProjectManifest, tile: number): boolean {
  return manifest.solidTiles.includes(tile);
}

/** Smallest free `npc-<n>` id (n >= 1) on the map. */
export function nextNpcId(map: GameMap): string {
  const used = new Set(map.objects.map((o) => o.id));
  let n = 1;
  while (used.has(`npc-${n}`)) n++;
  return `npc-${n}`;
}

/** The object standing on cell (`x`, `y`), if any. */
export function objectAt(map: GameMap, x: number, y: number): MapObject | undefined {
  return map.objects.find((o) => o.x === x && o.y === y);
}

/** True when any layer of `map` has a tile from `solid` on the cell. */
function cellIsSolid(map: GameMap, x: number, y: number, solid: readonly number[]): boolean {
  const i = y * map.width + x;
  return map.layers.some((l) => solid.includes(l.tiles[i]!));
}

/** Checks the target cell of an object; `ignoreId` is the object being moved or replaced. */
function checkCell(map: GameMap, solid: readonly number[], x: number, y: number, ignoreId?: string): void {
  const where = `in map "${map.name}"`;
  if (!isIndex(x, map.width)) {
    fail(`${where}: x must be a whole number from 0 to ${map.width - 1}, but it is ${x}`);
  }
  if (!isIndex(y, map.height)) {
    fail(`${where}: y must be a whole number from 0 to ${map.height - 1}, but it is ${y}`);
  }
  const other = objectAt(map, x, y);
  if (other !== undefined && other.id !== ignoreId) {
    fail(`${where}: cell (${x}, ${y}) is already taken by object "${other.id}"`);
  }
  if (cellIsSolid(map, x, y, solid)) {
    fail(`${where}: cell (${x}, ${y}) has a solid tile, so an object cannot stand there`);
  }
}

/** Places an object; a `spawn` replaces the map's existing spawn (undo brings it back). */
export function placeObjectCommand(mapId: string, object: MapObject, before: Project): Command {
  const map = getMap(before, mapId);
  if (!OBJECT_KINDS.includes(object.kind)) {
    fail(`in map "${map.name}": object kind must be "spawn", "npc" or "event", but it is "${object.kind}"`);
  }
  if (object.kind === "npc" || object.kind === "event") {
    try {
      checkObjectRefs(before, mapId, object);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  const replaced = object.kind === "spawn" ? map.objects.find((o) => o.kind === "spawn") : undefined;
  if (map.objects.some((o) => o.id === object.id && o !== replaced)) {
    fail(`in map "${map.name}": an object with id "${object.id}" already exists`);
  }
  checkCell(map, before.manifest.solidTiles, object.x, object.y, replaced?.id);
  const placed: MapObject = { ...object, props: { ...object.props } };
  const replacedAt = replaced === undefined ? -1 : map.objects.indexOf(replaced);
  return {
    label: `Place ${kindName(object.kind)}`,
    apply: (p) =>
      withObjects(p, mapId, (os) =>
        os.filter((o) => o.id !== replaced?.id && o.id !== placed.id).concat(placed),
      ),
    revert: (p) =>
      withObjects(p, mapId, (os) => {
        const rest = os.filter((o) => o.id !== placed.id);
        return replaced === undefined ? rest : insertAt(rest, replacedAt, replaced);
      }),
  };
}

function findObject(map: GameMap, id: string): MapObject {
  const found = map.objects.find((o) => o.id === id);
  if (found === undefined) fail(`in map "${map.name}": object "${id}" does not exist`);
  return found!;
}

/** Moves object `id` to cell (`x`, `y`). */
export function moveObjectCommand(mapId: string, id: string, x: number, y: number, before: Project): Command {
  const map = getMap(before, mapId);
  const obj = findObject(map, id);
  checkCell(map, before.manifest.solidTiles, x, y, id);
  const from = { x: obj.x, y: obj.y };
  const relocate = (p: Project, to: { x: number; y: number }): Project =>
    withObjects(p, mapId, (os) => {
      if (!os.some((o) => o.id === id)) fail(`object "${id}" does not exist in map "${mapId}"`);
      return os.map((o) => (o.id === id ? { ...o, x: to.x, y: to.y } : o));
    });
  return {
    label: `Move ${kindName(obj.kind)}`,
    apply: (p) => relocate(p, { x, y }),
    revert: (p) => relocate(p, from),
  };
}

/** Removes object `id`; undo puts it back at the same place in the list. */
export function removeObjectCommand(mapId: string, id: string, before: Project): Command {
  const map = getMap(before, mapId);
  const obj = findObject(map, id);
  const index = map.objects.indexOf(obj);
  return {
    label: `Remove ${kindName(obj.kind)}`,
    apply: (p) => withObjects(p, mapId, (os) => os.filter((o) => o.id !== id)),
    revert: (p) => withObjects(p, mapId, (os) => insertAt(os.filter((o) => o.id !== id), index, obj)),
  };
}

/** Marks tile `tile` as solid or passable; refuses while an object stands on a cell with that tile. */
export function setSolidCommand(tile: number, solid: boolean, before: Project): Command {
  if (!Number.isInteger(tile) || tile < 1 || tile > MAX_TILE_ID) {
    fail(`tile must be a whole number from 1 to ${MAX_TILE_ID}, but it is ${tile}`);
  }
  if (solid) {
    for (const map of Object.values(before.maps)) {
      for (const o of map.objects) {
        if (isIndex(o.x, map.width) && isIndex(o.y, map.height) && cellIsSolid(map, o.x, o.y, [tile])) {
          fail(
            `in map "${map.name}": object "${o.id}" stands on cell (${o.x}, ${o.y}) with tile ${tile}, so the tile cannot be solid`,
          );
        }
      }
    }
  }
  const already = isSolidTile(before.manifest, tile);
  if (solid === already) fail(`tile ${tile} is already ${solid ? "solid" : "passable"}`);
  const setTile = (p: Project, on: boolean): Project => {
    const rest = p.manifest.solidTiles.filter((t) => t !== tile);
    const list = (on ? rest.concat(tile) : rest).sort((a, b) => a - b);
    return { ...p, manifest: { ...p.manifest, solidTiles: list } };
  };
  return {
    label: solid ? "Mark tile as solid" : "Mark tile as passable",
    apply: (p) => setTile(p, solid),
    revert: (p) => setTile(p, !solid),
  };
}
