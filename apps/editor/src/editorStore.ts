import {
  History,
  MANIFEST_FILE,
  BUILTIN_TILE_COUNT,
  createEmptyProject,
  loadProject,
  nextNpcId,
  objectAt,
  paintCommand,
  placeObjectCommand,
  removeObjectCommand,
  saveProject,
  setSolidCommand,
} from "@nestst/core";
import type { BackupFile, Command, Project, ProjectStorage, TileEdit } from "@nestst/core";

export type Tool = "brush" | "eraser" | "spawn" | "npc";
export const TOOLS: readonly Tool[] = ["brush", "eraser", "spawn", "npc"];

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
}

/** Play needs a project whose current map has a spawn, and an idle editor. */
export function canPlay(s: Pick<EditorState, "project" | "currentMapId" | "mode">): boolean {
  if (s.project === null || s.currentMapId === null || s.mode !== "idle") return false;
  const map = Object.hasOwn(s.project.maps, s.currentMapId) ? s.project.maps[s.currentMapId] : undefined;
  return map !== undefined && map.objects.some((o) => o.kind === "spawn");
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
  };

  const set = (patch: Partial<EditorState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  const historyPatch = (): Pick<EditorState, "canUndo" | "canRedo" | "dirty"> => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    dirty: topId() !== savedId,
  });

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
    set({
      project,
      currentMapId: mapId,
      error: null,
      mode: "idle",
      notice: pendingBackup.length > 0 ? MIGRATION_NOTICE : null,
      projectName: project.manifest.name,
      rootLabel: picked.label,
      ...historyPatch(),
    });
  };

  /**
   * Pushes `cmd` to the history and does the bookkeeping shared by every edit.
   * Throws if the command does not apply; nothing changes then.
   */
  const commit = (cmd: Command): void => {
    const next = history.push(cmd, state.project!);
    doneIds.push(nextStepId++);
    version += 1;
    if (doneIds.length > HISTORY_LIMIT) floorId = doneIds.shift()!;
    undoneIds = [];
    set({ project: next, ...historyPatch() });
  };

  /** Runs an edit of the current map; errors only set `error` (a save may be in flight). */
  const edit = (prefix: string, make: (project: Project, mapId: string) => Command | null): boolean => {
    const project = state.project;
    const mapId = state.currentMapId;
    if (state.mode !== "idle" && state.mode !== "saving") return false;
    if (project === null || mapId === null || !Object.hasOwn(project.maps, mapId)) return false;
    try {
      const cmd = make(project, mapId);
      if (cmd === null) return false;
      commit(cmd);
    } catch (e) {
      set({ error: `${prefix}${ensurePeriod(capitalize(describe(e)))}` });
      return false;
    }
    return true;
  };

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
      try {
        paintCommand(mapId, edits, map); // validates every edit, throws on bad ones
        const effective = effectiveEdits(project, mapId, edits);
        if (effective.length === 0) return false;
        commit(paintCommand(mapId, effective, map));
      } catch (e) {
        // Only the error: a save may be in flight, and the mode must stay as it is.
        set({ error: `Could not paint there. ${ensurePeriod(capitalize(describe(e)))}` });
        return false;
      }
      return true;
    },

    placeObjectAt(x, y) {
      const tool = state.tool;
      if (tool !== "spawn" && tool !== "npc") return false;
      return edit("Could not place that there. ", (project, mapId) => {
        const map = project.maps[mapId]!;
        if (tool === "spawn") {
          return placeObjectCommand(mapId, { id: "spawn", kind: "spawn", x, y, props: {} }, project);
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
      return edit("Could not place that there. ", (project, mapId) => {
        const found = objectAt(project.maps[mapId]!, x, y);
        return found === undefined ? null : removeObjectCommand(mapId, found.id, project);
      });
    },

    setTileSolid(tile, solid) {
      return edit("Could not change that tile. ", (project) => setSolidCommand(tile, solid, project));
    },

    toggleShowSolid() {
      set({ showSolid: !state.showSolid });
    },

    play() {
      if (!canPlay(state)) return false;
      set({ mode: "playing" });
      return true;
    },

    stopPlay() {
      if (state.mode === "playing") set({ mode: "idle" });
    },

    undo() {
      if (state.mode === "playing" || state.project === null || !history.canUndo) return;
      const next = history.undo(state.project);
      undoneIds.push(doneIds.pop()!);
      version += 1;
      set({ project: next, ...historyPatch() });
    },

    redo() {
      if (state.mode === "playing" || state.project === null || !history.canRedo) return;
      const next = history.redo(state.project);
      doneIds.push(undoneIds.pop()!);
      version += 1;
      set({ project: next, ...historyPatch() });
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
