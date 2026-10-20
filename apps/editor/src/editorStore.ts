import {
  History,
  MANIFEST_FILE,
  BUILTIN_TILE_COUNT,
  collectProjectRefProblems,
  createEmptyProject,
  loadProject,
  mergeCommands,
  nextNpcId,
  objectAt,
  paintCommand,
  placeObjectCommand,
  removeDialogCommand,
  removeObjectCommand,
  saveProject,
  setObjectPropsCommand,
  setSolidCommand,
  setVariablesCommand,
  upsertDialogCommand,
} from "@nestst/core";
import { addNode, findFreeSpot } from "./dialogGraph.js";
import type {
  BackupFile,
  Command,
  Dialog,
  EventProps,
  Project,
  ProjectStorage,
  TileEdit,
  VariableDef,
} from "@nestst/core";

export type Tool = "brush" | "eraser" | "spawn" | "npc" | "event" | "select";
export const TOOLS: readonly Tool[] = ["brush", "eraser", "spawn", "npc", "event", "select"];

export type EditorView = "map" | "dialogs" | "variables";
const VIEWS: readonly EditorView[] = ["map", "dialogs", "variables"];

/** A project folder picked by the user, with the storage that reaches it. */
export interface OpenedFolder {
  storage: ProjectStorage;
  /** Shown to the user, e.g. the folder path. */
  label: string;
}

/**
 * How the store gets a folder: the editor shows a folder dialog (Tauri), tests
 * return a MemoryStorage. `null` means the user cancelled.
 */
export interface ProjectSession {
  pickNew(): Promise<OpenedFolder | null>;
  pickOpen(): Promise<OpenedFolder | null>;
}

export type EditorMode = "idle" | "saving" | "loading" | "dialog" | "playing";

/** New/Open/Save must not start while the editor is doing something else (including Play). */
export function isBusy(s: Pick<EditorState, "mode">): boolean {
  return s.mode !== "idle";
}

export interface EditorState {
  project: Project | null;
  currentMapId: string | null;
  tool: Tool;
  selectedTile: number;
  /** There are changes that are not saved to disk. */
  dirty: boolean;
  /** Plain English message for the error banner. */
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * What the store is doing: `dialog` = the folder dialog is open, `loading` =
   * reading/writing the picked folder, `saving` = a save is running.
   */
  mode: EditorMode;
  /** Plain English info message (e.g. about the format update), or null. */
  notice: string | null;
  projectName: string;
  rootLabel: string;
  /** Draw the solid-tile overlay on the map. */
  showSolid: boolean;
  /** Counts opened/created projects; changes only when a project is adopted. */
  openSeq: number;
  /** True after a successful `play()`; reset when a project is adopted. */
  playedOnce: boolean;
  /** Which editor tab is shown. Not part of the history. */
  view: EditorView;
  /** Object picked with the select tool on the current map, or null. */
  selectedObjectId: string | null;
  /** Dialog open in the dialogs tab, or null. */
  activeDialogId: string | null;
  /** Map the running game started on; null unless playing. */
  playingMapId: string | null;
  /**
   * Broken references in the open project (plain English, up to 20). Kept here, not in the
   * project, so history snapshots stay untouched. Re-checked after every edit.
   */
  refProblems: string[];
}

function hasSpawn(project: Project, mapId: string): boolean {
  const map = Object.hasOwn(project.maps, mapId) ? project.maps[mapId] : undefined;
  return map !== undefined && map.objects.some((o) => o.kind === "spawn");
}

/** Map Play starts on: the current one if it has a spawn, else the start map if it has one, else null. */
export function playMapId(s: Pick<EditorState, "project" | "currentMapId" | "mode">): string | null {
  const project = s.project;
  if (project === null) return null;
  if (s.currentMapId !== null && hasSpawn(project, s.currentMapId)) return s.currentMapId;
  const start = project.manifest.startMapId;
  return hasSpawn(project, start) ? start : null;
}

/** Play needs a project with a spawn (see `playMapId`), no broken references, and an idle editor. */
export function canPlay(
  s: Pick<EditorState, "project" | "currentMapId" | "mode"> & Partial<Pick<EditorState, "refProblems">>,
): boolean {
  return s.mode === "idle" && (s.refProblems?.length ?? 0) === 0 && playMapId(s) !== null;
}

