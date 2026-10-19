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
import type { Dir, World } from "./world.js";

const EXAMPLE = fileURLToPath(new URL("../../../../examples/lost-cat/", import.meta.url));
const load = () => loadProject(new NodeFsStorage(EXAMPLE));

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x: number, y: number) => `${x},${y}`;

/** Cells the player can walk to from (sx, sy). */
function reachable(world: World, sx: number, sy: number): Set<string> {
  const seen = new Set([key(sx, sy)]);
  const queue: [number, number][] = [[sx, sy]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!seen.has(key(nx, ny)) && canEnter(world, nx, ny)) {
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}
const reachesNeighbour = (r: Set<string>, x: number, y: number) =>
  DIRS.some(([dx, dy]) => r.has(key(x + dx, y + dy)));

const objectsOf = (project: Project, mapId: string) => project.maps[mapId]!.objects;
const eventAt = (project: Project, mapId: string, name: string) =>
  objectsOf(project, mapId).find((o) => o.kind === "event" && o.props["name"] === name)!;

/** Talks to the NPC with `npcId` from its west neighbour. */
function talk(session: Session, project: Project, world: World, npcId: string): void {
  const npc = world.npcs.find((n) => n.id === npcId)!;
  const player = { ...createPlayer(world), x: npc.x - 1, y: npc.y, facing: "right" as Dir };
  expect(interact(session, project, world, player)).toBe(true);
}
function pick(session: Session, project: Project, index: number): void {
  while (session.dialog?.kind === "choice" && session.dialog.selected < index) moveSelection(session, 1);
  advance(session, project);
}
/** Steps on a touch event and, like the game does, switches map. */
function walkThrough(session: Session, project: Project, mapId: string, name: string): World {
  const ev = eventAt(project, mapId, name);
  enterCell(session, project, mapId, ev.x, ev.y);
  const tp = session.teleport!;
  expect(tp).not.toBeNull();
  session.mapId = tp.map;
  session.teleport = null;
  return createWorld(project, tp.map, { x: tp.x, y: tp.y });
}

describe("examples/lost-cat", () => {
  it("loads without migration and with valid references", async () => {
    const project = await load();
    expect(project.migratedFrom).toBeUndefined();
    expect(project.refProblems ?? []).toEqual([]);
    expect(() => validateProjectRefs(project)).not.toThrow();
    expect(project.manifest.name).toBe("Lost Cat");
    expect(project.manifest.startMapId).toBe("village");
  });

  it("village: spawn reaches Mira, the sign and the garden gate", async () => {
    const project = await load();
    const world = createWorld(project, "village");
    const r = reachable(world, world.spawn.x, world.spawn.y);
    const mira = world.npcs.find((n) => n.name === "Mira")!;
    expect(reachesNeighbour(r, mira.x, mira.y)).toBe(true);
    const sign = eventAt(project, "village", "Sign");
    expect(reachesNeighbour(r, sign.x, sign.y)).toBe(true);
    const gate = eventAt(project, "village", "Garden gate");
    expect(r.has(key(gate.x, gate.y))).toBe(true);
  });

  it("garden: arrival reaches Mochi and the gate back; arrivals are free cells", async () => {
    const project = await load();
    const gate = eventAt(project, "village", "Garden gate");
    const to = (gate.props["actions"] as { map: string; x: number; y: number }[])[0]!;
    expect(to.map).toBe("garden");
    const garden = createWorld(project, "garden", to);
    expect(canEnter(garden, to.x, to.y)).toBe(true);
    const r = reachable(garden, to.x, to.y);
    const mochi = garden.npcs.find((n) => n.name === "Mochi")!;
    expect(reachesNeighbour(r, mochi.x, mochi.y)).toBe(true);
    const back = eventAt(project, "garden", "Gate back");
    expect(r.has(key(back.x, back.y))).toBe(true);
    expect(garden.npcs.some((n) => n.x === to.x && n.y === to.y)).toBe(false);
    expect(objectsOf(project, "garden").some((o) => o.kind === "event" && o.x === to.x && o.y === to.y)).toBe(false);

    const toVillage = (back.props["actions"] as { map: string; x: number; y: number }[])[0]!;
    expect(toVillage.map).toBe("village");
    const village = createWorld(project, "village", toVillage);
    expect(canEnter(village, toVillage.x, toVillage.y)).toBe(true);
    expect(village.npcs.some((n) => n.x === toVillage.x && n.y === toVillage.y)).toBe(false);
    expect(objectsOf(project, "village").some((o) => o.kind === "event" && o.x === toVillage.x && o.y === toVillage.y)).toBe(false);
    expect([gate.x - toVillage.x, gate.y - toVillage.y]).toEqual([1, 0]);
  });

  it("full playthrough: quest, cat, reward, final line", async () => {
    const project = await load();
    const session = createSession(project);
    let world = createWorld(project, "village");

    talk(session, project, world, "npc-1");
    expect(session.dialog).toMatchObject({ kind: "say", speaker: "Mira", text: "Oh no… my cat Mochi ran away to the garden. Could you find her?" });
    advance(session, project);
    expect(session.dialog).toMatchObject({ kind: "choice" });
    pick(session, project, 0);
    expect(session.vars["quest-started"]).toBe(true);
    expect(session.dialog).toMatchObject({ kind: "say", text: "Thank you! The garden is through the gate to the east." });
    advance(session, project);
    expect(session.dialog).toBeNull();

    world = walkThrough(session, project, "village", "Garden gate");
    expect(session.mapId).toBe("garden");
    expect(world.spawn).toEqual({ x: 1, y: 5 });

    talk(session, project, world, "npc-1");
    expect(session.dialog).toMatchObject({ kind: "say", speaker: "Mochi", text: "Meow!" });
    advance(session, project);
    expect(session.vars["found-cat"]).toBe(true);
    expect(session.dialog).toMatchObject({ text: "Mochi purrs and follows you home. Go back to Mira!" });
    advance(session, project);
    expect(session.dialog).toBeNull();

    world = walkThrough(session, project, "garden", "Gate back");
    expect(session.mapId).toBe("village");
    expect(world.spawn).toEqual({ x: 21, y: 8 });

    talk(session, project, world, "npc-1");
    expect(session.dialog).toMatchObject({ text: "Mochi! You found her! Please take this." });
    advance(session, project);
    expect(session.vars["coins"]).toBe(5);
    expect(session.vars["quest-done"]).toBe(true);
    expect(session.dialog).toMatchObject({ text: "Thank you, hero. You saved my day!" });
    advance(session, project);
    expect(session.dialog).toBeNull();

    talk(session, project, world, "npc-1");
    expect(session.dialog).toMatchObject({ text: "Mochi is happy at home. Thank you again!" });
    advance(session, project);
    expect(session.dialog).toBeNull();
    expect(session.vars["coins"]).toBe(5);
  });

  it("negative paths: 'Not now.', and Mochi twice", async () => {
    const project = await load();
    const session = createSession(project);
    const village = createWorld(project, "village");
    talk(session, project, village, "npc-1");
    advance(session, project);
    pick(session, project, 1);
    expect(session.vars["quest-started"]).toBe(false);
    expect(session.dialog).toMatchObject({ text: "Please hurry…" });
    advance(session, project);
    expect(session.dialog).toBeNull();

    session.mapId = "garden";
    const garden = createWorld(project, "garden", { x: 1, y: 5 });
    talk(session, project, garden, "npc-1");
    advance(session, project);
    advance(session, project);
    expect(session.vars["found-cat"]).toBe(true);
    talk(session, project, garden, "npc-1");
    expect(session.dialog).toMatchObject({ text: "Meow." });
    advance(session, project);
    expect(session.dialog).toBeNull();
    expect(session.vars["found-cat"]).toBe(true);
    expect(session.vars["coins"]).toBe(0);
  });

  it("the sign says where the garden is", async () => {
    const project = await load();
    const session = createSession(project);
    const world = createWorld(project, "village");
    const sign = eventAt(project, "village", "Sign");
    const player = { ...createPlayer(world), x: sign.x, y: sign.y + 1, facing: "up" as Dir };
    expect(interact(session, project, world, player)).toBe(true);
    expect(session.dialog).toMatchObject({ speaker: "Sign", text: "Willow Village. The garden is to the east." });
  });
});
