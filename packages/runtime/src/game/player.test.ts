import { describe, expect, it } from "vitest";
import type { Dir } from "./player.js";
import { TILE_MOVE_MS, createPlayer, stepPlayer } from "./player.js";
import type { InputFrame, PlayerState } from "./player.js";
import { createWorld } from "./world.js";
import { makeProject } from "./testProject.js";

const none: InputFrame = { held: null, tapped: null };
const held = (d: Dir): InputFrame => ({ held: d, tapped: null });
const tap = (d: Dir): InputFrame => ({ held: null, tapped: d });

function world(extra: Parameters<typeof makeProject>[0] = {}) {
  return createWorld(
    makeProject({
      objects: [{ id: "s", kind: "spawn", x: 1, y: 1, props: {} }],
      ...extra,
    }),
    "main",
  );
}

describe("stepPlayer", () => {
  it("starts on the spawn cell, at rest", () => {
    expect(createPlayer(world())).toEqual({ x: 1, y: 1, facing: "down", moving: null, queued: null });
  });

  it("a step right takes exactly 250 ms", () => {
    const w = world();
    let s = stepPlayer(w, createPlayer(w), held("right"), 249);
    expect(s.moving).not.toBeNull();
    expect(s.x).toBe(1);
    s = stepPlayer(w, s, none, 1);
    expect(s.moving).toBeNull();
    expect(s.x).toBe(2);
    expect(TILE_MOVE_MS).toBe(250);
  });

  it("a tap starts a step and turns the player", () => {
    const w = world();
    const s = stepPlayer(w, createPlayer(w), tap("left"), 0);
    expect(s.facing).toBe("left");
    expect(s.moving).toMatchObject({ fromX: 1, toX: 0, t: 0 });
  });

  it("turns without moving when blocked by a wall", () => {
    const w = world({ layers: [{}, { 7: 9 }] }); // cell (2,1)
    const s = stepPlayer(w, createPlayer(w), held("right"), 1000);
    expect(s).toMatchObject({ x: 1, y: 1, facing: "right", moving: null });
  });

  it("turns without moving when blocked by an NPC", () => {
    const w = world({
      objects: [
        { id: "s", kind: "spawn", x: 1, y: 1, props: {} },
        { id: "n", kind: "npc", x: 1, y: 2, props: {} },
      ],
    });
    const s = stepPlayer(w, createPlayer(w), held("down"), 1000);
    expect(s).toMatchObject({ x: 1, y: 1, moving: null });
    const t = stepPlayer(w, { ...s, facing: "up" }, tap("down"), 10);
    expect(t.facing).toBe("down");
    expect(t.y).toBe(1);
  });

  it("pushing outwards at a corner never moves the player off the map", () => {
    const w = world({ objects: [{ id: "s", kind: "spawn", x: 0, y: 0, props: {} }] });
    const start = createPlayer(w);
    for (const [dir, facing] of [["up", "up"], ["left", "left"]] as const) {
      const s = stepPlayer(w, start, held(dir), 5000);
      expect(s).toMatchObject({ x: 0, y: 0, facing, moving: null });
    }
    const far = world({ objects: [{ id: "s", kind: "spawn", x: 4, y: 4, props: {} }] });
    for (const dir of ["down", "right"] as const) {
      const s = stepPlayer(far, createPlayer(far), held(dir), 5000);
      expect(s).toMatchObject({ x: 4, y: 4, facing: dir, moving: null });
    }
  });

  it("a held key walks continuously, carrying leftover time across cells", () => {
    const w = world({ width: 10, objects: [{ id: "s", kind: "spawn", x: 0, y: 1, props: {} }] });
    let s: PlayerState = createPlayer(w);
    s = stepPlayer(w, s, held("right"), 200);
    s = stepPlayer(w, s, held("right"), 100); // 300 ms total: one cell + 50 ms
    expect(s.x).toBe(1);
    expect(s.moving).toMatchObject({ toX: 2 });
    expect(s.moving!.t).toBeCloseTo(0.2);
    s = stepPlayer(w, s, held("right"), 450); // 750 ms total: three cells
    expect(s.x).toBe(3);
    expect(s.moving).toMatchObject({ toX: 4 });
  });

  it("one long frame crosses several cells while held", () => {
    const w = world({ width: 10, objects: [{ id: "s", kind: "spawn", x: 0, y: 1, props: {} }] });
    const s = stepPlayer(w, createPlayer(w), held("right"), 3 * TILE_MOVE_MS);
    expect(s.x).toBe(3);
    expect(s.moving).toMatchObject({ fromX: 3, toX: 4, t: 0 }); // still held: next step begins
  });

  it("a tap during a step gives exactly one more step after arrival", () => {
    const w = world({ width: 10, objects: [{ id: "s", kind: "spawn", x: 0, y: 1, props: {} }] });
    let s = stepPlayer(w, createPlayer(w), held("right"), 100);
    s = stepPlayer(w, s, tap("down"), 50);
    expect(s.queued).toBe("down");
    s = stepPlayer(w, s, none, 100); // arrives at x=1, starts going down with 0 left
    expect(s).toMatchObject({ x: 1, y: 1, queued: null });
    expect(s.moving).toMatchObject({ toX: 1, toY: 2 });
    s = stepPlayer(w, s, none, TILE_MOVE_MS);
    expect(s).toMatchObject({ x: 1, y: 2, moving: null });
    s = stepPlayer(w, s, none, 1000);
    expect(s).toMatchObject({ x: 1, y: 2, moving: null });
  });

  it("the last queued tap wins", () => {
    const w = world();
    let s = stepPlayer(w, createPlayer(w), tap("right"), 10);
    s = stepPlayer(w, s, tap("up"), 10);
    s = stepPlayer(w, s, tap("down"), 10);
    expect(s.queued).toBe("down");
  });

  it("held beats a queued tap on arrival", () => {
    const w = world({ width: 10 });
    let s = stepPlayer(w, createPlayer(w), tap("right"), 10);
    s = stepPlayer(w, s, tap("up"), 10);
    s = stepPlayer(w, s, held("right"), 300);
    expect(s.queued).toBeNull();
    expect(s.moving).toMatchObject({ toX: 3 });
  });

  it("never moves diagonally and positions stay integral at rest", () => {
    const w = world({ width: 10, height: 10 });
    let s = createPlayer(w);
    const seq: InputFrame[] = [held("right"), tap("up"), held("down"), tap("left"), none, held("up")];
    for (let i = 0; i < 40; i++) {
      s = stepPlayer(w, s, seq[i % seq.length]!, 37);
      if (s.moving) {
        const { fromX, fromY, toX, toY } = s.moving;
        expect(Math.abs(toX - fromX) + Math.abs(toY - fromY)).toBe(1);
      } else {
        expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
      }
    }
  });

  it("does not mutate the previous state", () => {
    const w = world();
    const s0 = createPlayer(w);
    const copy = structuredClone(s0);
    stepPlayer(w, s0, held("right"), 100);
    expect(s0).toEqual(copy);
  });
});
