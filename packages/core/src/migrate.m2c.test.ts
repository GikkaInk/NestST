import { describe, expect, it } from "vitest";
import { FORMAT_VERSIONS, NestError, migrateRaw } from "./index.js";

const v3 = () => ({ schemaVersion: 3, name: "G", solidTiles: [1], extra: { a: [1] } });

describe("manifest migration 3 to 4", () => {
  it("has the M2c format versions", () => {
    expect(FORMAT_VERSIONS).toEqual({ manifest: 4, map: 2, dialog: 1 });
  });

  it("adds empty variables and dialogs and keeps the rest", () => {
    expect(migrateRaw("manifest", v3())).toEqual({ ...v3(), schemaVersion: 4, variables: [], dialogs: [] });
  });

  it("chains v1 to v4", () => {
    expect(migrateRaw("manifest", { name: "G", extra: { a: [1] }, schemaVersion: 1 })).toEqual({
      name: "G",
      extra: { a: [1] },
      schemaVersion: 4,
      solidTiles: [],
      variables: [],
      dialogs: [],
    });
  });

  it("keeps existing variables and dialogs arrays", () => {
    const vars = [{ id: "a" }];
    const dialogs = [{ id: "d" }];
    const out = migrateRaw("manifest", { ...v3(), variables: vars, dialogs }) as Record<string, unknown>;
    expect(out.variables).toEqual(vars);
    expect(out.dialogs).toEqual(dialogs);
  });

  it("does not mutate the input", () => {
    const input = v3();
    migrateRaw("manifest", input);
    expect(input).toEqual(v3());
  });

  it("rejects manifest version 5 as too new", () => {
    try {
      migrateRaw("manifest", { ...v3(), schemaVersion: 5 });
    } catch (e) {
      expect((e as NestError).code).toBe("schema_too_new");
      return;
    }
    throw new Error("expected NestError");
  });
});

describe("dialog migration", () => {
  it("passes version 1 through and rejects version 2", () => {
    const d = { schemaVersion: 1, id: "x" };
    expect(migrateRaw("dialog", d)).toEqual(d);
    try {
      migrateRaw("dialog", { ...d, schemaVersion: 2 }, undefined, "dialogs/x.json");
    } catch (e) {
      expect((e as NestError).code).toBe("schema_too_new");
      expect((e as NestError).message).toContain("dialog");
      return;
    }
    throw new Error("expected NestError");
  });
});
