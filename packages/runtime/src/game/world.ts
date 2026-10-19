import { NestError } from "@nestst/core";
import type { Project } from "@nestst/core";

export type Dir = "up" | "down" | "left" | "right";

export interface World {
  width: number;
  height: number;
  tileSize: number;
  solid: ReadonlySet<number>;
  layers: readonly (readonly number[])[];
  npcs: readonly { id: string; x: number; y: number; name: string }[];
  spawn: { x: number; y: number };
}

/**
 * `start` overrides the spawn cell (used for teleports); then the map needs no
 * spawn. Without `start` and without a spawn point this throws `no_spawn`.
 */
export function createWorld(
  project: Project,
  mapId: string,
  start?: { x: number; y: number },
): World {
  const map = project.maps[mapId];
  if (map === undefined) throw new NestError("no_map", `Map "${mapId}" does not exist`);
  const spawn = map.objects.find((o) => o.kind === "spawn");
  if (start === undefined && spawn === undefined) {
    throw new NestError("no_spawn", `Map "${map.name}" has no spawn point`);
  }
  return {
    width: map.width,
    height: map.height,
    tileSize: map.tileSize,
    solid: new Set(project.manifest.solidTiles),
    layers: map.layers.map((l) => l.tiles),
    npcs: map.objects
      .filter((o) => o.kind === "npc")
      .map((o) => {
        const name = o.props["name"];
        return {
          id: o.id,
          x: o.x,
          y: o.y,
          name: typeof name === "string" && name !== "" ? name : o.id,
        };
      }),
    spawn: start !== undefined ? { x: start.x, y: start.y } : { x: spawn!.x, y: spawn!.y },
  };
}

export function canEnter(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const cell = y * world.width + x;
  for (const layer of world.layers) {
    const tile = layer[cell];
    if (tile !== undefined && world.solid.has(tile)) return false;
  }
  return !world.npcs.some((n) => n.x === x && n.y === y);
}
