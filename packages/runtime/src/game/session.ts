import { parseEventProps } from "@nestst/core";
import type { Dialog, DialogNode, EventAction, EventProps, Project } from "@nestst/core";
import { evalCondition } from "./conditions.js";
import type { VarValue } from "./conditions.js";
import type { PlayerState } from "./player.js";
import type { Dir, World } from "./world.js";

export type DialogView =
  | { kind: "say"; speaker: string; text: string }
  | { kind: "choice"; options: { text: string }[]; selected: number };

export interface Session {
  vars: Record<string, VarValue>;
  mapId: string;
  dialog: DialogView | null;
  teleport: { map: string; x: number; y: number } | null;
  error: string | null;
}

/** More consecutive automatic steps (set/branch) than this means the dialog loops. */
const MAX_AUTO_STEPS = 1000;
const VALUE_LIMIT = 1000000;

interface Internal {
  /** Events that already fired, keyed `<mapId>:<objectId>`. */
  fired: Set<string>;
  run: null | {
    dialog: Dialog;
    node: DialogNode | null;
    /** Next node for each shown choice option (by visible index). */
    targets: (string | null)[];
  };
}

// Private state: not reachable from the Session object itself.
const internals = new WeakMap<Session, Internal>();

function internal(session: Session): Internal {
  let s = internals.get(session);
  if (s === undefined) {
    s = { fired: new Set(), run: null };
    internals.set(session, s);
  }
  return s;
}

export function createSession(project: Project): Session {
  const vars: Record<string, VarValue> = {};
  for (const v of project.manifest.variables) vars[v.id] = v.initial;
  const session: Session = {
    vars,
    mapId: project.manifest.startMapId,
    dialog: null,
    teleport: null,
    error: null,
  };
  internals.set(session, { fired: new Set(), run: null });
  return session;
}

export function closeDialog(session: Session): void {
  session.dialog = null;
  internal(session).run = null;
}

function applySet(
  session: Session,
  variable: string,
  op: "set" | "add",
  value: VarValue,
): void {
  if (op === "set") {
    session.vars[variable] = value;
    return;
  }
  const cur = session.vars[variable];
  const base = typeof cur === "number" ? cur : 0;
  const sum = base + (typeof value === "number" ? value : 0);
  session.vars[variable] = Math.max(-VALUE_LIMIT, Math.min(VALUE_LIMIT, sum));
}

function findNode(dialog: Dialog, id: string | null): DialogNode | null {
  if (id === null) return null;
  return dialog.nodes.find((n) => n.id === id) ?? null;
}

/** Runs automatic steps from `nodeId` until a say/choice is shown or the dialog ends. */
function run(session: Session, dialog: Dialog, nodeId: string | null): void {
  const st = internal(session);
  let id = nodeId;
  for (let steps = 0; ; steps++) {
    const node = findNode(dialog, id);
    if (node === null) {
      closeDialog(session);
      return;
    }
    if (node.type === "say") {
      st.run = { dialog, node, targets: [] };
      session.dialog = { kind: "say", speaker: node.speaker, text: node.text };
      return;
    }
    if (node.type === "choice") {
      const visible = node.options.filter(
        (o) => o.condition === undefined || evalCondition(session.vars, o.condition),
      );
      if (visible.length === 0) {
        closeDialog(session);
        return;
      }
      st.run = { dialog, node, targets: visible.map((o) => o.next) };
      session.dialog = {
        kind: "choice",
        options: visible.map((o) => ({ text: o.text })),
        selected: 0,
      };
      return;
    }
    if (steps >= MAX_AUTO_STEPS) {
      session.error =
        `Dialog "${dialog.name}" loops without showing anything ` +
        `(more than ${MAX_AUTO_STEPS} automatic steps in a row), so it was closed`;
      closeDialog(session);
      return;
    }
    if (node.type === "set") {
      applySet(session, node.variable, node.op, node.value);
      id = node.next;
    } else {
      id = evalCondition(session.vars, node.condition) ? node.then : node.else;
    }
  }
}

export function startDialog(session: Session, project: Project, dialogId: string): void {
  closeDialog(session);
  const dialog = project.dialogs[dialogId];
  if (dialog === undefined) {
    session.error = `Dialog "${dialogId}" does not exist`;
    return;
  }
  run(session, dialog, dialog.start);
}

export function advance(session: Session, _project: Project): void {
  const cur = internal(session).run;
  if (cur === null || cur.node === null) return;
  if (cur.node.type === "say") {
    run(session, cur.dialog, cur.node.next);
  } else if (session.dialog?.kind === "choice") {
    run(session, cur.dialog, cur.targets[session.dialog.selected] ?? null);
  }
}

export function moveSelection(session: Session, delta: 1 | -1): void {
  const view = session.dialog;
  if (view === null || view.kind !== "choice") return;
  const n = view.options.length;
  view.selected = (view.selected + delta + n) % n;
}

/** Runs the actions in order; stops after a dialog or teleport. Returns true if one of those ran. */
function runActions(session: Session, project: Project, actions: readonly EventAction[]): boolean {
  for (const a of actions) {
    if (a.type === "set") {
      applySet(session, a.variable, a.op, a.value);
    } else if (a.type === "dialog") {
      startDialog(session, project, a.dialog);
      return true;
    } else {
      session.teleport = { map: a.map, x: a.x, y: a.y };
      return true;
    }
  }
  return false;
}

/** Fires the events of `trigger` on the cell; returns true if at least one ran. */
function fireEvents(
  session: Session,
  project: Project,
  mapId: string,
  x: number,
  y: number,
  trigger: "touch" | "interact",
): boolean {
  const map = project.maps[mapId];
  if (map === undefined) return false;
  const st = internal(session);
  let ran = false;
  for (const obj of map.objects) {
    if (obj.kind !== "event" || obj.x !== x || obj.y !== y) continue;
    let props: EventProps;
    try {
      props = parseEventProps(obj.props);
    } catch {
      continue;
    }
    if (props.trigger !== trigger) continue;
    if (props.condition !== undefined && !evalCondition(session.vars, props.condition)) continue;
    const key = `${mapId}:${obj.id}`;
    if (props.once) {
      if (st.fired.has(key)) continue;
      st.fired.add(key);
    }
    ran = true;
    if (runActions(session, project, props.actions)) break;
  }
  return ran;
}

const DELTA: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * Acts on the cell in front of the player. Ignored while a dialog is open or the player is
 * mid-step. An NPC with a dialog takes the cell; otherwise its interact events run.
 */
export function interact(
  session: Session,
  project: Project,
  world: World,
  player: PlayerState,
): boolean {
  if (session.dialog !== null || player.moving !== null) return false;
  const [dx, dy] = DELTA[player.facing];
  const x = player.x + dx;
  const y = player.y + dy;
  const npc = world.npcs.find((n) => n.x === x && n.y === y);
  if (npc !== undefined) {
    const obj = project.maps[session.mapId]?.objects.find((o) => o.id === npc.id);
    const dialog = obj?.props["dialog"];
    if (typeof dialog === "string" && dialog !== "") {
      startDialog(session, project, dialog);
      return true;
    }
  }
  return fireEvents(session, project, session.mapId, x, y, "interact");
}

export function enterCell(
  session: Session,
  project: Project,
  mapId: string,
  x: number,
  y: number,
): void {
  fireEvents(session, project, mapId, x, y, "touch");
}
