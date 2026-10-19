import { describe, expect, it } from "vitest";
import { cameraFor } from "./camera.js";

const view = { w: 320, h: 240 };

describe("cameraFor", () => {
  it("follows the player (player centred)", () => {
    const c = cameraFor({ mapPx: { w: 1000, h: 1000 }, viewPx: view, playerPx: { x: 500, y: 400 }, scale: 1 });
    expect(c).toEqual({ x: 340, y: 280 });
  });

  it("does not leave the map", () => {
    const a = cameraFor({ mapPx: { w: 1000, h: 1000 }, viewPx: view, playerPx: { x: 0, y: 0 }, scale: 1 });
    expect(a).toEqual({ x: 0, y: 0 });
    const b = cameraFor({ mapPx: { w: 1000, h: 1000 }, viewPx: view, playerPx: { x: 1000, y: 1000 }, scale: 1 });
    expect(b).toEqual({ x: 680, y: 760 });
  });

  it("accounts for scale", () => {
    const c = cameraFor({ mapPx: { w: 1000, h: 1000 }, viewPx: view, playerPx: { x: 500, y: 500 }, scale: 2 });
    expect(c).toEqual({ x: 420, y: 440 });
  });

  it("centres a small map on each axis independently", () => {
    const c = cameraFor({ mapPx: { w: 100, h: 1000 }, viewPx: view, playerPx: { x: 10, y: 500 }, scale: 1 });
    expect(c).toEqual({ x: -110, y: 380 });
    const d = cameraFor({ mapPx: { w: 160, h: 120 }, viewPx: view, playerPx: { x: 0, y: 0 }, scale: 2 });
    expect(d).toEqual({ x: 0, y: 0 });
  });
});
