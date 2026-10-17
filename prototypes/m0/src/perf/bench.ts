import type { Application, Container } from "pixi.js";
import { reportMetric } from "./metrics";

const PAN_SECONDS = 5;
const WARMUP_FRAMES = 10;

/** Pans the camera continuously for 5 s and reports avg/min FPS (from the Pixi ticker). */
export function benchPan(
  app: Application,
  view: Container,
  label: string,
  mapPixels: number,
): Promise<void> {
  return new Promise((resolve) => {
    const ampX = Math.max(0, (mapPixels - app.screen.width) / 2);
    const ampY = Math.max(0, (mapPixels - app.screen.height) / 2);
    const wx = ampX > 0 ? 800 / ampX : 0;
    const wy = ampY > 0 ? 500 / ampY : 0;
    let t = 0;
    let frames = 0;
    let measuredMs = 0;
    let minFps = Infinity;
    let skipped = 0;
    view.scale.set(1);
    const tick = (): void => {
      const dt = app.ticker.deltaMS;
      t += dt / 1000;
      view.position.set(-(ampX + ampX * Math.sin(t * wx)), -(ampY + ampY * Math.sin(t * wy)));
      if (skipped < WARMUP_FRAMES) {
        skipped++;
        t = 0;
        return;
      }
      frames++;
      measuredMs += dt;
      minFps = Math.min(minFps, 1000 / dt);
      if (measuredMs >= PAN_SECONDS * 1000) {
        app.ticker.remove(tick);
        const avg = (frames * 1000) / measuredMs;
        reportMetric(`${label} avg_fps=${avg.toFixed(1)} min_fps=${minFps.toFixed(1)}`);
        resolve();
      }
    };
    app.ticker.add(tick);
  });
}

export function reportHeap(): void {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) reportMetric(`heap_mb=${(mem.usedJSHeapSize / 1048576).toFixed(1)}`);
}
