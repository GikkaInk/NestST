// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryStorage } from "@nestst/core/testing";
import { createEditorStore } from "../editorStore.js";
import type { EditorStore } from "../editorStore.js";
import { OnboardingPanel } from "./OnboardingPanel.js";
import { readOnboardingHidden } from "../onboardingPrefs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});
beforeEach(() => window.localStorage.clear());

async function openStore(): Promise<EditorStore> {
  const storage = new MemoryStorage();
  const store = createEditorStore({
    pickNew: async () => ({ storage, label: "/tmp/game" }),
    pickOpen: async () => ({ storage, label: "/tmp/game" }),
  });
  await store.newProject("Test");
  return store;
}

const paint = (s: EditorStore) => s.paintStroke([{ layerId: "ground", x: 0, y: 0, tile: 1 }]);
function addSpawn(s: EditorStore) {
  s.selectTool("spawn");
  s.placeObjectAt(1, 1);
}
function addNpc(s: EditorStore) {
  s.selectTool("npc");
  s.placeObjectAt(2, 2);
}
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("OnboardingPanel", () => {
  it("shows five steps for a new project", async () => {
    const store = await openStore();
    render(<OnboardingPanel store={store} />);
    expect(screen.getByLabelText("First steps")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    for (const t of ["Draw some ground", "Place the start point", "Add a character", "Write them a line", "Press Play"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("marks done steps", async () => {
    const store = await openStore();
    paint(store);
    render(<OnboardingPanel store={store} />);
    expect(screen.getAllByRole("listitem")[0]!.getAttribute("data-done")).toBe("true");
    expect(screen.queryByRole("button", { name: "Draw: Draw some ground" })).toBeNull();
    expect(screen.getAllByRole("listitem")[1]!.getAttribute("data-done")).toBe("false");
  });

  it("step action buttons select tool brush/spawn/npc", async () => {
    const store = await openStore();
    render(<OnboardingPanel store={store} />);
    fireEvent.click(btn("Place it: Place the start point"));
    expect(store.getState().tool).toBe("spawn");
    fireEvent.click(btn("Add one: Add a character"));
    expect(store.getState().tool).toBe("npc");
    fireEvent.click(btn("Draw: Draw some ground"));
    expect(store.getState().tool).toBe("brush");
  });

  it("line step creates dialog for the first npc and opens Dialogs tab", async () => {
    const store = await openStore();
    addNpc(store);
    render(<OnboardingPanel store={store} />);
    fireEvent.click(btn("Write a line: Write them a line"));
    const s = store.getState();
    expect(s.view).toBe("dialogs");
    const map = s.project!.maps[s.currentMapId!]!;
    expect(map.objects.find((o) => o.kind === "npc")!.props["dialog"]).toBe(s.activeDialogId);
  });

  it("line step is inactive with a reason when there is no character", async () => {
    const store = await openStore();
    render(<OnboardingPanel store={store} />);
    expect(btn("Write a line: Write them a line").disabled).toBe(true);
    expect(screen.getByText("Add a character on this map first")).toBeTruthy();
  });

  it("line step is disabled with a reason when the only npc is on another map", async () => {
    const store = await openStore();
    const project = structuredClone(store.getState().project!);
    const other = structuredClone(project.maps[store.getState().currentMapId!]!);
    other.objects = [{ id: "npc-9", kind: "npc", x: 0, y: 0, props: { name: "Far" } }];
    project.maps["other"] = other;
    const patched = { ...store.getState(), project };
    vi.spyOn(store, "getState").mockReturnValue(patched);
    render(<OnboardingPanel store={store} />);
    expect(btn("Write a line: Write them a line").disabled).toBe(true);
    expect(screen.getByText("Add a character on this map first")).toBeTruthy();
  });

  it("Play step button disabled with text reason until start point exists", async () => {
    const store = await openStore();
    render(<OnboardingPanel store={store} />);
    expect(btn("Play: Press Play").disabled).toBe(true);
    expect(screen.getByText("Place a start point first")).toBeTruthy();
    act(() => addSpawn(store));
    expect(btn("Play: Press Play").disabled).toBe(false);
    expect(screen.queryByText("Place a start point first")).toBeNull();
    fireEvent.click(btn("Play: Press Play"));
    expect(store.getState().mode).toBe("playing");
  });

  it("collapses to \"All set!\" when all done and \"Show again\" expands", async () => {
    const store = await openStore();
    paint(store);
    addSpawn(store);
    addNpc(store);
    store.newDialogForObject(store.getState().project!.maps[store.getState().currentMapId!]!.objects.find((o) => o.kind === "npc")!.id);
    store.play();
    store.stopPlay();
    render(<OnboardingPanel store={store} />);
    expect(screen.getByText("All set!")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(btn("Show again"));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("close button hides panel and writes the pref", async () => {
    const store = await openStore();
    const { container } = render(<OnboardingPanel store={store} />);
    fireEvent.click(btn("Close first steps"));
    expect(container.firstChild).toBeNull();
    expect(readOnboardingHidden()).toBe(true);
  });

  it("stays hidden when the pref is set", async () => {
    window.localStorage.setItem("nestst.onboardingHidden", "1");
    const store = await openStore();
    const { container } = render(<OnboardingPanel store={store} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders expanded when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = await openStore();
    const { container } = render(<OnboardingPanel store={store} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(btn("Close first steps"));
    expect(container.firstChild).toBeNull();
  });

  it("buttons disabled while playing", async () => {
    const store = await openStore();
    addSpawn(store);
    store.play();
    render(<OnboardingPanel store={store} />);
    for (const b of screen.getAllByRole("button")) {
      if (b.getAttribute("aria-label") === "Close first steps") continue;
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
