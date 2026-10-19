/// <reference types="node" />
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject, validateProjectRefs } from "@nestst/core";
import type { Project } from "@nestst/core";
import { NodeFsStorage } from "@nestst/core/testing";
import { createPlayer } from "./player.js";
import { advance, createSession, enterCell, interact, moveSelection } from "./session.js";
import type { Session } from "./session.js";
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

describe("examples/nest-island content (session, no Pixi)", () => {
  const load = () => loadProject(new NodeFsStorage(EXAMPLE));

  /** A session whose player stands next to npc-1 facing it, with the dialog started. */
  const talk = (project: Project): Session => {
    const session = createSession(project);
    const world = createWorld(project, "main");
    const npc = world.npcs.find((n) => n.id === "npc-1")!;
    const player = { ...createPlayer(world), x: npc.x - 1, y: npc.y, facing: "right" as const };
    expect(interact(session, project, world, player)).toBe(true);
    return session;
  };
  const pick = (session: Session, project: Project, index: number): void => {
    while (session.dialog?.kind === "choice" && session.dialog.selected < index) moveSelection(session, 1);
    advance(session, project);
  };

  it("has no migration and valid references", async () => {
    const project = await load();
    expect(project.migratedFrom).toBeUndefined();
    expect(() => validateProjectRefs(project)).not.toThrow();
  });

  it("guide: introduction sets the flag and gives a coin", async () => {
    const project = await load();
    const session = talk(project);
    expect(session.dialog).toMatchObject({ kind: "say", text: "Welcome to Nest Island!" });
    advance(session, project);
    expect(session.dialog?.kind).toBe("choice");
    pick(session, project, 0);
    expect(session.dialog).toMatchObject({ kind: "say", text: "I am the island guide. Nice to meet you!" });
    advance(session, project);
    expect(session.vars["met-guide"]).toBe(true);
    expect(session.vars["coins"]).toBe(1);
    expect(session.dialog).toMatchObject({ kind: "say", text: "Take this coin." });
    advance(session, project);
    expect(session.dialog).toBeNull();
  });

  it("guide: tips before and after meeting", async () => {
    const project = await load();
    const first = talk(project);
    advance(first, project);
    pick(first, project, 1);
    expect(first.dialog).toMatchObject({ text: "Talk to me first." });
    expect(first.vars["met-guide"]).toBe(false);

    const second = talk(project);
    advance(second, project);
    pick(second, project, 0);
    advance(second, project);
    advance(second, project);
    expect(second.dialog).toBeNull();
    const world = createWorld(project, "main");
    const npc = world.npcs[0]!;
    const player = { ...createPlayer(world), x: npc.x - 1, y: npc.y, facing: "right" as const };
    interact(second, project, world, player);
    advance(second, project);
    pick(second, project, 1);
    expect(second.dialog).toMatchObject({ text: "We have already met! Keep exploring." });
  });

  it("cave: entrance, walls, exit and sign", async () => {
    const project = await load();
    const session = createSession(project);
    enterCell(session, project, "main", 27, 15);
    expect(session.teleport).toEqual({ map: "cave", x: 2, y: 4 });

    const cave = createWorld(project, "cave", { x: 2, y: 4 });
    for (const [x, y] of [[3, 4], [2, 3], [2, 5], [1, 4]] as const) expect(canEnter(cave, x, y)).toBe(true);
    for (let x = 0; x < cave.width; x++) {
      expect(canEnter(cave, x, 0)).toBe(false);
      expect(canEnter(cave, x, cave.height - 1)).toBe(false);
    }
    for (let y = 0; y < cave.height; y++) {
      expect(canEnter(cave, 0, y)).toBe(false);
      expect(canEnter(cave, cave.width - 1, y)).toBe(false);
    }

    const back = createSession(project);
    enterCell(back, project, "cave", 1, 4);
    expect(back.teleport).toEqual({ map: "main", x: 28, y: 15 });
    const main = createWorld(project, "main");
    expect(canEnter(main, 28, 15)).toBe(true);

    const inCave = createSession(project);
    inCave.mapId = "cave";
    const player = { ...createPlayer(cave), x: 6, y: 4, facing: "up" as const };
    expect(interact(inCave, project, cave, player)).toBe(true);
    expect(inCave.dialog).toMatchObject({ kind: "say", text: "Nest Island Cave — watch your step!" });
  });
});
