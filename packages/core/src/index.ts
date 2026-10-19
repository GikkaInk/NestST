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
export {
  MAX_VARIABLES,
  MAX_DIALOGS,
  MAX_DIALOG_NODES,
  MAX_CHOICE_OPTIONS,
  MAX_SAY_TEXT,
  MAX_OPTION_TEXT,
  MAX_SPEAKER,
  MAX_VARIABLE_NAME,
  MAX_VALUE,
  parseDialog,
} from "./dialogSchema.js";
export type { VariableDef, Condition, CompareOp, DialogNode, Dialog } from "./dialogSchema.js";
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
export {
  MAX_EVENT_ACTIONS,
  MAX_OBJECT_NAME,
  eventActionSchema,
  parseNpcProps,
  parseEventProps,
} from "./objectProps.js";
export type { EventAction, NpcProps, EventProps } from "./objectProps.js";
export { validateProjectRefs, collectProjectRefProblems, findReferences } from "./refs.js";
export type { RefTarget } from "./refs.js";
export {
  setVariablesCommand,
  upsertDialogCommand,
  removeDialogCommand,
  setObjectPropsCommand,
  removeMapGuard,
} from "./contentOps.js";
