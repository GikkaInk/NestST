import { expect, it } from "vitest";
import * as runtime from "./index.js";

it("exports only the public API", () => {
  expect(Object.keys(runtime).sort()).toEqual(
    [
      "CHUNK_SIZE",
      "MAX_SCALE",
      "MIN_SCALE",
      "builtinTileColor",
      "createBuiltinTileset",
      "createTileMapView",
      "destroyTileset",
      "tileTexture",
      "visibleChunkRange",
    ].sort(),
  );
});
