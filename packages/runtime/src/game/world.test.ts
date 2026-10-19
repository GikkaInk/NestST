import { describe, expect, it } from "vitest";
import { NestError } from "@nestst/core";
import { makeProject } from "./testProject.js";
import { canEnter, createWorld } from "./world.js";

describe("createWorld", () => {
  it("reads size, spawn, solid tiles and NPCs", () => {
    const w = createWorld(
      makeProject({
        objects: [
          { id: "s", kind: "spawn", x: 2, y: 3, props: {} },
          { id: "n1", kind: "npc", x: 1, y: 1, props: { name: "Ann" } },
          { id: "n2", kind: "npc", x: 4, y: 4, props: {} },
        ],
      }),
      "main",
    );
    expect(w).toMatchObject({ width: 5, height: 5, tileSize: 16, spawn: { x: 2, y: 3 } });
    expect(w.solid.has(9)).toBe(true);
    expect(w.layers).toHaveLength(2);
    expect(w.npcs).toEqual([
      { id: "n1", x: 1, y: 1, name: "Ann" },
      { id: "n2", x: 4, y: 4, name: "n2" },
    ]);
  });

  it("throws no_spawn when the map has no spawn", () => {
    const p = makeProject({ objects: [{ id: "n", kind: "npc", x: 1, y: 1, props: {} }] });
    try {
      createWorld(p, "main");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NestError);
      expect((e as NestError).code).toBe("no_spawn");
    }
  });

  it("throws no_map for an unknown map id", () => {
    expect(() => createWorld(makeProject({}), "nope")).toThrow(NestError);
  });
});

describe("canEnter", () => {
  const w = createWorld(
    makeProject({
      layers: [{}, { 7: 9 }],
      objects: [
        { id: "s", kind: "spawn", x: 0, y: 0, props: {} },
        { id: "n", kind: "npc", x: 3, y: 3, props: {} },
      ],
    }),
    "main",
  );
  it("allows a free cell", () => expect(canEnter(w, 1, 1)).toBe(true));
  it("blocks a solid tile in the second layer", () => expect(canEnter(w, 2, 1)).toBe(false));
  it("blocks cells outside the map", () => {
    expect(canEnter(w, -1, 0)).toBe(false);
    expect(canEnter(w, 0, -1)).toBe(false);
    expect(canEnter(w, 5, 0)).toBe(false);
    expect(canEnter(w, 0, 5)).toBe(false);
  });
  it("blocks an NPC cell", () => expect(canEnter(w, 3, 3)).toBe(false));
});