/**
 * Props of a freshly placed event. Valid by construction: with no dialogs it
 * teleports to its own cell (a placeholder), otherwise it starts the first dialog.
 */
export function defaultEventProps(project: Project, mapId: string, x: number, y: number): EventProps {
  const map = Object.hasOwn(project.maps, mapId) ? project.maps[mapId] : undefined;
  const used = new Set<string>();
  for (const o of map?.objects ?? []) {
    const name = (o.props as { name?: unknown }).name;
    if (o.kind === "event" && typeof name === "string") used.add(name);
  }
  let n = 1;
  while (used.has(`Event ${n}`)) n++;
  const firstDialog = project.manifest.dialogs[0]?.id ?? Object.keys(project.dialogs)[0];
  return {
    name: `Event ${n}`,
    trigger: "touch",
    once: false,
    actions: firstDialog !== undefined
      ? [{ type: "dialog", dialog: firstDialog }]
      : [{ type: "teleport", map: mapId, x, y }],
  };
}

const RESERVED_ID = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Unique dialog id from a name: lowercase [a-z0-9-], fallback `dialog`, suffix -2, -3 ... on collisions, max 64 chars. */
function dialogIdFor(name: string, taken: (id: string) => boolean): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let base = slug.slice(0, 64).replace(/-+$/, "") || "dialog";
  // Windows device names are reserved ids; `con` becomes `con-1`.
  if (RESERVED_ID.test(base)) base = `${base}-1`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = `${base.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken(id)) return id;
  }
}

export interface EditorStore {
  getState(): EditorState;
  /** The listener runs after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Asks for a folder, creates the project there and saves it. True on success. */
  newProject(name: string): Promise<boolean>;
  /** Asks for a folder and loads the project from it. True on success. */
  open(): Promise<boolean>;
  save(): Promise<boolean>;
  /** One brush drag = one undo step. True if the map changed. */
  paintStroke(edits: readonly TileEdit[]): boolean;
  /** Places a spawn or an NPC (by the current tool) on the cell. True if the map changed. */
  placeObjectAt(x: number, y: number): boolean;
  setView(view: EditorView): void;
  selectObject(id: string | null): void;
  /** Selects the object on the cell; an empty cell clears the selection. True if an object was selected. */
  selectObjectAt(x: number, y: number): boolean;
  /** Replaces the props of an NPC or event on the current map (through the history). */
  setObjectProps(id: string, props: Record<string, unknown>): boolean;
  setVariables(vars: VariableDef[]): boolean;
  saveDialog(dialog: Dialog): boolean;
  deleteDialog(id: string): boolean;
  selectDialog(id: string | null): void;
  /** Creates an empty dialog named `name`, selects it and returns its id; null on error. */
  newDialog(name: string): string | null;
  /** Creates a starter dialog for an NPC of the current map and binds it, as one undo step. */
  newDialogForObject(objectId: string): string | null;
  /** Removes the object on the cell. False if there is none. */
  removeObjectAt(x: number, y: number): boolean;
  /** Marks a tile as solid or passable (through the history). */
  setTileSolid(tile: number, solid: boolean): boolean;
  toggleShowSolid(): void;
  /** Enters play mode; false unless `canPlay`. */
  play(): boolean;
  stopPlay(): void;
  undo(): void;
  redo(): void;
  selectTool(tool: Tool): void;
  selectTile(tile: number): void;
  dismissError(): void;
  /** Shows a plain English message in the error banner. */
  reportError(message: string): void;
  dismissNotice(): void;
}

/** Tile a stroke paints with the current tool: the eraser paints 0 (empty). */
export function strokeTile(state: Pick<EditorState, "tool" | "selectedTile">): number {
  return state.tool === "eraser" ? 0 : state.selectedTile;
}

const HISTORY_LIMIT = 200;
const MIGRATION_NOTICE =
  "Project updated to the new format. A backup of the old files will be saved to .nestst-backup when you save.";

function describe(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "an unexpected problem happened";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ensurePeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Edits that really change the map: for each cell only the last edit counts,
 * and it is kept only if it differs from what the cell holds now. Assumes the
 * edits were already validated (paintCommand throws on bad ones).
 */
function effectiveEdits(project: Project, mapId: string, edits: readonly TileEdit[]): TileEdit[] {
  const map = project.maps[mapId]!;
  const layerIndex = new Map(map.layers.map((l, i) => [l.id, i] as const));
  const last = new Map<string, TileEdit>();
  for (const e of edits) {
    const key = `${e.layerId}\u0000${e.x}\u0000${e.y}`;
    last.delete(key); // keep insertion order = order of the final edit
    last.set(key, e);
  }
  const out: TileEdit[] = [];
  for (const e of last.values()) {
    const layer = map.layers[layerIndex.get(e.layerId)!]!;
    if (layer.tiles[e.y * map.width + e.x] !== e.tile) out.push(e);
  }
  return out;
}

export function createEditorStore(session: ProjectSession): EditorStore {
  const listeners = new Set<() => void>();
  let history = new History(HISTORY_LIMIT);
  let storage: ProjectStorage | null = null;

  // Dirty tracking: each history step gets an id; the project is clean when the
  // step on top of the undo stack is the one that was on top at the last save.
  let nextStepId = 1;
  let doneIds: number[] = [];
  let undoneIds: number[] = [];
  let savedId = 0;
  // Id of the state the oldest remaining undo step returns to: 0 (the opened
  // state) until the history overflows, then the id of the last evicted step.
  let floorId = 0;
  const topId = () => doneIds.at(-1) ?? floorId;
  // Bumped by every change of the open project (paint, undo, redo). A folder
  // dialog may stay open while the user keeps working; if the project changed
  // meanwhile, new/open must not replace it without asking again.
  let version = 0;
  const CHANGED_DURING_DIALOG =
    "The project changed while the folder dialog was open, so nothing was opened. Save or undo your changes and try again.";

  // Old-format files to copy into .nestst-backup on the next successful save.
  let pendingBackup: readonly BackupFile[] = [];

  let state: EditorState = {
    project: null,
    currentMapId: null,
    tool: "brush",
    selectedTile: 1,
    dirty: false,
    error: null,
    canUndo: false,
    canRedo: false,
    mode: "idle",
    notice: null,
    projectName: "",
    rootLabel: "",
    showSolid: true,
    openSeq: 0,
    playedOnce: false,
    view: "map",
    selectedObjectId: null,
    activeDialogId: null,
    playingMapId: null,
    refProblems: [],
  };

  const set = (patch: Partial<EditorState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) {
      try {
        l();
      } catch (e) {
        console.error(e); // one broken subscriber must not break the store or its caller
      }
    }
  };

  const historyPatch = (): Pick<EditorState, "canUndo" | "canRedo" | "dirty"> => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    dirty: topId() !== savedId,
  });

  /** Current broken references of `project`; keeps the old list if the check itself cannot run. */
  const recheckRefs = (project: Project): string[] => {
    try {
      const found = collectProjectRefProblems(project);
      return found.length === 0 && state.refProblems.length === 0 ? state.refProblems : found;
    } catch {
      return state.refProblems;
    }
  };

  /** Patch after the project changed: history flags, and selections that point at something that is gone. */
  const changePatch = (project: Project): Partial<EditorState> => {
    const map = state.currentMapId !== null && Object.hasOwn(project.maps, state.currentMapId)
      ? project.maps[state.currentMapId]
      : undefined;
    const selected = state.selectedObjectId;
    const dialog = state.activeDialogId;
    return {
      project,
      refProblems: recheckRefs(project),
      ...historyPatch(),
      ...(selected !== null && !map?.objects.some((o) => o.id === selected) ? { selectedObjectId: null } : {}),
      ...(dialog !== null && !Object.hasOwn(project.dialogs, dialog) ? { activeDialogId: null } : {}),
    };
  };

  /** Installs a freshly created or loaded project as the clean current one. */
  const adopt = (project: Project, picked: OpenedFolder): void => {
    storage = picked.storage;
    history = new History(HISTORY_LIMIT);
    doneIds = [];
    undoneIds = [];
    savedId = 0;
    floorId = 0;
    const mapId = Object.hasOwn(project.maps, project.manifest.startMapId)
      ? project.manifest.startMapId
      : (project.manifest.maps[0]?.id ?? null);
    pendingBackup = project.migratedFrom ?? [];
    // Reference problems live in the store state, not in the project that goes through the history.
    const { refProblems = [], ...clean } = project;
    project = clean;
    set({
      project,
      refProblems,
      currentMapId: mapId,
      error: null,
      mode: "idle",
      notice: pendingBackup.length > 0 ? MIGRATION_NOTICE : null,
      projectName: project.manifest.name,
      rootLabel: picked.label,
      openSeq: state.openSeq + 1,
      playedOnce: false,
      view: "map",
      selectedObjectId: null,
      activeDialogId: null,
      playingMapId: null,
      ...historyPatch(),
    });
  };

  /**
   * Pushes `cmd` to the history and does the bookkeeping shared by every edit.
   * Throws if the command does not apply; nothing changes then. Returns the new
   * project; the caller publishes it with `set` outside its try block, so a
   * throwing subscriber is not reported as a failed edit.
   */
  const commit = (cmd: Command): Project => {
    const next = history.push(cmd, state.project!);
    doneIds.push(nextStepId++);
    version += 1;
    if (doneIds.length > HISTORY_LIMIT) floorId = doneIds.shift()!;
    undoneIds = [];
    return next;
  };

  /** Runs a project edit; errors only set `error` (a save may be in flight). Refused in dialog/loading/playing. */
  const editProject = (prefix: string, make: (project: Project) => Command | null): boolean => {
    const project = state.project;
    if (state.mode !== "idle" && state.mode !== "saving") return false;
    if (project === null) return false;
    let next: Project;
    try {
      const cmd = make(project);
      if (cmd === null) return false;
      next = commit(cmd);
    } catch (e) {
      set({ error: `${prefix}${ensurePeriod(capitalize(describe(e)))}` });
      return false;
    }
    set(changePatch(next));
    return true;
  };

  /** Runs an edit of the current map. */
  const edit = (prefix: string, make: (project: Project, mapId: string) => Command | null): boolean => {
    const mapId = state.currentMapId;
    return editProject(prefix, (project) =>
      mapId === null || !Object.hasOwn(project.maps, mapId) ? null : make(project, mapId),
    );
  };

  const canEditNow = (): boolean => state.project !== null && (state.mode === "idle" || state.mode === "saving");

  const fail = (prefix: string, e: unknown): false => {
    set({ mode: "idle", error: `${prefix}${ensurePeriod(capitalize(describe(e)))}` });
    return false;
  };

  const pick = async (which: "pickNew" | "pickOpen"): Promise<OpenedFolder | null | "failed"> => {
    try {
      return await session[which]();
    } catch (e) {
      fail("Could not choose the folder. ", e);
      return "failed";
    }
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async newProject(name) {
      if (isBusy(state)) return false;
      let project: Project;
      try {
        project = createEmptyProject(name);
      } catch (e) {
        return fail("", e);
      }
      const versionAtStart = version;
      set({ mode: "dialog" });
      const picked = await pick("pickNew");
      if (picked === "failed") return false;
      if (picked === null) {
        set({ mode: "idle" });
        return false;
      }
      set({ mode: "loading" });
      if (version !== versionAtStart) return fail("", CHANGED_DURING_DIALOG);
      try {
        if (await picked.storage.exists(MANIFEST_FILE)) {
          return fail(
            "",
            "this folder already has a NestST project. Choose an empty folder, or use Open project instead",
          );
        }
        // Never overwrite a stray file the new project would write.
        for (const entry of project.manifest.maps) {
          if (await picked.storage.exists(entry.file)) {
            return fail(
              "",
              `this folder already has a file ${entry.file}, and NestST will not overwrite it. Choose an empty folder`,
            );
          }
        }
        if (version !== versionAtStart) return fail("", CHANGED_DURING_DIALOG);
        await saveProject(picked.storage, project);
      } catch (e) {
        return fail("Could not save the new project. ", e);
      }
      adopt(project, picked);
      return true;
    },

    async open() {
      if (isBusy(state)) return false;
      const versionAtStart = version;
      set({ mode: "dialog" });
      const picked = await pick("pickOpen");
      if (picked === "failed") return false;
      if (picked === null) {
        set({ mode: "idle" });
        return false;
      }
      set({ mode: "loading" });
      let project: Project;
      try {
        project = await loadProject(picked.storage);
      } catch (e) {
        const keep = state.project ? " Your current project is still open." : "";
        set({ mode: "idle", error: `Could not open the project. ${ensurePeriod(capitalize(describe(e)))}${keep}` });
        return false;
      }
      if (version !== versionAtStart) return fail("", CHANGED_DURING_DIALOG);
      adopt(project, picked);
      return true;
    },

    async save() {
      const project = state.project;
      if (isBusy(state) || project === null || storage === null) return false;
      const idAtStart = topId();
      const backup = pendingBackup;
      set({ mode: "saving" });
      try {
        await saveProject(storage, project, { backup });
      } catch (e) {
        set({
          mode: "idle",
          error: `Could not save the project. ${ensurePeriod(capitalize(describe(e)))} Your changes are still here, so you can try again.`,
        });
        return false;
      }
      savedId = idAtStart;
      const backedUp = backup.length > 0;
      if (backedUp) pendingBackup = [];
      set({ mode: "idle", error: null, ...(backedUp ? { notice: null } : {}), ...historyPatch() });
      return true;
    },

    paintStroke(edits) {
      const project = state.project;
      const mapId = state.currentMapId;
      // While the folder dialog or a load is pending the project must stay as it
      // is (see `version`). Strokes during a save stay unsaved: savedId is the id
      // captured when the save started.
      if (state.mode === "dialog" || state.mode === "loading" || state.mode === "playing" || project === null || mapId === null || edits.length === 0) return false;
      const map = project.maps[mapId];
      if (map === undefined) return false;
      let next: Project;
      try {
        paintCommand(mapId, edits, map); // validates every edit, throws on bad ones
        const effective = effectiveEdits(project, mapId, edits);
        if (effective.length === 0) return false;
        next = commit(paintCommand(mapId, effective, map));
      } catch (e) {
        // Only the error: a save may be in flight, and the mode must stay as it is.
        set({ error: `Could not paint there. ${ensurePeriod(capitalize(describe(e)))}` });
        return false;
      }
      set(changePatch(next));
      return true;
    },

    placeObjectAt(x, y) {
      const tool = state.tool;
      if (tool !== "spawn" && tool !== "npc" && tool !== "event") return false;
      return edit("Could not place that there. ", (project, mapId) => {
        const map = project.maps[mapId]!;
        if (tool === "spawn") {
          // Already standing there: nothing to do (no history step, not dirty).
          if (map.objects.some((o) => o.kind === "spawn" && o.x === x && o.y === y)) return null;
          return placeObjectCommand(mapId, { id: "spawn", kind: "spawn", x, y, props: {} }, project);
        }
        if (tool === "event") {
          const used = new Set(map.objects.map((o) => o.id));
          let n = 1;
          while (used.has(`event-${n}`)) n++;
          return placeObjectCommand(
            mapId,
            { id: `event-${n}`, kind: "event", x, y, props: { ...defaultEventProps(project, mapId, x, y) } },
            project,
          );
        }
        const id = nextNpcId(map);
        return placeObjectCommand(
          mapId,
          { id, kind: "npc", x, y, props: { name: `NPC ${id.slice("npc-".length)}` } },
          project,
        );
      });
    },

    removeObjectAt(x, y) {
      return edit("Could not remove that. ", (project, mapId) => {
        const found = objectAt(project.maps[mapId]!, x, y);
        return found === undefined ? null : removeObjectCommand(mapId, found.id, project);
      });
    },

    setTileSolid(tile, solid) {
      return edit("Could not change that tile. ", (project) => setSolidCommand(tile, solid, project));
    },

    setView(view) {
      if (!VIEWS.includes(view) || view === state.view) return;
      set({ view });
    },

    selectObject(id) {
      if (!canEditNow()) return;
      const map = state.currentMapId !== null ? state.project!.maps[state.currentMapId] : undefined;
      const next = id !== null && map?.objects.some((o) => o.id === id) ? id : null;
      if (next !== state.selectedObjectId) set({ selectedObjectId: next });
    },

    selectObjectAt(x, y) {
      if (!canEditNow()) return false;
      const map = state.currentMapId !== null ? state.project!.maps[state.currentMapId] : undefined;
      const found = map === undefined ? undefined : objectAt(map, x, y);
      const next = found?.id ?? null;
      if (next !== state.selectedObjectId) set({ selectedObjectId: next });
      return next !== null;
    },

    setObjectProps(id, props) {
      return edit("Could not change that object. ", (project, mapId) =>
        setObjectPropsCommand(mapId, id, props, project),
      );
    },

    setVariables(vars) {
      return editProject("Could not change the variables. ", (project) => setVariablesCommand(vars, project));
    },

    saveDialog(dialog) {
      return editProject("Could not save the dialog. ", (project) => upsertDialogCommand(dialog, project));
    },

    deleteDialog(id) {
      return editProject("Could not delete the dialog. ", (project) => removeDialogCommand(id, project));
    },

    selectDialog(id) {
      const next = id !== null && state.project !== null && Object.hasOwn(state.project.dialogs, id) ? id : null;
      if (next !== state.activeDialogId) set({ activeDialogId: next });
    },

    newDialog(name) {
      let created: string | null = null;
      const ok = editProject("Could not create the dialog. ", (project) => {
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > 200) {
          throw new Error("the dialog name must be 1 to 200 characters");
        }
        const id = dialogIdFor(trimmed, (x) => Object.hasOwn(project.dialogs, x));
        const cmd = upsertDialogCommand({ schemaVersion: 1, id, name: trimmed, start: null, nodes: [] }, project);
        created = id;
        return cmd;
      });
      if (!ok || created === null) return null;
      set({ activeDialogId: created });
      return created;
    },

    newDialogForObject(objectId) {
      let created: string | null = null;
      const mapId = state.currentMapId;
      const ok = editProject("Could not create the dialog. ", (project) => {
        const obj = mapId !== null && Object.hasOwn(project.maps, mapId)
          ? project.maps[mapId]!.objects.find((o) => o.id === objectId)
          : undefined;
        if (obj === undefined || obj.kind !== "npc") throw new Error("only a character can get a dialog");
        const rawName = obj.props["name"];
        const npcName = typeof rawName === "string" && rawName.trim() !== "" ? rawName.trim() : "Character";
        const dialogName = `${npcName} talks`.slice(0, 200);
        const id = dialogIdFor(dialogName, (x) => Object.hasOwn(project.dialogs, x));
        const empty: Dialog = { schemaVersion: 1, id, name: dialogName, start: null, nodes: [] };
        const filled = addNode(empty, "say", findFreeSpot(empty));
        const node = filled.nodes[0]!;
        const dialog: Dialog = {
          ...filled,
          nodes: [{ ...node, speaker: npcName, text: "Hello!" } as typeof node],
        };
        const create = upsertDialogCommand(dialog, project);
        // The binding is validated against the project that already has the dialog.
        const bind = setObjectPropsCommand(mapId!, objectId, { ...obj.props, dialog: id }, create.apply(project));
        created = id;
        return mergeCommands("Add dialog for NPC", [create, bind]);
      });
      if (!ok || created === null) return null;
      set({ activeDialogId: created, view: "dialogs" });
      return created;
    },

    toggleShowSolid() {
      set({ showSolid: !state.showSolid });
    },

    play() {
      if (!canPlay(state)) return false;
      const mapId = playMapId(state)!;
      set({ mode: "playing", playingMapId: mapId, playedOnce: true });
      return true;
    },

    stopPlay() {
      if (state.mode === "playing") set({ mode: "idle", playingMapId: null });
    },

    undo() {
      if (state.mode === "playing" || state.project === null || !history.canUndo) return;
      const next = history.undo(state.project);
      undoneIds.push(doneIds.pop()!);
      version += 1;
      set(changePatch(next));
    },

    redo() {
      if (state.mode === "playing" || state.project === null || !history.canRedo) return;
      const next = history.redo(state.project);
      doneIds.push(undoneIds.pop()!);
      version += 1;
      set(changePatch(next));
    },

    selectTool(tool) {
      if (!TOOLS.includes(tool) || tool === state.tool) return;
      set({ tool });
    },

    selectTile(tile) {
      if (!Number.isInteger(tile) || tile < 1 || tile > BUILTIN_TILE_COUNT) return;
      set({ selectedTile: tile, tool: "brush" });
    },

    reportError(message) {
      set({ error: message });
    },

    dismissError() {
      if (state.error !== null) set({ error: null });
    },

    dismissNotice() {
      if (state.notice !== null) set({ notice: null });
    },
  };
}
