import { describe, expect, it } from "vitest";
import { layoutDialog, wrapText } from "./dialogLayout.js";
import type { LayoutInput } from "./dialogLayout.js";

const measure = (s: string): number => s.length * 8;
const base: LayoutInput = {
  screenW: 800,
  screenH: 300,
  head: "Ann",
  text: "Hi",
  options: null,
  selected: 0,
  footer: null,
  measure,
  lineH: 18,
};
const long = (n: number): string => Array.from({ length: n }, (_, i) => `w${i % 10}${"x".repeat(i % 5)}`).join(" ");

describe("wrapText", () => {
  it("wraps at the width, keeps newlines, hard-breaks long words", () => {
    expect(wrapText("aa bb cc", 40, measure)).toEqual(["aa bb", "cc"]);
    expect(wrapText("a\nb", 400, measure)).toEqual(["a", "b"]);
    const lines = wrapText("x".repeat(30), 80, measure);
    expect(lines.every((l) => measure(l) <= 80)).toBe(true);
    expect(lines.join("")).toBe("x".repeat(30));
  });
});

describe("layoutDialog", () => {
  it("short content gives a small box", () => {
    const l = layoutDialog(base);
    expect(l.body).toEqual(["Hi"]);
    expect(l.boxH).toBe(2 * 18 + 20);
    expect(l.bodyClipped).toBe(false);
  });

  it("empty text still gives a valid box", () => {
    const l = layoutDialog({ ...base, text: "", head: null });
    expect(l.boxH).toBeGreaterThan(0);
  });

  it("a 500 character text is clipped to 60% of the screen, keeping its start and the head", () => {
    const text = long(120).slice(0, 500);
    const l = layoutDialog({ ...base, screenW: 400, text });
    expect(l.boxH).toBeLessThanOrEqual(300 * 0.6);
    expect(l.bodyClipped).toBe(true);
    expect(l.body[l.body.length - 1]!.endsWith("...")).toBe(true);
    expect(text.startsWith(l.body[0]!)).toBe(true);
    expect(l.head).toBe("Ann");
  });

  it("the footer stays visible when the text is clipped", () => {
    const l = layoutDialog({ ...base, text: long(200), footer: "Press Space to continue" });
    expect(l.footer).toBe("Press Space to continue");
    expect(l.boxH).toBeLessThanOrEqual(180);
  });

  const opts = Array.from({ length: 6 }, (_, i) => `${i}: ${long(30)}`);

  it("6 long options on 800x300: wrapped, selected visible at 0 and at 5, box within limit", () => {
    for (const selected of [0, 3, 5]) {
      const l = layoutDialog({ ...base, head: null, options: opts, selected });
      expect(l.options.some((o) => o.index === selected)).toBe(true);
      expect(l.boxH).toBeLessThanOrEqual(300 * 0.6);
      expect(l.options.every((o) => o.lines.every((x) => measure(x) <= 800 - 16 - 20 - 16))).toBe(true);
    }
    const first = layoutDialog({ ...base, head: null, options: opts, selected: 0 });
    expect(first.moreAbove).toBe(false);
    expect(first.moreBelow).toBe(true);
    const last = layoutDialog({ ...base, head: null, options: opts, selected: 5 });
    expect(last.moreAbove).toBe(true);
    expect(last.moreBelow).toBe(false);
    expect(last.options[last.options.length - 1]!.index).toBe(5);
  });

  it("short options all fit without markers", () => {
    const l = layoutDialog({ ...base, head: null, options: ["a", "b", "c"], selected: 1 });
    expect(l.options.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(l.moreAbove || l.moreBelow).toBe(false);
  });

  it("an option taller than the room is clipped but still shown", () => {
    const l = layoutDialog({ ...base, head: null, options: [long(400), "b"], selected: 0 });
    expect(l.options[0]!.index).toBe(0);
    expect(l.boxH).toBeLessThanOrEqual(180);
  });

  it("a tiny screen never gives negative or NaN sizes and shows the selection", () => {
    for (const [w, h] of [[10, 10], [0, 0], [100, 30]] as const) {
      const l = layoutDialog({ ...base, screenW: w, screenH: h, options: opts, head: null, selected: 4 });
      expect(l.boxW).toBeGreaterThan(0);
      expect(l.boxH).toBeGreaterThan(0);
      expect(Number.isFinite(l.boxH)).toBe(true);
      expect(l.options.some((o) => o.index === 4)).toBe(true);
      const t = layoutDialog({ ...base, screenW: w, screenH: h, text: long(100) });
      expect(t.boxH).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});
