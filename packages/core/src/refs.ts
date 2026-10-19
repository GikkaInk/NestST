import type { Condition } from "./dialogSchema.js";
import { NestError } from "./errors.js";
import { parseEventProps, parseNpcProps } from "./objectProps.js";
import type { EventAction } from "./objectProps.js";
import type { Project } from "./project.js";
import type { MapObject } from "./schema.js";

export interface RefTarget {
  kind: "variable" | "dialog" | "map";
  id: string;
}

type VarTypes = Map<string, "flag" | "number">;

function fail(text: string): never {
  throw new NestError("invalid_project", text);
}

function checkVariable(types: VarTypes, id: string, where: string): "flag" | "number" {
  const t = types.get(id);
  if (t === undefined) fail(`${where}: variable "${id}" does not exist`);
  return t!;
}

function checkCondition(types: VarTypes, c: Condition, where: string): void {
  const t = checkVariable(types, c.variable, where);
  const isFlag = typeof c.value === "boolean";
  if (isFlag !== (t === "flag")) {
    fail(`${where}: variable "${c.variable}" is a ${t}, so the condition value must be ${t === "flag" ? "true or false" : "a number"}`);
  }
}

function checkSet(
  types: VarTypes,
  s: { variable: string; op: "set" | "add"; value: boolean | number },
  where: string,
): void {
  const t = checkVariable(types, s.variable, where);
  if (s.op === "add" && t !== "number") fail(`${where}: "add" needs a number variable, but "${s.variable}" is a flag`);
  if ((typeof s.value === "boolean") !== (t === "flag")) {
    fail(`${where}: variable "${s.variable}" is a ${t}, so the value must be ${t === "flag" ? "true or false" : "a number"}`);
  }
}

/** Checks that every reference inside the project points at something that exists; throws on the first problem. */
export function validateProjectRefs(project: Project): void {
  const types: VarTypes = new Map(project.manifest.variables.map((v) => [v.id, v.type]));

  for (const dialog of Object.values(project.dialogs)) {
    for (const node of dialog.nodes) {
      const where = `dialog "${dialog.id}", node "${node.id}"`;
      if (node.type === "set") checkSet(types, node, where);
      else if (node.type === "branch") checkCondition(types, node.condition, where);
      else if (node.type === "choice") {
        node.options.forEach((o, i) => {
          if (o.condition) checkCondition(types, o.condition, `${where}, option ${i + 1}`);
        });
      }
    }
  }

  for (const map of Object.values(project.maps)) {
    for (const obj of map.objects) checkObjectRefs(project, map.id, obj, types);
  }
}

/** Checks one `npc` or `event` object (props and references); other kinds are ignored. Throws `invalid_project`. */
export function checkObjectRefs(project: Project, mapId: string, obj: MapObject, types?: VarTypes): void {
  const varTypes: VarTypes = types ?? new Map(project.manifest.variables.map((v) => [v.id, v.type]));
  const hasDialog = (id: string) => Object.hasOwn(project.dialogs, id);
  const where = `map "${mapId}", ${obj.kind} "${obj.id}"`;
  if (obj.kind === "npc") {
    let props;
    try {
      props = parseNpcProps(obj.props);
    } catch (e) {
      fail(`${where}: ${(e as Error).message}`);
    }
    if (props!.dialog !== undefined && !hasDialog(props!.dialog)) {
      fail(`${where}: dialog "${props!.dialog}" does not exist`);
    }
  } else if (obj.kind === "event") {
    let props;
    try {
      props = parseEventProps(obj.props);
    } catch (e) {
      fail(`${where}: ${(e as Error).message}`);
    }
    if (props!.condition) checkCondition(varTypes, props!.condition, `${where}, condition`);
    props!.actions.forEach((a, i) => {
      const at = `${where}, action ${i + 1}`;
      if (a.type === "dialog") {
        if (!hasDialog(a.dialog)) fail(`${at}: dialog "${a.dialog}" does not exist`);
      } else if (a.type === "set") {
        checkSet(varTypes, a, at);
      } else {
        const target = Object.hasOwn(project.maps, a.map) ? project.maps[a.map] : undefined;
        if (target === undefined) fail(`${at}: teleport goes to map "${a.map}", which does not exist`);
        if (a.x >= target!.width || a.y >= target!.height) {
          fail(`${at}: teleport cell (${a.x}, ${a.y}) is outside map "${a.map}" (${target!.width} x ${target!.height})`);
        }
      }
    });
  }
}

function actionRefs(a: EventAction, t: RefTarget): boolean {
  if (a.type === "dialog") return t.kind === "dialog" && a.dialog === t.id;
  if (a.type === "set") return t.kind === "variable" && a.variable === t.id;
  return t.kind === "map" && a.map === t.id;
}

function safe<T>(parse: () => T): T | undefined {
  try {
    return parse();
  } catch {
    return undefined;
  }
}

/** Readable descriptions of everything that refers to `target`; empty when nothing does. */
export function findReferences(project: Project, target: RefTarget): string[] {
  const out: string[] = [];
  const usesVar = (c: Condition | undefined) => c !== undefined && target.kind === "variable" && c.variable === target.id;

  if (target.kind === "variable") {
    for (const dialog of Object.values(project.dialogs)) {
      for (const node of dialog.nodes) {
        const hit =
          (node.type === "set" && node.variable === target.id) ||
          (node.type === "branch" && usesVar(node.condition)) ||
          (node.type === "choice" && node.options.some((o) => usesVar(o.condition)));
        if (hit) out.push(`dialog "${dialog.id}", node ${node.id}`);
      }
    }
  }

  for (const map of Object.values(project.maps)) {
    for (const obj of map.objects as MapObject[]) {
      const label = (what: string) => `${what} "${typeof obj.props.name === "string" ? obj.props.name : obj.id}" on map "${map.id}"`;
      if (obj.kind === "npc") {
        const p = safe(() => parseNpcProps(obj.props));
        if (p && target.kind === "dialog" && p.dialog === target.id) out.push(label("npc"));
      } else if (obj.kind === "event") {
        const p = safe(() => parseEventProps(obj.props));
        if (p && (usesVar(p.condition) || p.actions.some((a) => actionRefs(a, target)))) out.push(label("event"));
      }
    }
  }
  return out;
}
