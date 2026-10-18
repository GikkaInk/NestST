import { describe, expect, it, vi } from "vitest";
import { MANIFEST_FILE, loadProject } from "@nestst/core";
import type { ProjectStorage, TileEdit } from "@nestst/core";
import { MemoryStorage } from "@nestst/core/testing";
import { createEditorStore, strokeTile } from "./editorStore.js";
import type { OpenedFolder, ProjectSession } from "./editorStore.js";

/** Session whose pickers return the queued folders in order; `null` = cancelled. */
function fakeSession(...folders: Array<OpenedFolder | null>): ProjectSession & { calls: number } {
  const queue = folders.slice();
  const session = {
    calls: 0,
    async pickNew() {
      session.calls += 1;
      return queue.length > 0 ? queue.shift()! : null;
    },
    async pickOpen() {
      session.calls += 1;
      return queue.length > 0 ? queue.shift()! : null;
    },
  };
  return session;
}

function folder(storage: ProjectStorage, label = "/home/user/Игры/Мой проект"): OpenedFolder {
  return { storage, label };
}

const ground = (x: number, y: number, tile: number): TileEdit => ({ layerId: "ground", x, y, tile });

function tilesOf(store: ReturnType<typeof createEditorStore>): number[] {
  const s = store.getState();
  return s.project!.maps[s.currentMapId!]!.layers[0]!.tiles;
}

async function storeWithNewProject(storage = new MemoryStorage()) {
  const store = createEditorStore(fakeSession(folder(storage)));
  expect(await store.newProject("Лесная сказка")).toBe(true);
  return { store, storage };
}

describe("initial state", () => {
  it("starts empty with the brush and tile 1", () => {
    const s = createEditorStore(fakeSession()).getState();
    expect(s.project).toBeNull();
    expect(s.currentMapId).toBeNull();
    expect(s.tool).toBe("brush");
    expect(s.selectedTile).toBe(1);
    expect(s.dirty).toBe(false);
    expect(s.error).toBeNull();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.projectName).toBe("");
    expect(s.rootLabel).toBe("");
  });
});

