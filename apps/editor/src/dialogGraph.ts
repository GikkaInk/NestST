import { MAX_CHOICE_OPTIONS, MAX_DIALOG_NODES } from "@nestst/core";
import type { Dialog, DialogNode, VariableDef } from "@nestst/core";

/**
 * Pure functions behind the dialog node editor. Every function returns a new
 * Dialog and never touches its input. A request that cannot be done (unknown
 * node, bad handle, a limit reached) is not an error: the input object is
 * returned as it is, so callers can compare with `===` to see "nothing changed".
 * Results always pass `parseDialog` (limits: 500 nodes, 1..6 options per choice).
 */

export type NodeType = DialogNode["type"];

/** Id of the flow node that stands for "the dialog starts here". Dialog nodes are named `n<k>`, so it never collides. */
export const START_MARKER_ID = "__start__";
export const START_HANDLE = "start";
const NEXT_HANDLE = "next";

const MAX_POSITION = 1000000;
/** Used when a set/branch node is added and the project has no variables; the editor disables adding then. */
const PLACEHOLDER_VARIABLE = "var-1";

export interface FlowNodeData extends Record<string, unknown> {
  /** The dialog node; null for the start marker. */
  node: DialogNode | null;
  isStart: boolean;
}

export interface FlowNode {
  id: string;
  type: NodeType | "start";
  position: { x: number; y: number };
  data: FlowNodeData;
  draggable?: boolean;
  deletable?: boolean;
  selectable?: boolean;
}

export interface FlowEdge {
  /** `<source>:<handle>`, so it is the same on every render. */
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  deletable?: boolean;
}

export interface ConnectRequest {
  source: string;
  sourceHandle: string | null;
  target: string;
}

const edgeId = (source: string, handle: string): string => `${source}:${handle}`;

export function dialogToFlow(dialog: Dialog): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const startNode = dialog.nodes.find((n) => n.id === dialog.start);
  const nodes: FlowNode[] = [
    {
      id: START_MARKER_ID,
      type: "start",
      position: { x: (startNode?.x ?? 0) - 150, y: startNode?.y ?? 0 },
      data: { node: null, isStart: false },
      draggable: false,
      deletable: false,
    },
  ];
  const edges: FlowEdge[] = [];
  const link = (source: string, handle: string, target: string | null): void => {
    if (target !== null) edges.push({ id: edgeId(source, handle), source, sourceHandle: handle, target });
  };
  link(START_MARKER_ID, START_HANDLE, dialog.start);
  if (edges[0]) edges[0].deletable = true;
  for (const n of dialog.nodes) {
    nodes.push({ id: n.id, type: n.type, position: { x: n.x, y: n.y }, data: { node: n, isStart: n.id === dialog.start } });
    switch (n.type) {
      case "say":
      case "set":
        link(n.id, NEXT_HANDLE, n.next);
        break;
      case "choice":
        n.options.forEach((o, i) => link(n.id, `opt-${i}`, o.next));
        break;
      case "branch":
        link(n.id, "then", n.then);
        link(n.id, "else", n.else);
        break;
    }
  }
  return { nodes, edges };
}

/** Sets the link of the (source, handle) pair; null clears it. Unknown pairs give null (= not possible). */
function withLink(n: DialogNode, handle: string | null, target: string | null): DialogNode | null {
  switch (n.type) {
    case "say":
    case "set":
      return handle === null || handle === NEXT_HANDLE ? { ...n, next: target } : null;
    case "choice": {
      const m = handle === null ? null : /^opt-(\d+)$/.exec(handle);
      const i = m ? Number(m[1]) : -1;
      if (i < 0 || i >= n.options.length) return null;
      return { ...n, options: n.options.map((o, j) => (j === i ? { ...o, next: target } : o)) };
    }
    case "branch":
      if (handle === "then") return { ...n, then: target };
      if (handle === "else") return { ...n, else: target };
      return null;
  }
}

/** Swaps one node; if it comes out equal to the old one, the input is returned. */
function replace(dialog: Dialog, id: string, next: DialogNode): Dialog {
  const old = dialog.nodes.find((n) => n.id === id);
  if (old && JSON.stringify(old) === JSON.stringify(next)) return dialog;
  return { ...dialog, nodes: dialog.nodes.map((n) => (n.id === id ? next : n)) };
}

export function applyConnect(dialog: Dialog, c: ConnectRequest): Dialog {
  if (!dialog.nodes.some((n) => n.id === c.target)) return dialog;
  if (c.source === START_MARKER_ID) {
    return c.sourceHandle === null || c.sourceHandle === START_HANDLE ? { ...dialog, start: c.target } : dialog;
  }
  const source = dialog.nodes.find((n) => n.id === c.source);
  if (!source) return dialog;
  const next = withLink(source, c.sourceHandle, c.target);
  return next ? replace(dialog, source.id, next) : dialog;
}

export function applyDisconnect(dialog: Dialog, id: string): Dialog {
  // Handles never contain ":", node ids might, so split at the last one.
  const cut = id.lastIndexOf(":");
  if (cut <= 0) return dialog;
  const source = id.slice(0, cut);
  const handle = id.slice(cut + 1);
  if (source === START_MARKER_ID) {
    return handle === START_HANDLE && dialog.start !== null ? { ...dialog, start: null } : dialog;
  }
  const node = dialog.nodes.find((n) => n.id === source);
  if (!node) return dialog;
  const next = withLink(node, handle, null);
  return next ? replace(dialog, source, next) : dialog;
}

