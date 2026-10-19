import { describe, expect, it } from "vitest";
import type { MapObject, Project } from "@nestst/core";
import type { GameInputFrame } from "./input.js";
import { createPlayer, TILE_MOVE_MS } from "./player.js";
import type { PlayerState } from "./player.js";
import { stepFrame } from "./frame.js";
import type { FrameResult, FrameState } from "./frame.js";
import { createSession } from "./session.js";
import { makeDialog, makeProject } from "./testProject.js";
import { createWorld } from "./world.js";

const spawn: MapObject = { id: "s", kind: "spawn", x: 0, y: 0, props: {} };
const IDLE: GameInputFrame = { held: null, tapped: null, action: false, menu: 0 };
const say = (id: string, next: string | null, text = id) => ({ id, type: "say", speaker: "A", text, next });
const num = { id: "n", name: "N", type: "number", initial: 0 } as const;
const inc = { type: "set", variable: "n", op: "add", value: 1 } as const;

function ev(id: string, x: number, y: number, props: Record<string, unknown>): MapObject {
  return { id, kind: "event", x, y, props: { name: id, trigger: "interact", once: false, actions: [], ...props } };
}

/** "main" plus a second map "other" (no spawn needed) built from the same template. */
function twoMaps(main: MapObject[], other: MapObject[], opts: Parameters<typeof makeProject>[0] = {}): Project {
  const p = makeProject({ ...opts, objects: main });
  const o = makeProject({ ...opts, objects: other }).maps["main"]!;
  p.maps["other"] = { ...o, id: "other", name: "Other" };
  p.manifest.maps.push({ id: "other", file: "maps/other.json" });
  return p;
}

function start(project: Project, at?: Partial<PlayerState>): { project: Project; session: ReturnType<typeof createSession>; state: FrameState } {
  const session = createSession(project);
  const world = createWorld(project, session.mapId);
  return { project, session, state: { world, player: { ...createPlayer(world), ...at } } };
}

/** Steps with `input` for one full tile of time (arrival happens on the last step). */
function walk(env: ReturnType<typeof start>, input: GameInputFrame, steps = 1): FrameResult {
  let s: FrameResult = { ...env.state, mapChanged: false };
  for (let i = 0; i < steps; i++) s = stepFrame(env.project, env.session, s, input, TILE_MOVE_MS);
  return s;
}

describe("stepFrame: dialogs", () => {
  const dialogs = [makeDialog("d", "a", [say("a", "b"), say("b", null)])];
  const npcMap = (): MapObject[] => [spawn, { id: "npc", kind: "npc", x: 1, y: 0, props: { dialog: "d" } }];

  it("action next to an NPC starts its dialog; walking is frozen while it is open", () => {
    const env = start(makeProject({ objects: npcMap(), dialogs }), { facing: "right" });
    let s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    expect(env.session.dialog).toMatchObject({ kind: "say", text: "a" });
    s = stepFrame(env.project, env.session, s, { ...IDLE, held: "down", tapped: "down" }, TILE_MOVE_MS);
    expect(s.player).toMatchObject({ x: 0, y: 0, moving: null });
  });

  it("action advances and closes the dialog; then walking works again", () => {
    const env = start(makeProject({ objects: npcMap(), dialogs }), { facing: "right" });
    let s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    s = stepFrame(env.project, env.session, s, { ...IDLE, action: true }, 16);
    expect(env.session.dialog).toMatchObject({ text: "b" });
    s = stepFrame(env.project, env.session, s, { ...IDLE, action: true }, 16);
    expect(env.session.dialog).toBeNull();
    s = stepFrame(env.project, env.session, s, { ...IDLE, held: "down", tapped: "down" }, 16);
    expect(s.player.moving).not.toBeNull();
  });

  it("the action that closes a dialog does not also interact again", () => {
    const env = start(makeProject({ objects: npcMap(), dialogs: [makeDialog("d", "a", [say("a", null)])] }), { facing: "right" });
    let s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    s = stepFrame(env.project, env.session, s, { ...IDLE, action: true }, 16);
    expect(env.session.dialog).toBeNull();
  });

  it("menu moves the selection of a choice", () => {
    const d = makeDialog("d", "c", [
      { id: "c", type: "choice", options: [{ text: "x", next: null }, { text: "y", next: null }] },
    ]);
    const env = start(makeProject({ objects: npcMap(), dialogs: [d] }), { facing: "right" });
    let s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    s = stepFrame(env.project, env.session, s, { ...IDLE, menu: 1 }, 16);
    expect(env.session.dialog).toMatchObject({ kind: "choice", selected: 1 });
    stepFrame(env.project, env.session, s, { ...IDLE, menu: -1 }, 16);
    expect(env.session.dialog).toMatchObject({ selected: 0 });
  });

  it("an error is shown until action dismisses it; walking is frozen meanwhile", () => {
    const env = start(makeProject({}));
    env.session.error = "boom";
    let s = stepFrame(env.project, env.session, env.state, { ...IDLE, held: "down", tapped: "down" }, TILE_MOVE_MS);
    expect(s.player.y).toBe(0);
    expect(env.session.error).toBe("boom");
    s = stepFrame(env.project, env.session, s, { ...IDLE, action: true }, 16);
    expect(env.session.error).toBeNull();
    expect(s.player.moving).toBeNull();
  });
});

