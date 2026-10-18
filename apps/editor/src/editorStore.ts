import {
  History,
  MANIFEST_FILE,
  MAX_TILE_ID,
  createEmptyProject,
  loadProject,
  paintCommand,
  saveProject,
} from "@nestst/core";
import type { Project, ProjectStorage, TileEdit } from "@nestst/core";

export type Tool = "brush" | "eraser";
export const TOOLS: readonly Tool[] = ["brush", "eraser"];

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
  /** A new/open/save is running. */
  busy: boolean;
  projectName: string;
  rootLabel: string;
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
  undo(): void;
  redo(): void;
  selectTool(tool: Tool): void;
  selectTile(tile: number): void;
  dismissError(): void;
}

/** Tile a stroke paints with the current tool: the eraser paints 0 (empty). */
export function strokeTile(state: Pick<EditorState, "tool" | "selectedTile">): number {
  return state.tool === "eraser" ? 0 : state.selectedTile;
}

const HISTORY_LIMIT = 200;

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
  const topId = () => doneIds.at(-1) ?? 0;

  let state: EditorState = {
    project: null,
    currentMapId: null,
    tool: "brush",
    selectedTile: 1,
    dirty: false,
    error: null,
    canUndo: false,
    canRedo: false,
    busy: false,
    projectName: "",
    rootLabel: "",
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
    const mapId = Object.hasOwn(project.maps, project.manifest.startMapId)
      ? project.manifest.startMapId
      : (project.manifest.maps[0]?.id ?? null);
    set({
      project,
      currentMapId: mapId,
      error: null,
      busy: false,
      projectName: project.manifest.name,
      rootLabel: picked.label,
      ...historyPatch(),
    });
  };

  const fail = (prefix: string, e: unknown): false => {
    set({ busy: false, error: `${prefix}${ensurePeriod(capitalize(describe(e)))}` });
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
      if (state.busy) return false;
      let project: Project;
      try {
        project = createEmptyProject(name);
      } catch (e) {
        return fail("", e);
      }
      set({ busy: true });
      const picked = await pick("pickNew");
      if (picked === "failed") return false;
      if (picked === null) {
        set({ busy: false });
        return false;
      }
      try {
        if (await picked.storage.exists(MANIFEST_FILE)) {
          return fail(
            "",
            "this folder already has a NestST project. Choose an empty folder, or use Open project instead",
          );
        }
        await saveProject(picked.storage, project);
      } catch (e) {
        return fail("Could not save the new project. ", e);
      }
      adopt(project, picked);
      return true;
    },

    async open() {
      if (state.busy) return false;
      set({ busy: true });
      const picked = await pick("pickOpen");
      if (picked === "failed") return false;
      if (picked === null) {
        set({ busy: false });
        return false;
      }
      let project: Project;
      try {
        project = await loadProject(picked.storage);
      } catch (e) {
        const keep = state.project ? " Your current project is still open." : "";
        set({ busy: false, error: `Could not open the project. ${ensurePeriod(capitalize(describe(e)))}${keep}` });
        return false;
      }
      adopt(project, picked);
      return true;
    },

    async save() {
      const project = state.project;
      if (state.busy || project === null || storage === null) return false;
      const idAtStart = topId();
      set({ busy: true });
      try {
        await saveProject(storage, project);
      } catch (e) {
        set({
          busy: false,
          error: `Could not save the project. ${ensurePeriod(capitalize(describe(e)))} Your changes are still here, so you can try again.`,
        });
        return false;
      }
      savedId = idAtStart;
      set({ busy: false, error: null, ...historyPatch() });
      return true;
    },

    paintStroke(edits) {
      const project = state.project;
      const mapId = state.currentMapId;
      if (project === null || mapId === null || edits.length === 0) return false;
      const map = project.maps[mapId];
      if (map === undefined) return false;
      let next: Project;
      try {
        paintCommand(mapId, edits, map); // validates every edit, throws on bad ones
        const effective = effectiveEdits(project, mapId, edits);
        if (effective.length === 0) return false;
        next = history.push(paintCommand(mapId, effective, map), project);
      } catch (e) {
        return fail("Could not paint there. ", e);
      }
      doneIds.push(nextStepId++);
      if (doneIds.length > HISTORY_LIMIT) doneIds.shift();
      undoneIds = [];
      set({ project: next, ...historyPatch() });
      return true;
    },

    undo() {
      if (state.project === null || !history.canUndo) return;
      const next = history.undo(state.project);
      undoneIds.push(doneIds.pop()!);
      set({ project: next, ...historyPatch() });
    },

    redo() {
      if (state.project === null || !history.canRedo) return;
      const next = history.redo(state.project);
      doneIds.push(undoneIds.pop()!);
      set({ project: next, ...historyPatch() });
    },

    selectTool(tool) {
      if (!TOOLS.includes(tool) || tool === state.tool) return;
      set({ tool });
    },

    selectTile(tile) {
      if (!Number.isInteger(tile) || tile < 1 || tile > MAX_TILE_ID) return;
      set({ selectedTile: tile, tool: "brush" });
    },

    dismissError() {
      if (state.error !== null) set({ error: null });
    },
  };
}
