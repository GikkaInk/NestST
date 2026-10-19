import { describe, expect, it, vi } from "vitest";
import { bindKeyboard } from "./keyboard.js";
import { createInput } from "./input.js";

function fakeTarget() {
  const handlers = new Map<string, Set<(e: never) => void>>();
  return {
    handlers,
    addEventListener(type: string, fn: (e: never) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: never) => void) {
      handlers.get(type)?.delete(fn);
    },
    emit(type: string, e: object = {}) {
      for (const fn of handlers.get(type) ?? []) fn(e as never);
    },
    count() {
      return [...handlers.values()].reduce((n, s) => n + s.size, 0);
    },
  };
}

describe("bindKeyboard", () => {
  it("forwards keydown, keyup and blur to the input", () => {
    const input = createInput();
    const target = fakeTarget();
    bindKeyboard(input, target);
    target.emit("keydown", { code: "ArrowLeft", preventDefault() {} });
    expect(input.poll().held).toBe("left");
    target.emit("keyup", { code: "ArrowLeft", preventDefault() {} });
    expect(input.poll().held).toBeNull();
    target.emit("keydown", { code: "ArrowUp", preventDefault() {} });
    target.emit("blur");
    expect(input.poll().held).toBeNull();
  });

  it("unbind removes every listener and is idempotent", () => {
    const target = fakeTarget();
    const unbind = bindKeyboard(createInput(), target);
    expect(target.count()).toBe(3);
    unbind();
    expect(target.count()).toBe(0);
    expect(() => unbind()).not.toThrow();
  });

  it("calls removeEventListener for each added listener", () => {
    const target = fakeTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    bindKeyboard(createInput(), target)();
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(["blur", "keydown", "keyup"]);
  });

  it("prevents default only for handled keys", () => {
    const target = fakeTarget();
    bindKeyboard(createInput(), target);
    const down = { code: "ArrowDown", preventDefault: vi.fn() };
    const other = { code: "KeyQ", preventDefault: vi.fn() };
    target.emit("keydown", down);
    target.emit("keydown", other);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
});
