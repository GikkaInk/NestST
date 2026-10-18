import { describe, expect, it } from "vitest";
import { History, createEmptyProject, paintCommand } from "./index.js";
import type { Command, Project } from "./index.js";

function project(): Project {
  return createEmptyProject("История");
}

function paint(p: Project, x: number, tile: number): Command {
  return paintCommand("main", [{ layerId: "ground", x, y: 0, tile }], p.maps.main!);
}

function tileAt(p: Project, x: number): number {
  return p.maps.main!.layers[0]!.tiles[x]!;
}

describe("History", () => {
  it("undo and redo on an empty history return the project unchanged", () => {
    const h = new History();
    const p = project();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(0);
    expect(h.undo(p)).toBe(p);
    expect(h.redo(p)).toBe(p);
  });

  it("push applies the command; undo and redo round-trip", () => {
    const h = new History();
    const p0 = project();
    const p1 = h.push(paint(p0, 2, 7), p0);
    expect(tileAt(p1, 2)).toBe(7);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    const back = h.undo(p1);
    expect(back.maps.main).toEqual(p0.maps.main);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    const again = h.redo(back);
    expect(again.maps.main).toEqual(p1.maps.main);
    expect(h.canRedo).toBe(false);
  });

  it("a push after undo clears redo", () => {
    const h = new History();
    const p0 = project();
    const p1 = h.push(paint(p0, 0, 1), p0);
    const p2 = h.push(paint(p1, 1, 2), p1);
    const u = h.undo(p2);
    expect(h.canRedo).toBe(true);
    const p3 = h.push(paint(u, 3, 3), u);
    expect(h.canRedo).toBe(false);
    expect(h.redo(p3)).toBe(p3);
    expect(tileAt(p3, 1)).toBe(0);
    expect(tileAt(p3, 3)).toBe(3);
  });

  it("drops the oldest step past the default limit of 200 without error", () => {
    const h = new History();
    const p0 = project();
    let p = p0;
    for (let i = 1; i <= 201; i++) p = h.push(paint(p, i % 32, (i % 255) + 1), p);
    expect(h.size).toBe(200);
    let undos = 0;
    while (h.canUndo) {
      p = h.undo(p);
      undos++;
    }
    expect(undos).toBe(200);
    // The very first step (x = 1, tile 2) was evicted, so it stays applied.
    expect(tileAt(p, 1)).toBe(2);
    expect(tileAt(p, 2)).toBe(0);
  });

  it("respects a custom limit", () => {
    const h = new History(2);
    let p = project();
    for (let i = 0; i < 5; i++) p = h.push(paint(p, i, 9), p);
    expect(h.size).toBe(2);
  });

  it("rejects an invalid limit", () => {
    expect(() => new History(0)).toThrow(expect.objectContaining({ code: "invalid_history_limit" }));
    expect(() => new History(1.5)).toThrow(expect.objectContaining({ code: "invalid_history_limit" }));
  });

  it("clear empties both stacks", () => {
    const h = new History();
    const p0 = project();
    const p1 = h.push(paint(p0, 0, 1), p0);
    h.push(paint(p1, 1, 1), p1);
    h.undo(p1);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("a failing command is not recorded", () => {
    const h = new History();
    const p0 = project();
    const broken: Command = {
      label: "Broken",
      apply: () => {
        throw new Error("boom");
      },
      revert: (p) => p,
    };
    expect(() => h.push(broken, p0)).toThrow("boom");
    expect(h.canUndo).toBe(false);
  });
});
