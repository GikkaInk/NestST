import { describe, expect, it } from "vitest";
import { createInput } from "./input.js";

describe("createInput", () => {
  it("is idle at first", () => {
    expect(createInput().poll()).toEqual({ held: null, tapped: null });
  });

  it("reports held until release", () => {
    const i = createInput();
    i.keydown("ArrowLeft");
    expect(i.poll().held).toBe("left");
    expect(i.poll().held).toBe("left");
    i.keyup("ArrowLeft");
    expect(i.poll().held).toBeNull();
  });

  it("tapped is reported once, then reset by poll", () => {
    const i = createInput();
    i.keydown("KeyD");
    i.keyup("KeyD");
    expect(i.poll()).toEqual({ held: null, tapped: "right" });
    expect(i.poll()).toEqual({ held: null, tapped: null });
  });

  it("the last pressed of the held keys wins, and falls back on release", () => {
    const i = createInput();
    i.keydown("ArrowUp");
    i.keydown("ArrowRight");
    expect(i.poll().held).toBe("right");
    i.keyup("ArrowRight");
    expect(i.poll().held).toBe("up");
  });

  it("blur releases everything while a key is held", () => {
    const i = createInput();
    i.keydown("KeyW");
    i.keydown("KeyA");
    i.blur();
    expect(i.poll()).toEqual({ held: null, tapped: null });
    // the late keyup after refocus is harmless; a fresh press works
    i.keyup("KeyW");
    i.keydown("KeyW");
    expect(i.poll()).toEqual({ held: "up", tapped: "up" });
  });

  it("ignores auto-repeat keydown of a held key", () => {
    const i = createInput();
    i.keydown("ArrowUp");
    i.poll();
    i.keydown("ArrowUp");
    i.keydown("ArrowUp");
    expect(i.poll()).toEqual({ held: "up", tapped: null });
  });

  it("auto-repeat does not steal priority from a later key", () => {
    const i = createInput();
    i.keydown("ArrowUp");
    i.keydown("ArrowRight");
    i.keydown("ArrowUp");
    expect(i.poll().held).toBe("right");
  });

  it("WASD and arrows are equivalent", () => {
    const pairs: [string, string, string][] = [
      ["KeyW", "ArrowUp", "up"],
      ["KeyS", "ArrowDown", "down"],
      ["KeyA", "ArrowLeft", "left"],
      ["KeyD", "ArrowRight", "right"],
    ];
    for (const [wasd, arrow, dir] of pairs) {
      for (const code of [wasd, arrow]) {
        const i = createInput();
        i.keydown(code);
        expect(i.poll().held).toBe(dir);
      }
    }
  });

  it("ignores unknown codes", () => {
    const i = createInput();
    i.keydown("Space");
    i.keydown("KeyQ");
    i.keyup("Space");
    expect(i.poll()).toEqual({ held: null, tapped: null });
  });
});
