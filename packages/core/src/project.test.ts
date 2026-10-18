/// <reference types="node" />
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as core from "./index.js";
import {
  MANIFEST_FILE,
  NestError,
  createEmptyProject,
  loadProject,
  parseManifest,
  parseMap,
  saveProject,
} from "./index.js";
import type { GameMap, Project } from "./index.js";
import { MemoryStorage, NodeFsStorage } from "./testing.js";

async function rejected(p: Promise<unknown>): Promise<NestError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

function thrown(fn: () => unknown): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

function addMap(project: Project, id: string, tile: number): GameMap {
  const map: GameMap = {
    schemaVersion: 1,
    id,
    name: `Карта ${id}`,
    viewMode: "topdown",
    width: 2,
    height: 2,
    tileSize: 32,
    layers: [{ id: "ground", name: "Ground", visible: true, tiles: [tile, tile, tile, tile] }],
  };
  project.maps[id] = map;
  project.manifest.maps.push({ id, file: `maps/${id}.json` });
  return map;
}

/** Every stored file is whole: valid JSON that passes its schema. */
function expectAllFilesWhole(storage: MemoryStorage): void {
  for (const [path, text] of storage.files) {
    const raw = JSON.parse(text) as unknown;
    if (path === MANIFEST_FILE) parseManifest(raw, path);
    else parseMap(raw, path);
  }
}

describe("createEmptyProject", () => {
  it("builds the default project", () => {
    const p = createEmptyProject("  Моя игра  ");
    expect(p.manifest).toEqual({
      schemaVersion: 1,
      name: "Моя игра",
      resolution: { width: 1280, height: 720 },
      tileSize: 32,
      maps: [{ id: "main", file: "maps/main.json" }],
      startMapId: "main",
    });
    expect(Object.keys(p.maps)).toEqual(["main"]);
    const map = p.maps.main!;
    expect(map).toMatchObject({ schemaVersion: 1, id: "main", viewMode: "topdown", width: 32, height: 24, tileSize: 32 });
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]).toMatchObject({ id: "ground", name: "Ground", visible: true });
    expect(map.layers[0]!.tiles).toHaveLength(32 * 24);
    expect(map.layers[0]!.tiles.every((t) => t === 0)).toBe(true);
    expect(() => parseMap(map)).not.toThrow();
    expect(() => parseManifest(p.manifest)).not.toThrow();
  });

  it("(ж) empty, whitespace-only and too long names are rejected", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const err = thrown(() => createEmptyProject(name));
      expect(err.code).toBe("invalid_project_name");
      expect(err.message).toMatch(/must not be empty/);
    }
    const long = thrown(() => createEmptyProject("я".repeat(201)));
    expect(long.code).toBe("invalid_project_name");
    expect(long.message).toContain("200");
    expect(createEmptyProject("я".repeat(200)).manifest.name).toHaveLength(200);
  });
});

