/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MANIFEST_FILE, NestError, createEmptyProject, loadProject, saveProject } from "./index.js";
import type { Dialog, Project } from "./index.js";
import { MemoryStorage, NodeFsStorage } from "./testing.js";

const V3 = fileURLToPath(new URL("./fixtures/v3/", import.meta.url));

async function rejected(p: Promise<unknown>): Promise<NestError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

const hello: Dialog = {
  schemaVersion: 1,
  id: "hello",
  name: "Hello",
  start: "a",
  nodes: [{ id: "a", x: 1, y: 2, type: "say", speaker: "Nest", text: "Hi", next: null }],
};

function withDialog(): Project {
  const p = createEmptyProject("G");
  p.manifest.variables = [{ id: "gold", name: "Gold", type: "number", initial: 0 }];
  p.manifest.dialogs = [{ id: "hello", file: "dialogs/hello.json" }];
  p.dialogs = { hello: structuredClone(hello) };
  return p;
}

describe("dialogs in a project", () => {
  it("createEmptyProject has no variables or dialogs", () => {
    const p = createEmptyProject("G");
    expect(p.manifest.schemaVersion).toBe(4);
    expect(p.manifest.variables).toEqual([]);
    expect(p.manifest.dialogs).toEqual([]);
    expect(p.dialogs).toEqual({});
  });

  it("saves and loads a dialog (deep equality), pretty JSON, after maps and before the manifest", async () => {
    const storage = new MemoryStorage();
    const project = withDialog();
    await saveProject(storage, project);
    expect(storage.writeLog).toEqual(["maps/main.json", "dialogs/hello.json", MANIFEST_FILE]);
    expect(storage.files.get("dialogs/hello.json")).toBe(`${JSON.stringify(hello, null, 2)}\n`);
    const loaded = await loadProject(storage);
    expect(loaded).toEqual(project);
    expect(loaded.dialogs.hello).toEqual(hello);
  });

  it("reports file_missing when the dialog file is absent", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, withDialog());
    storage.files.delete("dialogs/hello.json");
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("file_missing");
    expect(err.file).toBe("dialogs/hello.json");
  });

  it("rejects a dialog whose id differs from the manifest entry", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, withDialog());
    storage.files.set("dialogs/hello.json", JSON.stringify({ ...hello, id: "other" }));
    expect((await rejected(loadProject(storage))).code).toBe("invalid_dialog");
  });

  it("rejects an invalid dialog file on load", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, withDialog());
    storage.files.set("dialogs/hello.json", JSON.stringify({ ...hello, start: "zz" }));
    expect((await rejected(loadProject(storage))).code).toBe("invalid_dialog");
  });

  it("rejects a dialog from a newer version", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, withDialog());
    storage.files.set("dialogs/hello.json", JSON.stringify({ ...hello, schemaVersion: 2 }));
    expect((await rejected(loadProject(storage))).code).toBe("schema_too_new");
  });

  it("refuses to save when dialogs and manifest disagree, writing nothing", async () => {
    const storage = new MemoryStorage();
    const extra = withDialog();
    extra.dialogs.ghost = { ...hello, id: "ghost" };
    expect((await rejected(saveProject(storage, extra))).code).toBe("invalid_project");
    const missing = withDialog();
    missing.dialogs = {};
    expect((await rejected(saveProject(storage, missing))).code).toBe("invalid_project");
    const wrongId = withDialog();
    wrongId.dialogs.hello = { ...hello, id: "other" };
    expect((await rejected(saveProject(storage, wrongId))).code).toBe("invalid_project");
    expect(storage.writeLog).toEqual([]);
  });

  it("refuses to save an invalid dialog", async () => {
    const p = withDialog();
    p.dialogs.hello = { ...hello, start: "zz" };
    expect((await rejected(saveProject(new MemoryStorage(), p))).code).toBe("invalid_dialog");
  });
});

describe("fixture v3", () => {
  it("loads, migrates to v4, and the backup keeps the original manifest byte for byte", async () => {
    const original = await readFile(`${V3}${MANIFEST_FILE}`, "utf8");
    const originalMap = await readFile(`${V3}maps/main.json`, "utf8");
    const project = await loadProject(new NodeFsStorage(V3));
    expect(project.manifest.schemaVersion).toBe(4);
    expect(project.manifest.variables).toEqual([]);
    expect(project.dialogs).toEqual({});
    expect(project.migratedFrom).toEqual([{ path: MANIFEST_FILE, text: original }]);

    const storage = new MemoryStorage();
    await saveProject(storage, project, { backup: project.migratedFrom!, now: new Date("2026-10-19T12:34:56Z") });
    expect(storage.files.get(`.nestst-backup/20261019-123456/${MANIFEST_FILE}`)).toBe(original);
    expect(JSON.parse(storage.files.get(MANIFEST_FILE)!).schemaVersion).toBe(4);
    expect(storage.files.get("maps/main.json")).toBe(originalMap);
  });
});
