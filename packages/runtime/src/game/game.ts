/**
 * Wires the pure game core to Pixi: owns the Application, the map view, the
 * player sprite and the fixed-step loop. Not unit-tested (needs WebGL).
 */
import type { Project } from "@nestst/core";
import { Application, Container, Graphics } from "pixi.js";
import type { Tileset } from "../tileset.js";
import type { TileMapView } from "../tileMapView.js";
import type { ObjectsView } from "./objectsView.js";
import { createBuiltinTileset, destroyTileset } from "../tileset.js";
import { createTileMapView } from "../tileMapView.js";
import { cameraFor } from "./camera.js";
import { sceneTransform } from "./layout.js";
import { watchResize } from "./resizeWatch.js";
import { createInput } from "./input.js";
import { bindKeyboard } from "./keyboard.js";
import { createObjectsView } from "./objectsView.js";
import { createPlayer, stepPlayer } from "./player.js";
import { createWorld } from "./world.js";

export interface Game {
  destroy(): void;
}

const SCALE = 2;
const STEP_MS = 1000 / 60;
/** Steps simulated per frame at most; the rest of a long stall is dropped. */
const MAX_STEPS = 5;
const PLAYER_COLOR = 0xff7aa8;
const OUTLINE = 0x3a2e4f;

export async function createGame(opts: { project: Project; mapId: string; host: HTMLElement }): Promise<Game> {
  const { project, mapId, host } = opts;
  const world = createWorld(project, mapId); // throws before any Pixi resource exists
  const map = project.maps[mapId]!;
  const t = world.tileSize;
  const app = new Application();
  let tileset: Tileset | null = null;
  let view: TileMapView | null = null;
  let objects: ObjectsView | null = null;
  let unbind: () => void = () => {};
  let unwatch: () => void = () => {};
  let appReady = false;
  let live = false;

  /** Idempotent; every step runs even if an earlier one throws. */
  const cleanup = (): void => {
    live = false;
    try {
      unwatch();
      unwatch = () => {};
      unbind();
      unbind = () => {};
      app.ticker.remove(onTick);
    } finally {
      try {
        view?.destroy();
        view = null;
      } finally {
        try {
          objects?.destroy();
          objects = null;
        } finally {
          try {
            if (appReady) app.destroy({ removeView: true }, { children: true });
            appReady = false;
          } finally {
            if (tileset !== null) destroyTileset(tileset);
            tileset = null;
          }
        }
      }
    }
  };

  const input = createInput();
  let player = createPlayer(world);
  let acc = 0;
  let scene: Container;
  let playerShape: Graphics;

  const render = (): void => {
    const m = player.moving;
    const px = (m ? m.fromX + (m.toX - m.fromX) * m.t : player.x) * t;
    const py = (m ? m.fromY + (m.toY - m.fromY) * m.t : player.y) * t;
    playerShape.position.set(px, py);
    const cam = cameraFor({
      mapPx: { w: world.width * t, h: world.height * t },
      viewPx: { w: app.screen.width, h: app.screen.height },
      playerPx: { x: px + t / 2, y: py + t / 2 },
      scale: SCALE,
    });
    // The map view positions itself in setCamera; `scene` gets the same transform.
    const tr = sceneTransform(cam, SCALE);
    scene.position.set(tr.x, tr.y);
    scene.scale.set(tr.scale);
    view?.setCamera(cam.x, cam.y, SCALE);
  };

  function onTick(): void {
    if (!live) return;
    try {
      acc += app.ticker.deltaMS;
      let steps = 0;
      while (acc >= STEP_MS && steps < MAX_STEPS) {
        player = stepPlayer(world, player, input.poll(), STEP_MS);
        acc -= STEP_MS;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
      render();
    } catch (err) {
      console.error(err);
      try {
        cleanup();
      } catch (e) {
        console.error(e);
      }
    }
  }

  try {
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: false,
      preference: "webgl",
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
    });
    appReady = true;
    tileset = createBuiltinTileset(app.renderer, t);
    view = createTileMapView(app, map, tileset);
    objects = createObjectsView(t);
    objects.setObjects(map.objects.filter((o) => o.kind === "npc"));
    playerShape = new Graphics()
      .circle(t / 2, t / 2, t / 2 - 1)
      .fill(PLAYER_COLOR)
      .stroke({ width: 1, color: OUTLINE });
    scene = new Container({ label: "game-scene" });
    scene.addChild(objects.container, playerShape);
    // Z-order: map below objects below player.
    app.stage.addChild(view.container, scene);
    app.canvas.classList.add("game-canvas");
    host.appendChild(app.canvas);
    live = true;
    render();
    app.ticker.add(onTick);
    unbind = bindKeyboard(input, window);
    unwatch = watchResize(host, () => {
      if (!live) return;
      app.resize();
      render();
    });
  } catch (err) {
    try {
      cleanup();
    } catch (e) {
      console.error(e);
    }
    throw err;
  }

  // The Game only exists once init has finished, so destroy() cannot race it;
  // a caller that unmounts meanwhile must destroy the Game when the promise resolves.
  return {
    destroy() {
      if (!live) return;
      cleanup();
    },
  };
}
