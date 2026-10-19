import { describe, expect, it } from "vitest";
import { NestError, parseDialog, parseManifest } from "./index.js";

function say(id: string, next: string | null = null, over: Record<string, unknown> = {}) {
  return { id, x: 0, y: 0, type: "say", speaker: "Nest", text: "Hi", next, ...over };
}

function dialog(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "hello",
    name: "Hello",
    start: "a",
    nodes: [say("a", "b"), say("b")],
    ...over,
  };
}

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 4,
    name: "G",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [{ id: "town", file: "maps/town.json" }],
    startMapId: "town",
    solidTiles: [],
    variables: [],
    dialogs: [],
    ...over,
  };
}

function fails(fn: () => unknown, code: string, part?: string): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    expect((e as NestError).code).toBe(code);
    if (part) expect((e as NestError).message).toContain(part);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

const cond = { variable: "gold", op: ">=", value: 3 };

describe("parseDialog", () => {
  it("accepts a valid dialog with all node types", () => {
    const raw = dialog({
      start: "s",
      nodes: [
        say("s", "c"),
        {
          id: "c", x: 1, y: 2, type: "choice",
          options: [{ text: "Yes", next: "set1" }, { text: "No", next: null, condition: cond }],
        },
        { id: "set1", x: 0, y: 0, type: "set", variable: "gold", op: "add", value: 5, next: "br" },
        { id: "br", x: 0, y: 0, type: "branch", condition: cond, then: "s", else: null },
      ],
    });
    expect(parseDialog(raw)).toEqual(raw);
  });

  it("accepts an empty dialog with start null", () => {
    expect(parseDialog(dialog({ start: null, nodes: [] })).nodes).toEqual([]);
  });

  it("allows 500 nodes but not 501", () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => say(`n${i}`));
    parseDialog(dialog({ start: "n0", nodes: nodes(500) }));
    fails(() => parseDialog(dialog({ start: "n0", nodes: nodes(501) })), "invalid_dialog", "nodes");
  });

  it("allows 6 options but not 7", () => {
    const choice = (n: number) => ({
      id: "c", x: 0, y: 0, type: "choice",
      options: Array.from({ length: n }, () => ({ text: "o", next: null })),
    });
    parseDialog(dialog({ start: "c", nodes: [choice(6)] }));
    fails(() => parseDialog(dialog({ start: "c", nodes: [choice(7)] })), "invalid_dialog", "options");
    fails(() => parseDialog(dialog({ start: "c", nodes: [choice(0)] })), "invalid_dialog", "options");
  });

  it("limits say text to 500 and option text to 200 characters", () => {
    parseDialog(dialog({ start: "a", nodes: [say("a", null, { text: "x".repeat(500) })] }));
    fails(() => parseDialog(dialog({ start: "a", nodes: [say("a", null, { text: "x".repeat(501) })] })), "invalid_dialog", "text");
    fails(() => parseDialog(dialog({ start: "a", nodes: [say("a", null, { text: "" })] })), "invalid_dialog", "text");
    const opt = (t: string) => ({ id: "c", x: 0, y: 0, type: "choice", options: [{ text: t, next: null }] });
    parseDialog(dialog({ start: "c", nodes: [opt("x".repeat(200))] }));
    fails(() => parseDialog(dialog({ start: "c", nodes: [opt("x".repeat(201))] })), "invalid_dialog", "text");
  });

  it("rejects a huge array of invalid nodes quickly with the limit message", () => {
    const nodes = new Array<null>(1000000).fill(null);
    const t = performance.now();
    fails(() => parseDialog(dialog({ nodes })), "invalid_dialog", "too many nodes");
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("gives a plain message for an unknown node type", () => {
    const e = fails(() => parseDialog(dialog({ nodes: [{ id: "a", x: 0, y: 0, type: "jump" }] })), "invalid_dialog", "node type must be");
    expect(e.message).not.toMatch(/Invalid input|expected|received/i);
  });

  it("limits dialog name to 200 characters and rejects empty option text", () => {
    parseDialog(dialog({ name: "x".repeat(200) }));
    fails(() => parseDialog(dialog({ name: "x".repeat(201) })), "invalid_dialog", "name");
    const opt = { id: "c", x: 0, y: 0, type: "choice", options: [{ text: "", next: null }] };
    fails(() => parseDialog(dialog({ start: "c", nodes: [opt] })), "invalid_dialog", "text");
  });

  it("limits speaker to 60 characters", () => {
    parseDialog(dialog({ nodes: [say("a", null, { speaker: "x".repeat(60) })] }));
    fails(() => parseDialog(dialog({ nodes: [say("a", null, { speaker: "x".repeat(61) })] })), "invalid_dialog", "speaker");
  });

  it("limits numbers to +-1 000 000", () => {
    const setNode = (value: number) => ({ id: "s", x: 0, y: 0, type: "set", variable: "gold", op: "set", value, next: null });
    parseDialog(dialog({ start: "s", nodes: [setNode(1000000)] }));
    parseDialog(dialog({ start: "s", nodes: [setNode(-1000000)] }));
    fails(() => parseDialog(dialog({ start: "s", nodes: [setNode(1000001)] })), "invalid_dialog", "value");
    fails(() => parseDialog(dialog({ start: "s", nodes: [setNode(1.5)] })), "invalid_dialog", "value");
    const br = (value: number) => ({ id: "b", x: 0, y: 0, type: "branch", condition: { ...cond, value }, then: null, else: null });
    parseDialog(dialog({ start: "b", nodes: [br(1000000)] }));
    fails(() => parseDialog(dialog({ start: "b", nodes: [br(1000001)] })), "invalid_dialog", "value");
  });

  it("rejects duplicate node ids", () => {
    fails(() => parseDialog(dialog({ nodes: [say("a"), say("a")] })), "invalid_dialog", 'node id "a"');
  });

  it("rejects a dangling start, next, option, then and else", () => {
    fails(() => parseDialog(dialog({ start: "zz" })), "invalid_dialog", '"zz"');
    fails(() => parseDialog(dialog({ nodes: [say("a", "zz")] })), "invalid_dialog", '"zz"');
    fails(
      () => parseDialog(dialog({ start: "c", nodes: [{ id: "c", x: 0, y: 0, type: "choice", options: [{ text: "o", next: "zz" }] }] })),
      "invalid_dialog", '"zz"',
    );
    const br = (t: string | null, e: string | null) => ({ id: "b", x: 0, y: 0, type: "branch", condition: cond, then: t, else: e });
    fails(() => parseDialog(dialog({ start: "b", nodes: [br("zz", null)] })), "invalid_dialog", "then");
    fails(() => parseDialog(dialog({ start: "b", nodes: [br(null, "zz")] })), "invalid_dialog", "else");
    fails(
      () => parseDialog(dialog({ start: "s", nodes: [{ id: "s", x: 0, y: 0, type: "set", variable: "v", op: "set", value: 1, next: "zz" }] })),
      "invalid_dialog", '"zz"',
    );
  });

  it("rejects a flag condition with > and a boolean with a number operator", () => {
    const br = (condition: unknown) => ({ id: "b", x: 0, y: 0, type: "branch", condition, then: null, else: null });
    fails(() => parseDialog(dialog({ start: "b", nodes: [br({ variable: "f", op: ">", value: true })] })), "invalid_dialog", "condition");
    parseDialog(dialog({ start: "b", nodes: [br({ variable: "f", op: "!=", value: true })] }));
    parseDialog(dialog({ start: "b", nodes: [br({ variable: "n", op: "<", value: 2 })] }));
    fails(() => parseDialog(dialog({ start: "b", nodes: [br({ variable: "f", op: "<>", value: 1 })] })), "invalid_dialog");
  });

  it("rejects add on a flag value", () => {
    const s = (op: string, value: unknown) => ({ id: "s", x: 0, y: 0, type: "set", variable: "v", op, value, next: null });
    parseDialog(dialog({ start: "s", nodes: [s("set", true)] }));
    fails(() => parseDialog(dialog({ start: "s", nodes: [s("add", true)] })), "invalid_dialog", "add");
  });

  it("rejects an unknown node type, bad id and wrong version", () => {
    fails(() => parseDialog(dialog({ nodes: [{ id: "a", x: 0, y: 0, type: "jump" }] })), "invalid_dialog");
    fails(() => parseDialog(dialog({ id: "Bad Id" })), "invalid_dialog", "id");
    fails(() => parseDialog(dialog({ schemaVersion: 2 })), "invalid_dialog", "version");
    fails(() => parseDialog("x"), "invalid_dialog");
  });

  it("mentions the file in errors", () => {
    fails(() => parseDialog(dialog({ id: "Bad" }), "dialogs/x.json"), "invalid_dialog", "dialogs/x.json");
  });
});

