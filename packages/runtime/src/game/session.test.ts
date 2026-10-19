import { describe, expect, it } from "vitest";
import type { MapObject } from "@nestst/core";
import { createPlayer } from "./player.js";
import type { PlayerState } from "./player.js";
import { advance, closeDialog, createSession, enterCell, interact, moveSelection, startDialog } from "./session.js";
import { makeDialog, makeProject } from "./testProject.js";
import { createWorld } from "./world.js";

const spawn: MapObject = { id: "s", kind: "spawn", x: 0, y: 0, props: {} };
const flag = { id: "f", name: "F", type: "flag", initial: false } as const;
const num = { id: "n", name: "N", type: "number", initial: 0 } as const;
const say = (id: string, next: string | null, text = id) => ({ id, type: "say", speaker: "A", text, next });

function ev(id: string, x: number, y: number, props: Record<string, unknown>): MapObject {
  return { id, kind: "event", x, y, props: { name: id, trigger: "interact", once: false, actions: [], ...props } };
}

function facing(x: number, y: number, dir: PlayerState["facing"]): PlayerState {
  return { x, y, facing: dir, moving: null, queued: null };
}

describe("dialogs", () => {
  it("createSession uses initial values and start map", () => {
    const s = createSession(makeProject({ variables: [flag, num] }));
    expect(s.vars).toEqual({ f: false, n: 0 });
    expect(s.mapId).toBe("main");
    expect(s.dialog).toBeNull();
  });

  it("start null shows nothing", () => {
    const p = makeProject({ dialogs: [makeDialog("d", null, [])] });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.dialog).toBeNull();
  });

  it("say -> say -> end", () => {
    const p = makeProject({ dialogs: [makeDialog("d", "a", [say("a", "b"), say("b", null)])] });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.dialog).toEqual({ kind: "say", speaker: "A", text: "a" });
    advance(s, p);
    expect(s.dialog).toEqual({ kind: "say", speaker: "A", text: "b" });
    advance(s, p);
    expect(s.dialog).toBeNull();
    expect(s.error).toBeNull();
  });

  it("choice picks the selected branch; moveSelection is cyclic", () => {
    const p = makeProject({
      dialogs: [
        makeDialog("d", "c", [
          { id: "c", type: "choice", options: [{ text: "x", next: "a" }, { text: "y", next: "b" }, { text: "z", next: "a" }] },
          say("a", null, "A"),
          say("b", null, "B"),
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    moveSelection(s, -1);
    expect(s.dialog).toMatchObject({ kind: "choice", selected: 2 });
    moveSelection(s, 1);
    expect(s.dialog).toMatchObject({ selected: 0 });
    moveSelection(s, 1);
    advance(s, p);
    expect(s.dialog).toMatchObject({ kind: "say", text: "B" });
    moveSelection(s, 1); // no-op on say
    expect(s.dialog).toMatchObject({ kind: "say" });
  });

  it("choice hides options with false condition and keeps original targets", () => {
    const p = makeProject({
      variables: [flag],
      dialogs: [
        makeDialog("d", "c", [
          {
            id: "c",
            type: "choice",
            options: [
              { text: "hidden", next: "a", condition: { variable: "f", op: "==", value: true } },
              { text: "shown", next: "b" },
            ],
          },
          say("a", null, "A"),
          say("b", null, "B"),
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.dialog).toEqual({ kind: "choice", options: [{ text: "shown" }], selected: 0 });
    advance(s, p);
    expect(s.dialog).toMatchObject({ text: "B" });
  });

  it("choice with no visible options ends the dialog", () => {
    const p = makeProject({
      variables: [flag],
      dialogs: [
        makeDialog("d", "c", [
          { id: "c", type: "choice", options: [{ text: "h", next: "a", condition: { variable: "f", op: "==", value: true } }] },
          say("a", null),
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.dialog).toBeNull();
    expect(s.error).toBeNull();
  });

  it("set / add / branch run automatically", () => {
    const p = makeProject({
      variables: [flag, num],
      dialogs: [
        makeDialog("d", "s1", [
          { id: "s1", type: "set", variable: "f", op: "set", value: true, next: "s2" },
          { id: "s2", type: "set", variable: "n", op: "add", value: 3, next: "b" },
          { id: "b", type: "branch", condition: { variable: "n", op: ">=", value: 3 }, then: "yes", else: "no" },
          say("yes", null, "yes"),
          say("no", null, "no"),
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.vars).toEqual({ f: true, n: 3 });
    expect(s.dialog).toMatchObject({ text: "yes" });
  });

  it("add saturates at +-1,000,000", () => {
    const p = makeProject({
      variables: [{ id: "n", name: "N", type: "number", initial: 999999 }],
      dialogs: [
        makeDialog("up", "a", [{ id: "a", type: "set", variable: "n", op: "add", value: 5, next: null }]),
        makeDialog("down", "a", [{ id: "a", type: "set", variable: "n", op: "add", value: -5, next: null }]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "up");
    expect(s.vars["n"]).toBe(1000000);
    s.vars["n"] = -999999;
    startDialog(s, p, "down");
    expect(s.vars["n"]).toBe(-1000000);
  });

  function chain(len: number) {
    const nodes: Record<string, unknown>[] = [];
    for (let i = 0; i < len; i++) {
      nodes.push({ id: `n${i}`, type: "set", variable: "n", op: "add", value: 1, next: `n${i + 1}` });
    }
    nodes.push(say(`n${len}`, null, "end"));
    return makeProject({ variables: [num], dialogs: [makeDialog("d", "n0", nodes)] });
  }

  it("1000 automatic steps are allowed", () => {
    const p = chain(1000);
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.error).toBeNull();
    expect(s.vars["n"]).toBe(1000);
    expect(s.dialog).toMatchObject({ text: "end" });
  });

  it("1001 automatic steps give dialog_loop-style error and close the dialog", () => {
    const p = chain(1001);
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.error).toContain('"Dialog d"');
    expect(s.error).toContain("loops");
    expect(s.dialog).toBeNull();
  });

  it("set -> branch -> set cycle is stopped", () => {
    const p = makeProject({
      variables: [num],
      dialogs: [
        makeDialog("d", "s", [
          { id: "s", type: "set", variable: "n", op: "set", value: 1, next: "b" },
          { id: "b", type: "branch", condition: { variable: "n", op: "==", value: 1 }, then: "s", else: null },
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.error).not.toBeNull();
    expect(s.dialog).toBeNull();
  });

  it("closeDialog clears the dialog but keeps the error", () => {
    const p = chain(1001);
    const s = createSession(p);
    startDialog(s, p, "d");
    closeDialog(s);
    expect(s.error).not.toBeNull();
  });
});

describe("events", () => {
  const npcObj: MapObject = { id: "npc1", kind: "npc", x: 1, y: 0, props: { name: "Bob", dialog: "d" } };
  const hello = makeDialog("d", "a", [say("a", null, "hi")]);

  it("interact in front of an NPC starts its dialog", () => {
    const p = makeProject({ objects: [spawn, npcObj], dialogs: [hello] });
    const s = createSession(p);
    expect(interact(s, p, createWorld(p, "main"), facing(0, 0, "right"))).toBe(true);
    expect(s.dialog).toMatchObject({ text: "hi" });
  });

  it("interact on an empty cell or facing away is false", () => {
    const p = makeProject({ objects: [spawn, npcObj], dialogs: [hello] });
    const s = createSession(p);
    const w = createWorld(p, "main");
    expect(interact(s, p, w, facing(0, 0, "down"))).toBe(false);
    expect(interact(s, p, w, facing(0, 0, "up"))).toBe(false);
    expect(s.dialog).toBeNull();
  });

  it("interact is ignored mid-step and while a dialog is open", () => {
    const p = makeProject({ objects: [spawn, npcObj], dialogs: [hello] });
    const s = createSession(p);
    const w = createWorld(p, "main");
    const moving = { ...facing(0, 0, "right"), moving: { fromX: 0, fromY: 0, toX: 0, toY: 1, t: 0.5 } };
    expect(interact(s, p, w, moving)).toBe(false);
    startDialog(s, p, "d");
    expect(interact(s, p, w, facing(0, 0, "right"))).toBe(false);
  });

  it("interact event with false condition is false and does nothing", () => {
    const p = makeProject({
      variables: [flag],
      objects: [spawn, ev("e", 0, 1, { condition: { variable: "f", op: "==", value: true }, actions: [{ type: "set", variable: "f", op: "set", value: true }] })],
    });
    const s = createSession(p);
    expect(interact(s, p, createWorld(p, "main"), createPlayer(createWorld(p, "main")))).toBe(false);
    expect(s.vars["f"]).toBe(false);
  });

  it("interact event runs actions in order", () => {
    const p = makeProject({
      variables: [num],
      objects: [spawn, ev("e", 0, 1, { actions: [
        { type: "set", variable: "n", op: "set", value: 4 },
        { type: "set", variable: "n", op: "add", value: 2 },
      ] })],
    });
    const s = createSession(p);
    const w = createWorld(p, "main");
    expect(interact(s, p, w, createPlayer(w))).toBe(true);
    expect(s.vars["n"]).toBe(6);
  });

  it("touch events fire through enterCell only on their cell; interact events do not", () => {
    const p = makeProject({
      variables: [num],
      objects: [
        spawn,
        ev("t", 2, 2, { trigger: "touch", actions: [{ type: "set", variable: "n", op: "add", value: 1 }] }),
        ev("i", 2, 2, { trigger: "interact", actions: [{ type: "set", variable: "n", op: "add", value: 10 }] }),
      ],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 1, 2);
    expect(s.vars["n"]).toBe(0);
    enterCell(s, p, "main", 2, 2);
    expect(s.vars["n"]).toBe(1);
  });

  it("once fires once per session; a false condition does not consume it", () => {
    const p = makeProject({
      variables: [flag, num],
      objects: [
        spawn,
        ev("t", 2, 2, {
          trigger: "touch",
          once: true,
          condition: { variable: "f", op: "==", value: true },
          actions: [{ type: "set", variable: "n", op: "add", value: 1 }],
        }),
      ],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 2, 2); // condition false
    expect(s.vars["n"]).toBe(0);
    s.vars["f"] = true;
    enterCell(s, p, "main", 2, 2);
    enterCell(s, p, "main", 2, 2);
    expect(s.vars["n"]).toBe(1);
    expect(Object.keys(s)).not.toContain("fired");
    expect(JSON.stringify(s)).not.toContain("main:t");
    const s2 = createSession(p);
    s2.vars["f"] = true;
    enterCell(s2, p, "main", 2, 2);
    expect(s2.vars["n"]).toBe(1);
  });

  it("actions after teleport are skipped", () => {
    const p = makeProject({
      variables: [num],
      objects: [spawn, ev("t", 2, 2, { trigger: "touch", actions: [
        { type: "set", variable: "n", op: "set", value: 1 },
        { type: "teleport", map: "main", x: 3, y: 3 },
        { type: "set", variable: "n", op: "set", value: 2 },
      ] })],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 2, 2);
    expect(s.teleport).toEqual({ map: "main", x: 3, y: 3 });
    expect(s.vars["n"]).toBe(1);
  });

  it("actions after dialog are skipped", () => {
    const p = makeProject({
      variables: [num],
      dialogs: [hello],
      objects: [spawn, ev("t", 2, 2, { trigger: "touch", actions: [
        { type: "dialog", dialog: "d" },
        { type: "set", variable: "n", op: "set", value: 2 },
      ] })],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 2, 2);
    expect(s.dialog).toMatchObject({ text: "hi" });
    expect(s.vars["n"]).toBe(0);
  });

  it("once state is independent between sessions", () => {
    const p = makeProject({
      variables: [num],
      objects: [spawn, ev("t", 2, 2, { trigger: "touch", once: true, actions: [{ type: "set", variable: "n", op: "add", value: 1 }] })],
    });
    const a = createSession(p);
    const b = createSession(p);
    enterCell(a, p, "main", 2, 2);
    enterCell(b, p, "main", 2, 2);
    expect(a.vars["n"]).toBe(1);
    expect(b.vars["n"]).toBe(1);
  });

  it("a skipped event after a teleport does not consume its once", () => {
    const p = makeProject({
      variables: [num],
      objects: [
        spawn,
        ev("a", 2, 2, { trigger: "touch", actions: [{ type: "teleport", map: "main", x: 3, y: 3 }] }),
        ev("b", 2, 2, { trigger: "touch", once: true, actions: [{ type: "set", variable: "n", op: "add", value: 1 }] }),
      ],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 2, 2);
    expect(s.vars["n"]).toBe(0);
    // Remove the blocking event: the once event still fires.
    p.maps["main"]!.objects = p.maps["main"]!.objects.filter((o) => o.id !== "a");
    enterCell(s, p, "main", 2, 2);
    expect(s.vars["n"]).toBe(1);
  });

  it("a touch event can start a dialog", () => {
    const p = makeProject({
      dialogs: [hello],
      objects: [spawn, ev("t", 2, 2, { trigger: "touch", actions: [{ type: "dialog", dialog: "d" }] })],
    });
    const s = createSession(p);
    enterCell(s, p, "main", 2, 2);
    expect(s.dialog).toMatchObject({ text: "hi" });
  });
});

describe("dialog robustness", () => {
  it("long say cycles and self-looping choices never trip the auto-step limit", () => {
    const p = makeProject({
      dialogs: [
        makeDialog("cyc", "a", [say("a", "b"), say("b", "a")]),
        makeDialog("ch", "c", [{ id: "c", type: "choice", options: [{ text: "again", next: "c" }] }]),
      ],
    });
    for (const id of ["cyc", "ch"]) {
      const s = createSession(p);
      startDialog(s, p, id);
      for (let i = 0; i < 2000; i++) advance(s, p);
      expect(s.error).toBeNull();
      expect(s.dialog).not.toBeNull();
    }
  });

  it("startDialog replaces an open dialog", () => {
    const p = makeProject({
      dialogs: [makeDialog("x", "a", [say("a", null, "old")]), makeDialog("y", "a", [say("a", null, "new")])],
    });
    const s = createSession(p);
    startDialog(s, p, "x");
    startDialog(s, p, "y");
    expect(s.dialog).toMatchObject({ text: "new" });
    advance(s, p);
    expect(s.dialog).toBeNull();
  });

  it("advance without a dialog is a no-op", () => {
    const p = makeProject({});
    const s = createSession(p);
    expect(() => advance(s, p)).not.toThrow();
    expect(s.dialog).toBeNull();
    expect(s.error).toBeNull();
  });

  it("advance onto a missing node closes the dialog", () => {
    const p = makeProject({ dialogs: [makeDialog("d", "a", [say("a", "gone")])] });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(() => advance(s, p)).not.toThrow();
    expect(s.dialog).toBeNull();
  });

  it("unknown dialog id sets a plain error and shows nothing", () => {
    const p = makeProject({});
    const s = createSession(p);
    startDialog(s, p, "nope");
    expect(s.dialog).toBeNull();
    expect(s.error).toBe('Dialog "nope" does not exist');
  });

  it("startDialog clears a stale error", () => {
    const p = makeProject({ dialogs: [makeDialog("d", "a", [say("a", null)])] });
    const s = createSession(p);
    startDialog(s, p, "nope");
    startDialog(s, p, "d");
    expect(s.error).toBeNull();
    expect(s.dialog).not.toBeNull();
  });

  it("set/add ignore unknown variables and add ignores flags", () => {
    const p = makeProject({
      variables: [flag],
      dialogs: [
        makeDialog("d", "a", [
          { id: "a", type: "set", variable: "ghost", op: "set", value: 1, next: "b" },
          { id: "b", type: "set", variable: "ghost", op: "add", value: 1, next: "c" },
          { id: "c", type: "set", variable: "f", op: "add", value: 1, next: null },
        ]),
      ],
    });
    const s = createSession(p);
    startDialog(s, p, "d");
    expect(s.vars).toEqual({ f: false });
  });
});
