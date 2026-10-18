import { NestError } from "./errors.js";
import { migrateRaw } from "./migrate.js";
import { CURRENT_SCHEMA_VERSION, parseManifest, parseMap } from "./schema.js";
import type { GameMap, ProjectManifest } from "./schema.js";
import type { ProjectStorage } from "./storage.js";

/** Manifest file name at the project root. */
export const MANIFEST_FILE = "nestst.project.json";

const MAX_PROJECT_NAME = 200;
const DEFAULT_MAP_ID = "main";
const DEFAULT_MAP_WIDTH = 32;
const DEFAULT_MAP_HEIGHT = 24;
const DEFAULT_TILE_SIZE = 32;

export interface Project {
  manifest: ProjectManifest;
  /** Maps by id; every manifest entry has exactly one map here and vice versa. */
  maps: Record<string, GameMap>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** New project with one empty map `main`. The name is trimmed. */
export function createEmptyProject(name: string): Project {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new NestError("invalid_project_name", "Project name must not be empty");
  }
  if (trimmed.length > MAX_PROJECT_NAME) {
    throw new NestError(
      "invalid_project_name",
      `Project name must be at most ${MAX_PROJECT_NAME} characters long`,
    );
  }
  const map: GameMap = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: DEFAULT_MAP_ID,
    name: "Main",
    viewMode: "topdown",
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    tileSize: DEFAULT_TILE_SIZE,
    layers: [
      {
        id: "ground",
        name: "Ground",
        visible: true,
        tiles: new Array<number>(DEFAULT_MAP_WIDTH * DEFAULT_MAP_HEIGHT).fill(0),
      },
    ],
  };
  const manifest: ProjectManifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: trimmed,
    resolution: { width: 1280, height: 720 },
    tileSize: DEFAULT_TILE_SIZE,
    maps: [{ id: DEFAULT_MAP_ID, file: `maps/${DEFAULT_MAP_ID}.json` }],
    startMapId: DEFAULT_MAP_ID,
  };
  return { manifest, maps: { [DEFAULT_MAP_ID]: map } };
}

function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Map as pretty JSON (2 spaces), except that each layer's `tiles` array is
 * written compactly, one map row (`width` comma-separated numbers) per line. Readers see plain
 * JSON either way. Works by stringifying with unique string placeholders in
 * place of `tiles` and splicing the rows in afterwards.
 */
export function serializeMap(map: GameMap): string {
  for (;;) {
    const token = `__nestst_tiles_${Math.random().toString(36).slice(2)}_`;
    const placeholder = (i: number) => `${token}${i}__`;
    const shell = {
      ...map,
      layers: map.layers.map((layer, i) => ({ ...layer, tiles: placeholder(i) })),
    };
    const text = serialize(shell);
    // Retry in the (practically impossible) case user data contains the token.
    if (text.split(token).length - 1 !== map.layers.length) continue;
    let out = text;
    map.layers.forEach((layer, i) => {
      const quoted = `"${placeholder(i)}"`;
      const at = out.indexOf(quoted);
      const lineStart = out.lastIndexOf("\n", at) + 1;
      const indent = /^ */.exec(out.slice(lineStart))![0];
      const rows: string[] = [];
      for (let r = 0; r * map.width < layer.tiles.length; r++) {
        rows.push(layer.tiles.slice(r * map.width, (r + 1) * map.width).join(","));
      }
      const body = `[\n${indent}  ${rows.join(`,\n${indent}  `)}\n${indent}]`;
      out = out.slice(0, at) + body + out.slice(at + quoted.length);
    });
    return out;
  }
}

/**
 * Saves the project. Everything is validated first, so nothing is written if
 * the project is invalid. Then all maps are written, and the manifest LAST.
 *
 * Guarantee after an interrupted save (write error, crash): every file is
 * either entirely old or entirely new, never half-written (that part is the
 * job of `ProjectStorage.writeAtomic`). Because the manifest goes last, an
 * interrupted save can leave the OLD manifest next to some NEW maps; each map
 * file is self-contained, so such a mix still loads without errors.
 */
