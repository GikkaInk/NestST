import { describe, expect, it } from "vitest";
import {
  NestError,
  createEmptyProject,
  isSolidTile,
  moveObjectCommand,
  nextNpcId,
  objectAt,
  placeObjectCommand,
  removeObjectCommand,
  setSolidCommand,
} from "./index.js";
import type { Command, MapObject, Project } from "./index.js";

const npc = (id: string, x: number, y: number): MapObject => ({ id, kind: "npc", x, y, props: {} });
const spawn = (id: string, x: number, y: number): MapObject => ({ id, kind: "spawn", x, y, props: {} });

/** Map "town" 4x3: ground is tile 1 everywhere except (3,2) which is tile 2; deco layer is empty. */
function makeProject(solid: number[] = []): Project {
  const p = createEmptyProject("Моя игра");
  const tiles = new Array<number>(12).fill(1);
  tiles[2 * 4 + 3] = 2;
  const map = {
    ...p.maps[Object.keys(p.maps)[0]!]!,
    id: "town",
    name: "Город",
    width: 4,
    height: 3,
    objects: [],
    layers: [
      { id: "ground", name: "Земля", visible: true, tiles },
      { id: "deco", name: "Декор", visible: true, tiles: new Array<number>(12).fill(0) },
    ],
  };
  return { ...p, manifest: { ...p.manifest, solidTiles: solid }, maps: { ...p.maps, town: map } };
}

function withObjects(p: Project, objects: MapObject[]): Project {
  return { ...p, maps: { ...p.maps, town: { ...p.maps.town!, objects } } };
}

