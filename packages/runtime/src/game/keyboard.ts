import type { Input } from "./input.js";

const HANDLED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
]);

export interface KeyboardTarget {
  addEventListener(type: "keydown" | "keyup", fn: (e: KeyboardEvent) => void): void;
  addEventListener(type: "blur", fn: () => void): void;
  removeEventListener(type: "keydown" | "keyup", fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "blur", fn: () => void): void;
}

/** Feeds keydown/keyup/blur from `target` into `input`; returns an idempotent unbind. */
export function bindKeyboard(input: Input, target: KeyboardTarget): () => void {
  const onDown = (e: KeyboardEvent): void => {
    if (HANDLED.has(e.code)) e.preventDefault();
    input.keydown(e.code);
  };
  const onUp = (e: KeyboardEvent): void => input.keyup(e.code);
  const onBlur = (): void => input.blur();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener("keydown", onDown);
    target.removeEventListener("keyup", onUp);
    target.removeEventListener("blur", onBlur);
  };
}
