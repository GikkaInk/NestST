import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@nestst/core";
import type { Dialog, MapObject, Project } from "@nestst/core";
import { allDone, findLineTarget, getOnboardingSteps } from "./onboarding.js";

type Input = Parameters<typeof getOnboardingSteps>[0];

function input(project: Project | null, over: Partial<Input> = {}): Input {
  return { project, currentMapId: project === null ? null : "main", playedOnce: false, ...over };
}

function doneIds(s: Input): string[] {
  return getOnboardingSteps(s)
    .filter((x) => x.done)
    .map((x) => x.id);
}

function withObject(p: Project, obj: MapObject, mapId = "main"): Project {
  p.maps[mapId]!.objects.push(obj);
  return p;
}

const spawn: MapObject = { id: "spawn-1", kind: "spawn", x: 1, y: 1, props: {} };
const npc = (dialog?: string): MapObject => ({
  id: "npc-1",
  kind: "npc",
  x: 2,
  y: 2,
  props: dialog === undefined ? { name: "Guide" } : { name: "Guide", dialog },
});

function addDialog(p: Project, nodes: Dialog["nodes"]): Project {
  p.dialogs["d1"] = { schemaVersion: 1, id: "d1", name: "D", start: null, nodes } as Dialog;
  return p;
}

describe("getOnboardingSteps", () => {
  it("empty project → nothing done", () => {
    const steps = getOnboardingSteps(input(createEmptyProject("P")));
    expect(steps.map((x) => x.id)).toEqual(["ground", "start", "character", "line", "play"]);
    expect(doneIds(input(createEmptyProject("P")))).toEqual([]);
  });

  it("null project → five steps, none done", () => {
    const steps = getOnboardingSteps(input(null));
    expect(steps).toHaveLength(5);
    expect(steps.every((x) => !x.done)).toBe(true);
  });

  it("currentMapId null does not throw", () => {
    const p = withObject(createEmptyProject("P"), spawn);
    expect(doneIds(input(p, { currentMapId: null }))).toEqual(["start"]);
    expect(doneIds(input(p, { currentMapId: "nope" }))).toEqual(["start"]);
  });

  it("tiles only → ground", () => {
    const p = createEmptyProject("P");
    p.maps["main"]!.layers[0]!.tiles[3] = 1;
    expect(doneIds(input(p))).toEqual(["ground"]);
  });

  it("spawn on another map counts", () => {
    const p = createEmptyProject("P");
    p.maps["other"] = { ...structuredClone(p.maps["main"]!), id: "other" };
    withObject(p, spawn, "other");
    expect(doneIds(input(p))).toEqual(["start"]);
  });

  it("npc without dialog → character but not line", () => {
    const p = withObject(createEmptyProject("P"), npc());
    expect(doneIds(input(p))).toEqual(["character"]);
  });

  it("npc with dangling dialog id → line not done", () => {
    const p = withObject(createEmptyProject("P"), npc("gone"));
    expect(doneIds(input(p))).toEqual(["character"]);
    expect(doneIds(input(withObject(createEmptyProject("P"), npc("toString"))))).toEqual(["character"]);
  });

  it("dialog with only choice nodes → line not done", () => {
    const p = addDialog(withObject(createEmptyProject("P"), npc("d1")), [
      { id: "n1", x: 0, y: 0, type: "choice", options: [] } as unknown as Dialog["nodes"][number],
    ]);
    expect(doneIds(input(p))).toEqual(["character"]);
  });

  it("dialog with say → line done", () => {
    const p = addDialog(withObject(createEmptyProject("P"), npc("d1")), [
      { id: "n1", x: 0, y: 0, type: "say", text: "Hi", next: null } as unknown as Dialog["nodes"][number],
    ]);
    expect(doneIds(input(p))).toEqual(["character", "line"]);
  });

  it("playedOnce → play", () => {
    expect(doneIds(input(createEmptyProject("P"), { playedOnce: true }))).toEqual(["play"]);
  });

  it("all five → allDone", () => {
    const p = createEmptyProject("P");
    p.maps["main"]!.layers[0]!.tiles[0] = 2;
    withObject(p, spawn);
    withObject(p, npc("d1"));
    addDialog(p, [{ id: "n1", x: 0, y: 0, type: "say", text: "Hi", next: null } as unknown as Dialog["nodes"][number]]);
    const steps = getOnboardingSteps(input(p, { playedOnce: true }));
    expect(allDone(steps)).toBe(true);
    expect(allDone(getOnboardingSteps(input(p)))).toBe(false);
  });
});

describe("findLineTarget", () => {
  it("null without project or npcs", () => {
    expect(findLineTarget(input(null))).toBeNull();
    expect(findLineTarget(input(createEmptyProject("P")))).toBeNull();
  });
  it("picks the first npc without a working dialog on the current map", () => {
    const p = withObject(createEmptyProject("P"), npc());
    expect(findLineTarget(input(p))).toEqual({ mapId: "main", objectId: "npc-1" });
  });
  it("skips npcs that already talk", () => {
    const p = addDialog(createEmptyProject("P"), [{ type: "say" }] as unknown as Dialog["nodes"]);
    withObject(p, npc("d1"));
    withObject(p, { ...npc(), id: "npc-2" });
    expect(findLineTarget(input(p))).toEqual({ mapId: "main", objectId: "npc-2" });
  });
  it("falls back to another map", () => {
    const p = createEmptyProject("P");
    p.maps["other"] = { ...structuredClone(p.maps["main"]!), objects: [{ ...npc(), id: "npc-9" }] };
    expect(findLineTarget(input(p))).toEqual({ mapId: "other", objectId: "npc-9" });
  });
});