function expectInvalid(p: Project, make: () => Command): void {
  const snapshot = structuredClone(p);
  let err: unknown;
  try {
    make().apply(p);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(NestError);
  expect((err as NestError).code).toBe("invalid_edit");
  expect(p).toEqual(snapshot);
}

describe("objectOps", () => {
  it("places an npc and undoes it", () => {
    const p = makeProject();
    const cmd = placeObjectCommand("town", npc("npc-1", 1, 1), p);
    expect(cmd.label).toBe("Place NPC");
    const after = cmd.apply(p);
    expect(after.maps.town!.objects).toEqual([npc("npc-1", 1, 1)]);
    expect(objectAt(after.maps.town!, 1, 1)?.id).toBe("npc-1");
    expect(cmd.revert(after).maps.town!.objects).toEqual([]);
  });

  it("a second spawn replaces the first and undo restores it", () => {
    const p = withObjects(makeProject(), [spawn("spawn", 0, 0), npc("npc-1", 2, 2)]);
    const cmd = placeObjectCommand("town", spawn("spawn-b", 1, 0), p);
    expect(cmd.label).toBe("Place spawn");
    const after = cmd.apply(p);
    expect(after.maps.town!.objects.filter((o) => o.kind === "spawn")).toEqual([spawn("spawn-b", 1, 0)]);
    expect(after.maps.town!.objects).toContainEqual(npc("npc-1", 2, 2));
    expect(cmd.revert(after).maps.town!.objects).toEqual(p.maps.town!.objects);
  });

  it("a new spawn may take the cell and id of the spawn it replaces", () => {
    const p = withObjects(makeProject(), [spawn("spawn", 0, 0)]);
    const after = placeObjectCommand("town", spawn("spawn", 0, 0), p).apply(p);
    expect(after.maps.town!.objects).toEqual([spawn("spawn", 0, 0)]);
  });

  it("refuses an object on a solid tile", () => {
    const p = makeProject([2]);
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-1", 3, 2), p));
    const q = makeProject([2]);
    expectInvalid(q, () => placeObjectCommand("town", spawn("spawn", 3, 2), q));
  });

  it("refuses to mark a tile solid while an object stands on it", () => {
    const p = withObjects(makeProject(), [npc("npc-1", 3, 2)]);
    let err: unknown;
    try {
      setSolidCommand(2, true, p).apply(p);
    } catch (e) {
      err = e;
    }
    expect((err as NestError).code).toBe("invalid_edit");
    expect((err as NestError).message).toContain("npc-1");
    expect((err as NestError).message).toContain("(3, 2)");
    expectInvalid(p, () => setSolidCommand(2, true, p));
    expect(setSolidCommand(2, false, p).apply(p).manifest.solidTiles).toEqual([]);
  });

  it("refuses a busy cell", () => {
    const p = withObjects(makeProject(), [npc("npc-1", 1, 1)]);
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-2", 1, 1), p));
    const q = withObjects(makeProject(), [npc("npc-1", 1, 1), npc("npc-2", 2, 1)]);
    expectInvalid(q, () => moveObjectCommand("town", "npc-2", 1, 1, q));
  });

  it("refuses out of range cell", () => {
    const p = makeProject();
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-1", 4, 0), p));
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-1", 0, -1), p));
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-1", 0.5, 0), p));
    const q = withObjects(p, [npc("npc-1", 0, 0)]);
    expectInvalid(q, () => moveObjectCommand("town", "npc-1", 0, 3, q));
  });

  it("refuses duplicate id, unknown kind and unknown tile", () => {
    const p = withObjects(makeProject(), [npc("npc-1", 1, 1)]);
    expectInvalid(p, () => placeObjectCommand("town", npc("npc-1", 2, 2), p));
    expectInvalid(p, () => placeObjectCommand("town", { ...npc("npc-2", 2, 2), kind: "chest" }, p));
    expectInvalid(p, () => setSolidCommand(0, true, p));
    expectInvalid(p, () => setSolidCommand(1.5, true, p));
    expectInvalid(p, () => moveObjectCommand("town", "nope", 0, 0, p));
    expectInvalid(p, () => removeObjectCommand("town", "nope", p));
  });

  it("moves and removes an object with undo", () => {
    const p = withObjects(makeProject(), [npc("npc-1", 1, 1)]);
    const mv = moveObjectCommand("town", "npc-1", 2, 0, p);
    expect(mv.label).toBe("Move NPC");
    const moved = mv.apply(p);
    expect(moved.maps.town!.objects).toEqual([npc("npc-1", 2, 0)]);
    expect(mv.revert(moved).maps.town!.objects).toEqual([npc("npc-1", 1, 1)]);

    const rm = removeObjectCommand("town", "npc-1", p);
    expect(rm.label).toBe("Remove NPC");
    const removed = rm.apply(p);
    expect(removed.maps.town!.objects).toEqual([]);
    expect(rm.revert(removed).maps.town!.objects).toEqual([npc("npc-1", 1, 1)]);
  });

  it("refuses to move onto a solid tile", () => {
    const p = withObjects(makeProject([2]), [npc("npc-1", 1, 1)]);
    expectInvalid(p, () => moveObjectCommand("town", "npc-1", 3, 2, p));
  });

  it("setSolid keeps the list sorted without duplicates", () => {
    let p = makeProject([5, 2]);
    const add = setSolidCommand(3, true, p);
    expect(add.label).toBe("Mark tile as solid");
    p = add.apply(p);
    expect(p.manifest.solidTiles).toEqual([2, 3, 5]);
    expect(setSolidCommand(3, true, p).apply(p).manifest.solidTiles).toEqual([2, 3, 5]);
    expect(isSolidTile(p.manifest, 3)).toBe(true);
    expect(isSolidTile(p.manifest, 4)).toBe(false);
    const off = setSolidCommand(3, false, p);
    expect(off.apply(p).manifest.solidTiles).toEqual([2, 5]);
    expect(off.revert(off.apply(p)).manifest.solidTiles).toEqual([2, 3, 5]);
    expect(add.revert(add.apply(makeProject([5, 2]))).manifest.solidTiles).toEqual([5, 2]);
  });

  it("nextNpcId fills the smallest gap", () => {
    const p = withObjects(makeProject(), []);
    expect(nextNpcId(p.maps.town!)).toBe("npc-1");
    const q = withObjects(p, [npc("npc-1", 0, 0), npc("npc-3", 1, 0), spawn("npc-2x", 2, 0)]);
    expect(nextNpcId(q.maps.town!)).toBe("npc-2");
  });

  it("commands do not mutate their input", () => {
    const p = withObjects(makeProject([4]), [npc("npc-1", 1, 1), spawn("spawn", 0, 0)]);
    const snapshot = structuredClone(p);
    const cmds = [
      placeObjectCommand("town", npc("npc-2", 2, 1), p),
      placeObjectCommand("town", spawn("s2", 3, 0), p),
      moveObjectCommand("town", "npc-1", 2, 2, p),
      removeObjectCommand("town", "npc-1", p),
      setSolidCommand(7, true, p),
      setSolidCommand(4, false, p),
    ];
    for (const c of cmds) {
      const after = c.apply(p);
      c.revert(after);
      expect(p).toEqual(snapshot);
    }
  });
});