function clampPos(v: number): number {
  return Math.max(-MAX_POSITION, Math.min(MAX_POSITION, Math.round(v)));
}

/** Smallest unused `n<k>`. */
function newNodeId(dialog: Dialog): string {
  const used = new Set(dialog.nodes.map((n) => n.id));
  for (let k = 1; ; k++) if (!used.has(`n${k}`)) return `n${k}`;
}

function defaultNode(type: NodeType, id: string, x: number, y: number, vars: readonly VariableDef[]): DialogNode {
  const v = vars[0];
  switch (type) {
    case "say":
      return { id, x, y, type, speaker: "", text: "New line", next: null };
    case "choice":
      return { id, x, y, type, options: [{ text: "Option 1", next: null }] };
    case "set":
      return v?.type === "number"
        ? { id, x, y, type, variable: v.id, op: "add", value: 1, next: null }
        : { id, x, y, type, variable: v?.id ?? PLACEHOLDER_VARIABLE, op: "set", value: true, next: null };
    case "branch":
      return {
        id, x, y, type,
        condition: { variable: v?.id ?? PLACEHOLDER_VARIABLE, op: "==", value: v?.type === "number" ? 0 : true },
        then: null,
        else: null,
      };
  }
}

/**
 * Adds a node with default values. The first node of a dialog with `start === null`
 * becomes the start. `variables` feeds set/branch defaults. At 500 nodes the input is returned.
 */
export function addNode(
  dialog: Dialog,
  type: NodeType,
  pos: { x: number; y: number },
  variables: readonly VariableDef[] = [],
): Dialog {
  if (dialog.nodes.length >= MAX_DIALOG_NODES || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return dialog;
  const id = newNodeId(dialog);
  const node = defaultNode(type, id, clampPos(pos.x), clampPos(pos.y), variables);
  return { ...dialog, start: dialog.start ?? id, nodes: [...dialog.nodes, node] };
}

export function removeNode(dialog: Dialog, id: string): Dialog {
  if (!dialog.nodes.some((n) => n.id === id)) return dialog;
  const nodes = dialog.nodes
    .filter((n) => n.id !== id)
    .map((n): DialogNode => {
      switch (n.type) {
        case "say":
        case "set":
          return n.next === id ? { ...n, next: null } : n;
        case "choice":
          return n.options.some((o) => o.next === id)
            ? { ...n, options: n.options.map((o) => (o.next === id ? { ...o, next: null } : o)) }
            : n;
        case "branch":
          return n.then === id || n.else === id
            ? { ...n, then: n.then === id ? null : n.then, else: n.else === id ? null : n.else }
            : n;
      }
    });
  return { ...dialog, start: dialog.start === id ? null : dialog.start, nodes };
}

export function moveNode(dialog: Dialog, id: string, pos: { x: number; y: number }): Dialog {
  const n = dialog.nodes.find((x) => x.id === id);
  if (!n || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return dialog;
  const x = clampPos(pos.x);
  const y = clampPos(pos.y);
  return x === n.x && y === n.y ? dialog : replace(dialog, id, { ...n, x, y });
}

export function setStart(dialog: Dialog, id: string): Dialog {
  if (!dialog.nodes.some((n) => n.id === id) || dialog.start === id) return dialog;
  return { ...dialog, start: id };
}

/** Adds an empty option to a choice (max 6). */
export function addOption(dialog: Dialog, id: string): Dialog {
  const n = dialog.nodes.find((x) => x.id === id);
  if (n?.type !== "choice" || n.options.length >= MAX_CHOICE_OPTIONS) return dialog;
  return replace(dialog, id, { ...n, options: [...n.options, { text: `Option ${n.options.length + 1}`, next: null }] });
}

/** Removes option `index` of a choice (at least one stays). */
export function removeOption(dialog: Dialog, id: string, index: number): Dialog {
  const n = dialog.nodes.find((x) => x.id === id);
  if (n?.type !== "choice" || n.options.length <= 1 || !Number.isInteger(index) || index < 0 || index >= n.options.length) {
    return dialog;
  }
  return replace(dialog, id, { ...n, options: n.options.filter((_, i) => i !== index) });
}

const COL = 280;
const ROW = 170;

/** First grid cell (left to right, top to bottom) with no node close to it. */
export function findFreeSpot(dialog: Dialog): { x: number; y: number } {
  for (let row = 0; ; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 40 + col * COL;
      const y = 40 + row * ROW;
      if (!dialog.nodes.some((n) => Math.abs(n.x - x) < COL * 0.7 && Math.abs(n.y - y) < ROW * 0.7)) return { x, y };
    }
  }
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** One short line for the node card; `names` maps variable ids to display names. */
export function nodeSummary(node: DialogNode, names: ReadonlyMap<string, string> = new Map()): string {
  const name = (id: string): string => names.get(id) ?? id;
  switch (node.type) {
    case "say":
      return node.speaker === "" ? clip(node.text, 60) : `${clip(node.speaker, 20)}: ${clip(node.text, 50)}`;
    case "choice":
      return node.options.length === 1 ? "1 option" : `${node.options.length} options`;
    case "set":
      return `${name(node.variable)} ${node.op === "add" ? "+=" : "="} ${String(node.value)}`;
    case "branch":
      return `if ${name(node.condition.variable)} ${node.condition.op} ${String(node.condition.value)}`;
  }
}
