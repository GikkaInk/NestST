import type { InputFrame } from "./player.js";
import type { Dir } from "./world.js";

export type Input = {
  keydown(code: string): void;
  keyup(code: string): void;
  blur(): void;
  poll(): GameInputFrame;
};

export interface GameInputFrame extends InputFrame {
  /** An action key was pressed since the last poll. */
  action: boolean;
  /** The last up (-1) / down (1) press since the last poll, 0 if none. */
  menu: -1 | 0 | 1;
}

const ACTION_KEYS = new Set(["Space", "Enter", "KeyZ"]);
const MENU: Record<string, -1 | 1> = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };

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
  let action = false;
  let menu: -1 | 0 | 1 = 0;
  /** Action keys currently held, to ignore auto-repeat. */
  let actionDown = new Set<string>();
  return {
    keydown(code) {
      if (ACTION_KEYS.has(code)) {
        if (!actionDown.has(code)) {
          actionDown.add(code);
          action = true;
        }
        return;
      }
      const dir = KEYS[code];
      if (dir === undefined || down.includes(code)) return;
      down.push(code);
      tapped = dir;
      menu = MENU[code] ?? menu;
    },
    keyup(code) {
      down = down.filter((c) => c !== code);
      actionDown.delete(code);
    },
    blur() {
      down = [];
      tapped = null;
      action = false;
      menu = 0;
      actionDown = new Set();
    },
    poll() {
      const last = down[down.length - 1];
      const frame: GameInputFrame = {
        held: last === undefined ? null : (KEYS[last] ?? null),
        tapped,
        action,
        menu,
      };
      tapped = null;
      action = false;
      menu = 0;
      return frame;
    },
  };
}