describe("stepFrame: touch", () => {
  it("fires on arrival by walking, not at the start cell", () => {
    const env = start(
      makeProject({ variables: [num], objects: [spawn, ev("t", 0, 1, { trigger: "touch", actions: [inc] }), ev("u", 0, 0, { trigger: "touch", actions: [inc] })] }),
    );
    // Walking down: the walk starts on (0,0) without firing "u"; arrives on (0,1).
    const s = walk(env, { ...IDLE, held: null, tapped: "down" });
    expect(s.player).toMatchObject({ x: 0, y: 1 });
    expect(env.session.vars["n"]).toBe(1);
  });

  it("does not fire mid-step", () => {
    const env = start(makeProject({ variables: [num], objects: [spawn, ev("t", 0, 1, { trigger: "touch", actions: [inc] })] }));
    stepFrame(env.project, env.session, env.state, { ...IDLE, tapped: "down" }, TILE_MOVE_MS / 2);
    expect(env.session.vars["n"]).toBe(0);
  });

  it("fires on each arrival while walking continuously", () => {
    const env = start(
      makeProject({ variables: [num], objects: [spawn, ev("a", 0, 1, { trigger: "touch", actions: [inc] }), ev("b", 0, 2, { trigger: "touch", actions: [inc] })] }),
    );
    const down = { ...IDLE, held: "down", tapped: "down" } as const;
    let s = env.state;
    // Two tiles in one huge step: both arrivals are one position change, so only the last cell is seen.
    s = stepFrame(env.project, env.session, s, down, TILE_MOVE_MS);
    s = stepFrame(env.project, env.session, s, { ...down, tapped: null }, TILE_MOVE_MS);
    expect(s.player.y).toBe(2);
    expect(env.session.vars["n"]).toBe(2);
  });

  it("a touch event starts a dialog", () => {
    const d = makeDialog("d", "a", [say("a", null)]);
    const env = start(makeProject({ dialogs: [d], objects: [spawn, ev("t", 0, 1, { trigger: "touch", actions: [{ type: "dialog", dialog: "d" }] })] }));
    walk(env, { ...IDLE, tapped: "down" });
    expect(env.session.dialog).toMatchObject({ kind: "say" });
  });
});

