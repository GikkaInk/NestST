import { describe, expect, it } from "vitest";
import { NestError, migrateRaw } from "./index.js";

const v2 = () => ({ schemaVersion: 2, name: "G", extra: { a: [1] } });

describe("manifest migration 2 to 3", () => {
  it("adds empty solidTiles and keeps the rest", () => {
    expect(migrateRaw("manifest", v2())).toEqual({ ...v2(), schemaVersion: 3, solidTiles: [] });
  });

  it("chains v1 to v3", () => {
    expect(migrateRaw("manifest", { ...v2(), schemaVersion: 1 })).toEqual({
      ...v2(),
      schemaVersion: 3,
      solidTiles: [],
    });
  });

  it("keeps an existing solidTiles array", () => {
    const out = migrateRaw("manifest", { ...v2(), solidTiles: [4, 5] }) as Record<string, unknown>;
    expect(out.solidTiles).toEqual([4, 5]);
  });

  it("does not mutate the input", () => {
    const input = v2();
    migrateRaw("manifest", input);
    expect(input).toEqual(v2());
  });

  it("rejects version 4 as too new", () => {
    try {
      migrateRaw("manifest", { ...v2(), schemaVersion: 4 });
    } catch (e) {
      expect((e as NestError).code).toBe("schema_too_new");
      return;
    }
    throw new Error("expected NestError");
  });
});
