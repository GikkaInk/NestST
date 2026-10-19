import { describe, expect, it } from "vitest";
import {
  NestError,
  createEmptyProject,
  removeDialogCommand,
  removeMapGuard,
  setObjectPropsCommand,
  setVariablesCommand,
  upsertDialogCommand,
  validateProjectRefs,
} from "./index.js";
import type { Dialog, MapObject, Project, VariableDef } from "./index.js";

const gold: VariableDef = { id: "gold", name: "Gold", type: "number", initial: 0 };
const met: VariableDef = { id: "met", name: "Met", type: "flag", initial: false };

const dlg = (id: string, nodes: Dialog["nodes"] = [{ id: "a", x: 0, y: 0, type: "say", speaker: "N", text: "Hi", next: null }]): Dialog => ({
  schemaVersion: 1,
  id,
  name: id,
  start: nodes.length > 0 ? nodes[0]!.id : null,
  nodes,
});
const setGold: Dialog["nodes"] = [
  { id: "a", x: 0, y: 0, type: "set", variable: "gold", op: "add", value: 1, next: null },
];

const npcObj = (props: Record<string, unknown>): MapObject => ({ id: "npc-1", kind: "npc", x: 1, y: 1, props });
const eventObj = (actions: unknown[]): MapObject => ({
  id: "ev-1",
  kind: "event",
  x: 2,
  y: 2,
  props: { name: "E", trigger: "touch", once: false, actions },
});

/** Maps "main" (start) and "cave"; variables gold+met; dialogs hello, bye. */
function makeProject(): Project {
  const p = createEmptyProject("G");
  const main = p.maps[p.manifest.startMapId]!;
  const cave = { ...main, id: "cave", name: "Cave", objects: [] };
  return {
    ...p,
    manifest: {
      ...p.manifest,
      variables: [gold, met],
      dialogs: [
        { id: "hello", file: "dialogs/hello.json" },
        { id: "bye", file: "dialogs/bye.json" },
      ],
      maps: [...p.manifest.maps, { id: "cave", file: "maps/cave.json" }],
    },
    maps: { ...p.maps, cave },
    dialogs: { hello: dlg("hello"), bye: dlg("bye") },
  };
}

function withObject(p: Project, mapId: string, obj: MapObject): Project {
  const map = p.maps[mapId]!;
  return { ...p, maps: { ...p.maps, [mapId]: { ...map, objects: [...map.objects, obj] } } };
}

function refused(fn: () => unknown): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    expect((e as NestError).code).toBe("invalid_edit");
    return e as NestError;
  }
  throw new Error("expected invalid_edit");
}

describe("setVariablesCommand", () => {
  it("replaces the list, undo/redo", () => {
    const p = makeProject();
    const next: VariableDef[] = [gold, { id: "hp", name: "HP", type: "number", initial: 5 }];
    const cmd = setVariablesCommand(next, p);
    expect(cmd.label).toBe("Edit variables");
    const a = cmd.apply(p);
    expect(a.manifest.variables).toEqual(next);
    expect(a.maps).toBe(p.maps);
    expect(a.dialogs).toBe(p.dialogs);
    expect(cmd.revert(a).manifest.variables).toEqual([gold, met]);
    expect(cmd.apply(cmd.revert(a)).manifest.variables).toEqual(next);
  });

  it("refuses to remove a used variable, listing users; project unchanged", () => {
    let p = makeProject();
    p = { ...p, dialogs: { ...p.dialogs, shop: dlg("shop", setGold) } };
    p = withObject(p, "main", eventObj([{ type: "set", variable: "gold", op: "set", value: 3 }]));
    const snapshot = structuredClone(p);
    const err = refused(() => setVariablesCommand([met], p));
    expect(err.message).toContain('dialog "shop", node "a"');
    expect(err.message).toContain('event "E" on map "main"');
    expect(p).toEqual(snapshot);
  });

  it("refuses to retype a used variable but allows an unused one", () => {
    const p = withObject(makeProject(), "main", eventObj([{ type: "set", variable: "gold", op: "set", value: 3 }]));
    refused(() => setVariablesCommand([{ ...gold, type: "flag", initial: true }, met], p));
    const ok = setVariablesCommand([gold, { ...met, type: "number", initial: 1 }], p);
    expect(ok.apply(p).manifest.variables[1]!.type).toBe("number");
  });

  it("allows removing an unused variable", () => {
    const p = makeProject();
    expect(setVariablesCommand([gold], p).apply(p).manifest.variables).toEqual([gold]);
  });

  it("validates the new list: duplicate ids, initial type, limit", () => {
    const p = makeProject();
    refused(() => setVariablesCommand([gold, { ...gold, name: "Again" }], p));
    refused(() => setVariablesCommand([{ ...gold, initial: true }], p));
    refused(() => setVariablesCommand([{ ...gold, id: "Bad Id" }], p));
    const many = Array.from({ length: 201 }, (_, i) => ({ ...gold, id: `v${i}` }));
    refused(() => setVariablesCommand(many, p));
  });

  it("revert works on a project modified in between", () => {
    const p = makeProject();
    const cmd = setVariablesCommand([gold], p);
    const a = cmd.apply(p);
    const changed = { ...a, manifest: { ...a.manifest, name: "Renamed" } };
    const r = cmd.revert(changed);
    expect(r.manifest.name).toBe("Renamed");
    expect(r.manifest.variables).toEqual([gold, met]);
  });
});

