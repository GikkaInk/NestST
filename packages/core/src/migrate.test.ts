import { describe, expect, it } from "vitest";
import { MIGRATIONS, NestError, migrateRaw, parseManifest, parseMap } from "./index.js";
import type { MigrationStep } from "./index.js";

const step01: MigrationStep = {
  kind: "map",
  from: 0,
  to: 1,
  run: (raw) => ({ ...raw, schemaVersion: 1, name: String(raw.name).trim() }),
};

function thrown(fn: () => unknown): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

describe("migrateRaw", () => {
  it("MIGRATIONS is empty in M1", () => {
    expect(MIGRATIONS).toEqual([]);
  });

  it("applies fake 0 -> 1 step, keeps unknown keys, does not mutate input", () => {
    const input = { schemaVersion: 0, name: "  Город ", extra: { a: [1] } };
    const copy = structuredClone(input);
    const out = migrateRaw("map", input, [step01]) as Record<string, unknown>;
    expect(input).toEqual(copy);
    expect(out).toEqual({ schemaVersion: 1, name: "Город", extra: { a: [1] } });
    expect(out).not.toBe(input);
  });

  it("chains steps in order", () => {
    const steps: MigrationStep[] = [
      { kind: "map", from: 1, to: 2, run: (r) => ({ ...r, schemaVersion: 2, trail: [...(r.trail as string[]), "1-2"] }) },
      { kind: "map", from: 0, to: 1, run: (r) => ({ ...r, schemaVersion: 1, trail: ["0-1"] }) },
    ];
    // current version is 1, so a chain only runs up to it; use 0 -> 1
    const out = migrateRaw("map", { schemaVersion: 0 }, steps) as Record<string, unknown>;
    expect(out.trail).toEqual(["0-1"]);
    expect(out.schemaVersion).toBe(1);
  });

  it("current version is returned unchanged, no steps run", () => {
    const input = { schemaVersion: 1, name: "x" };
    let called = false;
    const spy: MigrationStep = { kind: "map", from: 1, to: 2, run: (r) => ((called = true), r) };
    const out = migrateRaw("map", input, [spy]);
    expect(out).toEqual(input);
    expect(called).toBe(false);
  });

  it("newer version -> schema_too_new, input untouched", () => {
    const input = { schemaVersion: 2, name: "Город" };
    const copy = structuredClone(input);
    const err = thrown(() => migrateRaw("map", input));
    expect(err.code).toBe("schema_too_new");
    expect(err.message).toContain("format version 2");
    expect(err.message).toContain("update NestST");
    expect(input).toEqual(copy);
  });

  it("public flow migrateRaw -> parse gives schema_too_new for both kinds", () => {
    expect(thrown(() => parseMap(migrateRaw("map", { schemaVersion: 7 }))).code).toBe("schema_too_new");
    expect(thrown(() => parseManifest(migrateRaw("manifest", { schemaVersion: 7 }))).code).toBe("schema_too_new");
  });

  it("missing or non-integer schemaVersion -> error mentioning schemaVersion", () => {
    for (const raw of [{}, { schemaVersion: "1" }, { schemaVersion: 1.5 }, { schemaVersion: null }]) {
      const err = thrown(() => migrateRaw("map", raw));
      expect(err.message).toContain("schemaVersion");
    }
  });

  it("gap in the chain -> error", () => {
    const err = thrown(() => migrateRaw("map", { schemaVersion: 0 }, []));
    expect(err.message).toContain("0");
    const other: MigrationStep = { ...step01, kind: "manifest" };
    expect(() => migrateRaw("map", { schemaVersion: 0 }, [other])).toThrow(NestError);
  });

  it("non-object raw -> error", () => {
    for (const raw of [null, undefined, 5, "x", []]) {
      expect(thrown(() => migrateRaw("map", raw)).message).toContain("must be an object");
    }
  });
});
