/**
 * Content commands (variables, dialogs, object props). Same contract as objectOps.ts:
 * a command is validated once, when it is created, against the project passed as `before`;
 * `apply`/`revert` are deltas over whatever project they get and do NOT re-validate.
 * So a command must be created from the CURRENT project and pushed right away
 * (this is how the store's commit(cmd) works). Guards such as "variable is still used"
 * fire at creation time through findReferences, on the then-current project.
 */
import { MAX_DIALOGS, MAX_VARIABLES, parseDialog, variableDefSchema } from "./dialogSchema.js";
import type { Dialog, VariableDef } from "./dialogSchema.js";
import { NestError } from "./errors.js";
import type { Command } from "./mapOps.js";
import { parseEventProps, parseNpcProps } from "./objectProps.js";
import type { Project } from "./project.js";
import { checkObjectRefs, findReferences, validateProjectRefs } from "./refs.js";
import type { RefTarget } from "./refs.js";
import type { GameMap, MapObject } from "./schema.js";

function fail(why: string): never {
  throw new NestError("invalid_edit", why);
}

/** Refuses with the list of places that refer to `target`. */
function refuseIfReferenced(project: Project, target: RefTarget, what: string): void {
  const refs = findReferences(project, target);
  if (refs.length > 0) fail(`cannot ${what}: it is used by ${refs.join("; ")}`);
}

/** Validates a variable list with the manifest rules (item shape, unique ids, limit). */
function checkVariables(variables: readonly VariableDef[]): VariableDef[] {
  if (variables.length > MAX_VARIABLES) {
    fail(`too many variables: ${variables.length}, the limit is ${MAX_VARIABLES}`);
  }
  const ids = new Set<string>();
  return variables.map((v, i) => {
    const res = variableDefSchema.safeParse(v);
    if (!res.success) {
      const issue = res.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      fail(`variable ${i + 1}${path ? `, field ${path}` : ""}: ${issue?.message ?? "is invalid"}`);
    }
    const def = res.data!;
    if (ids.has(def.id)) fail(`variable "${def.id}" is listed more than once`);
    ids.add(def.id);
    return def;
  });
}

/** Replaces the variable list; refuses to remove or retype a variable that something uses. */
export function setVariablesCommand(variables: VariableDef[], before: Project): Command {
  const next = checkVariables(variables);
  const old = before.manifest.variables;
  for (const o of old) {
    const kept = next.find((v) => v.id === o.id);
    if (kept === undefined) {
      const hint = next.some((v) => !old.some((x) => x.id === v.id))
        ? " (rename is not supported: create a new variable and update the references)"
        : "";
      const refs = findReferences(before, { kind: "variable", id: o.id });
      if (refs.length > 0) {
        fail(`cannot remove variable "${o.id}": it is used by ${refs.join("; ")}${hint}`);
      }
    } else if (kept.type !== o.type) {
      refuseIfReferenced(before, { kind: "variable", id: o.id }, `change the type of variable "${o.id}"`);
    }
  }
  const set = (p: Project, list: VariableDef[]): Project => ({
    ...p,
    manifest: { ...p.manifest, variables: list },
  });
  return {
    label: "Edit variables",
    apply: (p) => set(p, next),
    revert: (p) => set(p, old),
  };
}

const dialogFile = (id: string): string => `dialogs/${id}.json`;

/** Creates a dialog or replaces the one with the same id; manifest and `project.dialogs` stay in sync. */
export function upsertDialogCommand(dialog: Dialog, before: Project): Command {
  let parsed: Dialog;
  try {
    parsed = parseDialog(dialog);
  } catch (e) {
    return fail((e as Error).message);
  }
  const id = parsed.id;
  const old = Object.hasOwn(before.dialogs, id) ? before.dialogs[id] : undefined;
  if (old === undefined && before.manifest.dialogs.length >= MAX_DIALOGS) {
    fail(`too many dialogs: the limit is ${MAX_DIALOGS}`);
  }
  try {
    // Only this dialog is checked: other dialogs and objects are not its business.
    validateProjectRefs({ ...before, maps: {}, dialogs: { [id]: parsed } });
  } catch (e) {
    fail((e as Error).message);
  }
  const oldIndex = before.manifest.dialogs.findIndex((d) => d.id === id);
  const upsert = (p: Project): Project => {
    const dialogs = { ...p.dialogs, [id]: parsed };
    if (p.manifest.dialogs.some((d) => d.id === id)) return { ...p, dialogs };
    const entries = p.manifest.dialogs.concat({ id, file: dialogFile(id) });
    return { ...p, dialogs, manifest: { ...p.manifest, dialogs: entries } };
  };
  return {
    label: old === undefined ? "Add dialog" : "Edit dialog",
    apply: upsert,
    revert: (p) => {
      if (old !== undefined) {
        const restored = { ...p.dialogs, [id]: old };
        if (p.manifest.dialogs.some((d) => d.id === id)) return { ...p, dialogs: restored };
        const entries = p.manifest.dialogs.slice();
        entries.splice(Math.min(oldIndex, entries.length), 0, { id, file: dialogFile(id) });
        return { ...p, dialogs: restored, manifest: { ...p.manifest, dialogs: entries } };
      }
      const { [id]: _gone, ...rest } = p.dialogs;
      const entries = p.manifest.dialogs.filter((d) => d.id !== id);
      return { ...p, dialogs: rest, manifest: { ...p.manifest, dialogs: entries } };
    },
  };
}

