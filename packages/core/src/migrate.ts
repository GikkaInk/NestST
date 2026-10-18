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

/** Internal: same as `migrateRaw` but with a configurable target version (for tests). */
export function migrateToVersion(
  kind: "manifest" | "map",
  raw: unknown,
  steps: MigrationStep[],
  file: string | undefined,
  target: number,
): unknown {
  const what = `${file ? `file ${file}: ` : ""}${kind === "map" ? "map" : "project manifest"}`;
  const fail = (code: string, text: string): never => {
    throw new NestError(code, `${what}: ${text}`, file);
  };
  if (!isRecord(raw)) return fail("invalid_data", "data must be an object");
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail(
      "invalid_schema_version",
      "field schemaVersion is missing or is not a whole number",
    );
  }
  if (version > target) {
    return fail(
      "schema_too_new",
      "this file was created by a newer version of NestST " +
        `(format version ${version}); please update NestST`,
    );
  }
  const own = steps.filter((s) => s.kind === kind);
  const froms = new Set<number>();
  for (const s of own) {
    if (froms.has(s.from)) {
      return fail("migration_invalid", `two migrations start from format version ${s.from}`);
    }
    froms.add(s.from);
  }
  let data = structuredClone(raw);
  let current = version;
  while (current < target) {
    const step = own.find((s) => s.from === current);
    if (!step) {
      return fail(
        "migration_missing",
        `there is no migration from format version ${current} to ${target}`,
      );
    }
    const name = `migration from format version ${step.from} to ${step.to}`;
    if (!Number.isInteger(step.to) || step.to <= step.from) {
      return fail("migration_invalid", `${name} does not move forward`);
    }
    if (step.to > target) {
      return fail("migration_invalid", `${name} goes beyond the current format version ${target}`);
    }
    data = step.run(data);
    if (data.schemaVersion !== step.to) {
      return fail("migration_invalid", `${name} did not set schemaVersion to ${step.to}`);
    }
    current = step.to;
  }
  return data;
}

/**
 * Brings raw data up to CURRENT_SCHEMA_VERSION. Works on a copy and never
 * mutates the input. The single place that rejects files from newer versions.
 */
export function migrateRaw(
  kind: "manifest" | "map",
  raw: unknown,
  steps: MigrationStep[] = MIGRATIONS,
  file?: string,
): unknown {
  return migrateToVersion(kind, raw, steps, file, CURRENT_SCHEMA_VERSION);
}
