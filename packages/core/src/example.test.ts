/// <reference types="node" />
/**
 * The example project in `examples/nest-island` must keep loading with the
 * current format, so it never rots.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "./index.js";
import { NodeFsStorage } from "./testing.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/nest-island/", import.meta.url));

describe("examples/nest-island", () => {
  it("loads, has one full Ground layer and uses only palette tiles 0..32", async () => {
    const project = await loadProject(new NodeFsStorage(EXAMPLE));
    expect(project.manifest.name).toBe("Nest Island");
    const map = project.maps[project.manifest.startMapId]!;
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]!.name).toBe("Ground");
    const tiles = map.layers[0]!.tiles;
    expect(tiles).toHaveLength(map.width * map.height);
    expect(tiles.every((t) => Number.isInteger(t) && t >= 0 && t <= 32)).toBe(true);
  });
});
