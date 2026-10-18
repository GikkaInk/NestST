/// <reference types="node" />
/**
 * End-to-end M1 scenario on the real file system: create → paint/erase →
 * undo → save → load with a fresh storage, plus damaged, newer, interrupted
 * and unsafe projects. Covers the plan's Review Focus items 1, 2, 3 and 5.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  History,
  MANIFEST_FILE,
  NestError,
  createEmptyProject,
  loadProject,
  mergeCommands,
  paintCommand,
  saveProject,
} from "./index.js";
import type { Project, TileEdit } from "./index.js";
import { NodeFsStorage } from "./testing.js";

const NAME = "Тест с пробелами и кириллицей";

async function rejected(p: Promise<unknown>): Promise<NestError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

/** All file names under `dir`, recursively, relative and with "/". */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), `${rel}/`)));
    else out.push(rel);
  }
  return out.sort();
}

/** NodeFsStorage whose n-th write call (1-based) fails before touching the disk. */
class FailingFsStorage extends NodeFsStorage {
  private calls = 0;
  constructor(rootDir: string, private readonly failAt: number) {
    super(rootDir);
  }
  override async writeAtomic(path: string, data: string): Promise<void> {
    this.calls += 1;
    if (this.calls === this.failAt) throw new Error("simulated write failure");
    return super.writeAtomic(path, data);
  }
}

/** One brush drag: several paint commands merged into one undo step. */
function stroke(history: History, project: Project, edits: TileEdit[][]): Project {
  let current = project;
  const cmds = edits.map((part) => {
    const cmd = paintCommand("main", part, current.maps.main!);
    current = cmd.apply(current);
    return cmd;
  });
  return history.push(mergeCommands("Stroke", cmds), project);
}

const at = (x: number, y: number, tile: number): TileEdit => ({ layerId: "ground", x, y, tile });