describe("stepFrame: teleport", () => {
  const tele = (x: number, y: number, map = "other") => ({ type: "teleport", map, x, y });

  it("an interact teleport switches map, world and player cell", () => {
    const env = start(
      twoMaps([spawn, ev("e", 0, 1, { trigger: "interact", actions: [tele(3, 2)] })], []),
      { facing: "down" },
    );
    const s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    expect(s.mapChanged).toBe(true);
    expect(env.session.mapId).toBe("other");
    expect(env.session.teleport).toBeNull();
    expect(s.world.spawn).toEqual({ x: 3, y: 2 });
    expect(s.player).toMatchObject({ x: 3, y: 2, moving: null, queued: null });
  });

  it("a touch teleport switches map on arrival; the target map needs no spawn", () => {
    const env = start(twoMaps([spawn, ev("e", 0, 1, { trigger: "touch", actions: [tele(1, 1)] })], []));
    const s = walk(env, { ...IDLE, tapped: "down" });
    expect(env.session.mapId).toBe("other");
    expect(s.player).toMatchObject({ x: 1, y: 1 });
    expect(s.mapChanged).toBe(true);
  });

  it("arrival by teleport does not fire a touch event on the destination cell", () => {
    const env = start(
      twoMaps(
        [spawn, ev("e", 0, 1, { trigger: "touch", actions: [tele(2, 2)] })],
        [ev("back", 2, 2, { trigger: "touch", actions: [tele(0, 0, "main"), inc] })],
        { variables: [num] },
      ),
    );
    const s = walk(env, { ...IDLE, tapped: "down" });
    expect(env.session.mapId).toBe("other");
    expect(s.player).toMatchObject({ x: 2, y: 2 });
    expect(env.session.vars["n"]).toBe(0);
    // Another frame standing there still does nothing.
    const s2 = stepFrame(env.project, env.session, s, IDLE, 16);
    expect(env.session.mapId).toBe("other");
    expect(s2.mapChanged).toBe(false);
  });

  it("walking onto that cell later does fire it", () => {
    const env = start(
      twoMaps(
        [spawn, ev("e", 0, 1, { trigger: "touch", actions: [tele(2, 1)] })],
        [ev("hit", 2, 2, { trigger: "touch", actions: [inc] })],
        { variables: [num] },
      ),
    );
    let s = walk(env, { ...IDLE, tapped: "down" });
    expect(env.session.mapId).toBe("other");
    s = walk({ ...env, state: s }, { ...IDLE, tapped: "down" });
    expect(s.player).toMatchObject({ x: 2, y: 2 });
    expect(env.session.vars["n"]).toBe(1);
  });

  it("once state is kept across teleports within a session", () => {
    const env = start(
      twoMaps(
        [spawn, ev("o", 0, 1, { trigger: "touch", once: true, actions: [inc] }), ev("go", 1, 0, { trigger: "touch", actions: [tele(0, 0)] })],
        [ev("home", 0, 1, { trigger: "touch", actions: [tele(0, 0, "main")] })],
        { variables: [num] },
      ),
    );
    let s = walk(env, { ...IDLE, tapped: "down" }); // fires "o" once
    expect(env.session.vars["n"]).toBe(1);
    // Back up, over to (1,0): teleport to other, and come back to main via interact-free path.
    s = walk({ ...env, state: s }, { ...IDLE, tapped: "up" });
    s = walk({ ...env, state: s }, { ...IDLE, tapped: "right" });
    expect(env.session.mapId).toBe("other");
    s = walk({ ...env, state: s }, { ...IDLE, tapped: "down" }); // touch "home" -> main (0,0)
    expect(env.session.mapId).toBe("main");
    s = walk({ ...env, state: s }, { ...IDLE, tapped: "down" }); // onto "o" again
    expect(s.player).toMatchObject({ x: 0, y: 1 });
    expect(env.session.vars["n"]).toBe(1);
  });

  it.each([
    ["an unknown map", tele(0, 0, "nope"), /nope/],
    ["a cell outside the map", tele(9, 9), /outside|cell/i],
    ["a solid cell", tele(2, 2), /solid|blocked|cell/i],
  ])("%s shows an error and keeps the old map", (_n, action, msg) => {
    const env = start(
      twoMaps([spawn, ev("e", 0, 1, { trigger: "interact", actions: [action] })], [], { layers: [{ 12: 9 }, {}] }),
      { facing: "down" },
    );
    const s = stepFrame(env.project, env.session, env.state, { ...IDLE, action: true }, 16);
    expect(s.mapChanged).toBe(false);
    expect(s.world).toBe(env.state.world);
    expect(s.player).toMatchObject({ x: 0, y: 0 });
    expect(env.session.mapId).toBe("main");
    expect(env.session.teleport).toBeNull();
    expect(env.session.error).toMatch(msg);
  });
});
