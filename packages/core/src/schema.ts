import { z } from "zod";
import { NestError, describeFirstIssue } from "./errors.js";
import { MAX_DIALOGS, MAX_VARIABLES, variableDefSchema } from "./dialogSchema.js";
import { idSchema, intRange, isRecord, safeParseGuarded, schemaVersionSchema, withFile } from "./schemaUtil.js";
export { FORMAT_VERSIONS } from "./schemaUtil.js";
export type { FormatKind } from "./schemaUtil.js";

export const MAX_TILE_ID = 65535;
/** Tiles in the built-in tileset and palette (ids 1..255; 0 is empty). */
export const BUILTIN_TILE_COUNT = 255;
export const MAX_MAP_SIZE = 2048;
export const MAX_LAYERS = 16;
/** Upper limit of width × height × layers of one map. */
export const MAX_MAP_CELLS = 4194304;

const TILE_MESSAGE = `must be a whole number from 0 to ${MAX_TILE_ID}`;

/**
 * Tile list checked with a plain loop that stops at the first bad tile.
 * `z.array(intRange(...))` collects one issue per bad item, which on a
 * 2048×2048 layer is slow and can overflow the call stack.
 */
const tilesSchema = z
  .custom<number[]>((v) => Array.isArray(v), { error: "must be a list" })
  .check((ctx) => {
    const tiles = ctx.value;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!Number.isInteger(t) || t < 0 || t > MAX_TILE_ID) {
        ctx.issues.push({
          code: "custom",
          input: t,
          path: [i],
          message: t === undefined ? "this field is missing" : TILE_MESSAGE,
        });
        return;
      }
    }
  });

export const tileLayerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  visible: z.boolean(),
  tiles: tilesSchema,
});

export const mapObjectSchema = z.looseObject({
  id: idSchema,
  kind: z.string(),
  x: intRange(0, MAX_MAP_SIZE),
  y: intRange(0, MAX_MAP_SIZE),
  props: z.record(z.string(), z.unknown()),
});

export const gameMapSchema = z.looseObject({
  schemaVersion: schemaVersionSchema("map"),
  id: idSchema,
  name: z.string().min(1).max(200),
  viewMode: z.literal("topdown", {
    error: (iss) =>
      iss.input === undefined
        ? "this field is missing"
        : "view mode must be \"topdown\"",
  }),
  width: intRange(1, MAX_MAP_SIZE),
  height: intRange(1, MAX_MAP_SIZE),
  tileSize: intRange(1, 256),
  layers: z.array(tileLayerSchema).min(1).max(MAX_LAYERS),
  objects: z.array(mapObjectSchema),
});

const solidTilesSchema = z
  .array(intRange(1, MAX_TILE_ID), { error: "must be a list" })
  .refine((v) => new Set(v).size === v.length, { error: "tiles must not repeat" });

export const manifestMapEntrySchema = z.looseObject({
  id: idSchema,
  file: z.string().min(1),
});

export const manifestDialogEntrySchema = z.looseObject({
  id: idSchema,
  file: z.string().min(1),
});

export const projectManifestSchema = z.looseObject({
  schemaVersion: schemaVersionSchema("manifest"),
  name: z.string().min(1).max(200),
  resolution: z.looseObject({
    width: intRange(1, 16384),
    height: intRange(1, 16384),
  }),
  tileSize: intRange(1, 256),
  maps: z.array(manifestMapEntrySchema),
  startMapId: idSchema,
  solidTiles: solidTilesSchema,
  variables: z.array(variableDefSchema).max(MAX_VARIABLES),
  dialogs: z.array(manifestDialogEntrySchema).max(MAX_DIALOGS),
});

export type TileLayer = z.infer<typeof tileLayerSchema>;
export type MapObject = z.infer<typeof mapObjectSchema>;
export type GameMap = z.infer<typeof gameMapSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

function mapLabel(raw: unknown): string {
  if (isRecord(raw)) {
    if (typeof raw.name === "string" && raw.name !== "") return `in map "${raw.name}"`;
    if (typeof raw.id === "string" && raw.id !== "") return `in map "${raw.id}"`;
  }
  return "in map";
}

function tooBig(where: string, cells: number, file: string | undefined): NestError {
  return new NestError(
    "invalid_map",
    `${where}: map is too big: ${cells} cells (width × height × layers), the limit is ${MAX_MAP_CELLS}`,
    file,
  );
}

