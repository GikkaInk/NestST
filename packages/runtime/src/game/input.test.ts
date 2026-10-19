import { describe, expect, it } from "vitest";
import { createInput } from "./input.js";

const IDLE = { held: null, tapped: null, action: false, menu: 0 } as const;

describe("createInput", () => {
  it("is idle at first", () => {
    expect(createInput().poll()).toEqual(IDLE);
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
    expect(i.poll()).toMatchObject({ held: null, tapped: "right" });
    expect(i.poll()).toEqual(IDLE);
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
    expect(i.poll()).toEqual(IDLE);
    // the late keyup after refocus is harmless; a fresh press works
    i.keyup("KeyW");
    i.keydown("KeyW");
    expect(i.poll()).toMatchObject({ held: "up", tapped: "up" });
  });

  it("ignores auto-repeat keydown of a held key", () => {
    const i = createInput();
    i.keydown("ArrowUp");
    i.poll();
    i.keydown("ArrowUp");
    i.keydown("ArrowUp");
    expect(i.poll()).toMatchObject({ held: "up", tapped: null });
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
    i.keydown("KeyX");
    i.keydown("KeyQ");
    i.keyup("KeyX");
    expect(i.poll()).toEqual(IDLE);
  });
});

describe("createInput action and menu", () => {
  it("action is reported once for Space, Enter and KeyZ", () => {
    for (const code of ["Space", "Enter", "KeyZ"]) {
      const i = createInput();
      i.keydown(code);
      expect(i.poll().action).toBe(true);
      expect(i.poll().action).toBe(false);
    }
  });

  it("action keys do not affect walking", () => {
    const i = createInput();
    i.keydown("Space");
    expect(i.poll()).toMatchObject({ held: null, tapped: null });
  });

  it("ignores auto-repeat of an action key until it is released", () => {
    const i = createInput();
    i.keydown("Enter");
    i.poll();
    i.keydown("Enter");
    i.keydown("Enter");
    expect(i.poll().action).toBe(false);
    i.keyup("Enter");
    i.keydown("Enter");
    expect(i.poll().action).toBe(true);
  });

  it("blur clears a pending action and menu", () => {
    const i = createInput();
    i.keydown("KeyZ");
    i.keydown("ArrowUp");
    i.blur();
    expect(i.poll()).toEqual(IDLE);
    i.keyup("KeyZ");
    i.keydown("KeyZ");
    expect(i.poll().action).toBe(true);
  });

  it("menu: up keys give -1, down keys give 1, the last press wins, reset by poll", () => {
    const i = createInput();
    i.keydown("ArrowUp");
    expect(i.poll().menu).toBe(-1);
    expect(i.poll().menu).toBe(0);
    i.keydown("KeyS");
    expect(i.poll().menu).toBe(1);
    i.keyup("KeyS");
    i.keydown("KeyW");
    i.keydown("ArrowDown");
    expect(i.poll().menu).toBe(1);
  });

  it("menu keys still walk", () => {
    const i = createInput();
    i.keydown("ArrowDown");
    expect(i.poll()).toMatchObject({ held: "down", tapped: "down", menu: 1 });
  });

  it("auto-repeat of a menu key does not repeat the menu step", () => {
    const i = createInput();
    i.keydown("ArrowDown");
    i.poll();
    i.keydown("ArrowDown");
    expect(i.poll().menu).toBe(0);
  });
});