describe("saveProject / loadProject", () => {
  it("(а) round-trip through MemoryStorage", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("Моя игра");
    await saveProject(storage, project);
    expect([...storage.files.keys()].sort()).toEqual(["maps/main.json", MANIFEST_FILE].sort());
    expect(await loadProject(storage)).toEqual(project);
  });

  it("maps are written first, manifest last", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("Моя игра");
    addMap(project, "second", 1);
    await saveProject(storage, project);
    expect(storage.writeLog).toEqual(["maps/main.json", "maps/second.json", MANIFEST_FILE]);
  });

  it("(б) corrupt map JSON names the file", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    storage.files.set("maps/main.json", '{"schemaVersion": 1, "id": "ma');
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("invalid_json");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");
  });

  it("(б) empty map file names the file", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    for (const empty of ["", "  \n"]) {
      storage.files.set("maps/main.json", empty);
      const err = await rejected(loadProject(storage));
      expect(err.code).toBe("empty_file");
      expect(err.file).toBe("maps/main.json");
      expect(err.message).toContain("maps/main.json");
      expect(err.message).toContain("empty");
    }
  });

  it("corrupt or empty manifest names the manifest file", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    storage.files.set(MANIFEST_FILE, "not json");
    let err = await rejected(loadProject(storage));
    expect(err.code).toBe("invalid_json");
    expect(err.file).toBe(MANIFEST_FILE);
    expect(err.message).toContain(MANIFEST_FILE);
    storage.files.set(MANIFEST_FILE, "");
    err = await rejected(loadProject(storage));
    expect(err.code).toBe("empty_file");
    expect(err.message).toContain(MANIFEST_FILE);
  });

  it("missing manifest gives a clear error", async () => {
    const err = await rejected(loadProject(new MemoryStorage()));
    expect(err.code).toBe("file_missing");
    expect(err.file).toBe(MANIFEST_FILE);
    expect(err.message).toContain(MANIFEST_FILE);
  });

  it("map file from a newer NestST is refused with the file name", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    const raw = JSON.parse(storage.files.get("maps/main.json")!) as Record<string, unknown>;
    storage.files.set("maps/main.json", JSON.stringify({ ...raw, schemaVersion: 9 }));
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("schema_too_new");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");
    expect(err.message).toContain("update NestST");
  });

  it("map whose id does not match its manifest entry is refused", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    const raw = JSON.parse(storage.files.get("maps/main.json")!) as Record<string, unknown>;
    storage.files.set("maps/main.json", JSON.stringify({ ...raw, id: "other" }));
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("invalid_map");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");
  });

  it("(в) interrupted save keeps the project loadable, no half-written files", async () => {
    const storage = new MemoryStorage();
    const old = createEmptyProject("Старая игра");
    addMap(old, "second", 1);
    await saveProject(storage, old);
    const oldFiles = new Map(storage.files);

    const next = structuredClone(old);
    next.manifest.name = "Новая игра";
    next.maps.main!.layers[0]!.tiles[0] = 7;
    next.maps.second!.layers[0]!.tiles[0] = 9;
    storage.failOnWrite(2);

    const err = await rejected(saveProject(storage, next));
    expect(err.code).toBe("save_failed");
    expect(err.file).toBe("maps/second.json");
    expect(err.message).toContain("maps/second.json");
    expect(err.message).toMatch(/^[\x20-\x7e]*$/);

    expectAllFilesWhole(storage);
    // Manifest is written last, so it is still the old one; the failed map is old too.
    expect(storage.files.get(MANIFEST_FILE)).toBe(oldFiles.get(MANIFEST_FILE));
    expect(storage.files.get("maps/second.json")).toBe(oldFiles.get("maps/second.json"));

    const loaded = await loadProject(storage);
    expect(loaded.manifest.name).toBe("Старая игра");
    expect(loaded.maps.main).toEqual(next.maps.main); // already new
    expect(loaded.maps.second).toEqual(old.maps.second); // still old
  });

  it("invalid project is not written at all", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("Моя игра");
    const second = addMap(project, "second", 1);
    second.layers[0]!.tiles[3] = 999;
    const err = await rejected(saveProject(storage, project));
    expect(err.code).toBe("invalid_map");
    expect(err.message).toContain("maps/second.json");
    expect(storage.files.size).toBe(0);
    expect(storage.writeLog).toEqual([]);
  });

  it("manifest and maps out of sync are refused before writing", async () => {
    const storage = new MemoryStorage();
    const missingMap = createEmptyProject("Моя игра");
    missingMap.manifest.maps.push({ id: "ghost", file: "maps/ghost.json" });
    expect((await rejected(saveProject(storage, missingMap))).code).toBe("invalid_project");

    const extraMap = createEmptyProject("Моя игра");
    addMap(extraMap, "extra", 0);
    extraMap.manifest.maps.pop();
    expect((await rejected(saveProject(storage, extraMap))).code).toBe("invalid_project");

    const wrongKey = createEmptyProject("Моя игра");
    wrongKey.maps.main!.id = "other";
    expect((await rejected(saveProject(storage, wrongKey))).code).toBe("invalid_project");

    const emptyName = createEmptyProject("Моя игра");
    emptyName.manifest.name = "";
    expect((await rejected(saveProject(storage, emptyName))).code).toBe("invalid_manifest");
    expect(storage.writeLog).toEqual([]);
  });

  it("(г) manifest referencing a missing map file names that file", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    storage.files.delete("maps/main.json");
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("file_missing");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");
    expect(err.message).toContain(MANIFEST_FILE);
  });

  it("(д) unknown keys in manifest, map and layer survive a round-trip", async () => {
    const storage = new MemoryStorage();
    const project = createEmptyProject("Моя игра");
    (project.manifest as Record<string, unknown>).futureKey = { список: [1, 2] };
    (project.maps.main as Record<string, unknown>).weather = "дождь";
    (project.maps.main!.layers[0] as Record<string, unknown>).opacity = 0.5;
    await saveProject(storage, project);
    const loaded = await loadProject(storage);
    expect(loaded.manifest.futureKey).toEqual({ список: [1, 2] });
    expect(loaded.maps.main!.weather).toBe("дождь");
    expect(loaded.maps.main!.layers[0]!.opacity).toBe(0.5);
    await saveProject(storage, loaded);
    expect(await loadProject(storage)).toEqual(project);
  });

  it("(е) startMapId without a map is refused with the manifest name", async () => {
    const storage = new MemoryStorage();
    await saveProject(storage, createEmptyProject("Моя игра"));
    const raw = JSON.parse(storage.files.get(MANIFEST_FILE)!) as Record<string, unknown>;
    storage.files.set(MANIFEST_FILE, JSON.stringify({ ...raw, startMapId: "nowhere" }));
    const err = await rejected(loadProject(storage));
    expect(err.code).toBe("invalid_manifest");
    expect(err.file).toBe(MANIFEST_FILE);
    expect(err.message).toContain(MANIFEST_FILE);
    expect(err.message).toContain("startMapId");

    const project = createEmptyProject("Моя игра");
    project.manifest.startMapId = "nowhere";
    expect((await rejected(saveProject(new MemoryStorage(), project))).code).toBe("invalid_manifest");
  });
});

