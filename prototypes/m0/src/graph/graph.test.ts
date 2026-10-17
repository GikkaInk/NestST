import { describe, expect, it } from "vitest";
import {
  DialogueError,
  demoGraph,
  loadGraphOrDemo,
  parseDialogue,
  serializeDialogue,
  type DialogueGraph,
} from "./graph";

const good: DialogueGraph = {
  schemaVersion: 1,
  start: "a",
  nodes: [
    { id: "a", kind: "line", text: "Привет", next: ["b"] },
    { id: "b", kind: "end", next: [] },
  ],
};

function expectError(input: unknown, fragment: string): void {
  try {
    parseDialogue(input);
  } catch (e) {
    expect(e).toBeInstanceOf(DialogueError);
    expect((e as Error).message).toContain(fragment);
    return;
  }
  throw new Error("expected DialogueError");
}

describe("parseDialogue", () => {
  it("round-trips", () => {
    expect(parseDialogue(JSON.parse(serializeDialogue(good)))).toEqual(good);
  });
  it("serializes with 2-space indent", () => {
    expect(serializeDialogue(good)).toBe(JSON.stringify(good, null, 2));
  });
  it("rejects unknown kind", () => {
    expectError({ ...good, nodes: [{ id: "a", kind: "foo", next: [] }] }, "неизвестный тип узла");
  });
  it("rejects dangling next", () => {
    expectError(
      { ...good, nodes: [{ id: "a", kind: "line", next: ["zzz"] }] },
      "ссылается на несуществующий узел",
    );
  });
  it("rejects duplicate ids", () => {
    expectError(
      { ...good, nodes: [{ id: "a", kind: "end", next: [] }, { id: "a", kind: "end", next: [] }] },
      "повторяется",
    );
  });
  it("rejects missing start", () => {
    expectError({ ...good, start: "nope" }, "нет стартового узла");
  });
  it("rejects empty dialogue", () => {
    expectError({ schemaVersion: 1, start: "a", nodes: [] }, "пустой диалог");
  });
  it("rejects non-object input", () => {
    expectError(42, "некорректный формат");
  });
  it("accepts a self-loop", () => {
    const g = { schemaVersion: 1, start: "a", nodes: [{ id: "a", kind: "line", next: ["a"] }] };
    expect(parseDialogue(g).nodes[0].next).toEqual(["a"]);
  });
});

describe("loadGraphOrDemo", () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it("returns demo without error when empty", () => {
    const r = loadGraphOrDemo(store(null));
    expect(r.graph).toEqual(demoGraph());
    expect(r.error).toBeUndefined();
  });
  it("loads a valid saved graph", () => {
    expect(loadGraphOrDemo(store(serializeDialogue(good))).graph).toEqual(good);
  });
  it("falls back on corrupt JSON", () => {
    const r = loadGraphOrDemo(store("{oops"));
    expect(r.graph).toEqual(demoGraph());
    expect(r.error).toContain("некорректный JSON");
  });
  it("falls back on DialogueError", () => {
    const r = loadGraphOrDemo(store(JSON.stringify({ ...good, start: "x" })));
    expect(r.graph).toEqual(demoGraph());
    expect(r.error).toContain("нет стартового узла");
  });
  it("falls back when storage throws", () => {
    const r = loadGraphOrDemo({ getItem: () => { throw new Error("denied"); } });
    expect(r.graph).toEqual(demoGraph());
    expect(r.error).toBeTruthy();
  });
});