/** Removes a dialog nothing refers to; undo puts the dialog and its manifest entry back in place. */
export function removeDialogCommand(id: string, before: Project): Command {
  const old = Object.hasOwn(before.dialogs, id) ? before.dialogs[id] : undefined;
  if (old === undefined) fail(`dialog "${id}" does not exist`);
  refuseIfReferenced(before, { kind: "dialog", id }, `remove dialog "${id}"`);
  const index = before.manifest.dialogs.findIndex((d) => d.id === id);
  const entry = before.manifest.dialogs[index] ?? { id, file: dialogFile(id) };
  return {
    label: "Remove dialog",
    apply: (p) => {
      const { [id]: _gone, ...rest } = p.dialogs;
      const entries = p.manifest.dialogs.filter((d) => d.id !== id);
      return { ...p, dialogs: rest, manifest: { ...p.manifest, dialogs: entries } };
    },
    revert: (p) => {
      const entries = p.manifest.dialogs.filter((d) => d.id !== id);
      entries.splice(Math.min(Math.max(index, 0), entries.length), 0, entry);
      return { ...p, dialogs: { ...p.dialogs, [id]: old! }, manifest: { ...p.manifest, dialogs: entries } };
    },
  };
}

function withProps(p: Project, mapId: string, objectId: string, props: Record<string, unknown>): Project {
  const map: GameMap | undefined = Object.hasOwn(p.maps, mapId) ? p.maps[mapId] : undefined;
  if (map === undefined) throw new NestError("unknown_map", `map "${mapId}" does not exist in the project`);
  if (!map!.objects.some((o) => o.id === objectId)) {
    fail(`object "${objectId}" does not exist in map "${mapId}"`);
  }
  const objects = map!.objects.map((o) => (o.id === objectId ? { ...o, props: { ...props } } : o));
  return { ...p, maps: { ...p.maps, [mapId]: { ...map!, objects } } };
}

/** Replaces the props of an NPC or event; props and references are validated. Spawns are refused. */
export function setObjectPropsCommand(
  mapId: string,
  objectId: string,
  props: Record<string, unknown>,
  before: Project,
): Command {
  const map = Object.hasOwn(before.maps, mapId) ? before.maps[mapId] : undefined;
  if (map === undefined) throw new NestError("unknown_map", `map "${mapId}" does not exist in the project`);
  const obj: MapObject | undefined = map.objects.find((o) => o.id === objectId);
  if (obj === undefined) fail(`in map "${map.name}": object "${objectId}" does not exist`);
  if (obj!.kind !== "npc" && obj!.kind !== "event") {
    fail(`in map "${map.name}": a ${obj!.kind} has no properties to edit`);
  }
  // Keep a deep copy of the parsed props (unknown extra keys survive), so the caller's objects are not aliased.
  let next: Record<string, unknown>;
  try {
    const parsed = obj!.kind === "npc" ? parseNpcProps(props) : parseEventProps(props);
    next = structuredClone(parsed) as unknown as Record<string, unknown>;
    checkObjectRefs(before, mapId, { ...obj!, props: next });
  } catch (e) {
    return fail((e as Error).message);
  }
  const old = obj!.props;
  return {
    label: obj!.kind === "npc" ? "Edit NPC" : "Edit event",
    apply: (p) => withProps(p, mapId, objectId, next),
    revert: (p) => withProps(p, mapId, objectId, old),
  };
}

/** Throws `invalid_edit` when `mapId` is the start map or a teleport leads to it. For future map deletion. */
export function removeMapGuard(project: Project, mapId: string): void {
  if (!Object.hasOwn(project.maps, mapId)) {
    throw new NestError("unknown_map", `map "${mapId}" does not exist in the project`);
  }
  refuseIfReferenced(project, { kind: "map", id: mapId }, `remove map "${mapId}"`);
}
