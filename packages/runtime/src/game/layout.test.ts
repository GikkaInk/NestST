import { describe, expect, it } from "vitest";
import type { Application, Renderer } from "pixi.js";
import { Container } from "pixi.js";
import { createBuiltinTileset, destroyTileset } from "../tileset.js";
import { createTileMapView } from "../tileMapView.js";
import { sceneTransform } from "./layout.js";
import { makeProject } from "./testProject.js";

describe("sceneTransform", () => {
  it("maps a world point to the same screen point as the tile map view", () => {
    const app = {
      screen: { width: 320, height: 240 },
      ticker: { add() {}, remove() {} },
    } as unknown as Application;
    const map = makeProject({ width: 20, height: 20 }).maps["main"]!;
    const tileset = createBuiltinTileset({} as Renderer, 16);
    const view = createTileMapView(app, map, tileset);
    const cam = { x: 37, y: 11 };
    view.setCamera(cam.x, cam.y, 2);
    const scene = new Container();
    const t = sceneTransform(cam, 2);
    scene.position.set(t.x, t.y);
    scene.scale.set(t.scale);
    const p = { x: 100, y: 60 };
    const a = view.container.toGlobal(p);
    const b = scene.toGlobal(p);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
    expect(a.x).toBeCloseTo((100 - 37) * 2);
    view.destroy();
    destroyTileset(tileset);
  });
});
