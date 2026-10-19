import { describe, expect, it } from "vitest";
import { MAX_CHOICE_OPTIONS, MAX_DIALOG_NODES, MAX_OPTION_TEXT, MAX_SAY_TEXT, parseDialog } from "@nestst/core";
import type { Dialog, DialogNode, VariableDef } from "@nestst/core";
import {
  START_MARKER_ID,
  addNode,
  addOption,
  applyConnect,
  applyDisconnect,
  dialogToFlow,
  findFreeSpot,
  moveNode,
  removeNode,
  removeOption,
  setStart,
} from "./dialogGraph.js";

const VARS: VariableDef[] = [
  { id: "met", name: "Met", type: "flag", initial: false },
  { id: "coins", name: "Coins", type: "number", initial: 0 },
];

function empty(): Dialog {
  return { schemaVersion: 1, id: "d", name: "D", start: null, nodes: [] };
}

/** say(n1) -> choice(n2: 2 options) ; branch(n3) ; set(n4). Start n1. */
function full(): Dialog {
  return {
    schemaVersion: 1,
    id: "d",
    name: "D",
    start: "n1",
    nodes: [
      { id: "n1", x: 10, y: 20, type: "say", speaker: "Mo", text: "Hi", next: "n2" },
      {
        id: "n2",
        x: 300,
        y: 20,
        type: "choice",
        options: [
          { text: "A", next: "n3" },
          { text: "B", next: null },
        ],
      },
      {
        id: "n3",
        x: 600,
        y: 0,
        type: "branch",
        condition: { variable: "met", op: "==", value: true },
        then: "n4",
        else: null,
      },
      { id: "n4", x: 900, y: 0, type: "set", variable: "coins", op: "add", value: 1, next: null },
    ],
  };
}

function ok(d: Dialog): Dialog {
  expect(() => parseDialog(structuredClone(d))).not.toThrow();
  const ids = d.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  return d;
}

function node(d: Dialog, id: string): DialogNode {
  return d.nodes.find((n) => n.id === id)!;
}

describe("dialogToFlow", () => {
  it("makes a flow node per dialog node plus a start marker, with positions", () => {
    const { nodes } = dialogToFlow(full());
    expect(nodes.map((n) => n.id)).toEqual([START_MARKER_ID, "n1", "n2", "n3", "n4"]);
    const n2 = nodes.find((n) => n.id === "n2")!;
    expect(n2.type).toBe("choice");
    expect(n2.position).toEqual({ x: 300, y: 20 });
    expect(nodes.find((n) => n.id === "n1")!.data.isStart).toBe(true);
    expect(nodes.find((n) => n.id === "n3")!.data.isStart).toBe(false);
    expect(nodes.find((n) => n.id === START_MARKER_ID)!.draggable).toBe(false);
  });

  it("makes edges with deterministic ids and handles", () => {
    const { edges } = dialogToFlow(full());
    expect(edges.map((e) => [e.id, e.source, e.sourceHandle, e.target])).toEqual([
      [`${START_MARKER_ID}:start`, START_MARKER_ID, "start", "n1"],
      ["n1:next", "n1", "next", "n2"],
      ["n2:opt-0", "n2", "opt-0", "n3"],
      ["n3:then", "n3", "then", "n4"],
    ]);
  });

  it("has no start edge when start is null and no edges for empty links", () => {
    expect(dialogToFlow(empty())).toEqual({ nodes: [expect.objectContaining({ id: START_MARKER_ID })], edges: [] });
  });

  it("is repeatable (same input, same output)", () => {
    expect(dialogToFlow(full())).toEqual(dialogToFlow(full()));
  });
});

