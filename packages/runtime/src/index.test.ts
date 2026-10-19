import { expect, it } from "vitest";
import * as runtime from "./index.js";

it("exports only the public API", () => {
  expect(Object.keys(runtime).sort()).toEqual(
    [
      "CHUNK_SIZE",
      "MAX_SCALE",
      "MIN_SCALE",
      "TILE_MOVE_MS",
      "advance",
      "closeDialog",
      "createSession",
      "enterCell",
      "evalCondition",
      "interact",
      "moveSelection",
      "startDialog",
      "builtinTileColor",
      "cameraFor",
      "canEnter",
      "createBuiltinTileset",
      "createGame",
      "createDialogBox",
      "createInput",
      "createObjectsView",
      "createPlayer",
      "createTileMapView",
      "createWorld",
      "destroyTileset",
      "stepFrame",
      "stepPlayer",
      "tileTexture",
      "visibleChunkRange",
    ].sort(),
  );
});
