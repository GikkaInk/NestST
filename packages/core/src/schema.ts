import { z } from "zod";
import { NestError, describeFirstIssue, messageForIssue } from "./errors.js";

/** Current format version of each file kind. */
export const FORMAT_VERSIONS = { manifest: 2, map: 2 } as const;
export type FormatKind = keyof typeof FORMAT_VERSIONS;
export const MAX_TILE_ID = 65535;
/** Tiles in the built-in tileset and palette (ids 1..255; 0 is empty). */
export const BUILTIN_TILE_COUNT = 255;
export const MAX_MAP_SIZE = 2048;
export const MAX_LAYERS = 16;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ID_MESSAGE =
  "id must use lowercase Latin letters, digits, \"_\" and \"-\", start with a letter or digit and be at most 64 characters long";

/** Whole number in a range; one clear message for every reason of rejection. */
function intRange(min: number, max: number) {
  const message = `must be a whole number from ${min} to ${max}`;
  const error = (iss: { input?: unknown }) =>
    iss.input === undefined ? "this field is missing" : message;
  return z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
}

/** Device names Windows refuses as file names (`maps/<id>.json` must work everywhere). */
const RESERVED_ID = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const RESERVED_MESSAGE =
  "id is a reserved device name on Windows (con, prn, aux, nul, com1-com9, lpt1-lpt9); choose another id";

const idSchema = z
  .string()
  .regex(ID_PATTERN, { error: ID_MESSAGE })
  .refine((v) => !RESERVED_ID.test(v), { error: RESERVED_MESSAGE });

const schemaVersionSchema = <K extends FormatKind>(kind: K) =>
  z.literal(FORMAT_VERSIONS[kind], {
    error: (iss) =>
      iss.input === undefined
        ? "this field is missing"
        : `format version must be ${FORMAT_VERSIONS[kind]}`,
  });

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

export const manifestMapEntrySchema = z.looseObject({
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
});

export type TileLayer = z.infer<typeof tileLayerSchema>;
export type MapObject = z.infer<typeof mapObjectSchema>;
export type GameMap = z.infer<typeof gameMapSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function withFile(file: string | undefined, where: string): string {
  return file ? `file ${file}: ${where}` : where;
}

function mapLabel(raw: unknown): string {
  if (isRecord(raw)) {
    if (typeof raw.name === "string" && raw.name !== "") return `in map "${raw.name}"`;
    if (typeof raw.id === "string" && raw.id !== "") return `in map "${raw.id}"`;
  }
  return "in map";
}

/**
 * `safeParse` that never lets an engine error out: if the data is so damaged
 * that validation itself runs out of stack, report it as a NestError.
 */
function safeParseGuarded<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  code: string,
  where: string,
  file: string | undefined,
): ReturnType<T["safeParse"]> {
  try {
    return schema.safeParse(raw, { error: messageForIssue }) as ReturnType<T["safeParse"]>;
  } catch (e) {
    if (e instanceof RangeError) {
      throw new NestError(code, `${where}: the data is too damaged to read`, file);
    }
    throw e;
  }
}

export function parseMap(raw: unknown, file?: string): GameMap {
  const where = withFile(file, mapLabel(raw));
  const res = safeParseGuarded(gameMapSchema, raw, "invalid_map", where, file);
  if (!res.success) {
    throw new NestError("invalid_map", describeFirstIssue(res.error, where), file);
  }
  const map = res.data;

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
  if (!ids.has(manifest.startMapId)) {
    throw new NestError(
      "invalid_manifest",
      `${where}, field startMapId: start map "${manifest.startMapId}" is not among the project maps`,
      file,
    );
  }
  return manifest;
}