describe("applyConnect", () => {
  it("connects say and set via next", () => {
    const d = ok(applyConnect(full(), { source: "n1", sourceHandle: "next", target: "n4" }));
    expect((node(d, "n1") as { next: string }).next).toBe("n4");
    const d2 = ok(applyConnect(full(), { source: "n4", sourceHandle: null, target: "n1" }));
    expect((node(d2, "n4") as { next: string }).next).toBe("n1");
  });

  it("connects a particular choice option", () => {
    const d = ok(applyConnect(full(), { source: "n2", sourceHandle: "opt-1", target: "n4" }));
    const c = node(d, "n2") as Extract<DialogNode, { type: "choice" }>;
    expect(c.options.map((o) => o.next)).toEqual(["n3", "n4"]);
  });

  it("connects branch then and else", () => {
    let d = applyConnect(full(), { source: "n3", sourceHandle: "else", target: "n1" });
    d = applyConnect(d, { source: "n3", sourceHandle: "then", target: "n2" });
    ok(d);
    const b = node(d, "n3") as Extract<DialogNode, { type: "branch" }>;
    expect([b.then, b.else]).toEqual(["n2", "n1"]);
  });

  it("connecting the start marker sets start", () => {
    const d = ok(applyConnect(full(), { source: START_MARKER_ID, sourceHandle: "start", target: "n3" }));
    expect(d.start).toBe("n3");
  });

  it("ignores impossible connections and returns the input", () => {
    const base = full();
    for (const c of [
      { source: "nope", sourceHandle: "next", target: "n1" },
      { source: "n1", sourceHandle: "next", target: "nope" },
      { source: "n2", sourceHandle: "opt-5", target: "n1" },
      { source: "n2", sourceHandle: "next", target: "n1" },
      { source: "n2", sourceHandle: null, target: "n1" },
      { source: "n3", sourceHandle: "next", target: "n1" },
      { source: "n1", sourceHandle: "then", target: "n2" },
    ]) {
      expect(applyConnect(base, c)).toBe(base);
    }
  });

  it("does not mutate the input", () => {
    const base = full();
    const copy = structuredClone(base);
    const out = applyConnect(base, { source: "n1", sourceHandle: "next", target: "n4" });
    expect(base).toEqual(copy);
    expect(out).not.toBe(base);
  });
});

describe("applyDisconnect", () => {
  it("clears say, choice and branch links by edge id", () => {
    let d = applyDisconnect(full(), "n1:next");
    d = applyDisconnect(d, "n2:opt-0");
    d = applyDisconnect(d, "n3:then");
    ok(d);
    expect((node(d, "n1") as { next: unknown }).next).toBeNull();
    expect((node(d, "n2") as Extract<DialogNode, { type: "choice" }>).options[0]!.next).toBeNull();
    expect((node(d, "n3") as Extract<DialogNode, { type: "branch" }>).then).toBeNull();
  });

  it("clears start via the marker edge", () => {
    expect(applyDisconnect(full(), `${START_MARKER_ID}:start`).start).toBeNull();
  });

  it("returns the input for unknown edges and does not mutate", () => {
    const base = full();
    const copy = structuredClone(base);
    expect(applyDisconnect(base, "zzz")).toBe(base);
    expect(applyDisconnect(base, "n9:next")).toBe(base);
    applyDisconnect(base, "n1:next");
    expect(base).toEqual(copy);
  });

  it("handles node ids that contain a colon", () => {
    const d: Dialog = {
      ...empty(),
      nodes: [{ id: "a:b", x: 0, y: 0, type: "say", speaker: "", text: "x", next: "a:b" }],
    };
    const out = applyDisconnect(d, "a:b:next");
    expect((out.nodes[0] as { next: unknown }).next).toBeNull();
  });
});

