/**
 * The Pixi side of the map editor: owns the Application, the TileMapView and
 * the pointer/wheel/keyboard wiring. All maths lives in mapInput.ts; this file
 * only glues it to Pixi and the store. Not unit-tested (needs WebGL).
 */
import { paintTiles } from "@nestst/core";
import type { GameMap } from "@nestst/core";
import { createBuiltinTileset, createTileMapView, destroyTileset } from "@nestst/runtime";
import type { TileMapView } from "@nestst/runtime";
import { Application, BufferImageSource, Color, Container, Graphics, Texture, TilingSprite } from "pixi.js";
import { strokeTile } from "./editorStore.js";
import type { EditorStore } from "./editorStore.js";
import {
  centeredCamera,
  fitScale,
  panBy,
  screenToCell,
  wheelZoomFactor,
  zoomAt,
  createStroke,
} from "./mapInput.js";
import type { Camera, Cell, Stroke } from "./mapInput.js";

export interface MapCanvasCallbacks {
  onZoom(scale: number): void;
  /** Cell under the pointer, or null when it is outside the map. */
  onHover(cell: Cell | null): void;
  onError(message: string): void;
  /** "paint" | "pan" | "grab" (Space held) — for the cursor. */
  onMode(mode: "paint" | "pan" | "grab"): void;
}

export interface MapCanvas {
  /** Zoom about the centre of the view. */
  zoomBy(factor: number): void;
  fit(): void;
  destroy(): void;
}

/** True when keys typed there belong to the control (text fields, buttons...). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
}

function cssColor(name: string, fallback: string): Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new Color(value || fallback);
  } catch {
    return new Color(fallback);
  }
}

/** 2×2 checker texture (one check per map cell once scaled by the tile size). */
function checkerTexture(a: Color, b: Color): Texture {
  const [ar, ag, ab] = a.toUint8RgbArray();
  const [br, bg, bb] = b.toUint8RgbArray();
  const px = [ar, ag, ab, 255, br, bg, bb, 255, br, bg, bb, 255, ar, ag, ab, 255];
  const source = new BufferImageSource({
    resource: new Uint8Array(px),
    width: 2,
    height: 2,
    scaleMode: "nearest",
    addressMode: "repeat",
    label: "nestst-map-checker",
  });
  return new Texture({ source });
}