describe("setVariablesCommand edge cases", () => {
  const used = () => withObject(makeProject(), "main", eventObj([{ type: "set", variable: "gold", op: "set", value: 3 }]));

  it("allows changing only the initial value or the order of a used variable", () => {
    const p = used();
    expect(setVariablesCommand([{ ...gold, initial: 5 }, met], p).apply(p).manifest.variables[0]!.initial).toBe(5);
    expect(setVariablesCommand([met, gold], p).apply(p).manifest.variables.map((v) => v.id)).toEqual(["met", "gold"]);
  });

  it("refuses an id rename of a used variable with a hint", () => {
    const err = refused(() => setVariablesCommand([{ ...gold, id: "coins" }, met], used()));
    expect(err.message).toContain("rename is not supported: create a new variable and update the references");
  });

  it("guards against the CURRENT project: a dialog that starts using a variable blocks its removal", () => {
    const p = makeProject();
    expect(() => setVariablesCommand([met], p)).not.toThrow();
    const current = upsertDialogCommand(dlg("shop", setGold), p).apply(p);
    expect(refused(() => setVariablesCommand([met], current)).message).toContain('dialog "shop"');
  });

  it("revert keeps an unrelated change made in between", () => {
    const p = makeProject();
    const cmd = setVariablesCommand([gold], p);
    const a = withObject(cmd.apply(p), "main", npcObj({ name: "Ann" }));
    const r = cmd.revert(a);
    expect(r.manifest.variables).toEqual([gold, met]);
    expect(r.maps.main!.objects).toHaveLength(1);
  });
});

describe("upsertDialogCommand", () => {
  it("refuses a new dialog past MAX_DIALOGS", () => {
    const p = makeProject();
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, file: `dialogs/d${i}.json` }));
    const full = { ...p, manifest: { ...p.manifest, dialogs: entries } };
    refused(() => upsertDialogCommand(dlg("one-more"), full));
  });

  it("adds a dialog: appends the manifest entry, undo removes both", () => {
    const p = makeProject();
    const cmd = upsertDialogCommand(dlg("new"), p);
    expect(cmd.label).toBe("Add dialog");
    const a = cmd.apply(p);
    expect(a.dialogs.new).toBeDefined();
    expect(a.manifest.dialogs.at(-1)).toEqual({ id: "new", file: "dialogs/new.json" });
    expect(a.maps).toBe(p.maps);
    const r = cmd.revert(a);
    expect(r.dialogs).toEqual(p.dialogs);
    expect(r.manifest.dialogs).toEqual(p.manifest.dialogs);
    expect(cmd.apply(r).dialogs.new).toBeDefined();
  });

  it("replaces a dialog keeping the entry position; undo restores the old one", () => {
    const p = makeProject();
    const edited = dlg("hello", setGold);
    const cmd = upsertDialogCommand(edited, p);
    expect(cmd.label).toBe("Edit dialog");
    const a = cmd.apply(p);
    expect(a.dialogs.hello).toEqual(edited);
    expect(a.manifest.dialogs).toBe(p.manifest.dialogs);
    expect(a.dialogs.bye).toBe(p.dialogs.bye);
    const r = cmd.revert(a);
    expect(r.dialogs.hello).toBe(p.dialogs.hello);
    expect(r.manifest.dialogs.map((d) => d.id)).toEqual(["hello", "bye"]);
  });

  it("keeps map identity (structural sharing)", () => {
    const p = makeProject();
    const a = upsertDialogCommand(dlg("hello", setGold), p).apply(p);
    expect(a.maps).toBe(p.maps);
    expect(a.maps.main).toBe(p.maps.main);
  });

  it("refuses an invalid dialog and unknown or mistyped variables", () => {
    const p = makeProject();
    refused(() => upsertDialogCommand({ ...dlg("x"), start: "zz" }, p));
    refused(() =>
      upsertDialogCommand(
        dlg("x", [{ id: "a", x: 0, y: 0, type: "set", variable: "nope", op: "set", value: 1, next: null }]),
        p,
      ),
    );
    refused(() =>
      upsertDialogCommand(
        dlg("x", [{ id: "a", x: 0, y: 0, type: "set", variable: "met", op: "set", value: 1, next: null }]),
        p,
      ),
    );
  });

  it("ignores unrelated problems elsewhere in the project", () => {
    const p = withObject(makeProject(), "main", npcObj({ name: "N", dialog: "ghost" }));
    expect(() => upsertDialogCommand(dlg("fine"), p)).not.toThrow();
  });

  it("revert of a replace re-adds a manifest entry lost in between, at the old index", () => {
    const p = makeProject();
    const cmd = upsertDialogCommand(dlg("bye", setGold), p);
    const a = cmd.apply(p);
    const changed = { ...a, manifest: { ...a.manifest, dialogs: a.manifest.dialogs.filter((d) => d.id !== "bye") } };
    const r = cmd.revert(changed);
    expect(r.manifest.dialogs.map((d) => d.id)).toEqual(["hello", "bye"]);
    expect(r.dialogs.bye).toBe(p.dialogs.bye);
  });
});

