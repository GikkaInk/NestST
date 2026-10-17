import { CURRENT_SCHEMA_VERSION } from "./schema.js";
import { NestError } from "./errors.js";

export interface MigrationStep {
  kind: "manifest" | "map";
  from: number;
  to: number;
  run(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Real data migrations; empty in M1 (format version 1 is the first). */
export const MIGRATIONS: MigrationStep[] = [];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Brings raw data up to CURRENT_SCHEMA_VERSION. Works on a copy and never
 * mutates the input. The single place that rejects files from newer versions.
 */
export function migrateRaw(
  kind: "manifest" | "map",
  raw: unknown,
  steps: MigrationStep[] = MIGRATIONS,
): unknown {
  const what = kind === "map" ? "map" : "project manifest";
  if (!isRecord(raw)) throw new NestError("invalid_data", `${what} data must be an object`);
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new NestError(
      "invalid_schema_version",
      `${what}: field schemaVersion is missing or is not a whole number`,
    );
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new NestError(
      "schema_too_new",
      `this file was created by a newer version of NestST (format version ${version}); please update NestST`,
    );
  }
  let data = structuredClone(raw);
  let current = version;
  while (current < CURRENT_SCHEMA_VERSION) {
    const step = steps.find((s) => s.kind === kind && s.from === current);
    if (!step) {
      throw new NestError(
        "migration_missing",
        `${what}: there is no migration from format version ${current} to ${CURRENT_SCHEMA_VERSION}`,
      );
    }
    if (!Number.isInteger(step.to) || step.to <= current) {
      throw new NestError("migration_invalid", `${what}: migration from format version ${current} does not move forward`);
    }
    data = step.run(data);
    current = step.to;
  }
  return data;
}
