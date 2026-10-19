import { describe, expect, it } from "vitest";
import { shouldFit } from "./fitSignal.js";

describe("shouldFit", () => {
  it("fits the first time, for a new project and for another map", () => {
    expect(shouldFit(null, { openSeq: 1, mapId: "a" })).toBe(true);
    expect(shouldFit({ openSeq: 1, mapId: "a" }, { openSeq: 2, mapId: "a" })).toBe(true);
    expect(shouldFit({ openSeq: 1, mapId: "a" }, { openSeq: 1, mapId: "b" })).toBe(true);
  });
  it("keeps the camera for the same project and map", () => {
    expect(shouldFit({ openSeq: 1, mapId: "a" }, { openSeq: 1, mapId: "a" })).toBe(false);
  });
});