describe("removeDialogCommand", () => {
  it("removes and restores dialog and entry at the same place", () => {
    const p = makeProject();
    const cmd = removeDialogCommand("hello", p);
    expect(cmd.label).toBe("Remove dialog");
    const a = cmd.apply(p);
    expect(Object.keys(a.dialogs)).toEqual(["bye"]);
    expect(a.manifest.dialogs.map((d) => d.id)).toEqual(["bye"]);
    expect(a.maps).toBe(p.maps);
    const r = cmd.revert(a);
    expect(r.manifest.dialogs.map((d) => d.id)).toEqual(["hello", "bye"]);
    expect(r.dialogs.hello).toBe(p.dialogs.hello);
  });

  it("refuses while an NPC or event uses it, listing them; project unchanged", () => {
    let p = withObject(makeProject(), "main", npcObj({ name: "Ann", dialog: "hello" }));
    p = withObject(p, "cave", eventObj([{ type: "dialog", dialog: "hello" }]));
    const snapshot = structuredClone(p);
    const err = refused(() => removeDialogCommand("hello", p));
    expect(err.message).toContain('npc "Ann" on map "main"');
    expect(err.message).toContain('event "E" on map "cave"');
    expect(p).toEqual(snapshot);
  });

  it("refuses an unknown dialog", () => {
    refused(() => removeDialogCommand("ghost", makeProject()));
  });

  it("revert works when another dialog was added in between", () => {
    const p = makeProject();
    const cmd = removeDialogCommand("hello", p);
    const a = upsertDialogCommand(dlg("extra"), cmd.apply(p)).apply(cmd.apply(p));
    const r = cmd.revert(a);
    expect(r.manifest.dialogs.map((d) => d.id)).toEqual(["hello", "bye", "extra"]);
    expect(Object.keys(r.dialogs).sort()).toEqual(["bye", "extra", "hello"]);
  });
});

