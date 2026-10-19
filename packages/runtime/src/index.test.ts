import { expect, it } from "vitest";
import * as runtime from "./index.js";

it("exports only the public API", () => {
  expect(Object.keys(runtime).sort()).toEqual(
    [
      "CHUNK_SIZE",
      "MAX_SCALE",
      "MIN_SCALE",
      "TILE_MOVE_MS",
      "builtinTileColor",
      "cameraFor",
      "canEnter",
      "createBuiltinTileset",
      "createGame",
      "createInput",
      "createObjectsView",
      "createPlayer",
      "createTileMapView",
      "createWorld",
      "destroyTileset",
      "stepPlayer",
      "tileTexture",
      "visibleChunkRange",
    ].sort(),
  );
});
