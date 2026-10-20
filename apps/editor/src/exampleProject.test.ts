import { describe, expect, it } from "vitest";
import { MANIFEST_FILE } from "@nestst/core";
import { EXAMPLE_FILES } from "./exampleProject.js";

describe("EXAMPLE_FILES", () => {
  it("has manifest and every file it lists", () => {
    const manifest = JSON.parse(EXAMPLE_FILES[MANIFEST_FILE]!) as {
      maps: Array<{ file: string }>;
      dialogs?: Array<{ file: string }>;
    };
    expect(manifest.maps.length).toBeGreaterThan(0);
    for (const entry of [...manifest.maps, ...(manifest.dialogs ?? [])]) {
      expect(EXAMPLE_FILES[entry.file], entry.file).toBeTypeOf("string");
    }
    expect(Object.keys(EXAMPLE_FILES).every((k) => !k.startsWith(".") && !k.startsWith("/"))).toBe(true);
  });
});