describe("addNode", () => {
  it("adds each type with valid defaults and a unique id", () => {
    let d = empty();
    for (const type of ["say", "choice", "set", "branch"] as const) {
      d = ok(addNode(d, type, { x: 5, y: 6 }, VARS));
    }
    expect(d.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(d.nodes.map((n) => n.type)).toEqual(["say", "choice", "set", "branch"]);
    expect(d.nodes[0]).toMatchObject({ x: 5, y: 6 });
  });

  it("uses the smallest unused n<k>", () => {
    const base = full(); // n1..n4
    const gap = removeNode(base, "n2");
    expect(addNode(gap, "say", { x: 0, y: 0 }).nodes.at(-1)!.id).toBe("n2");
    const other: Dialog = { ...empty(), nodes: [{ id: "n1", x: 0, y: 0, type: "say", speaker: "", text: "x", next: null }] };
    expect(addNode(other, "say", { x: 0, y: 0 }).nodes.at(-1)!.id).toBe("n2");
  });

  it("makes the first node the start only when start is null", () => {
    const d = addNode(empty(), "say", { x: 0, y: 0 });
    expect(d.start).toBe("n1");
    expect(addNode(d, "say", { x: 0, y: 0 }).start).toBe("n1");
    const nullStart = { ...full(), start: null };
    expect(addNode(nullStart, "say", { x: 0, y: 0 }).start).toBe("n5");
  });

  it("builds set/branch defaults from the first variable", () => {
    const flagFirst = addNode(empty(), "set", { x: 0, y: 0 }, VARS).nodes[0]!;
    expect(flagFirst).toMatchObject({ variable: "met", op: "set", value: true });
    const numFirst = addNode(empty(), "set", { x: 0, y: 0 }, [VARS[1]!]).nodes[0]!;
    expect(numFirst).toMatchObject({ variable: "coins", op: "add", value: 1 });
    expect(addNode(empty(), "branch", { x: 0, y: 0 }, [VARS[1]!]).nodes[0]).toMatchObject({
      condition: { variable: "coins", op: "==", value: 0 },
      then: null,
      else: null,
    });
  });

  it("still gives a valid node without variables (placeholder id)", () => {
    ok(addNode(addNode(empty(), "set", { x: 0, y: 0 }), "branch", { x: 0, y: 0 }));
  });

  it("never generates the reserved marker id", () => {
    let d = empty();
    for (let i = 0; i < 20; i++) d = addNode(d, "say", { x: 0, y: 0 });
    expect(d.nodes.some((n) => n.id === START_MARKER_ID)).toBe(false);
  });

  it("rounds and clamps positions", () => {
    const d = ok(addNode(empty(), "say", { x: 1.6, y: -5e9 }));
    expect(d.nodes[0]).toMatchObject({ x: 2, y: -1000000 });
  });

  it("returns the input unchanged at the node limit", () => {
    const nodes: DialogNode[] = Array.from({ length: MAX_DIALOG_NODES }, (_, i) => ({
      id: `n${i + 1}`, x: 0, y: 0, type: "say", speaker: "", text: "x", next: null,
    }));
    const full500: Dialog = { ...empty(), start: "n1", nodes };
    expect(addNode(full500, "say", { x: 0, y: 0 })).toBe(full500);
  });

  it("does not mutate the input", () => {
    const base = full();
    const copy = structuredClone(base);
    addNode(base, "choice", { x: 1, y: 1 });
    expect(base).toEqual(copy);
  });

  it("default texts stay within the limits", () => {
    const d = addNode(addNode(empty(), "say", { x: 0, y: 0 }), "choice", { x: 0, y: 0 });
    expect((d.nodes[0] as { text: string }).text.length).toBeLessThanOrEqual(MAX_SAY_TEXT);
    expect((d.nodes[1] as Extract<DialogNode, { type: "choice" }>).options[0]!.text.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
  });
});

describe("removeNode", () => {
  it("removes the node and every incoming link", () => {
    const d = ok(removeNode(full(), "n3"));
    expect(d.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n4"]);
    expect((node(d, "n2") as Extract<DialogNode, { type: "choice" }>).options.map((o) => o.next)).toEqual([null, null]);
  });

  it("clears links from say, set and branch (then and else)", () => {
    const d: Dialog = {
      ...empty(),
      nodes: [
        { id: "n1", x: 0, y: 0, type: "say", speaker: "", text: "x", next: "n9" },
        { id: "n2", x: 0, y: 0, type: "set", variable: "met", op: "set", value: true, next: "n9" },
        { id: "n3", x: 0, y: 0, type: "branch", condition: { variable: "met", op: "==", value: true }, then: "n9", else: "n9" },
        { id: "n9", x: 0, y: 0, type: "say", speaker: "", text: "x", next: null },
      ],
    };
    const out = ok(removeNode(d, "n9"));
    expect(out.nodes.map((n) => JSON.stringify(n).includes("n9"))).toEqual([false, false, false]);
  });

  it("sets start to null when the start node is removed, keeps it otherwise", () => {
    expect(removeNode(full(), "n1").start).toBeNull();
    expect(removeNode(full(), "n2").start).toBe("n1");
  });

  it("returns the input for unknown ids and does not mutate", () => {
    const base = full();
    const copy = structuredClone(base);
    expect(removeNode(base, "zz")).toBe(base);
    removeNode(base, "n1");
    expect(base).toEqual(copy);
  });
});

describe("moveNode / setStart", () => {
  it("moves one node, rounding and clamping", () => {
    const d = ok(moveNode(full(), "n2", { x: 12.4, y: 2e6 }));
    expect(node(d, "n2")).toMatchObject({ x: 12, y: 1000000 });
    expect(node(d, "n1")).toMatchObject({ x: 10, y: 20 });
  });

  it("ignores unknown ids and non-finite positions", () => {
    const base = full();
    expect(moveNode(base, "zz", { x: 1, y: 1 })).toBe(base);
    expect(moveNode(base, "n1", { x: Number.NaN, y: 1 })).toBe(base);
  });

  it("sets start to an existing node only", () => {
    const base = full();
    expect(ok(setStart(base, "n3")).start).toBe("n3");
    expect(setStart(base, "zz")).toBe(base);
    expect(base.start).toBe("n1");
  });
});

describe("options", () => {
  it("adds options up to the limit and removes down to one", () => {
    let d = full();
    for (let i = 0; i < 10; i++) d = ok(addOption(d, "n2"));
    expect((node(d, "n2") as Extract<DialogNode, { type: "choice" }>).options).toHaveLength(MAX_CHOICE_OPTIONS);
    const atLimit = d;
    expect(addOption(atLimit, "n2")).toBe(atLimit);
    for (let i = 0; i < 10; i++) d = ok(removeOption(d, "n2", 0));
    expect((node(d, "n2") as Extract<DialogNode, { type: "choice" }>).options).toHaveLength(1);
    expect(removeOption(d, "n2", 0)).toBe(d);
  });

  it("ignores non-choice nodes and bad indexes", () => {
    const base = full();
    expect(addOption(base, "n1")).toBe(base);
    expect(removeOption(base, "n2", 7)).toBe(base);
    expect(removeOption(base, "n1", 0)).toBe(base);
  });
});

describe("findFreeSpot", () => {
  it("returns a spot that no node occupies", () => {
    const d = full();
    const spot = findFreeSpot(d);
    expect(d.nodes.some((n) => Math.abs(n.x - spot.x) < 200 && Math.abs(n.y - spot.y) < 100)).toBe(false);
  });

  it("is deterministic and works for an empty dialog", () => {
    expect(findFreeSpot(empty())).toEqual(findFreeSpot(empty()));
  });
});

describe("random operation sequences", () => {
  function rng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  it("always yield a valid dialog, never mutate the input, keep ids unique", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      let d = empty();
      for (let step = 0; step < 80; step++) {
        const prev = d;
        const before = structuredClone(d);
        const ids = [...d.nodes.map((n) => n.id), "ghost"];
        const handles = ["next", "then", "else", "opt-0", "opt-1", "opt-4", null];
        const op = Math.floor(r() * 9);
        if (op === 0) d = addNode(d, pick(["say", "choice", "set", "branch"] as const), { x: r() * 900, y: r() * 900 }, r() < 0.5 ? VARS : []);
        else if (op === 1) d = applyConnect(d, { source: pick(ids), sourceHandle: pick(handles), target: pick(ids) });
        else if (op === 2) d = applyDisconnect(d, `${pick(ids)}:${pick(handles) ?? "next"}`);
        else if (op === 3) d = removeNode(d, pick(ids));
        else if (op === 4) d = moveNode(d, pick(ids), { x: r() * 5000 - 2500, y: r() * 5000 });
        else if (op === 5) d = setStart(d, pick(ids));
        else if (op === 6) d = addOption(d, pick(ids));
        else if (op === 7) d = removeOption(d, pick(ids), Math.floor(r() * 7));
        else d = addNode(d, "say", findFreeSpot(d));
        expect(prev).toEqual(before); // the operation did not touch its input
        ok(d);
        const flow = dialogToFlow(d);
        const edgeIds = flow.edges.map((e) => e.id);
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
        for (const e of flow.edges) expect(flow.nodes.some((n) => n.id === e.target)).toBe(true);
      }
    }
  });

  it("operations leave a frozen input untouched", () => {
    const frozen = structuredClone(full());
    const deepFreeze = (o: unknown): void => {
      if (typeof o === "object" && o !== null) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(frozen);
    expect(() => {
      addNode(frozen, "say", { x: 0, y: 0 });
      applyConnect(frozen, { source: "n1", sourceHandle: "next", target: "n4" });
      applyConnect(frozen, { source: "n2", sourceHandle: "opt-0", target: "n4" });
      applyConnect(frozen, { source: "n3", sourceHandle: "then", target: "n1" });
      applyDisconnect(frozen, "n2:opt-0");
      removeNode(frozen, "n3");
      moveNode(frozen, "n1", { x: 1, y: 1 });
      setStart(frozen, "n2");
      addOption(frozen, "n2");
      removeOption(frozen, "n2", 0);
    }).not.toThrow();
  });
});
