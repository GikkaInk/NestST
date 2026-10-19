import { describe, expect, it } from "vitest";
import { MIGRATIONS, NestError, migrateRaw, parseManifest, parseMap } from "./index.js";
import type { MigrationStep } from "./index.js";
import { migrateToVersion } from "./migrate.js";

function step(from: number, to: number, kind: "map" | "manifest" = "map", set = to): MigrationStep {
  return { kind, from, to, run: (r) => ({ ...r, schemaVersion: set }) };
}

function thrown(fn: () => unknown): NestError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    return e as NestError;
  }
  throw new Error("expected NestError");
}

function v0Map(): Record<string, unknown> {
  return {
    schemaVersion: 0,
    id: "town",
    name: "Город",
    viewMode: "topdown",
    width: 2,
    height: 2,
    tileSize: 16,
    layers: [{ id: "g", name: "Земля", visible: true, tiles: [0, 1, 2, 3] }],
    unknownKey: { я: [1] },
  };
}

function v0Manifest(): Record<string, unknown> {
  return {
    schemaVersion: 0,
    name: "Проект",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [{ id: "town", file: "maps/town.json" }],
    startMapId: "town",
    futureKey: "x",
  };
}

describe("migrateRaw", () => {
  it("MIGRATIONS lists every step in order", () => {
    expect(MIGRATIONS.map((s) => [s.kind, s.from, s.to])).toEqual([
      ["manifest", 1, 2],
      ["manifest", 2, 3],
      ["manifest", 3, 4],
      ["map", 1, 2],
    ]);
  });

  it("works on a copy: in-place mutating step does not touch the input", () => {
    const input = { schemaVersion: 0, name: "x", extra: { a: [1] } };
    const before = structuredClone(input);
    const mutating: MigrationStep = {
      kind: "map",
      from: 0,
      to: 2,
      run: (r) => {
        (r.extra as { a: number[] }).a.push(2);
        r.schemaVersion = 2;
        r.name = "changed";
        return r;
      },
    };
    const out = migrateRaw("map", input, [mutating]) as Record<string, unknown>;
    expect(input).toEqual(before);
    expect(out).toEqual({ schemaVersion: 2, name: "changed", extra: { a: [1, 2] } });
    expect(out).not.toBe(input);
  });

  it("v0 map -> fake step -> parseMap succeeds, unknown key survives", () => {
    const out = parseMap(migrateRaw("map", v0Map(), [step(0, 1), ...MIGRATIONS]));
    expect(out.schemaVersion).toBe(2);
    expect(out.unknownKey).toEqual({ я: [1] });
  });

  it("v0 manifest -> fake step -> parseManifest succeeds, unknown key survives", () => {
    const out = parseManifest(migrateRaw("manifest", v0Manifest(), [step(0, 1, "manifest"), ...MIGRATIONS]));
    expect(out.schemaVersion).toBe(4);
    expect(out.futureKey).toBe("x");
  });

  it("chains a 3-step chain given unsorted, in order", () => {
    const trail = (from: number, to: number): MigrationStep => ({
      kind: "map",
      from,
      to,
      run: (r) => ({ ...r, schemaVersion: to, trail: [...((r.trail as string[]) ?? []), `${from}-${to}`] }),
    });
    const steps = [trail(2, 3), trail(0, 1), trail(1, 2)];
    const out = migrateToVersion("map", { schemaVersion: 0 }, steps, undefined, 3) as Record<string, unknown>;
    expect(out.trail).toEqual(["0-1", "1-2", "2-3"]);
    expect(out.schemaVersion).toBe(3);
  });

  it("current version is returned unchanged, no steps run", () => {
    const input = { schemaVersion: 2, name: "x" };
    let called = false;
    const spy: MigrationStep = { kind: "map", from: 2, to: 3, run: (r) => ((called = true), r) };
    expect(migrateRaw("map", input, [spy])).toEqual(input);
    expect(called).toBe(false);
  });

  it("newer version -> schema_too_new, input untouched", () => {
    const input = { schemaVersion: 3, name: "Город" };
    const copy = structuredClone(input);
    const err = thrown(() => migrateRaw("map", input));
    expect(err.code).toBe("schema_too_new");
    expect(err.message).toContain("format version 3");
    expect(err.message).toContain("update NestST");
    expect(input).toEqual(copy);
  });

  it("public flow migrateRaw -> parse gives schema_too_new for both kinds", () => {
    expect(thrown(() => parseMap(migrateRaw("map", { schemaVersion: 7 }))).code).toBe("schema_too_new");
    expect(thrown(() => parseManifest(migrateRaw("manifest", { schemaVersion: 7 }))).code).toBe("schema_too_new");
  });

  it("bad schemaVersion values", () => {
    for (const v of [undefined, "1", 1.5, null, NaN, Infinity, -Infinity]) {
      const err = thrown(() => migrateRaw("map", { schemaVersion: v }));
      expect(err.code, String(v)).toBe("invalid_schema_version");
      expect(err.message).toContain("schemaVersion");
    }
    expect(thrown(() => migrateRaw("map", {})).code).toBe("invalid_schema_version");
    expect(thrown(() => migrateRaw("map", { schemaVersion: 1e308 })).code).toBe("schema_too_new");
    expect(thrown(() => migrateRaw("map", { schemaVersion: -1 })).code).toBe("migration_missing");
    expect(thrown(() => migrateRaw("map", { schemaVersion: 0 })).code).toBe("migration_missing");
  });

  it("gap in the chain -> migration_missing", () => {
    expect(thrown(() => migrateRaw("map", { schemaVersion: 0 }, [])).code).toBe("migration_missing");
    const err = thrown(() => migrateToVersion("map", { schemaVersion: 0 }, [step(0, 1)], undefined, 3));
    expect(err.code).toBe("migration_missing");
    expect(err.message).toContain("from format version 1");
  });

  it("only a wrong-kind step -> migration_missing", () => {
    const err = thrown(() => migrateRaw("map", { schemaVersion: 0 }, [step(0, 1, "manifest")]));
    expect(err.code).toBe("migration_missing");
  });

  it("step that does not advance -> migration_invalid", () => {
    for (const s of [step(0, 0, "map", 0), step(1, 0, "map", 0)]) {
      const err = thrown(() => migrateToVersion("map", { schemaVersion: s.from }, [s], undefined, 2));
      expect(err.code).toBe("migration_invalid");
      expect(err.message).toContain("does not move forward");
    }
  });

  it("step that sets the wrong schemaVersion -> migration_invalid", () => {
    const err = thrown(() => migrateRaw("map", { schemaVersion: 0 }, [step(0, 1, "map", 5)]));
    expect(err.code).toBe("migration_invalid");
    expect(err.message).toContain("from format version 0 to 1");
  });

  it("step beyond the current version -> migration_invalid", () => {
    const err = thrown(() => migrateRaw("map", { schemaVersion: 0 }, [step(0, 3)]));
    expect(err.code).toBe("migration_invalid");
    expect(err.message).toContain("from format version 0 to 3");
  });

  it("duplicate steps with same kind and from -> migration_invalid; other kind is fine", () => {
    const err = thrown(() => migrateRaw("map", { schemaVersion: 0 }, [step(0, 2), step(0, 2)]));
    expect(err.code).toBe("migration_invalid");
    expect(migrateRaw("map", { schemaVersion: 0 }, [step(0, 2), step(0, 1, "manifest")])).toEqual({
      schemaVersion: 2,
    });
  });

  it("non-object raw -> invalid_data", () => {
    for (const raw of [null, undefined, 5, "x", []]) {
      const err = thrown(() => migrateRaw("map", raw));
      expect(err.code).toBe("invalid_data");
      expect(err.message).toContain("must be an object");
    }
  });

  it("file name goes into NestError.file and the message for every error", () => {
    const cases: unknown[] = [null, {}, { schemaVersion: 9 }, { schemaVersion: 0 }];
    for (const raw of cases) {
      const err = thrown(() => migrateRaw("map", raw, [], "maps/town.json"));
      expect(err.file).toBe("maps/town.json");
      expect(err.message).toContain("file maps/town.json");
    }
    const bad = thrown(() => migrateRaw("map", { schemaVersion: 0 }, [step(0, 1, "map", 5)], "maps/a.json"));
    expect(bad.file).toBe("maps/a.json");
  });

  it("wraps an error thrown inside a step in migration_failed", () => {
    const steps: MigrationStep[] = [
      {
        kind: "map",
        from: 1,
        to: 2,
        run() {
          throw new Error("boom");
        },
      },
    ];
    const e = thrown(() => migrateToVersion("map", { schemaVersion: 1 }, steps, "maps/a.json", 2));
    expect(e.code).toBe("migration_failed");
    expect(e.file).toBe("maps/a.json");
    expect(e.message).toContain("migration from format version 1 to 2 failed: boom");
  });
});
