import { canEnter } from "./world.js";
import type { Dir, World } from "./world.js";

export type { Dir } from "./world.js";

export const TILE_MOVE_MS = 250;

export interface PlayerState {
  x: number;
  y: number;
  facing: Dir;
  moving: null | { fromX: number; fromY: number; toX: number; toY: number; t: number };
  queued: Dir | null;
}

export interface InputFrame {
  held: Dir | null;
  tapped: Dir | null;
}

const DELTA: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export function createPlayer(world: World): PlayerState {
  return { x: world.spawn.x, y: world.spawn.y, facing: "down", moving: null, queued: null };
}

/** Turns toward `dir`; starts a step (t = 0) when the target cell is free. */
function turnAndStart(world: World, s: PlayerState, dir: Dir): PlayerState {
  const [dx, dy] = DELTA[dir];
  const toX = s.x + dx;
  const toY = s.y + dy;
  if (!canEnter(world, toX, toY)) return { ...s, facing: dir, moving: null };
  return { ...s, facing: dir, moving: { fromX: s.x, fromY: s.y, toX, toY, t: 0 } };
}

export function stepPlayer(
  world: World,
  state: PlayerState,
  input: InputFrame,
  dtMs: number,
): PlayerState {
  let s = state;
  let left = dtMs;

  if (s.moving === null) {
    const dir = input.held ?? input.tapped;
    if (dir === null) return s;
    s = turnAndStart(world, s, dir);
    if (s.moving === null) return s;
  } else if (input.tapped !== null) {
    s = { ...s, queued: input.tapped };
  }

  // Each pass consumes time inside one step; arrival hands the rest to the next.
  for (;;) {
    const m = s.moving;
    if (m === null) return s;
    const t = m.t + left / TILE_MOVE_MS;
    if (t < 1) return { ...s, moving: { ...m, t } };
    left = (t - 1) * TILE_MOVE_MS;
    const arrived: PlayerState = { ...s, x: m.toX, y: m.toY, moving: null, queued: null };
    const next = input.held ?? s.queued;
    if (next === null) return arrived;
    s = turnAndStart(world, arrived, next);
    if (s.moving === null) return s;
  }
}