describe("end-to-end project on disk", () => {
  let base: string;
  let dir: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "nestst-e2e-"));
    dir = join(base, NAME);
    await mkdir(dir);
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("create → paint → erase → undo → save → load with a fresh storage", async () => {
    const history = new History();
    let project = createEmptyProject(NAME);
    expect(project.manifest.name).toBe(NAME);

    // A stroke of three tiles, then an eraser stroke over the middle one.
    project = stroke(history, project, [[at(1, 1, 3)], [at(2, 1, 3)], [at(3, 1, 3)]]);
    const afterPaint = structuredClone(project);
    project = stroke(history, project, [[at(2, 1, 0)]]);
    const tiles = () => project.maps.main!.layers[0]!.tiles;
    const w = project.maps.main!.width;
    expect([tiles()[w + 1], tiles()[w + 2], tiles()[w + 3]]).toEqual([3, 0, 3]);

    // Undo removes only the erase.
    project = history.undo(project);
    expect(project).toEqual(afterPaint);
    expect([tiles()[w + 1], tiles()[w + 2], tiles()[w + 3]]).toEqual([3, 3, 3]);
    expect(history.canRedo).toBe(true);

    await saveProject(new NodeFsStorage(dir), project);
    expect(await listFiles(dir)).toEqual(["maps/main.json", MANIFEST_FILE]); // no temp files
    expect(await readFile(join(dir, MANIFEST_FILE), "utf8")).toContain(NAME);

    const loaded = await loadProject(new NodeFsStorage(dir));
    expect(loaded.maps).toEqual(project.maps);
    expect(loaded).toEqual(project);
  });

  it("damaged or empty maps/main.json is refused naming that file", async () => {
    await saveProject(new NodeFsStorage(dir), createEmptyProject(NAME));
    const manifestBefore = await readFile(join(dir, MANIFEST_FILE), "utf8");
    const mapPath = join(dir, "maps", "main.json");

    await writeFile(mapPath, "{ this is ]] not json");
    let err = await rejected(loadProject(new NodeFsStorage(dir)));
    expect(err.code).toBe("invalid_json");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");

    await writeFile(mapPath, "");
    err = await rejected(loadProject(new NodeFsStorage(dir)));
    expect(err.code).toBe("empty_file");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");

    // Loading never touches the other files.
    expect(await readFile(join(dir, MANIFEST_FILE), "utf8")).toBe(manifestBefore);
    expect(await readFile(mapPath, "utf8")).toBe("");
  });

  it("unknown keys in manifest and map survive save → load → save → load", async () => {
    const project = createEmptyProject(NAME);
    (project.manifest as Record<string, unknown>).futureManifestKey = { заметка: "из будущего" };
    (project.maps.main as Record<string, unknown>).futureMapKey = [1, "два", { три: 3 }];

    await saveProject(new NodeFsStorage(dir), project);
    const first = await loadProject(new NodeFsStorage(dir));
    expect(first.manifest.futureManifestKey).toEqual({ заметка: "из будущего" });
    expect(first.maps.main!.futureMapKey).toEqual([1, "два", { три: 3 }]);

    await saveProject(new NodeFsStorage(dir), first);
    const second = await loadProject(new NodeFsStorage(dir));
    expect(second).toEqual(project);
  });

  it("interrupted save leaves a loadable project and no .tmp leftovers", async () => {
    const old = createEmptyProject(NAME);
    old.maps.second = { ...structuredClone(old.maps.main!), id: "second", name: "Second" };
    old.manifest.maps.push({ id: "second", file: "maps/second.json" });
    await saveProject(new NodeFsStorage(dir), old);
    const before = new Map<string, string>();
    for (const f of await listFiles(dir)) before.set(f, await readFile(join(dir, f), "utf8"));

    const next = structuredClone(old);
    next.manifest.name = "Новое имя";
    next.maps.main!.layers[0]!.tiles[0] = 7;
    next.maps.second!.layers[0]!.tiles[0] = 9;

    // Write order: maps/main.json, maps/second.json (fails), manifest never written.
    const err = await rejected(saveProject(new FailingFsStorage(dir, 2), next));
    expect(err.code).toBe("save_failed");
    expect(err.file).toBe("maps/second.json");

    const files = await listFiles(dir);
    expect(files).toEqual(["maps/main.json", "maps/second.json", MANIFEST_FILE]);
    expect(files.filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(await readFile(join(dir, MANIFEST_FILE), "utf8")).toBe(before.get(MANIFEST_FILE));
    expect(await readFile(join(dir, "maps/second.json"), "utf8")).toBe(before.get("maps/second.json"));

    const loaded = await loadProject(new NodeFsStorage(dir));
    expect(loaded.manifest.name).toBe(NAME); // old manifest
    expect(loaded.maps.main).toEqual(next.maps.main); // already new, still whole
    expect(loaded.maps.second).toEqual(old.maps.second); // still old
  });

  it("a file from a newer NestST is refused with 'update NestST' and left as is", async () => {
    await saveProject(new NodeFsStorage(dir), createEmptyProject(NAME));
    const mapPath = join(dir, "maps", "main.json");
    const raw = JSON.parse(await readFile(mapPath, "utf8")) as Record<string, unknown>;
    const newer = JSON.stringify({ ...raw, schemaVersion: 2 });
    await writeFile(mapPath, newer);

    const err = await rejected(loadProject(new NodeFsStorage(dir)));
    expect(err.code).toBe("schema_too_new");
    expect(err.file).toBe("maps/main.json");
    expect(err.message).toContain("maps/main.json");
    expect(err.message).toContain("update NestST");
    expect(await readFile(mapPath, "utf8")).toBe(newer);

    // Same for the manifest.
    const manifestPath = join(dir, MANIFEST_FILE);
    const rawManifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...rawManifest, schemaVersion: 5 }));
    const err2 = await rejected(loadProject(new NodeFsStorage(dir)));
    expect(err2.code).toBe("schema_too_new");
    expect(err2.file).toBe(MANIFEST_FILE);
    expect(err2.message).toContain("update NestST");
  });

  it("an unsafe map id in the manifest is rejected and nothing outside is read", async () => {
    await saveProject(new NodeFsStorage(dir), createEmptyProject(NAME));
    // A valid-looking map file one level above the project folder.
    const outside = createEmptyProject("Outside").maps.main!;
    await writeFile(join(base, "x.json"), JSON.stringify({ ...outside, id: "../x" }));

    const manifestPath = join(dir, MANIFEST_FILE);
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    for (const entry of [
      { id: "../x", file: "maps/../x.json" },
      { id: "../x", file: "../x.json" },
      { id: "a/b", file: "maps/a/b.json" },
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...raw, maps: [entry], startMapId: entry.id }));
      const err = await rejected(loadProject(new NodeFsStorage(dir)));
      expect(err.code).toBe("invalid_manifest");
      expect(err.file).toBe(MANIFEST_FILE);
      expect(err.message).toContain(MANIFEST_FILE);
    }

    // Saving a project with such an id is refused before anything is written.
    const project = createEmptyProject(NAME);
    project.manifest.maps[0] = { id: "../x", file: "maps/../x.json" };
    const empty = join(base, "empty");
    await mkdir(empty);
    await rejected(saveProject(new NodeFsStorage(empty), project));
    expect(await listFiles(empty)).toEqual([]);
  });
});
