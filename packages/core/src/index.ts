export { NestError } from "./errors.js";
export {
  CURRENT_SCHEMA_VERSION,
  MAX_TILE_ID,
  MAX_MAP_SIZE,
  MAX_LAYERS,
  parseMap,
  parseManifest,
} from "./schema.js";
export type { TileLayer, GameMap, ProjectManifest } from "./schema.js";
export { migrateRaw, MIGRATIONS } from "./migrate.js";
export type { MigrationStep } from "./migrate.js";
