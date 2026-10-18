import { describe, expect, it } from "vitest";
import { NestError, createEmptyProject, mergeCommands, paintCommand, paintTiles } from "./index.js";
import type { GameMap, Project, TileEdit } from "./index.js";

function makeMap(): GameMap {
  return {
    schemaVersion: 1,
    id: "town",
    name: "Город",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    extra: { keep: "me" },
    layers: [
      { id: "ground", name: "Земля", visible: true, tiles: new Array<number>(12).fill(1), note: "x" },
      { id: "deco", name: "Декор", visible: false, tiles: new Array<number>(12).fill(0) },
    ],
  };
}

function makeProject(): Project {
  const p = createEmptyProject("Моя игра");
  return { ...p, maps: { ...p.maps, town: makeMap() } };
}

function editError(map: GameMap, edits: TileEdit[]): NestError {
  const snapshot = structuredClone(map);
  try {
    paintTiles(map, edits);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    expect(map).toEqual(snapshot);
    return e as NestError;
  }
  throw new Error("expected a rejection, but the edits were accepted");
}

describe("paintTiles", () => {
  it("paints exactly the requested cells and returns a new map", () => {
    const map = makeMap();
    const out = paintTiles(map, [
      { layerId: "ground", x: 1, y: 0, tile: 7 },
      { layerId: "ground", x: 3, y: 2, tile: 255 },
    ]);
    expect(out).not.toBe(map);
    const expected = new Array<number>(12).fill(1);
    expected[1] = 7;
    expected[11] = 255;
    expect(out.layers[0]!.tiles).toEqual(expected);
    expect(map.layers[0]!.tiles).toEqual(new Array<number>(12).fill(1));
  });

  it("erases with tile 0", () => {
    const out = paintTiles(makeMap(), [{ layerId: "ground", x: 0, y: 1, tile: 0 }]);
    const expected = new Array<number>(12).fill(1);
    expected[4] = 0;
    expect(out.layers[0]!.tiles).toEqual(expected);
  });

  it("keeps untouched layers by identity and preserves unknown keys", () => {
    const map = makeMap();
    const out = paintTiles(map, [{ layerId: "ground", x: 0, y: 0, tile: 3 }]);
    expect(out.layers[1]).toBe(map.layers[1]);
    expect(out.extra).toEqual({ keep: "me" });
    expect(out.layers[0]!.note).toBe("x");
    expect(out.layers[0]!.tiles).not.toBe(map.layers[0]!.tiles);
  });

  it("returns the very same map for an empty list", () => {
    const map = makeMap();
    expect(paintTiles(map, [])).toBe(map);
  });

  it("lets the last edit of the same cell win", () => {
    const out = paintTiles(makeMap(), [
      { layerId: "deco", x: 2, y: 1, tile: 5 },
      { layerId: "deco", x: 2, y: 1, tile: 9 },
    ]);
    expect(out.layers[1]!.tiles[6]).toBe(9);
  });

  it.each([
    ["x = -1", { x: -1, y: 0, tile: 1 }],
    ["x = width", { x: 4, y: 0, tile: 1 }],
    ["y = height", { x: 0, y: 3, tile: 1 }],
    ["y = -1", { x: 0, y: -1, tile: 1 }],
    ["x = 1.5", { x: 1.5, y: 0, tile: 1 }],
    ["x = NaN", { x: Number.NaN, y: 0, tile: 1 }],
    ["y = Infinity", { x: 0, y: Number.POSITIVE_INFINITY, tile: 1 }],
    ["tile = 256", { x: 0, y: 0, tile: 256 }],
    ["tile = -1", { x: 0, y: 0, tile: -1 }],
    ["tile = 2.5", { x: 0, y: 0, tile: 2.5 }],
  ])("rejects %s with invalid_edit and leaves the map unchanged", (_label, cell) => {
    const err = editError(makeMap(), [{ layerId: "ground", ...cell }]);
    expect(err.code).toBe("invalid_edit");
    expect(err.message).toMatch(/edit 0/);
  });

  it("rejects an unknown layer", () => {
    const err = editError(makeMap(), [{ layerId: "sky", x: 0, y: 0, tile: 1 }]);
    expect(err.code).toBe("invalid_edit");
    expect(err.message).toMatch(/layer "sky"/);
  });

  it("is all-or-nothing: one bad edit rejects the whole batch", () => {
    const map = makeMap();
    const err = editError(map, [
      { layerId: "ground", x: 0, y: 0, tile: 9 },
      { layerId: "ground", x: 0, y: 0, tile: 300 },
    ]);
    expect(err.message).toMatch(/edit 1/);
    expect(map.layers[0]!.tiles[0]).toBe(1);
  });
});

