export { NestError } from "./errors.js";
export {
  FORMAT_VERSIONS,
  MAX_TILE_ID,
  BUILTIN_TILE_COUNT,
  MAX_MAP_SIZE,
  MAX_LAYERS,
  MAX_MAP_CELLS,
  parseMap,
  parseManifest,
} from "./schema.js";
export type { FormatKind, TileLayer, MapObject, GameMap, ProjectManifest } from "./schema.js";
export { migrateRaw, MIGRATIONS } from "./migrate.js";
export type { MigrationStep } from "./migrate.js";
export type { ProjectStorage } from "./storage.js";
export { MANIFEST_FILE, BACKUP_DIR, createEmptyProject, saveProject, loadProject } from "./project.js";
export type { Project, BackupFile, SaveOptions } from "./project.js";
export { paintTiles, paintCommand, mergeCommands } from "./mapOps.js";
export type { TileEdit, Command } from "./mapOps.js";
export { History } from "./history.js";
export {
  isSolidTile,
  nextNpcId,
  objectAt,
  setSolidCommand,
  placeObjectCommand,
  moveObjectCommand,
  removeObjectCommand,
} from "./objectOps.js";
