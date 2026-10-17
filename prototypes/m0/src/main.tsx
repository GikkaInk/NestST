import { createRoot } from "react-dom/client";
import { Application, Container, Text, Texture } from "pixi.js";
import { GraphScreen } from "./graph/GraphView";
import { describeGraphicsError } from "./map/graphics-error";
import { createTileMapView, generateTestMap, TILE_KINDS } from "./map/tilemap";
import { benchPan, reportHeap } from "./perf/bench";
import { exitApp, markReady, readFlags } from "./perf/metrics";

const TILE = 16;
const COLORS = ["#3a7d44", "#4c9a52", "#2f6b3a", "#5aa860", "#8a5a2b", "#c9c9d4"];

function makeTileset(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE * TILE_KINDS;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  COLORS.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * TILE, 0, TILE, TILE);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(i * TILE + 0.5, 0.5, TILE - 1, TILE - 1);
  });
  return Texture.from(canvas);
}

function showError(root: HTMLElement, message: string): void {
  const p = document.createElement("p");
  p.textContent = message;
  p.style.cssText = "font:18px sans-serif;padding:24px;color:#b00020";
  root.replaceChildren(p);
}

export async function startApp(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;
  const flags = await readFlags();

  const app = new Application();
  try {
    if (flags.gpufail) throw new Error("forced graphics failure (gpufail flag)");
    await app.init({
      resizeTo: window,
      background: "#14161c",
      preference: "webgl",
      antialias: false,
    });
    if (!app.renderer) throw new Error("renderer missing");
  } catch (err) {
    console.error(err);
    showError(root, describeGraphicsError(err));
    requestAnimationFrame(() => markReady());
    if (flags.bench) setTimeout(exitApp, 500);
    return;
  }
  const mapHost = document.createElement("div");
  const graphHost = document.createElement("div");
  mapHost.style.cssText = "position:fixed;inset:0";
  graphHost.style.cssText = "position:fixed;inset:0;display:none;background:#fff";
  root.replaceChildren(mapHost, graphHost);
  mapHost.appendChild(app.canvas);
  app.canvas.style.display = "block";

  const tileset = makeTileset();
  const world = new Container();
  app.stage.addChild(world);
  let size = 200;
  let view = createTileMapView(app, generateTestMap(size, size), tileset);
  world.addChild(view.container);

  const setMap = (n: number): void => {
    view.destroy();
    size = n;
    view = createTileMapView(app, generateTestMap(n, n), tileset);
    view.container.position.set(0, 0);
    view.container.scale.set(1);
    world.addChild(view.container);
  };

  const fps = new Text({
    text: "",
    style: { fill: "#ffffff", fontFamily: "monospace", fontSize: 14 },
  });
  fps.position.set(8, 8);
  app.stage.addChild(fps);
  let acc = 0;
  app.ticker.add(() => {
    acc += app.ticker.deltaMS;
    if (acc >= 250) {
      acc = 0;
      fps.text = `FPS ${Math.round(app.ticker.FPS)}  map ${size}x${size}`;
    }
  });

  requestAnimationFrame(() => markReady());

  if (flags.bench) {
    await benchPan(app, view.container, "map200", 200 * TILE);
    setMap(1000);
    await benchPan(app, view.container, "map1000", 1000 * TILE);
    reportHeap();
    exitApp();
    return;
  }

  let dragging = false;
  app.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    app.canvas.setPointerCapture(e.pointerId);
  });
  app.canvas.addEventListener("pointerup", () => (dragging = false));
  app.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    view.container.x += e.movementX;
    view.container.y += e.movementY;
  });
  app.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const c = view.container;
      const next = Math.min(4, Math.max(0.25, c.scale.x * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const k = next / c.scale.x;
      c.x = e.offsetX - (e.offsetX - c.x) * k;
      c.y = e.offsetY - (e.offsetY - c.y) * k;
      c.scale.set(next);
    },
    { passive: false },
  );
  let graphRoot: ReturnType<typeof createRoot> | null = null;
  let graphShown = false;
  const toggleGraph = (): void => {
    graphShown = !graphShown;
    mapHost.style.display = graphShown ? "none" : "block";
    graphHost.style.display = graphShown ? "block" : "none";
    if (graphShown) {
      app.ticker.stop();
      graphRoot ??= createRoot(graphHost);
      graphRoot.render(<GraphScreen />);
    } else {
      app.ticker.start();
    }
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyG") toggleGraph();
    else if (!graphShown && e.code === "KeyM") setMap(size === 200 ? 1000 : 200);
  });
}
