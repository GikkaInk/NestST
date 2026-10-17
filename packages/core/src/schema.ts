import { z } from "zod";
import { NestError, describeFirstIssue, russianErrorMap } from "./errors.js";

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_TILE_ID = 255;
export const MAX_MAP_SIZE = 2048;
export const MAX_LAYERS = 16;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ID_MESSAGE =
  "идентификатор должен состоять из латинских строчных букв, цифр, «_» и «-», начинаться с буквы или цифры и быть не длиннее 64 символов";

/** Целое число в диапазоне; одно и то же понятное сообщение для любой причины отказа. */
function intRange(min: number, max: number) {
  const message = `должно быть целое число от ${min} до ${max}`;
  const error = (iss: { input?: unknown }) =>
    iss.input === undefined ? "поле обязательно, но отсутствует" : message;
  return z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
}

const idSchema = z.string().regex(ID_PATTERN, { error: ID_MESSAGE });

const schemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION, {
  error: (iss) =>
    iss.input === undefined
      ? "поле обязательно, но отсутствует"
      : `версия формата должна быть ${CURRENT_SCHEMA_VERSION}`,
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
        ? "поле обязательно, но отсутствует"
        : "режим вида должен быть «topdown» (вид сверху)",
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

function checkNewerVersion(raw: unknown, file: string | undefined): void {
  if (!isRecord(raw)) return;
  const v = raw.schemaVersion;
  if (typeof v === "number" && Number.isInteger(v) && v > CURRENT_SCHEMA_VERSION) {
    throw new NestError(
      "newer-version",
      `${file ? `файл ${file}: ` : ""}создан более новой версией NestST (формат ${v}, эта версия понимает формат ${CURRENT_SCHEMA_VERSION}). Обновите NestST.`,
      file,
    );
  }
}

function withFile(file: string | undefined, where: string): string {
  return file ? `файл ${file}: ${where}` : where;
}

function mapLabel(raw: unknown): string {
  if (isRecord(raw)) {
    if (typeof raw.name === "string" && raw.name !== "") return `в карте «${raw.name}»`;
    if (typeof raw.id === "string" && raw.id !== "") return `в карте «${raw.id}»`;
  }
  return "в карте";
}

export function parseMap(raw: unknown, file?: string): GameMap {
  checkNewerVersion(raw, file);
  const where = withFile(file, mapLabel(raw));
  const res = gameMapSchema.safeParse(raw, { error: russianErrorMap });
  if (!res.success) {
    throw new NestError("invalid-map", describeFirstIssue(res.error, where), file);
  }
  const map = res.data;

  const expected = map.width * map.height;
  const seen = new Set<string>();
  for (const layer of map.layers) {
    if (seen.has(layer.id)) {
      throw new NestError("invalid-map", `${where}: идентификатор слоя «${layer.id}» повторяется`, file);
    }
    seen.add(layer.id);
    if (layer.tiles.length !== expected) {
      throw new NestError(
        "invalid-map",
        `${where}: размер слоя «${layer.name}» (${layer.tiles.length} плиток) не равен ширина × высота (${map.width} × ${map.height} = ${expected})`,
        file,
      );
    }
  }
  return map;
}

export function parseManifest(raw: unknown, file?: string): ProjectManifest {
  checkNewerVersion(raw, file);
  const label =
    isRecord(raw) && typeof raw.name === "string" && raw.name !== ""
      ? `в проекте «${raw.name}»`
      : "в манифесте проекта";
  const where = withFile(file, label);
  const res = projectManifestSchema.safeParse(raw, { error: russianErrorMap });
  if (!res.success) {
    throw new NestError("invalid-manifest", describeFirstIssue(res.error, where), file);
  }
  const manifest = res.data;

  const ids = new Set<string>();
  manifest.maps.forEach((entry, i) => {
    if (ids.has(entry.id)) {
      throw new NestError("invalid-manifest", `${where}: карта «${entry.id}» указана в списке maps больше одного раза`, file);
    }
    ids.add(entry.id);
    const expectedFile = `maps/${entry.id}.json`;
    if (entry.file !== expectedFile) {
      throw new NestError(
        "invalid-manifest",
        `${where}, поле maps[${i}].file: для карты «${entry.id}» файл должен быть «${expectedFile}», а указано «${entry.file}»`,
        file,
      );
    }
  });
  if (!ids.has(manifest.startMapId)) {
    throw new NestError(
      "invalid-manifest",
      `${where}, поле startMapId: стартовой карты «${manifest.startMapId}» нет среди карт проекта`,
      file,
    );
  }
  return manifest;
}