describe("manifest variables and dialogs", () => {
  const v = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, type: "number", initial: 0, ...over });

  it("accepts valid variables and dialogs", () => {
    const m = manifest({
      variables: [v("gold"), v("met", { type: "flag", initial: false })],
      dialogs: [{ id: "hello", file: "dialogs/hello.json" }],
    });
    expect(parseManifest(m)).toEqual(m);
  });

  it("allows 200 variables but not 201", () => {
    const vars = (n: number) => Array.from({ length: n }, (_, i) => v(`v${i}`));
    parseManifest(manifest({ variables: vars(200) }));
    fails(() => parseManifest(manifest({ variables: vars(201) })), "invalid_manifest", "variables");
  });

  it("allows 200 dialogs but not 201", () => {
    const ds = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, file: `dialogs/d${i}.json` }));
    parseManifest(manifest({ dialogs: ds(200) }));
    fails(() => parseManifest(manifest({ dialogs: ds(201) })), "invalid_manifest", "dialogs");
  });

  it("rejects huge arrays of invalid variables and dialogs quickly", () => {
    for (const field of ["variables", "dialogs"]) {
      const t = performance.now();
      fails(() => parseManifest(manifest({ [field]: new Array<null>(1000000).fill(null) })), "invalid_manifest", `field ${field}: too many`);
      expect(performance.now() - t).toBeLessThan(500);
    }
  });

  it("limits variable name to 60 characters", () => {
    parseManifest(manifest({ variables: [v("a", { name: "x".repeat(60) })] }));
    fails(() => parseManifest(manifest({ variables: [v("a", { name: "x".repeat(61) })] })), "invalid_manifest", "name");
  });

  it("rejects duplicate variable and dialog ids", () => {
    fails(() => parseManifest(manifest({ variables: [v("a"), v("a")] })), "invalid_manifest", '"a"');
    const d = { id: "x", file: "dialogs/x.json" };
    fails(() => parseManifest(manifest({ dialogs: [d, d] })), "invalid_manifest", '"x"');
  });

  it("rejects an initial value of the wrong type or range", () => {
    fails(() => parseManifest(manifest({ variables: [v("a", { type: "number", initial: true })] })), "invalid_manifest", "initial");
    fails(() => parseManifest(manifest({ variables: [v("a", { type: "flag", initial: 0 })] })), "invalid_manifest", "initial");
    parseManifest(manifest({ variables: [v("a", { initial: 1000000 })] }));
    fails(() => parseManifest(manifest({ variables: [v("a", { initial: 1000001 })] })), "invalid_manifest", "initial");
    fails(() => parseManifest(manifest({ variables: [v("a", { type: "text" })] })), "invalid_manifest", "type");
    fails(() => parseManifest(manifest({ variables: [v("a", { name: "" })] })), "invalid_manifest", "name");
    fails(() => parseManifest(manifest({ variables: [v("a", { name: "x".repeat(61) })] })), "invalid_manifest", "name");
  });

  it("requires dialog file to be dialogs/<id>.json", () => {
    fails(() => parseManifest(manifest({ dialogs: [{ id: "x", file: "dialogs/y.json" }] })), "invalid_manifest", "dialogs/x.json");
  });
});