export function mountMapCanvas(host: HTMLElement, store: EditorStore, cb: MapCanvasCallbacks): MapCanvas {
  const app = new Application();
  let ready = false;
  let destroyed = false;

  let cam: Camera = { x: 0, y: 0, scale: 1 };
  let view: TileMapView | null = null;
  let tileset: ReturnType<typeof createBuiltinTileset> | null = null;
  let tilesetSize = 0;
  let shownMap: GameMap | null = null;
  let shownManifest: unknown = null;

  const back = new Container({ label: "map-back" });
  const front = new Container({ label: "map-front" });
  let checker: TilingSprite | null = null;
  const outline = new Graphics();
  const hover = new Graphics();
  let hoverCell: Cell | null = null;

  let stroke: Stroke | null = null;
  let preview: GameMap | null = null;
  let pan: { id: number; x: number; y: number } | null = null;
  let spaceDown = false;

  const currentMap = (): GameMap | null => {
    const s = store.getState();
    if (s.project === null || s.currentMapId === null) return null;
    return s.project.maps[s.currentMapId] ?? null;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const colors = () => ({
    checkA: cssColor("--map-check-a", "#fffdf8"),
    checkB: cssColor("--map-check-b", "#f6eadc"),
    outline: cssColor("--map-outline", "#3a2e4f"),
    hover: cssColor("--map-hover", "#ff7aa8"),
  });
  let palette = colors();

  const drawOverlays = (): void => {
    const map = shownMap;
    if (map === null) return;
    const w = map.width * map.tileSize;
    const h = map.height * map.tileSize;
    const line = 2 / cam.scale;
    if (checker) {
      checker.width = w;
      checker.height = h;
      checker.tileScale.set(map.tileSize);
    }
    outline.clear().rect(-line / 2, -line / 2, w + line, h + line).stroke({ width: line, color: palette.outline });
    hover.clear();
    if (hoverCell !== null && stroke === null && pan === null) {
      const t = map.tileSize;
      hover
        .rect(hoverCell.x * t, hoverCell.y * t, t, t)
        .stroke({ width: 2.5 / cam.scale, color: palette.hover, alignment: 1 });
    }
  };

  const applyCamera = (): void => {
    view?.setCamera(cam.x, cam.y, cam.scale);
    for (const c of [back, front]) {
      c.position.set(-cam.x * cam.scale, -cam.y * cam.scale);
      c.scale.set(cam.scale);
    }
    drawOverlays();
    cb.onZoom(cam.scale);
  };

  const fit = (): void => {
    const map = shownMap;
    if (map === null || !ready) return;
    const w = map.width * map.tileSize;
    const h = map.height * map.tileSize;
    const sw = app.screen.width;
    const sh = app.screen.height;
    cam = centeredCamera(w, h, sw, sh, fitScale(w, h, sw, sh));
    applyCamera();
  };

  const showMap = (map: GameMap): void => {
    if (tileset === null || map.tileSize !== tilesetSize) {
      view?.destroy();
      if (tileset) destroyTileset(tileset);
      tileset = createBuiltinTileset(app.renderer, map.tileSize);
      tilesetSize = map.tileSize;
      view = createTileMapView(app, map, tileset);
      app.stage.addChildAt(view.container, 1);
    } else {
      view!.setMap(map);
    }
    shownMap = map;
  };

  const sync = (): void => {
    if (!ready || stroke !== null) return;
    const s = store.getState();
    const map = currentMap();
    if (map === null) return;
    if (map !== shownMap) showMap(map);
    if (s.project!.manifest !== shownManifest) {
      shownManifest = s.project!.manifest;
      fit();
    } else {
      drawOverlays();
    }
  };

  const setHover = (cell: Cell | null): void => {
    const map = shownMap;
    const inside =
      cell !== null && map !== null && cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
    const next = inside ? cell : null;
    if (next?.x === hoverCell?.x && next?.y === hoverCell?.y) return;
    hoverCell = next;
    cb.onHover(next);
    drawOverlays();
  };

  const mode = () => cb.onMode(pan ? "pan" : spaceDown ? "grab" : "paint");

  const addStrokePoint = (p: { x: number; y: number }): void => {
    if (stroke === null || preview === null) return;
    const added = stroke.add(screenToCell(cam, p.x, p.y, preview.tileSize));
    if (added.length === 0) return;
    preview = paintTiles(preview, added);
    view?.setMap(preview);
  };

  const finishStroke = (): void => {
    if (stroke === null) return;
    const edits = stroke.edits;
    stroke = null;
    preview = null;
    store.paintStroke(edits);
    // Always redraw from the store: replaces the preview even if nothing was recorded.
    const map = currentMap();
    if (map !== null) showMap(map);
    drawOverlays();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!ready || shownMap === null) return;
    const p = local(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      if (pan !== null || stroke !== null) return;
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      capture(e.pointerId);
      mode();
      drawOverlays();
      return;
    }
    if (e.button !== 0 || stroke !== null || pan !== null) return;
    const map = currentMap();
    const layer = map?.layers[0];
    if (!map || !layer) return;
    host.focus({ preventScroll: true });
    capture(e.pointerId);
    stroke = createStroke(map, layer.id, strokeTile(store.getState()));
    preview = map;
    addStrokePoint(p);
    drawOverlays();
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!ready) return;
    if (pan !== null && e.pointerId === pan.id) {
      cam = panBy(cam, e.clientX - pan.x, e.clientY - pan.y);
      pan.x = e.clientX;
      pan.y = e.clientY;
      applyCamera();
      return;
    }
    if (stroke !== null) {
      // Coalesced events give every pointer sample of this frame; Bresenham fills the rest.
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const s of samples.length > 0 ? samples : [e]) addStrokePoint(local(s));
    }
    const p = local(e);
    if (shownMap) setHover(screenToCell(cam, p.x, p.y, shownMap.tileSize));
  };

  const onPointerEnd = (e: PointerEvent): void => {
    if (pan !== null && e.pointerId === pan.id) {
      pan = null;
      mode();
      drawOverlays();
    }
    finishStroke();
  };

  const onLeave = (): void => setHover(null);

  const onWheel = (e: WheelEvent): void => {
    if (!ready) return;
    e.preventDefault();
    const p = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    cam = zoomAt(cam, p.x, p.y, wheelZoomFactor(delta));
    applyCamera();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space" || isTypingTarget(e.target)) return;
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      mode();
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    spaceDown = false;
    mode();
  };

  const onBlur = (): void => {
    spaceDown = false;
    mode();
  };

  const noMenu = (e: Event) => e.preventDefault();

  /** Keeps pointer events coming while dragging outside the canvas; harmless if refused. */
  const capture = (id: number): void => {
    try {
      app.canvas.setPointerCapture(id);
    } catch {
      // e.g. the pointer is already gone
    }
  };

  const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onScheme = (): void => {
    palette = colors();
    if (checker) {
      const old = checker.texture;
      checker.texture = checkerTexture(palette.checkA, palette.checkB);
      old.destroy(true);
    }
    drawOverlays();
  };

  const resizeObserver = new ResizeObserver(() => {
    if (ready) app.resize();
  });

  let unsubscribe = (): void => {};

  void (async () => {
    try {
      await app.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: false,
        preference: "webgl",
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
    } catch (err) {
      console.error(err);
      if (!destroyed) {
        cb.onError(
          "The map view could not start, because the graphics (WebGL) are not available. Updating the graphics driver usually helps.",
        );
      }
      return;
    }
    if (destroyed) {
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    ready = true;
    app.canvas.classList.add("map-canvas");
    host.appendChild(app.canvas);
    checker = new TilingSprite({ texture: checkerTexture(palette.checkA, palette.checkB), width: 1, height: 1 });
    back.addChild(checker, outline);
    front.addChild(hover);
    app.stage.addChild(back, front);

    app.canvas.addEventListener("pointerdown", onPointerDown);
    app.canvas.addEventListener("pointermove", onPointerMove);
    app.canvas.addEventListener("pointerup", onPointerEnd);
    app.canvas.addEventListener("pointercancel", onPointerEnd);
    app.canvas.addEventListener("lostpointercapture", onPointerEnd);
    app.canvas.addEventListener("pointerleave", onLeave);
    app.canvas.addEventListener("wheel", onWheel, { passive: false });
    app.canvas.addEventListener("contextmenu", noMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    scheme?.addEventListener("change", onScheme);
    resizeObserver.observe(host);
    unsubscribe = store.subscribe(sync);
    sync();
  })();

  return {
    zoomBy(factor) {
      if (!ready) return;
      cam = zoomAt(cam, app.screen.width / 2, app.screen.height / 2, factor);
      applyCamera();
    },
    fit,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!ready) return; // init still running: it destroys the app when it finishes
      ready = false;
      unsubscribe();
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      scheme?.removeEventListener("change", onScheme);
      view?.destroy();
      view = null;
      const checkerTex = checker?.texture;
      app.destroy({ removeView: true }, { children: true });
      checkerTex?.destroy(true);
      if (tileset) destroyTileset(tileset);
      tileset = null;
    },
  };
}
