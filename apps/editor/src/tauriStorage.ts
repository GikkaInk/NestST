import { NestError } from "@nestst/core";
import type { ProjectStorage } from "@nestst/core";
import type { OpenedFolder, ProjectSession } from "./editorStore.js";

/** Shape of `invoke` from `@tauri-apps/api/core`; injected so tests need no Tauri. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Text of an error coming back from a Tauri command. The Rust side rejects
 * with plain English strings that already name the file.
 */
function errorText(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim() !== "") return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Files of one project folder, through the sandboxed Tauri commands. `root`
 * is the canonical folder returned by a folder dialog: the Rust side only
 * accepts roots the user picked, and every path stays relative to it.
 */
export class TauriStorage implements ProjectStorage {
  constructor(
    readonly root: string,
    private readonly invoke: InvokeFn,
  ) {}

  async read(path: string): Promise<string> {
    let text: unknown;
    try {
      text = await this.invoke<unknown>("project_read", { root: this.root, path });
    } catch (e) {
      throw new NestError("read_failed", errorText(e, `Could not read file ${path}`), path);
    }
    if (typeof text !== "string") {
      throw new NestError("read_failed", `Could not read file ${path}: unexpected answer`, path);
    }
    return text;
  }

  async writeAtomic(path: string, data: string): Promise<void> {
    try {
      await this.invoke<unknown>("project_write_atomic", { root: this.root, path, data });
    } catch (e) {
      throw new NestError("save_failed", errorText(e, `Could not save file ${path}`), path);
    }
  }

  async exists(path: string): Promise<boolean> {
    let found: unknown;
    try {
      found = await this.invoke<unknown>("project_exists", { root: this.root, path });
    } catch (e) {
      throw new NestError("read_failed", errorText(e, `Could not read file ${path}`), path);
    }
    if (typeof found !== "boolean") {
      throw new NestError("read_failed", `Could not read file ${path}: unexpected answer`, path);
    }
    return found;
  }
}

async function pick(invoke: InvokeFn, command: string): Promise<OpenedFolder | null> {
  let root: unknown;
  try {
    root = await invoke<unknown>(command);
  } catch (e) {
    throw new NestError("folder_pick_failed", errorText(e, "The folder could not be opened"));
  }
  if (root === null || root === undefined) return null;
  if (typeof root !== "string" || root === "") {
    throw new NestError("folder_pick_failed", "The folder could not be opened");
  }
  return { storage: new TauriStorage(root, invoke), label: root };
}

/** Folder dialog for a new project; `null` when cancelled. */
export function pickNewProject(invoke: InvokeFn): Promise<OpenedFolder | null> {
  return pick(invoke, "new_project_dialog");
}

/** Folder dialog for an existing project; `null` when cancelled. */
export function pickOpenProject(invoke: InvokeFn): Promise<OpenedFolder | null> {
  return pick(invoke, "open_project_dialog");
}

export function createTauriSession(invoke: InvokeFn): ProjectSession {
  return { pickNew: () => pickNewProject(invoke), pickOpen: () => pickOpenProject(invoke) };
}
