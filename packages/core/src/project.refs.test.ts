import { describe, expect, it } from "vitest";
import { MANIFEST_FILE, createEmptyProject, loadProject, saveProject } from "./index.js";
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

  it("load refuses a project with a dangling dialog", async () => {
    const good = createEmptyProject("G");
    const s = new MemoryStorage();
    await saveProject(s, good);
    const mapText = s.files.get("maps/main.json")!;
    const map = JSON.parse(mapText);
    map.objects.push({ id: "npc-1", kind: "npc", x: 1, y: 1, props: { name: "Guide", dialog: "gone" } });
    s.files.set("maps/main.json", JSON.stringify(map));
    const err = await loadProject(s).catch((e: unknown) => e as Error);
    expect(err).toMatchObject({ code: "invalid_project" });
    expect((err as Error).message).toMatch(/dialog "gone" does not exist/);
    expect(s.files.has(MANIFEST_FILE)).toBe(true);
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
