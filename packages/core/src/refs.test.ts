import { describe, expect, it } from "vitest";
import type { Dialog } from "./dialogSchema.js";
import { createEmptyProject } from "./project.js";
import type { Project } from "./project.js";
import { findReferences, validateProjectRefs } from "./refs.js";
import { placeObjectCommand } from "./objectOps.js";
import type { MapObject } from "./schema.js";

const dialog = (id: string, nodes: Dialog["nodes"] = []): Dialog => ({
  schemaVersion: 1,
  id,
  name: id,
  start: nodes[0]?.id ?? null,
  nodes,
});

function base(): Project {
  const p = createEmptyProject("T");
  p.manifest.variables = [
    { id: "key", name: "Key", type: "flag", initial: false },
    { id: "gold", name: "Gold", type: "number", initial: 0 },
  ];
  p.manifest.dialogs = [{ id: "intro", file: "dialogs/intro.json" }];
  p.dialogs = {
    intro: dialog("intro", [
      { id: "n1", x: 0, y: 0, type: "branch", condition: { variable: "key", op: "==", value: true }, then: null, else: null },
    ]),
  };
  return p;
}

const withObj = (p: Project, o: MapObject): Project => {
  p.maps.main!.objects.push(o);
  return p;
};
const event = (props: Record<string, unknown>): MapObject => ({
  id: "ev-1",
  kind: "event",
  x: 1,
  y: 1,
  props: { name: "Door", trigger: "touch", once: false, actions: [{ type: "dialog", dialog: "intro" }], ...props },
});
const npc = (props: Record<string, unknown>): MapObject => ({ id: "npc-1", kind: "npc", x: 2, y: 2, props });

function msg(p: Project): string {
  try {
    validateProjectRefs(p);
  } catch (e) {
    expect((e as { code: string }).code).toBe("invalid_project");
    return (e as Error).message;
  }
  return "";
}

describe("validateProjectRefs", () => {
  it("passes a project without references and one with valid ones", () => {
    expect(msg(createEmptyProject("T"))).toBe("");
    const p = withObj(base(), event({
      condition: { variable: "gold", op: ">=", value: 3 },
      actions: [
        { type: "dialog", dialog: "intro" },
        { type: "set", variable: "gold", op: "add", value: 1 },
        { type: "teleport", map: "main", x: 31, y: 23 },
      ],
    }));
    withObj(p, npc({ name: "Guide", dialog: "intro" }));
    expect(msg(p)).toBe("");
  });
  it("accepts an NPC with only a name", () => {
    expect(msg(withObj(base(), npc({ name: "NPC 1" })))).toBe("");
  });
  it("rejects an NPC with a missing dialog", () => {
    expect(msg(withObj(base(), npc({ name: "Guide", dialog: "gone" })))).toMatch(/npc "npc-1".*dialog "gone" does not exist/);
  });
  it("rejects an event with a missing dialog", () => {
    expect(msg(withObj(base(), event({ actions: [{ type: "dialog", dialog: "gone" }] })))).toMatch(/dialog "gone"/);
  });
  it("rejects an unknown variable in an event condition", () => {
    expect(msg(withObj(base(), event({ condition: { variable: "nope", op: "==", value: true } })))).toMatch(/variable "nope" does not exist/);
  });
  it("rejects a condition whose value does not fit the variable type", () => {
    expect(msg(withObj(base(), event({ condition: { variable: "gold", op: "==", value: true } })))).toMatch(/"gold" is a number/);
  });
  it("rejects set actions of the wrong type and add on a flag", () => {
    expect(msg(withObj(base(), event({ actions: [{ type: "set", variable: "key", op: "add", value: 1 }] })))).toMatch(/"key" is a flag/);
    expect(msg(withObj(base(), event({ actions: [{ type: "set", variable: "key", op: "set", value: 1 }] })))).toMatch(/"key" is a flag/);
  });
  it("rejects teleport to a missing map and outside the map", () => {
    expect(msg(withObj(base(), event({ actions: [{ type: "teleport", map: "nowhere", x: 0, y: 0 }] })))).toMatch(/map "nowhere"/);
    expect(msg(withObj(base(), event({ actions: [{ type: "teleport", map: "main", x: 32, y: 0 }] })))).toMatch(/outside map "main"/);
  });
  it("rejects bad props of an event", () => {
    expect(msg(withObj(base(), event({ actions: [] })))).toMatch(/event "ev-1"/);
  });
  it("rejects a dialog node using an unknown variable", () => {
    const p = base();
    p.dialogs.intro!.nodes[0] = { id: "n1", x: 0, y: 0, type: "set", variable: "zzz", op: "set", value: true, next: null };
    expect(msg(p)).toMatch(/dialog "intro", node "n1".*"zzz"/);
  });
  it("handles a large project quickly", () => {
    const p = base();
    for (let i = 0; i < 5000; i++) p.maps.main!.objects.push({ ...event({}), id: `ev-${i}` });
    const t = Date.now();
    expect(msg(p)).toBe("");
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("findReferences", () => {
  it("finds references from dialogs, NPCs, events and actions", () => {
    const p = base();
    withObj(p, npc({ name: "Guide", dialog: "intro" }));
    withObj(p, event({
      condition: { variable: "key", op: "==", value: true },
      actions: [{ type: "dialog", dialog: "intro" }, { type: "teleport", map: "main", x: 0, y: 0 }],
    }));
    expect(findReferences(p, { kind: "variable", id: "key" })).toEqual(['dialog "intro", node n1', 'event "Door" on map "main"']);
    expect(findReferences(p, { kind: "dialog", id: "intro" })).toEqual(['npc "Guide" on map "main"', 'event "Door" on map "main"']);
    expect(findReferences(p, { kind: "map", id: "main" })).toEqual(['event "Door" on map "main"']);
    expect(findReferences(p, { kind: "variable", id: "gold" })).toEqual([]);
  });
});

describe("placeObjectCommand with events", () => {
  it("places a valid event and refuses dangling references or bad props", () => {
    const p = base();
    const cmd = placeObjectCommand("main", event({}), p);
    expect(cmd.apply(p).maps.main!.objects).toHaveLength(1);
    expect(() => placeObjectCommand("main", event({ actions: [{ type: "dialog", dialog: "gone" }] }), p)).toThrow(/gone/);
    expect(() => placeObjectCommand("main", event({ actions: [] }), p)).toThrow(/event/);
    expect(() => placeObjectCommand("main", npc({}), p)).toThrow(/NPC/);
  });
});