describe("paintCommand", () => {
  it("applies and reverts with structural sharing", () => {
    const p = makeProject();
    const cmd = paintCommand("town", [{ layerId: "ground", x: 1, y: 1, tile: 4 }], p.maps.town!);
    const after = cmd.apply(p);
    expect(after).not.toBe(p);
    expect(after.maps.town!.layers[0]!.tiles[5]).toBe(4);
    expect(after.maps.main).toBe(p.maps.main);
    expect(after.manifest).toBe(p.manifest);
    expect(p.maps.town!.layers[0]!.tiles[5]).toBe(1);
    const back = cmd.revert(after);
    expect(back.maps.town).toEqual(p.maps.town);
    expect(back.maps.main).toBe(p.maps.main);
  });

  it("restores the original value when one cell is edited twice", () => {
    const p = makeProject();
    const edits: TileEdit[] = [
      { layerId: "deco", x: 0, y: 0, tile: 5 },
      { layerId: "deco", x: 0, y: 0, tile: 8 },
    ];
    const cmd = paintCommand("town", edits, p.maps.town!);
    const after = cmd.apply(p);
    expect(after.maps.town!.layers[1]!.tiles[0]).toBe(8);
    const back = cmd.revert(after);
    expect(back.maps.town!.layers[1]!.tiles[0]).toBe(0);
    expect(cmd.revert(cmd.apply(back)).maps.town).toEqual(p.maps.town);
  });

  it("reverts only the touched cells", () => {
    const p = makeProject();
    const cmd = paintCommand("town", [{ layerId: "ground", x: 0, y: 0, tile: 2 }], p.maps.town!);
    const after = cmd.apply(p);
    // Another change to a different cell made after the command.
    const other = paintTiles(after.maps.town!, [{ layerId: "ground", x: 3, y: 2, tile: 6 }]);
    const back = cmd.revert({ ...after, maps: { ...after.maps, town: other } });
    expect(back.maps.town!.layers[0]!.tiles[0]).toBe(1);
    expect(back.maps.town!.layers[0]!.tiles[11]).toBe(6);
  });

  it("rejects invalid edits when created", () => {
    const p = makeProject();
    expect(() => paintCommand("town", [{ layerId: "ground", x: 9, y: 0, tile: 1 }], p.maps.town!)).toThrow(
      expect.objectContaining({ code: "invalid_edit" }),
    );
  });

  it("fails with unknown_map on a project without the map", () => {
    const p = makeProject();
    const cmd = paintCommand("town", [{ layerId: "ground", x: 0, y: 0, tile: 1 }], p.maps.town!);
    const bare = createEmptyProject("Пусто");
    for (const run of [() => cmd.apply(bare), () => cmd.revert(bare)]) {
      try {
        run();
        throw new Error("expected a rejection");
      } catch (e) {
        expect(e).toBeInstanceOf(NestError);
        expect((e as NestError).code).toBe("unknown_map");
      }
    }
  });
});

describe("mergeCommands", () => {
  it("applies in order and reverts in reverse order as one step", () => {
    const p = makeProject();
    const a = paintCommand("town", [{ layerId: "ground", x: 0, y: 0, tile: 2 }], p.maps.town!);
    const mid = a.apply(p);
    const b = paintCommand("town", [{ layerId: "ground", x: 0, y: 0, tile: 3 }], mid.maps.town!);
    const stroke = mergeCommands("Brush stroke", [a, b]);
    expect(stroke.label).toBe("Brush stroke");
    const after = stroke.apply(p);
    expect(after.maps.town!.layers[0]!.tiles[0]).toBe(3);
    expect(stroke.revert(after).maps.town).toEqual(p.maps.town);
  });

  it("with no commands changes nothing", () => {
    const p = makeProject();
    const empty = mergeCommands("Nothing", []);
    expect(empty.apply(p)).toBe(p);
    expect(empty.revert(p)).toBe(p);
  });
});
