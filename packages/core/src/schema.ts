import { z } from "zod";
import { NestError, describeFirstIssue, messageForIssue } from "./errors.js";

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_TILE_ID = 255;
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

const schemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION, {
  error: (iss) =>
    iss.input === undefined
      ? "this field is missing"
      : `format version must be ${CURRENT_SCHEMA_VERSION}`,
});

export const tileLayerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  visible: z.boolean(),
  tiles: z.array(intRange(0, MAX_TILE_ID)),
});

export const gameMapSchema = z.looseObject({
  schemaVersion: schemaVersionSchema,
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
});

export const manifestMapEntrySchema = z.looseObject({
  id: idSchema,
  file: z.string().min(1),
});

export const projectManifestSchema = z.looseObject({
  schemaVersion: schemaVersionSchema,
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

export function parseMap(raw: unknown, file?: string): GameMap {
  const where = withFile(file, mapLabel(raw));
  const res = gameMapSchema.safeParse(raw, { error: messageForIssue });
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
  return map;
}

export function parseManifest(raw: unknown, file?: string): ProjectManifest {
  const label =
    isRecord(raw) && typeof raw.name === "string" && raw.name !== ""
      ? `in project "${raw.name}"`
      : "in project manifest";
  const where = withFile(file, label);
  const res = projectManifestSchema.safeParse(raw, { error: messageForIssue });
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
