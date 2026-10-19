/// <reference types="node" />
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@nestst/core";
import { NodeFsStorage } from "@nestst/core/testing";
import { canEnter, createWorld } from "./world.js";

const EXAMPLE = fileURLToPath(new URL("../../../../examples/nest-island/", import.meta.url));

describe("examples/nest-island as a game", () => {
  it("loads without migration and can be played", async () => {
    const project = await loadProject(new NodeFsStorage(EXAMPLE));
    expect(project.migratedFrom).toBeUndefined();
    const mapId = project.manifest.startMapId;
    const world = createWorld(project, mapId);
    const solidAt = (x: number, y: number) =>
      world.layers.some((l) => world.solid.has(l[y * world.width + x]!));

    const { x, y } = world.spawn;
    expect(x >= 0 && y >= 0 && x < world.width && y < world.height).toBe(true);
    expect(solidAt(x, y)).toBe(false);

    expect(world.npcs.length).toBeGreaterThan(0);
    for (const npc of world.npcs) {
      expect(npc.x === x && npc.y === y).toBe(false);
      expect(solidAt(npc.x, npc.y)).toBe(false);
      expect(canEnter(world, npc.x, npc.y)).toBe(false);
    }

    const neighbours: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    expect(neighbours.some(([nx, ny]) => canEnter(world, nx, ny))).toBe(true);
  });
});