describe("setObjectPropsCommand", () => {
  it("edits an NPC (undo/redo) with structural sharing", () => {
    const p = withObject(makeProject(), "main", npcObj({ name: "Ann" }));
    const cmd = setObjectPropsCommand("main", "npc-1", { name: "Bob", dialog: "hello" }, p);
    expect(cmd.label).toBe("Edit NPC");
    const a = cmd.apply(p);
    expect(a.maps.main!.objects[0]!.props).toEqual({ name: "Bob", dialog: "hello" });
    expect(a.maps.cave).toBe(p.maps.cave);
    expect(a.dialogs).toBe(p.dialogs);
    expect(cmd.revert(a).maps.main!.objects[0]!.props).toEqual({ name: "Ann" });
  });

  it("edits an event", () => {
    const p = withObject(makeProject(), "main", eventObj([{ type: "dialog", dialog: "hello" }]));
    const props = { name: "E2", trigger: "interact", once: true, actions: [{ type: "teleport", map: "cave", x: 1, y: 1 }] };
    const cmd = setObjectPropsCommand("main", "ev-1", props, p);
    expect(cmd.label).toBe("Edit event");
    const a = cmd.apply(p);
    expect(a.maps.main!.objects[0]!.props).toEqual(props);
    validateProjectRefs(a);
  });

  it("refuses spawns, unknown objects and unknown maps", () => {
    const p = withObject(makeProject(), "main", { id: "sp", kind: "spawn", x: 0, y: 0, props: {} });
    refused(() => setObjectPropsCommand("main", "sp", { name: "x" }, p));
    refused(() => setObjectPropsCommand("main", "nope", { name: "x" }, p));
    expect(() => setObjectPropsCommand("zzz", "sp", {}, p)).toThrow(expect.objectContaining({ code: "unknown_map" }));
  });

  it("refuses invalid props and dangling references", () => {
    const p = withObject(withObject(makeProject(), "main", npcObj({ name: "Ann" })), "main", { ...eventObj([{ type: "dialog", dialog: "hello" }]) });
    refused(() => setObjectPropsCommand("main", "npc-1", { name: "" }, p));
    refused(() => setObjectPropsCommand("main", "npc-1", { name: "A", dialog: "ghost" }, p));
    const base = { name: "E", trigger: "touch", once: false };
    refused(() => setObjectPropsCommand("main", "ev-1", { ...base, actions: [{ type: "set", variable: "nope", op: "set", value: 1 }] }, p));
    refused(() => setObjectPropsCommand("main", "ev-1", { ...base, actions: [{ type: "set", variable: "met", op: "add", value: 1 }] }, p));
    refused(() => setObjectPropsCommand("main", "ev-1", { ...base, actions: [{ type: "teleport", map: "ghost", x: 0, y: 0 }] }, p));
    refused(() => setObjectPropsCommand("main", "ev-1", { ...base, actions: [{ type: "teleport", map: "cave", x: 9999, y: 0 }] }, p));
  });

  it("apply/revert on a project modified in between keep the other changes", () => {
    const p = withObject(makeProject(), "main", npcObj({ name: "Ann" }));
    const cmd = setObjectPropsCommand("main", "npc-1", { name: "Bob" }, p);
    const a = cmd.apply(p);
    const moved = {
      ...a,
      maps: { ...a.maps, main: { ...a.maps.main!, objects: a.maps.main!.objects.map((o) => ({ ...o, x: 3 })) } },
    };
    const r = cmd.revert(moved);
    expect(r.maps.main!.objects[0]).toMatchObject({ x: 3, props: { name: "Ann" } });
    refused(() => cmd.apply({ ...p, maps: { ...p.maps, main: { ...p.maps.main!, objects: [] } } }));
    const { main: _m, ...noMain } = p.maps;
    expect(() => cmd.apply({ ...p, maps: noMain })).toThrow(expect.objectContaining({ code: "unknown_map" }));
  });

  it("does not alias the caller's props or actions", () => {
    const p = withObject(makeProject(), "main", eventObj([{ type: "dialog", dialog: "hello" }]));
    const actions: Record<string, unknown>[] = [{ type: "dialog", dialog: "hello" }];
    const props = { name: "E", trigger: "touch", once: false, actions, extra: 1 };
    const cmd = setObjectPropsCommand("main", "ev-1", props, p);
    actions[0]!.dialog = "bye";
    actions.push({ type: "dialog", dialog: "bye" });
    props.name = "Changed";
    const applied = cmd.apply(p).maps.main!.objects[0]!.props;
    expect(applied).toEqual({ name: "E", trigger: "touch", once: false, actions: [{ type: "dialog", dialog: "hello" }], extra: 1 });
  });
});

describe("removeMapGuard", () => {
  it("refuses the start map", () => {
    const p = makeProject();
    const err = refused(() => removeMapGuard(p, p.manifest.startMapId));
    expect(err.message).toContain("start map");
  });

  it("refuses a teleport target, listing the event", () => {
    const p = withObject(makeProject(), "main", eventObj([{ type: "teleport", map: "cave", x: 0, y: 0 }]));
    const err = refused(() => removeMapGuard(p, "cave"));
    expect(err.message).toContain('event "E" on map "main"');
  });

  it("throws unknown_map for a missing map", () => {
    expect(() => removeMapGuard(makeProject(), "ghost")).toThrow(expect.objectContaining({ code: "unknown_map" }));
  });

  it("passes for an unreferenced map", () => {
    expect(() => removeMapGuard(makeProject(), "cave")).not.toThrow();
  });
});
