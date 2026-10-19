import type { InputFrame } from "./player.js";
import type { Dir } from "./world.js";

export type Input = {
  keydown(code: string): void;
  keyup(code: string): void;
  blur(): void;
  poll(): InputFrame;
};

const KEYS: Record<string, Dir> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

export function createInput(): Input {
  /** Codes currently held, in press order. */
  let down: string[] = [];
  let tapped: Dir | null = null;
  return {
    keydown(code) {
      const dir = KEYS[code];
      if (dir === undefined || down.includes(code)) return;
      down.push(code);
      tapped = dir;
    },
    keyup(code) {
      down = down.filter((c) => c !== code);
    },
    blur() {
      down = [];
      tapped = null;
    },
    poll() {
      const last = down[down.length - 1];
      const frame: InputFrame = { held: last === undefined ? null : (KEYS[last] ?? null), tapped };
      tapped = null;
      return frame;
    },
  };
}
