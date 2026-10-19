import { describe, expect, it } from "vitest";
import type { MapObject } from "@nestst/core";
import { createObjectsView } from "./objectsView.js";

const spawn: MapObject = { id: "s", kind: "spawn", x: 1, y: 1, props: {} };
const npc: MapObject = { id: "n", kind: "npc", x: 2, y: 3, props: { name: "Ann" } };

describe("createObjectsView", () => {
  it("creates one child per object", () => {
    const view = createObjectsView(16);
    view.setObjects([spawn, npc]);
    expect(view.container.children).toHaveLength(2);
    view.destroy();
  });

  it("draws an event as its own shape with a name, one child per object", () => {
    const view = createObjectsView(16);
    const event: MapObject = { id: "e", kind: "event", x: 4, y: 4, props: { name: "Door" } };
    view.setObjects([npc, event]);
    expect(view.container.children).toHaveLength(2);
    const [n, e] = view.container.children as Array<{ label: string; children: unknown[] }>;
    expect(e!.label).toBe("event:e");
    expect(e!.children).toHaveLength(n!.children.length);
    view.destroy();
  });

  it("does not recreate children for an identical list", () => {
    const view = createObjectsView(16);
    view.setObjects([spawn, npc]);
    const before = [...view.container.children];
    view.setObjects([{ ...spawn }, { ...npc, props: { name: "Ann" } }]);
    view.setObjects([spawn, npc]);
    expect(view.container.children).toEqual(before);
    expect(view.container.children.every((c, i) => c === before[i])).toBe(true);
    view.destroy();
  });

  it("redraws when the list changes", () => {
    const view = createObjectsView(16);
    view.setObjects([spawn, npc]);
    const before = [...view.container.children];
    view.setObjects([npc]);
    expect(view.container.children).toHaveLength(1);
    expect(before.every((c) => c.destroyed)).toBe(true);
    view.destroy();
  });

  it("destroy is safe to call twice", () => {
    const view = createObjectsView(16);
    view.setObjects([spawn, npc]);
    view.destroy();
    expect(() => view.destroy()).not.toThrow();
    expect(() => view.setObjects([npc])).not.toThrow();
  });
});
