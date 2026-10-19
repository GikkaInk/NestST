/**
 * Wires the pure game core to Pixi: owns the Application, the map view, the
 * player sprite and the fixed-step loop. Not unit-tested (needs WebGL).
 */
import type { Project } from "@nestst/core";
import { Application, Container, Graphics } from "pixi.js";
import { createBuiltinTileset, destroyTileset } from "../tileset.js";
import { createTileMapView } from "../tileMapView.js";
import { cameraFor } from "./camera.js";
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
  const app = new Application();
  let live = false;

  // The Game only exists once init has finished, so destroy() cannot race it;
  // a caller that unmounts meanwhile must destroy the Game when the promise resolves.
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: false,
    preference: "webgl",
    resolution: window.devicePixelRatio || 1,
    roundPixels: true,
    autoDensity: true,
  });

  const tileset = createBuiltinTileset(app.renderer, world.tileSize);
  const view = createTileMapView(app, map, tileset);
  const objects = createObjectsView(world.tileSize);
  objects.setObjects(map.objects.filter((o) => o.kind === "npc"));
  const t = world.tileSize;
  const playerShape = new Graphics()
    .circle(t / 2, t / 2, t / 2 - 1)
    .fill(PLAYER_COLOR)
    .stroke({ width: 1, color: OUTLINE });
  const scene = new Container({ label: "game-scene" });
  scene.scale.set(SCALE);
  scene.addChild(view.container, objects.container, playerShape);
  app.stage.addChild(scene);
  app.canvas.classList.add("game-canvas");
  host.appendChild(app.canvas);

  const input = createInput();
  const unbind = bindKeyboard(input, window);
  let player = createPlayer(world);
  let acc = 0;

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
    scene.position.set(-cam.x * SCALE, -cam.y * SCALE);
    view.setCamera(cam.x, cam.y, SCALE);
  };

  const onTick = (): void => {
    acc += app.ticker.deltaMS;
    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_STEPS) {
      player = stepPlayer(world, player, input.poll(), STEP_MS);
      acc -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    render();
  };
  app.ticker.add(onTick);
  render();
  live = true;

  const cleanup = (): void => {
    app.ticker.remove(onTick);
    unbind();
    view.destroy();
    objects.destroy();
    app.destroy({ removeView: true }, { children: true });
    destroyTileset(tileset);
  };

  return {
    destroy() {
      if (!live) return;
      live = false;
      cleanup();
    },
  };
}
