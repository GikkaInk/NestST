/** Pure helpers behind the Variables table and the object inspector (no React). */
import { MAX_VALUE } from "@nestst/core";
import type { CompareOp, EventAction, Project, VariableDef } from "@nestst/core";

export interface VariableRow {
  id: string;
  name: string;
  type: VariableDef["type"];
  initial: boolean | number;
}

/** One row per variable, in manifest order. */
export function variableRows(project: Project): VariableRow[] {
  return project.manifest.variables.map((v) => ({ id: v.id, name: v.name, type: v.type, initial: v.initial }));
}

/** First free `var-N` id. */
export function newVariableId(existing: ReadonlyArray<{ id: string }>): string {
  const used = new Set(existing.map((v) => v.id));
  let n = 1;
  while (used.has(`var-${n}`)) n++;
  return `var-${n}`;
}

const FLAG_OPS: readonly CompareOp[] = ["==", "!="];
const NUMBER_OPS: readonly CompareOp[] = ["==", "!=", ">", "<", ">=", "<="];

/** Comparison operators allowed for a variable type. */
export function operatorsFor(type: VariableDef["type"]): readonly CompareOp[] {
  return type === "flag" ? FLAG_OPS : NUMBER_OPS;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** A whole number from -1,000,000 to 1,000,000 typed into a field. */
export function checkNumber(text: string): Checked<number> {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) return { ok: false, message: "Enter a whole number." };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_VALUE) {
    return { ok: false, message: `The number must be from -${MAX_VALUE} to ${MAX_VALUE}.` };
  }
  return { ok: true, value: n };
}

/** A teleport target cell must be inside the target map. */
export function checkTeleport(project: Project, mapId: string, x: number, y: number): Checked<{ x: number; y: number }> {
  const map = Object.hasOwn(project.maps, mapId) ? project.maps[mapId] : undefined;
  if (map === undefined) return { ok: false, message: "Choose an existing map." };
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { ok: false, message: `The cell must be inside the map (x 0 to ${map.width - 1}, y 0 to ${map.height - 1}).` };
  }
  return { ok: true, value: { x, y } };
}

/** A new action of the given kind, or null when the project has nothing to point it at. */
export function defaultAction(kind: EventAction["type"], project: Project, mapId: string): EventAction | null {
  if (kind === "dialog") {
    const id = project.manifest.dialogs[0]?.id ?? Object.keys(project.dialogs)[0];
    return id === undefined ? null : { type: "dialog", dialog: id };
  }
  if (kind === "set") {
    const v = project.manifest.variables[0];
    if (v === undefined) return null;
    return v.type === "flag"
      ? { type: "set", variable: v.id, op: "set", value: true }
      : { type: "set", variable: v.id, op: "add", value: 1 };
  }
  return { type: "teleport", map: mapId, x: 0, y: 0 };
}

/** Edit controls work only while the editor is idle or saving (not playing, loading or in a folder dialog). */
export function canEditMode(mode: string): boolean {
  return mode === "idle" || mode === "saving";
}