export function parseMap(raw: unknown, file?: string): GameMap {
  const where = withFile(file, mapLabel(raw));
  // Cheap check on the raw data first, so an oversized map is refused before its tiles are validated.
  if (isRecord(raw) && Array.isArray(raw.layers)) {
    const w = raw.width;
    const h = raw.height;
    if (typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h)) {
      const rawCells = w * h * raw.layers.length;
      if (rawCells > MAX_MAP_CELLS) throw tooBig(where, rawCells, file);
    }
  }
  const res = safeParseGuarded(gameMapSchema, raw, "invalid_map", where, file);
  if (!res.success) {
    throw new NestError("invalid_map", describeFirstIssue(res.error, where), file);
  }
  const map = res.data;

  const cells = map.width * map.height * map.layers.length;
  if (cells > MAX_MAP_CELLS) throw tooBig(where, cells, file);
  const expected = map.width * map.height;
  const seen = new Set<string>();
  for (const layer of map.layers) {
    if (seen.has(layer.id)) {
      throw new NestError("invalid_map", `${where}: layer id "${layer.id}" is used more than once`, file);
    }
    seen.add(layer.id);
    if (layer.tiles.length !== expected) {
      throw new NestError(
        "invalid_map",
        `${where}: layer size of "${layer.name}" (${layer.tiles.length} tiles) does not match width × height (${map.width} × ${map.height} = ${expected})`,
        file,
      );
    }
  }
  const objectIds = new Set<string>();
  const cellOwners = new Map<number, string>();
  let spawnId: string | undefined;
  for (const obj of map.objects) {
    if (objectIds.has(obj.id)) {
      throw new NestError("invalid_map", `${where}: object id "${obj.id}" is used more than once`, file);
    }
    objectIds.add(obj.id);
    if (obj.x >= map.width || obj.y >= map.height) {
      throw new NestError(
        "invalid_map",
        `${where}: object "${obj.id}" at (${obj.x}, ${obj.y}) is outside the map (${map.width} × ${map.height})`,
        file,
      );
    }
    if (obj.kind === "spawn") {
      if (spawnId !== undefined) {
        throw new NestError(
          "invalid_map",
          `${where}: a map can have only one spawn, but "${spawnId}" and "${obj.id}" are both spawns`,
          file,
        );
      }
      spawnId = obj.id;
    }
    const cell = obj.y * map.width + obj.x;
    const other = cellOwners.get(cell);
    if (other !== undefined) {
      throw new NestError(
        "invalid_map",
        `${where}: objects "${other}" and "${obj.id}" are in the same cell (${obj.x}, ${obj.y})`,
        file,
      );
    }
    cellOwners.set(cell, obj.id);
  }
  return map;
}

export function parseManifest(raw: unknown, file?: string): ProjectManifest {
  const label =
    isRecord(raw) && typeof raw.name === "string" && raw.name !== ""
      ? `in project "${raw.name}"`
      : "in project manifest";
  const where = withFile(file, label);
  const res = safeParseGuarded(projectManifestSchema, raw, "invalid_manifest", where, file);
  if (!res.success) {
    throw new NestError("invalid_manifest", describeFirstIssue(res.error, where), file);
  }
  const manifest = res.data;

  const ids = new Set<string>();
  manifest.maps.forEach((entry, i) => {
    if (ids.has(entry.id)) {
      throw new NestError("invalid_manifest", `${where}: map "${entry.id}" is listed more than once in maps`, file);
    }
    ids.add(entry.id);
    const expectedFile = `maps/${entry.id}.json`;
    if (entry.file !== expectedFile) {
      throw new NestError(
        "invalid_manifest",
        `${where}, field maps[${i}].file: for map "${entry.id}" the file must be "${expectedFile}", but it is "${entry.file}"`,
        file,
      );
    }
  });
  const varIds = new Set<string>();
  for (const v of manifest.variables) {
    if (varIds.has(v.id)) {
      throw new NestError("invalid_manifest", `${where}: variable "${v.id}" is listed more than once in variables`, file);
    }
    varIds.add(v.id);
  }
  const dialogIds = new Set<string>();
  manifest.dialogs.forEach((entry, i) => {
    if (dialogIds.has(entry.id)) {
      throw new NestError("invalid_manifest", `${where}: dialog "${entry.id}" is listed more than once in dialogs`, file);
    }
    dialogIds.add(entry.id);
    const expectedFile = `dialogs/${entry.id}.json`;
    if (entry.file !== expectedFile) {
      throw new NestError(
        "invalid_manifest",
        `${where}, field dialogs[${i}].file: for dialog "${entry.id}" the file must be "${expectedFile}", but it is "${entry.file}"`,
        file,
      );
    }
  });
  if (!ids.has(manifest.startMapId)) {
    throw new NestError(
      "invalid_manifest",
      `${where}, field startMapId: start map "${manifest.startMapId}" is not among the project maps`,
      file,
    );
  }
  return manifest;
}
