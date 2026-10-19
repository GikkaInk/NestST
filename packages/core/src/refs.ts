import type { Condition } from "./dialogSchema.js";
import { NestError } from "./errors.js";
import { parseEventProps, parseNpcProps } from "./objectProps.js";
import type { Project } from "./project.js";
import type { MapObject } from "./schema.js";

export interface RefTarget {
  kind: "variable" | "dialog" | "map";
  id: string;
}

type VarTypes = Map<string, "flag" | "number">;

/** Collects reference problems; with `stopEarly`, scanning ends once `limit` is reached. */
interface Sink {
  out: string[];
  limit: number;
  stopEarly: boolean;
}

function add(sink: Sink, text: string): void {
  if (sink.out.length < sink.limit) sink.out.push(text);
}

const done = (sink: Sink): boolean => sink.stopEarly && sink.out.length >= sink.limit;

/** Props that cannot be parsed are not a reference problem: they always throw. */
function propsFail(text: string): never {
  throw new NestError("invalid_project", text);
}

function checkVariable(sink: Sink, types: VarTypes, id: string, where: string): "flag" | "number" | undefined {
  const t = types.get(id);
  if (t === undefined) add(sink, `${where}: variable "${id}" does not exist`);
  return t;
}

function checkCondition(sink: Sink, types: VarTypes, c: Condition, where: string): void {
  const t = checkVariable(sink, types, c.variable, where);
  if (t === undefined) return;
  const isFlag = typeof c.value === "boolean";
  if (isFlag !== (t === "flag")) {
    add(sink, `${where}: variable "${c.variable}" is a ${t}, so the condition value must be ${t === "flag" ? "true or false" : "a number"}`);
  }
}

function checkSet(
  sink: Sink,
  types: VarTypes,
  s: { variable: string; op: "set" | "add"; value: boolean | number },
  where: string,
): void {
  const t = checkVariable(sink, types, s.variable, where);
  if (t === undefined) return;
  if (s.op === "add" && t !== "number") {
    add(sink, `${where}: "add" needs a number variable, but "${s.variable}" is a flag`);
    return;
  }
  if ((typeof s.value === "boolean") !== (t === "flag")) {
    add(sink, `${where}: variable "${s.variable}" is a ${t}, so the value must be ${t === "flag" ? "true or false" : "a number"}`);
  }
}

function scan(project: Project, sink: Sink): void {
  const types: VarTypes = new Map(project.manifest.variables.map((v) => [v.id, v.type]));

  for (const dialog of Object.values(project.dialogs)) {
    for (const node of dialog.nodes) {
      if (done(sink)) return;
      const where = `dialog "${dialog.id}", node "${node.id}"`;
      if (node.type === "set") checkSet(sink, types, node, where);
      else if (node.type === "branch") checkCondition(sink, types, node.condition, where);
      else if (node.type === "choice") {
        node.options.forEach((o, i) => {
          if (o.condition) checkCondition(sink, types, o.condition, `${where}, option ${i + 1}`);
        });
      }
    }
  }

  for (const map of Object.values(project.maps)) {
    for (const obj of map.objects) {
      if (done(sink)) return;
      scanObject(sink, project, map.id, obj, types);
    }
  }
}

/**
 * Every reference problem in the project as plain English messages, at most `limit` (default 20).
 * Props that cannot even be parsed are not reference problems: those throw `invalid_project`.
 */
export function collectProjectRefProblems(project: Project, limit = 20): string[] {
  const sink: Sink = { out: [], limit, stopEarly: false };
  scan(project, sink);
  return sink.out;
}

/** Checks that every reference inside the project points at something that exists; throws on the first problem. */
export function validateProjectRefs(project: Project): void {
  const sink: Sink = { out: [], limit: 1, stopEarly: true };
  scan(project, sink);
  if (sink.out.length > 0) throw new NestError("invalid_project", sink.out[0]!);
}

/** Checks one `npc` or `event` object (props and references); other kinds are ignored. Throws `invalid_project`. */
export function checkObjectRefs(project: Project, mapId: string, obj: MapObject, types?: VarTypes): void {
  const sink: Sink = { out: [], limit: 1, stopEarly: true };
  scanObject(sink, project, mapId, obj, types);
  if (sink.out.length > 0) throw new NestError("invalid_project", sink.out[0]!);
}

