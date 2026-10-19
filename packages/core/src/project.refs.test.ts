import { describe, expect, it } from "vitest";
import { collectProjectRefProblems, createEmptyProject, loadProject, saveProject } from "./index.js";
import { MemoryStorage } from "./testing.js";

function dangling() {
  const p = createEmptyProject("G");
  p.maps.main!.objects.push({ id: "npc-1", kind: "npc", x: 1, y: 1, props: { name: "Guide", dialog: "gone" } });
  return p;
}

describe("reference validation on save and load", () => {
  it("save refuses a dangling dialog and writes nothing", async () => {
    const s = new MemoryStorage();
    await expect(saveProject(s, dangling())).rejects.toMatchObject({ code: "invalid_project" });
    expect(s.files.size).toBe(0);
  });

  it("load returns a project with a dangling dialog and reports it in refProblems", async () => {
    const good = createEmptyProject("G");
    const s = new MemoryStorage();
    await saveProject(s, good);
    const map = JSON.parse(s.files.get("maps/main.json")!);
    map.objects.push({ id: "npc-1", kind: "npc", x: 1, y: 1, props: { name: "Guide", dialog: "gone" } });
    s.files.set("maps/main.json", JSON.stringify(map));
    const back = await loadProject(s);
    expect(back.refProblems).toHaveLength(1);
    expect(back.refProblems![0]).toMatch(/npc "npc-1".*dialog "gone" does not exist/);
  });

  it("a normal project has no refProblems", async () => {
    const s = new MemoryStorage();
    await saveProject(s, createEmptyProject("G"));
    expect("refProblems" in (await loadProject(s))).toBe(false);
  });

  it("an interrupted save (new maps, old manifest) still loads and names the missing variable", async () => {
    const s = new MemoryStorage();
    await saveProject(s, createEmptyProject("G"));
    const p = createEmptyProject("G");
    p.manifest.variables = [{ id: "met", name: "Met", type: "flag", initial: false }];
    p.maps.main!.objects.push({
      id: "event-1", kind: "event", x: 1, y: 1,
      props: { name: "E", trigger: "touch", once: false, actions: [{ type: "set", variable: "met", op: "set", value: true }] },
    });
    s.failOnWrite(2); // the map is written, the manifest is not
    await expect(saveProject(s, p)).rejects.toMatchObject({ code: "save_failed" });
    const back = await loadProject(s);
    expect(back.refProblems).toHaveLength(1);
    expect(back.refProblems![0]).toMatch(/event "event-1".*variable "met" does not exist/);
    // saving stays strict and writes nothing
    const before = new Map(s.files);
    const err = await saveProject(s, back).catch((e: unknown) => e as Error);
    expect(err).toMatchObject({ code: "invalid_project" });
    expect((err as Error).message).toMatch(/Fix these references before saving\.$/);
    expect(s.files).toEqual(before);
  });

  it("collects all problems up to the limit", () => {
    const p = createEmptyProject("G");
    for (let i = 1; i <= 25; i++) {
      p.maps.main!.objects.push({ id: `npc-${i}`, kind: "npc", x: 1, y: 1, props: { name: "N", dialog: `d${i}` } });
    }
    expect(collectProjectRefProblems(p)).toHaveLength(20);
    expect(collectProjectRefProblems(p, 3)).toHaveLength(3);
  });

  it("other load errors still throw", async () => {
    const s = new MemoryStorage();
    await saveProject(s, createEmptyProject("G"));
    const map = JSON.parse(s.files.get("maps/main.json")!);
    map.objects.push({ id: "event-1", kind: "event", x: 1, y: 1, props: { name: "E", trigger: "bogus", actions: [] } });
    s.files.set("maps/main.json", JSON.stringify(map));
    await expect(loadProject(s)).rejects.toMatchObject({ code: "invalid_project" });
    s.files.set("maps/main.json", "{ nope");
    await expect(loadProject(s)).rejects.toMatchObject({ code: "invalid_json" });
  });
});

describe("extra object props", () => {
  it("survive a save/load round trip", async () => {
    const p = createEmptyProject("G");
    p.maps.main!.objects.push({ id: "npc-1", kind: "npc", x: 1, y: 1, props: { name: "Guide", mood: "sad" } });
    const s = new MemoryStorage();
    await saveProject(s, p);
    const back = await loadProject(s);
    expect(back.maps.main!.objects[0]!.props).toEqual({ name: "Guide", mood: "sad" });
  });
});
