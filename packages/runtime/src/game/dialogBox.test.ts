import { describe, expect, it } from "vitest";
import { Text } from "pixi.js";
import type { Container } from "pixi.js";
import { createDialogBox } from "./dialogBox.js";
import type { DialogView } from "./session.js";

const say: DialogView = { kind: "say", speaker: "Ann", text: "Hello there" };
const choice = (selected = 0): DialogView => ({
  kind: "choice",
  options: [{ text: "a" }, { text: "b" }, { text: "c" }],
  selected,
});

function texts(c: Container): Text[] {
  const out: Text[] = [];
  const walk = (n: Container): void => {
    for (const ch of n.children) {
      if (ch instanceof Text) out.push(ch);
      else walk(ch as Container);
    }
  };
  walk(c);
  return out;
}

describe("createDialogBox", () => {
  it("is hidden at first", () => {
    const box = createDialogBox(320, 240);
    expect(box.container.visible).toBe(false);
    box.destroy();
  });

  it("a say line makes two texts: speaker and text", () => {
    const box = createDialogBox(320, 240);
    box.show(say);
    expect(box.container.visible).toBe(true);
    expect(texts(box.container).map((t) => t.text)).toEqual(["Ann", "Hello there"]);
    box.destroy();
  });

  it("a choice of three makes three rows, the selected one marked", () => {
    const box = createDialogBox(320, 240);
    box.show(choice(1));
    const rows = texts(box.container).map((t) => t.text);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatch(/^[>▶]/);
    expect(rows[0]).not.toMatch(/^[>▶]/);
    box.destroy();
  });

  it("showing the same content again does not recreate anything", () => {
    const box = createDialogBox(320, 240);
    box.show(say);
    const before = texts(box.container);
    box.show({ ...say });
    expect(texts(box.container)).toEqual(before);
    expect(texts(box.container).every((t, i) => t === before[i])).toBe(true);
    box.show(choice(0));
    const rows = texts(box.container);
    box.show(choice(0));
    expect(texts(box.container).every((t, i) => t === rows[i])).toBe(true);
    box.show(choice(2));
    expect(texts(box.container).some((t, i) => t === rows[i])).toBe(false);
    box.destroy();
  });

  it("show(null) hides, and showing again works", () => {
    const box = createDialogBox(320, 240);
    box.show(say);
    box.show(null);
    expect(box.container.visible).toBe(false);
    box.show(say);
    expect(box.container.visible).toBe(true);
    expect(texts(box.container)).toHaveLength(2);
    box.destroy();
  });

  it("shows an error text when there is no dialog", () => {
    const box = createDialogBox(320, 240);
    box.show(null, "Something broke");
    expect(box.container.visible).toBe(true);
    expect(texts(box.container).some((t) => t.text.includes("Something broke"))).toBe(true);
    expect(texts(box.container).some((t) => t.text === "Press Space to continue")).toBe(true);
    box.show(null);
    expect(box.container.visible).toBe(false);
    box.destroy();
  });

  it("resize moves the box to the bottom of the new size and keeps the content", () => {
    const box = createDialogBox(320, 240);
    box.show(say);
    const y1 = box.container.y;
    box.resize(640, 480);
    expect(box.container.y).toBeGreaterThan(y1);
    expect(texts(box.container).map((t) => t.text)).toEqual(["Ann", "Hello there"]);
    expect(box.container.y).toBeLessThan(480);
    box.destroy();
  });

  it("a long text and 6 long options stay inside the screen and keep the selection", () => {
    const box = createDialogBox(400, 200);
    box.show({ kind: "say", speaker: "Ann", text: "word ".repeat(120) });
    expect(box.container.y).toBeGreaterThanOrEqual(0);
    const opts = Array.from({ length: 6 }, (_, i) => ({ text: `option ${i} ${"long ".repeat(30)}` }));
    box.show({ kind: "choice", options: opts, selected: 5 });
    expect(texts(box.container).some((t) => t.text.startsWith("> option 5"))).toBe(true);
    box.show({ kind: "choice", options: opts, selected: 0 });
    expect(texts(box.container).some((t) => t.text.startsWith("> option 0"))).toBe(true);
    box.destroy();
  });

  it("destroy is safe twice, and later calls do nothing", () => {
    const box = createDialogBox(320, 240);
    box.show(say);
    box.destroy();
    expect(() => box.destroy()).not.toThrow();
    expect(() => box.show(say)).not.toThrow();
    expect(() => box.resize(100, 100)).not.toThrow();
  });
});