describe("MemoryStorage", () => {
  it("fails exactly on the configured write and stores nothing for it", async () => {
    const s = new MemoryStorage();
    s.failOnWrite(2);
    await s.writeAtomic("a.json", "1");
    await expect(s.writeAtomic("b.json", "2")).rejects.toThrow();
    await s.writeAtomic("c.json", "3");
    expect([...s.files.keys()]).toEqual(["a.json", "c.json"]);
    expect(await s.exists("b.json")).toBe(false);
    await expect(s.read("b.json")).rejects.toThrow();
  });
});

describe("NodeFsStorage", () => {
  let base: string | undefined;
  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
    base = undefined;
  });

  it("(а) round-trip in a folder with Cyrillic and spaces", async () => {
    base = await mkdtemp(join(tmpdir(), "nestst-"));
    const dir = join(base, "Мой проект с пробелами");
    await mkdir(dir);
    const storage = new NodeFsStorage(dir);
    const project = createEmptyProject("Моя игра");
    await saveProject(storage, project);
    expect(await loadProject(storage)).toEqual(project);

    expect((await readdir(dir)).sort()).toEqual(["maps", MANIFEST_FILE].sort());
    expect(await readdir(join(dir, "maps"))).toEqual(["main.json"]); // no temp files left
    const manifestText = await readFile(join(dir, MANIFEST_FILE), "utf8");
    expect(manifestText).toContain("Моя игра");

    // Overwrite works and replaces the file entirely.
    project.manifest.name = "Моя игра 2";
    await saveProject(storage, project);
    expect((await loadProject(storage)).manifest.name).toBe("Моя игра 2");
    expect(await readdir(join(dir, "maps"))).toEqual(["main.json"]);
  });

  it("exists/read on missing files, and unsafe paths are refused", async () => {
    base = await mkdtemp(join(tmpdir(), "nestst-"));
    const storage = new NodeFsStorage(base);
    expect(await storage.exists("maps/none.json")).toBe(false);
    await expect(storage.read("maps/none.json")).rejects.toThrow();
    for (const bad of ["../x.json", "/etc/passwd", "maps/../../x.json", "maps\\x.json", ""]) {
      const err = await rejected(storage.writeAtomic(bad, "{}"));
      expect(err.code).toBe("unsafe_path");
    }
  });
});

describe("package boundaries", () => {
  it("core index does not expose test storages", () => {
    expect("MemoryStorage" in core).toBe(false);
    expect("NodeFsStorage" in core).toBe(false);
  });

  it("only testing.ts and tests use Node APIs", async () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "testing.ts") continue;
      const text = await readFile(join(dir, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["']node:|reference types="node"|\bprocess\./);
    }
  });
});
