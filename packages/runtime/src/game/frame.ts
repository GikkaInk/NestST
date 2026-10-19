import type { Project } from "@nestst/core";
import type { GameInputFrame } from "./input.js";
import { stepPlayer } from "./player.js";
import type { PlayerState } from "./player.js";
import { advance, enterCell, interact, moveSelection } from "./session.js";
import type { Session } from "./session.js";
import { canEnter, createWorld } from "./world.js";
import type { World } from "./world.js";

export interface FrameState {
  world: World;
  player: PlayerState;
}

export interface FrameResult extends FrameState {
  /** The world was rebuilt for another map (the caller refreshes the views). */
  mapChanged: boolean;
}

/**
 * Applies a pending `session.teleport`: switches the map and puts the player on the target
 * cell. A bad target keeps the old map and sets `session.error`. Never fires touch events.
 */
function applyTeleport(project: Project, session: Session, state: FrameState): FrameResult {
  const tp = session.teleport;
  const stay: FrameResult = { ...state, mapChanged: false };
  if (tp === null) return stay;
  session.teleport = null;
  const map = project.maps[tp.map];
  if (map === undefined) {
    session.error = `Teleport target map "${tp.map}" does not exist`;
    return stay;
  }
  const inside =
    Number.isInteger(tp.x) && Number.isInteger(tp.y) && tp.x >= 0 && tp.y >= 0 && tp.x < map.width && tp.y < map.height;
  if (!inside) {
    session.error = `Teleport target (${tp.x}, ${tp.y}) is outside map "${map.name}"`;
    return stay;
  }
  const world = createWorld(project, tp.map, { x: tp.x, y: tp.y });
  if (!canEnter(world, tp.x, tp.y)) {
    session.error = `Teleport target (${tp.x}, ${tp.y}) on map "${map.name}" is blocked (solid tile or NPC)`;
    return stay;
  }
  session.mapId = tp.map;
  const player: PlayerState = { x: tp.x, y: tp.y, facing: state.player.facing, moving: null, queued: null };
  return { world, player, mapChanged: true };
}

/**
 * One fixed simulation step. While a dialog (or an error) is shown, walking is frozen and
 * `menu`/`action` drive it; otherwise `action` interacts with the cell in front, and arriving
 * in a new cell by walking fires its touch events. Arriving by teleport fires none.
 */
export function stepFrame(
  project: Project,
  session: Session,
  state: FrameState,
  input: GameInputFrame,
  dtMs: number,
): FrameResult {
  const idle: FrameResult = { ...state, mapChanged: false };
  if (session.dialog !== null) {
    if (input.menu !== 0) moveSelection(session, input.menu);
    if (input.action) advance(session, project);
    return idle;
  }
  if (session.error !== null) {
    if (input.action) session.error = null;
    return idle;
  }
  if (input.action) {
    interact(session, project, state.world, state.player);
    if (session.dialog !== null || session.error !== null || session.teleport !== null) {
      return applyTeleport(project, session, state);
    }
  }
  const next = stepPlayer(state.world, state.player, input, dtMs);
  if (next.x !== state.player.x || next.y !== state.player.y) {
    enterCell(session, project, session.mapId, next.x, next.y);
  }
  return applyTeleport(project, session, { world: state.world, player: next });
}