export async function saveProject(storage: ProjectStorage, project: Project): Promise<void> {
  const manifest = parseManifest(project.manifest, MANIFEST_FILE);
  const listed = new Set(manifest.maps.map((e) => e.id));
  for (const key of Object.keys(project.maps)) {
    if (!listed.has(key)) {
      throw new NestError(
        "invalid_project",
        `map "${key}" is not listed in ${MANIFEST_FILE}`,
        MANIFEST_FILE,
      );
    }
  }
  const files: Array<{ path: string; text: string }> = [];
  for (const entry of manifest.maps) {
    const map = Object.hasOwn(project.maps, entry.id) ? project.maps[entry.id] : undefined;
    if (map === undefined) {
      throw new NestError(
        "invalid_project",
        `${MANIFEST_FILE} lists map "${entry.id}", but the project has no such map`,
        MANIFEST_FILE,
      );
    }
    const parsed = parseMap(map, entry.file);
    if (parsed.id !== entry.id) {
      throw new NestError(
        "invalid_project",
        `file ${entry.file}: map id "${parsed.id}" does not match "${entry.id}" in ${MANIFEST_FILE}`,
        entry.file,
      );
    }
    files.push({ path: entry.file, text: serializeMap(parsed) });
  }
  files.push({ path: MANIFEST_FILE, text: serialize(manifest) });

  for (const { path, text } of files) {
    try {
      await storage.writeAtomic(path, text);
    } catch (e) {
      // A NestError from the storage (e.g. unsafe_path) already explains the
      // problem and is passed through unchanged; any other failure becomes save_failed.
      if (e instanceof NestError) throw e;
      throw new NestError("save_failed", `Could not save file ${path}: ${errorText(e)}`, path);
    }
  }
}

async function readJson(storage: ProjectStorage, path: string, missing: string): Promise<unknown> {
  let exists: boolean;
  try {
    exists = await storage.exists(path);
  } catch (e) {
    throw new NestError("read_failed", `Could not read file ${path}: ${errorText(e)}`, path);
  }
  if (!exists) throw new NestError("file_missing", missing, path);
  let text: string;
  try {
    text = await storage.read(path);
  } catch (e) {
    throw new NestError("read_failed", `Could not read file ${path}: ${errorText(e)}`, path);
  }
  if (text.trim() === "") {
    throw new NestError("empty_file", `file ${path} is empty`, path);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new NestError(
      "invalid_json",
      `file ${path} is damaged: it is not valid JSON (${errorText(e)})`,
      path,
    );
  }
}

/** Reads the manifest, then every map; each file goes through `migrateRaw` and its parser. */
export async function loadProject(storage: ProjectStorage): Promise<Project> {
  const rawManifest = await readJson(
    storage,
    MANIFEST_FILE,
    `file ${MANIFEST_FILE} was not found; this folder is not a NestST project`,
  );
  const manifest = parseManifest(
    migrateRaw("manifest", rawManifest, undefined, MANIFEST_FILE),
    MANIFEST_FILE,
  );
  const maps: Record<string, GameMap> = {};
  for (const entry of manifest.maps) {
    const raw = await readJson(
      storage,
      entry.file,
      `file ${entry.file} was not found, but ${MANIFEST_FILE} lists it for map "${entry.id}"`,
    );
    const map = parseMap(migrateRaw("map", raw, undefined, entry.file), entry.file);
    if (map.id !== entry.id) {
      throw new NestError(
        "invalid_map",
        `file ${entry.file}: map id "${map.id}" does not match "${entry.id}" in ${MANIFEST_FILE}`,
        entry.file,
      );
    }
    maps[entry.id] = map;
  }
  return { manifest, maps };
}