function scanObject(sink: Sink, project: Project, mapId: string, obj: MapObject, types?: VarTypes): void {
  const varTypes: VarTypes = types ?? new Map(project.manifest.variables.map((v) => [v.id, v.type]));
  const hasDialog = (id: string) => Object.hasOwn(project.dialogs, id);
  const where = `map "${mapId}", ${obj.kind} "${obj.id}"`;
  if (obj.kind === "npc") {
    let props;
    try {
      props = parseNpcProps(obj.props);
    } catch (e) {
      propsFail(`${where}: ${(e as Error).message}`);
    }
    if (props!.dialog !== undefined && !hasDialog(props!.dialog)) {
      add(sink, `${where}: dialog "${props!.dialog}" does not exist`);
    }
  } else if (obj.kind === "event") {
    let props;
    try {
      props = parseEventProps(obj.props);
    } catch (e) {
      propsFail(`${where}: ${(e as Error).message}`);
    }
    if (props!.condition) checkCondition(sink, varTypes, props!.condition, `${where}, condition`);
    props!.actions.forEach((a, i) => {
      const at = `${where}, action ${i + 1}`;
      if (a.type === "dialog") {
        if (!hasDialog(a.dialog)) add(sink, `${at}: dialog "${a.dialog}" does not exist`);
      } else if (a.type === "set") {
        checkSet(sink, varTypes, a, at);
      } else {
        const target = Object.hasOwn(project.maps, a.map) ? project.maps[a.map] : undefined;
        if (target === undefined) {
          add(sink, `${at}: teleport goes to map "${a.map}", which does not exist`);
        } else if (a.x >= target.width || a.y >= target.height) {
          // A target cell with a solid tile is not checked here: the runtime handles it.
          add(sink, `${at}: teleport cell (${a.x}, ${a.y}) is outside map "${a.map}" (${target.width} x ${target.height})`);
        }
      }
    });
  }
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * Lenient scan of raw object props: works even when the props are invalid (e.g. half edited),
 * so such an object still shows up as a reference. Every access is guarded against wrong types.
 */
function propsRefer(raw: Record<string, unknown>, kind: string, t: RefTarget): boolean {
  if (kind === "npc") return t.kind === "dialog" && raw.dialog === t.id;
  if (t.kind === "variable" && asRecord(raw.condition)?.variable === t.id) return true;
  if (!Array.isArray(raw.actions)) return false;
  return raw.actions.some((item) => {
    const a = asRecord(item);
    if (a === undefined) return false;
    if (t.kind === "dialog") return a.dialog === t.id;
    if (t.kind === "variable") return a.variable === t.id;
    return a.map === t.id;
  });
}

/** Readable descriptions of everything that refers to `target`; empty when nothing does. */
export function findReferences(project: Project, target: RefTarget): string[] {
  const out: string[] = [];
  const usesVar = (c: Condition | undefined) => c !== undefined && target.kind === "variable" && c.variable === target.id;

  if (target.kind === "map" && project.manifest.startMapId === target.id) {
    out.push(`project map "${target.id}" is the start map`);
  }
  if (target.kind === "variable") {
    for (const dialog of Object.values(project.dialogs)) {
      for (const node of dialog.nodes) {
        const hit =
          (node.type === "set" && node.variable === target.id) ||
          (node.type === "branch" && usesVar(node.condition)) ||
          (node.type === "choice" && node.options.some((o) => usesVar(o.condition)));
        if (hit) out.push(`dialog "${dialog.id}", node "${node.id}"`);
      }
    }
  }

  for (const map of Object.values(project.maps)) {
    for (const obj of map.objects as MapObject[]) {
      if (obj.kind !== "npc" && obj.kind !== "event") continue;
      if (!propsRefer(obj.props, obj.kind, target)) continue;
      const name = typeof obj.props.name === "string" ? obj.props.name : obj.id;
      out.push(`${obj.kind} "${name}" on map "${map.id}"`);
    }
  }
  return out;
}