describe("newProject", () => {
  it("creates and saves a project in the picked folder; not dirty", async () => {
    const { store, storage } = await storeWithNewProject();
    const s = store.getState();
    expect(s.project?.manifest.name).toBe("Лесная сказка");
    expect(s.projectName).toBe("Лесная сказка");
    expect(s.rootLabel).toBe("/home/user/Игры/Мой проект");
    expect(s.currentMapId).toBe("main");
    expect(s.dirty).toBe(false);
    expect(s.error).toBeNull();
    expect(storage.files.has(MANIFEST_FILE)).toBe(true);
    expect(storage.files.has("maps/main.json")).toBe(true);
  });

  it("rejects an empty name without asking for a folder", async () => {
    const session = fakeSession(folder(new MemoryStorage()));
    const store = createEditorStore(session);
    expect(await store.newProject("   ")).toBe(false);
    expect(session.calls).toBe(0);
    expect(store.getState().project).toBeNull();
    expect(store.getState().error).toMatch(/name/i);
  });

  it("does nothing when the folder picker is cancelled", async () => {
    const store = createEditorStore(fakeSession(null));
    expect(await store.newProject("Game")).toBe(false);
    expect(store.getState().project).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it("refuses a folder that already holds a project and leaves its files alone", async () => {
    const storage = new MemoryStorage({ [MANIFEST_FILE]: "keep me" });
    const store = createEditorStore(fakeSession(folder(storage)));
    expect(await store.newProject("Game")).toBe(false);
    expect(store.getState().project).toBeNull();
    expect(store.getState().error).toMatch(/already/i);
    expect(storage.files.get(MANIFEST_FILE)).toBe("keep me");
    expect(storage.writeLog).toEqual([]);
  });

  it("keeps the current project when writing the new one fails", async () => {
    const broken = new MemoryStorage();
    broken.failOnWrite(1);
    const store = createEditorStore(fakeSession(folder(new MemoryStorage(), "/a"), folder(broken, "/b")));
    await store.newProject("First");
    store.paintStroke([ground(0, 0, 3)]);
    const before = store.getState();
    expect(await store.newProject("Second")).toBe(false);
    const s = store.getState();
    expect(s.project).toBe(before.project);
    expect(s.rootLabel).toBe("/a");
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
    expect(s.error).toMatch(/save/i);
  });

  it("turns a failing picker into an error message", async () => {
    const store = createEditorStore({
      pickNew: async () => {
        throw new Error("dialog exploded");
      },
      pickOpen: async () => null,
    });
    expect(await store.newProject("Game")).toBe(false);
    expect(store.getState().error).toMatch(/dialog exploded/i);
  });
});

describe("paintStroke, undo and redo", () => {
  it("marks the project dirty and undo restores the map", async () => {
    const { store } = await storeWithNewProject();
    const original = tilesOf(store).slice();
    expect(store.paintStroke([ground(1, 2, 5), ground(2, 2, 5)])).toBe(true);
    const s = store.getState();
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
    expect(tilesOf(store)[2 * 32 + 1]).toBe(5);
    store.undo();
    expect(tilesOf(store)).toEqual(original);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().canRedo).toBe(true);
    store.redo();
    expect(tilesOf(store)[2 * 32 + 2]).toBe(5);
    expect(store.getState().dirty).toBe(true);
  });

  it("records one whole stroke as one undo step", async () => {
    const { store } = await storeWithNewProject();
    const edits = Array.from({ length: 10 }, (_, i) => ground(i, 0, 7));
    store.paintStroke(edits);
    store.undo();
    expect(tilesOf(store).every((t) => t === 0)).toBe(true);
    expect(store.getState().canUndo).toBe(false);
  });

  it("ignores an empty stroke: no history step, not dirty", async () => {
    const { store } = await storeWithNewProject();
    const before = store.getState().project;
    expect(store.paintStroke([])).toBe(false);
    expect(store.getState().project).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it("ignores a stroke that changes nothing (erasing empty cells)", async () => {
    const { store } = await storeWithNewProject();
    const before = store.getState().project;
    expect(store.paintStroke([ground(0, 0, 0), ground(1, 0, 0)])).toBe(false);
    expect(store.getState().project).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it("a stroke that ends where it started on a cell counts only the net change", async () => {
    const { store } = await storeWithNewProject();
    // Cell (0,0) is painted then erased within one stroke: no net change.
    expect(store.paintStroke([ground(0, 0, 4), ground(0, 0, 0)])).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });

  it("rejects a coordinate outside the map and leaves project and history alone", async () => {
    const { store } = await storeWithNewProject();
    const before = store.getState().project;
    expect(store.paintStroke([ground(0, 0, 2), ground(32, 0, 2)])).toBe(false);
    const s = store.getState();
    expect(s.error).toMatch(/x must be/);
    expect(s.project).toBe(before);
    expect(s.canUndo).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it("rejects negative, fractional and too-large tile edits without crashing", async () => {
    const { store } = await storeWithNewProject();
    const before = store.getState().project;
    expect(store.paintStroke([ground(-1, 0, 2)])).toBe(false);
    expect(store.paintStroke([ground(0.5, 0, 2)])).toBe(false);
    expect(store.paintStroke([ground(0, 0, 65536)])).toBe(false);
    expect(store.getState().project).toBe(before);
  });

  it("ignores paint, undo and redo when no project is open", () => {
    const store = createEditorStore(fakeSession());
    expect(store.paintStroke([ground(0, 0, 1)])).toBe(false);
    store.undo();
    store.redo();
    expect(store.getState().project).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it("undo on an empty history changes nothing", async () => {
    const { store } = await storeWithNewProject();
    const before = store.getState().project;
    store.undo();
    store.redo();
    expect(store.getState().project).toBe(before);
    expect(store.getState().dirty).toBe(false);
  });

  it("a new stroke after undo clears redo", async () => {
    const { store } = await storeWithNewProject();
    store.paintStroke([ground(0, 0, 1)]);
    store.undo();
    store.paintStroke([ground(1, 1, 2)]);
    expect(store.getState().canRedo).toBe(false);
  });
});

describe("save and open", () => {
  it("save clears dirty and reopening reads an equal project", async () => {
    const { store, storage } = await storeWithNewProject();
    store.paintStroke([ground(3, 4, 9)]);
    expect(await store.save()).toBe(true);
    expect(store.getState().dirty).toBe(false);
    const reopened = createEditorStore(fakeSession(folder(storage)));
    expect(await reopened.open()).toBe(true);
    expect(reopened.getState().project).toEqual(store.getState().project);
    expect(reopened.getState().dirty).toBe(false);
    expect(await loadProject(storage)).toEqual(store.getState().project);
  });

  it("a failed save keeps dirty, the project and explains in English", async () => {
    const { store, storage } = await storeWithNewProject();
    store.paintStroke([ground(3, 4, 9)]);
    const painted = store.getState().project;
    storage.failOnWrite(1);
    expect(await store.save()).toBe(false);
    const s = store.getState();
    expect(s.dirty).toBe(true);
    expect(s.project).toBe(painted);
    expect(s.error).toBeTruthy();
    expect(s.error).toMatch(/save/i);
    expect(s.error).toMatch(/^[\x20-\x7e]+$/);
    // Retrying works once the disk is fine again.
    expect(await store.save()).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });

  it("undo back to the saved point is not dirty; going past it is", async () => {
    const { store } = await storeWithNewProject();
    store.paintStroke([ground(0, 0, 1)]);
    await store.save();
    store.paintStroke([ground(1, 0, 2)]);
    expect(store.getState().dirty).toBe(true);
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.undo();
    expect(store.getState().dirty).toBe(true);
    store.redo();
    expect(store.getState().dirty).toBe(false);
  });

  it("after save, a different branch is dirty even at the same depth", async () => {
    const { store } = await storeWithNewProject();
    store.paintStroke([ground(0, 0, 1)]);
    await store.save();
    store.undo();
    store.paintStroke([ground(5, 5, 6)]);
    expect(store.getState().dirty).toBe(true);
  });

  it("open of a corrupt project keeps the current one and names the file", async () => {
    const corrupt = new MemoryStorage();
    await storeWithNewProject(corrupt);
    corrupt.files.set("maps/main.json", "{ not json");
    const store = createEditorStore(fakeSession(folder(new MemoryStorage(), "/a"), folder(corrupt, "/broken")));
    await store.newProject("Keep");
    store.paintStroke([ground(2, 2, 2)]);
    const kept = store.getState();
    expect(await store.open()).toBe(false);
    const after = store.getState();
    expect(after.project).toBe(kept.project);
    expect(after.rootLabel).toBe("/a");
    expect(after.projectName).toBe("Keep");
    expect(after.dirty).toBe(true);
    expect(after.canUndo).toBe(true);
    expect(after.error).toContain("maps/main.json");
    expect(corrupt.files.get("maps/main.json")).toBe("{ not json");
  });

  it("after a failed open, save still goes to the original folder", async () => {
    const first = new MemoryStorage();
    const broken = new MemoryStorage({ [MANIFEST_FILE]: "" });
    const store = createEditorStore(fakeSession(folder(first, "/a"), folder(broken, "/b")));
    await store.newProject("Keep");
    store.paintStroke([ground(1, 1, 1)]);
    expect(await store.open()).toBe(false);
    expect(store.getState().error).toContain(MANIFEST_FILE);
    expect(await store.save()).toBe(true);
    expect(broken.writeLog).toEqual([]);
    expect((await loadProject(first)).maps.main!.layers[0]!.tiles[33]).toBe(1);
  });

  it("open of a folder without a project explains it", async () => {
    const store = createEditorStore(fakeSession(folder(new MemoryStorage())));
    expect(await store.open()).toBe(false);
    expect(store.getState().error).toMatch(/not a NestST project/);
  });

  it("a successful open replaces the project and resets history", async () => {
    const other = new MemoryStorage();
    const { store: maker } = await storeWithNewProject(other);
    maker.paintStroke([ground(0, 0, 8)]);
    await maker.save();
    const store = createEditorStore(fakeSession(folder(new MemoryStorage(), "/a"), folder(other, "/b")));
    await store.newProject("First");
    store.paintStroke([ground(1, 1, 1)]);
    expect(await store.open()).toBe(true);
    const s = store.getState();
    expect(s.rootLabel).toBe("/b");
    expect(s.projectName).toBe("Лесная сказка");
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.dirty).toBe(false);
    expect(tilesOf(store)[0]).toBe(8);
  });

  it("open cancelled keeps everything", async () => {
    const store = createEditorStore(fakeSession(folder(new MemoryStorage()), null));
    await store.newProject("Keep");
    const before = store.getState();
    expect(await store.open()).toBe(false);
    expect(store.getState()).toEqual(before);
    expect(store.getState().project).toBe(before.project);
  });

  it("save without a project does nothing", async () => {
    const store = createEditorStore(fakeSession());
    expect(await store.save()).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("painting while saving is ignored; an undo while saving stays dirty", async () => {
    const storage = new MemoryStorage();
    const { store } = await storeWithNewProject(storage);
    store.paintStroke([ground(0, 0, 1)]);
    store.paintStroke([ground(1, 0, 1)]);
    const pending = store.save();
    expect(store.paintStroke([ground(2, 0, 1)])).toBe(false);
    store.undo();
    expect(await pending).toBe(true);
    expect(store.getState().dirty).toBe(true);
    expect(tilesOf(store)[2]).toBe(0);
  });
});

describe("tools, tiles and errors", () => {
  it("selects tools and ignores unknown ones", () => {
    const store = createEditorStore(fakeSession());
    store.selectTool("eraser");
    expect(store.getState().tool).toBe("eraser");
    store.selectTool("lasso" as never);
    expect(store.getState().tool).toBe("eraser");
  });

  it("selects tiles 1..255 and ignores invalid ids", () => {
    const store = createEditorStore(fakeSession());
    store.selectTile(12);
    expect(store.getState().selectedTile).toBe(12);
    for (const bad of [0, -3, 256, 1.5, Number.NaN]) {
      store.selectTile(bad);
      expect(store.getState().selectedTile).toBe(12);
    }
    store.selectTile(255);
    expect(store.getState().selectedTile).toBe(255);
  });

  it("selecting a tile switches back to the brush", () => {
    const store = createEditorStore(fakeSession());
    store.selectTool("eraser");
    store.selectTile(4);
    expect(store.getState().tool).toBe("brush");
  });

  it("strokeTile: brush paints the selected tile, eraser paints 0", () => {
    const store = createEditorStore(fakeSession());
    store.selectTile(7);
    expect(strokeTile(store.getState())).toBe(7);
    store.selectTool("eraser");
    expect(strokeTile(store.getState())).toBe(0);
  });

  it("dismissError clears the message", async () => {
    const store = createEditorStore(fakeSession());
    await store.newProject("");
    expect(store.getState().error).not.toBeNull();
    store.dismissError();
    expect(store.getState().error).toBeNull();
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const store = createEditorStore(fakeSession());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.selectTile(3);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.selectTile(4);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("state objects are immutable snapshots (new object per change)", () => {
    const store = createEditorStore(fakeSession());
    const a = store.getState();
    store.selectTile(9);
    expect(store.getState()).not.toBe(a);
    expect(a.selectedTile).toBe(1);
  });
});

describe("dirty tracking after the history overflows (limit 200)", () => {
  // Stroke k paints its own cell, so every stroke really changes the map.
  const strokeN = (store: ReturnType<typeof createEditorStore>, k: number) =>
    expect(store.paintStroke([ground(k % 32, Math.floor(k / 32), 1)])).toBe(true);
  const undoAll = (store: ReturnType<typeof createEditorStore>) => {
    while (store.getState().canUndo) store.undo();
  };

  it("201 strokes then undo everything: still dirty, the first stroke cannot be undone", async () => {
    const { store, storage } = await storeWithNewProject();
    for (let k = 0; k < 201; k++) strokeN(store, k);
    undoAll(store);
    expect(tilesOf(store)[0]).toBe(1);
    expect(store.getState().dirty).toBe(true);
    expect((await loadProject(storage)).maps.main!.layers[0]!.tiles[0]).toBe(0);
  });

  it("saved before the overflow: undo back to the saved point is clean, past it dirty", async () => {
    const { store } = await storeWithNewProject();
    for (let k = 0; k < 150; k++) strokeN(store, k);
    await store.save();
    for (let k = 150; k < 250; k++) strokeN(store, k);
    for (let i = 0; i < 100; i++) store.undo();
    expect(store.getState().dirty).toBe(false);
    undoAll(store);
    expect(store.getState().dirty).toBe(true);
  });

  it("saved state evicted from history: undo all and redo all are both dirty", async () => {
    const { store } = await storeWithNewProject();
    for (let k = 0; k < 150; k++) strokeN(store, k);
    await store.save();
    for (let k = 150; k < 400; k++) strokeN(store, k);
    undoAll(store);
    expect(store.getState().dirty).toBe(true);
    // The saved step (150) was evicted, so no undo/redo position matches it.
    while (store.getState().canRedo) store.redo();
    expect(store.getState().dirty).toBe(true);
  });

  it("a save after the overflow resets the baseline", async () => {
    const { store } = await storeWithNewProject();
    for (let k = 0; k < 201; k++) strokeN(store, k);
    expect(await store.save()).toBe(true);
    expect(store.getState().dirty).toBe(false);
    undoAll(store);
    expect(store.getState().dirty).toBe(true);
    while (store.getState().canRedo) store.redo();
    expect(store.getState().dirty).toBe(false);
  });

  it("opening a project after an overflow starts clean", async () => {
    const storage = new MemoryStorage();
    const store = createEditorStore(fakeSession(folder(storage), folder(storage)));
    await store.newProject("A");
    for (let k = 0; k < 201; k++) strokeN(store, k);
    await store.save();
    expect(await store.open()).toBe(true);
    expect(store.getState().dirty).toBe(false);
    strokeN(store, 300);
    store.undo();
    expect(store.getState().dirty).toBe(false);
  });
});

describe("edits while a folder dialog is open", () => {
  /** Session whose picker runs `during` while it is "open", then returns `picked`. */
  function slowSession(picked: OpenedFolder, during: () => void, first?: OpenedFolder): ProjectSession {
    let calls = 0;
    const pick = async () => {
      calls += 1;
      if (first && calls === 1) return first;
      await Promise.resolve();
      during();
      return picked;
    };
    return { pickNew: pick, pickOpen: pick };
  }

  async function otherProject(): Promise<MemoryStorage> {
    const other = new MemoryStorage();
    await storeWithNewProject(other);
    return other;
  }

  it("paintStroke is ignored while busy, without an error", async () => {
    const other = await otherProject();
    let seen: { painted: boolean; error: string | null } | null = null;
    const holder: { store?: ReturnType<typeof createEditorStore> } = {};
    const store = createEditorStore(
      slowSession(folder(other, "/b"), () => {
        seen = {
          painted: holder.store!.paintStroke([ground(4, 4, 4)]),
          error: holder.store!.getState().error,
        };
      }, folder(new MemoryStorage(), "/a")),
    );
    holder.store = store;
    await store.newProject("A");
    expect(await store.open()).toBe(true);
    expect(seen).toEqual({ painted: false, error: null });
  });

  it("open is not adopted when the project changed during the dialog; edits are kept", async () => {
    const other = await otherProject();
    const holder: { store?: ReturnType<typeof createEditorStore> } = {};
    const store = createEditorStore(
      slowSession(folder(other, "/b"), () => holder.store!.undo(), folder(new MemoryStorage(), "/a")),
    );
    holder.store = store;
    await store.newProject("A");
    store.paintStroke([ground(1, 1, 1)]);
    store.paintStroke([ground(2, 2, 2)]);
    expect(await store.open()).toBe(false);
    const s = store.getState();
    expect(s.rootLabel).toBe("/a");
    expect(s.projectName).toBe("A");
    expect(s.dirty).toBe(true);
    expect(s.canRedo).toBe(true);
    expect(tilesOf(store)[33]).toBe(1);
    expect(s.busy).toBe(false);
    expect(s.error).toMatch(/changed while the folder dialog was open/);
  });

  it("Save first, then Open: a change during the dialog is not thrown away", async () => {
    const other = await otherProject();
    const holder: { store?: ReturnType<typeof createEditorStore> } = {};
    const store = createEditorStore(
      slowSession(folder(other, "/b"), () => holder.store!.undo(), folder(new MemoryStorage(), "/a")),
    );
    holder.store = store;
    await store.newProject("A");
    store.paintStroke([ground(1, 1, 1)]);
    expect(await store.save()).toBe(true);
    expect(await store.open()).toBe(false);
    expect(store.getState().rootLabel).toBe("/a");
    expect(store.getState().dirty).toBe(true);
    expect(tilesOf(store)[33]).toBe(0);
  });

  it("new project is not created when the project changed during the dialog", async () => {
    const target = new MemoryStorage();
    const holder: { store?: ReturnType<typeof createEditorStore> } = {};
    const store = createEditorStore(
      slowSession(folder(target, "/new"), () => holder.store!.undo(), folder(new MemoryStorage(), "/a")),
    );
    holder.store = store;
    await store.newProject("A");
    store.paintStroke([ground(1, 1, 1)]);
    store.paintStroke([ground(2, 2, 2)]);
    expect(await store.newProject("B")).toBe(false);
    expect(store.getState().projectName).toBe("A");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().error).toMatch(/changed while the folder dialog was open/);
    expect(target.writeLog).toEqual([]);
  });

  it("an unchanged project is replaced normally", async () => {
    const other = await otherProject();
    const store = createEditorStore(slowSession(folder(other, "/b"), () => {}, folder(new MemoryStorage(), "/a")));
    await store.newProject("A");
    store.paintStroke([ground(1, 1, 1)]);
    await store.save();
    expect(await store.open()).toBe(true);
    expect(store.getState().rootLabel).toBe("/b");
  });
});

describe("new project next to stray files", () => {
  it("refuses a folder that already has maps/main.json and writes nothing", async () => {
    const storage = new MemoryStorage({ "maps/main.json": "keep me" });
    const store = createEditorStore(fakeSession(folder(storage)));
    expect(await store.newProject("Game")).toBe(false);
    expect(store.getState().project).toBeNull();
    expect(store.getState().error).toMatch(/maps\/main\.json/);
    expect(storage.files.get("maps/main.json")).toBe("keep me");
    expect(storage.writeLog).toEqual([]);
  });
});

