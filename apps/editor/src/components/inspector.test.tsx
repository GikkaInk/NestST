// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryStorage } from "@nestst/core/testing";
import type { EventProps } from "@nestst/core";
import { createEditorStore } from "../editorStore.js";
import type { EditorStore } from "../editorStore.js";
import { App } from "../App.js";
import { ObjectInspector } from "./ObjectInspector.js";
import { VariablesView } from "./VariablesView.js";
import { ViewTabs } from "./ViewTabs.js";

vi.mock("./MapEditor.js", () => ({ MapEditor: () => <div data-testid="map-editor" /> }));

afterEach(cleanup);

async function openStore(): Promise<EditorStore> {
  const storage = new MemoryStorage();
  const store = createEditorStore({
    pickNew: async () => ({ storage, label: "/tmp/game" }),
    pickOpen: async () => ({ storage, label: "/tmp/game" }),
  });
  await store.newProject("Test");
  return store;
}

/** A project with a dialog, a flag, a number, an NPC and an event (both at distinct cells). */
async function richStore(): Promise<EditorStore> {
  const store = await openStore();
  store.newDialog("Hello");
  store.setVariables([
    { id: "met", name: "Met", type: "flag", initial: false },
    { id: "coins", name: "Coins", type: "number", initial: 0 },
  ]);
  store.selectTool("npc");
  store.placeObjectAt(1, 1);
  store.selectTool("event");
  store.placeObjectAt(2, 2);
  store.selectObject("event-1");
  return store;
}

function eventProps(store: EditorStore): EventProps {
  const s = store.getState();
  return s.project!.maps[s.currentMapId!]!.objects.find((o) => o.id === "event-1")!.props as unknown as EventProps;
}

describe("ViewTabs", () => {
  it("switch the view and leave the history alone", async () => {
    const store = await richStore();
    const before = { canUndo: store.getState().canUndo, dirty: store.getState().dirty };
    render(<ViewTabs store={store} />);
    expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
    expect(store.getState().view).toBe("variables");
    fireEvent.click(screen.getByRole("tab", { name: "Dialogs" }));
    expect(store.getState().view).toBe("dialogs");
    expect(screen.getByRole("tab", { name: "Dialogs" }).getAttribute("aria-selected")).toBe("true");
    expect({ canUndo: store.getState().canUndo, dirty: store.getState().dirty }).toEqual(before);
    store.undo(); // the first undo reverts the last edit (placing the event), not a view change
    const map = store.getState().project!.maps[store.getState().currentMapId!]!;
    expect(map.objects.some((o) => o.id === "event-1")).toBe(false);
    expect(map.objects.some((o) => o.id === "npc-1")).toBe(true);
  });

  it("App shows the matching view", async () => {
    const store = await richStore();
    render(<App store={store} />);
    expect(screen.getByTestId("map-editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Variables" }));
    expect(screen.queryByTestId("map-editor")).toBeNull();
    expect(screen.getByRole("region", { name: "Variables" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Dialogs" }));
    expect(screen.getByRole("heading", { name: "Dialogs" })).toBeTruthy();
  });
});

describe("VariablesView", () => {
  it("adds a variable, changes its type and deletes it", async () => {
    const store = await openStore();
    render(<VariablesView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
    expect(store.getState().project!.manifest.variables).toEqual([
      { id: "var-1", name: "Variable 1", type: "flag", initial: false },
    ]);
    fireEvent.change(screen.getByLabelText("Type of var-1"), { target: { value: "number" } });
    expect(store.getState().project!.manifest.variables[0]).toMatchObject({ type: "number", initial: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Delete var-1" }));
    expect(store.getState().project!.manifest.variables).toEqual([]);
  });

  it("commits the name and the initial value on blur, not on typing", async () => {
    const store = await openStore();
    store.setVariables([{ id: "coins", name: "Coins", type: "number", initial: 0 }]);
    render(<VariablesView store={store} />);
    const name = screen.getByLabelText("Name of coins");
    fireEvent.change(name, { target: { value: "Gold" } });
    expect(store.getState().project!.manifest.variables[0]!.name).toBe("Coins");
    fireEvent.blur(name);
    expect(store.getState().project!.manifest.variables[0]!.name).toBe("Gold");
    const initial = screen.getByLabelText("Initial value of coins");
    fireEvent.change(initial, { target: { value: "7" } });
    fireEvent.keyDown(initial, { key: "Enter" });
    expect(store.getState().project!.manifest.variables[0]!.initial).toBe(7);
  });

  it("refuses an out-of-range number with a message and keeps the old value", async () => {
    const store = await openStore();
    store.setVariables([{ id: "coins", name: "Coins", type: "number", initial: 1 }]);
    render(<VariablesView store={store} />);
    const initial = screen.getByLabelText("Initial value of coins") as HTMLInputElement;
    fireEvent.change(initial, { target: { value: "5000000" } });
    fireEvent.blur(initial);
    expect(store.getState().project!.manifest.variables[0]!.initial).toBe(1);
    expect(store.getState().error).toMatch(/-1000000 to 1000000/);
    expect(initial.value).toBe("1");
  });

  it("shows the reference-protection error from the store", async () => {
    const store = await richStore();
    store.selectObject("event-1");
    const props = eventProps(store);
    store.setObjectProps("event-1", { ...props, condition: { variable: "met", op: "==", value: true } });
    render(<VariablesView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete met" }));
    expect(store.getState().error).toMatch(/cannot remove variable "met"/i);
    expect(store.getState().project!.manifest.variables.some((v) => v.id === "met")).toBe(true);
  });
});

describe("ObjectInspector: NPC", () => {
  it("renders nothing without a selection or for a spawn", async () => {
    const store = await openStore();
    const { container } = render(<ObjectInspector store={store} />);
    expect(container.firstChild).toBeNull();
  });

  it("changes the dialog through the store, including None", async () => {
    const store = await richStore();
    act(() => store.selectObject("npc-1"));
    render(<ObjectInspector store={store} />);
    const select = screen.getByLabelText("Dialog") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["None", "Hello"]);
    fireEvent.change(select, { target: { value: "hello" } });
    const npc = () => store.getState().project!.maps[store.getState().currentMapId!]!.objects.find((o) => o.id === "npc-1")!;
    expect(npc().props).toMatchObject({ dialog: "hello" });
    fireEvent.change(select, { target: { value: "" } });
    expect(npc().props).not.toHaveProperty("dialog");
  });

  it("renames on blur only", async () => {
    const store = await richStore();
    act(() => store.selectObject("npc-1"));
    render(<ObjectInspector store={store} />);
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Cat" } });
    const get = () => store.getState().project!.maps[store.getState().currentMapId!]!.objects.find((o) => o.id === "npc-1")!.props;
    expect(get()).toMatchObject({ name: "NPC 1" });
    fireEvent.blur(name);
    expect(get()).toMatchObject({ name: "Cat" });
  });

  it("Delete removes the object", async () => {
    const store = await richStore();
    act(() => store.selectObject("npc-1"));
    render(<ObjectInspector store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const map = store.getState().project!.maps[store.getState().currentMapId!]!;
    expect(map.objects.some((o) => o.id === "npc-1")).toBe(false);
  });
});

describe("ObjectInspector: event", () => {
  it("edits trigger and once on change", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    fireEvent.change(screen.getByLabelText("Trigger"), { target: { value: "interact" } });
    expect(eventProps(store).trigger).toBe("interact");
    fireEvent.click(screen.getByLabelText("Only once"));
    expect(eventProps(store).once).toBe(true);
  });

  it("adds, orders and removes actions; at least one stays, at most eight", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    expect(eventProps(store).actions).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Remove action 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add set" }));
    fireEvent.click(screen.getByRole("button", { name: "Add teleport" }));
    expect(eventProps(store).actions.map((a) => a.type)).toEqual(["dialog", "set", "teleport"]);
    fireEvent.click(screen.getByRole("button", { name: "Move action 3 up" }));
    expect(eventProps(store).actions.map((a) => a.type)).toEqual(["dialog", "teleport", "set"]);
    fireEvent.click(screen.getByRole("button", { name: "Move action 1 down" }));
    expect(eventProps(store).actions.map((a) => a.type)).toEqual(["teleport", "dialog", "set"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove action 2" }));
    expect(eventProps(store).actions.map((a) => a.type)).toEqual(["teleport", "set"]);
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Add teleport" }));
    expect(eventProps(store).actions).toHaveLength(8);
    expect((screen.getByRole("button", { name: "Add teleport" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("set action: add is offered for numbers only; value commits on blur", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Add set" })); // first variable: flag "met"
    const op = screen.getByLabelText("Action 2 operation") as HTMLSelectElement;
    expect([...op.options].map((o) => o.value)).toEqual(["set"]);
    fireEvent.change(screen.getByLabelText("Action 2 variable"), { target: { value: "coins" } });
    expect(eventProps(store).actions[1]).toEqual({ type: "set", variable: "coins", op: "set", value: 0 });
    expect([...(screen.getByLabelText("Action 2 operation") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["set", "add"]);
    fireEvent.change(screen.getByLabelText("Action 2 operation"), { target: { value: "add" } });
    const value = screen.getByLabelText("Action 2 value");
    fireEvent.change(value, { target: { value: "5" } });
    expect(eventProps(store).actions[1]).toMatchObject({ value: 0 });
    fireEvent.blur(value);
    expect(eventProps(store).actions[1]).toEqual({ type: "set", variable: "coins", op: "add", value: 5 });
  });

  it("teleport action: x/y commit on blur, outside cells are refused with a message", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Add teleport" }));
    const x = screen.getByLabelText("Action 2 x");
    fireEvent.change(x, { target: { value: "3" } });
    fireEvent.blur(x);
    expect(eventProps(store).actions[1]).toMatchObject({ type: "teleport", x: 3, y: 0 });
    fireEvent.change(x, { target: { value: "99999" } });
    fireEvent.blur(x);
    expect(eventProps(store).actions[1]).toMatchObject({ x: 3 });
    expect(store.getState().error).toMatch(/inside the map/);
  });

  it("condition: toggle, change variable and operator, flag uses a checkbox", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    expect(screen.queryByLabelText("Condition variable")).toBeNull();
    fireEvent.click(screen.getByLabelText("Has condition"));
    expect(eventProps(store).condition).toEqual({ variable: "met", op: "==", value: true });
    const value = screen.getByLabelText("Condition value") as HTMLInputElement;
    expect(value.type).toBe("checkbox");
    const ops = screen.getByLabelText("Condition operator") as HTMLSelectElement;
    expect([...ops.options].map((o) => o.value)).toEqual(["==", "!="]);
    fireEvent.change(screen.getByLabelText("Condition variable"), { target: { value: "coins" } });
    expect(eventProps(store).condition).toEqual({ variable: "coins", op: "==", value: 0 });
    expect(within(screen.getByLabelText("Condition operator")).getAllByRole("option")).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Condition operator"), { target: { value: ">=" } });
    const num = screen.getByLabelText("Condition value");
    fireEvent.change(num, { target: { value: "10" } });
    fireEvent.blur(num);
    expect(eventProps(store).condition).toEqual({ variable: "coins", op: ">=", value: 10 });
    fireEvent.click(screen.getByLabelText("Has condition"));
    expect(eventProps(store).condition).toBeUndefined();
  });

  it("Delete removes the event", async () => {
    const store = await richStore();
    render(<ObjectInspector store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const map = store.getState().project!.maps[store.getState().currentMapId!]!;
    expect(map.objects.some((o) => o.id === "event-1")).toBe(false);
  });

  it("every control is disabled while playing", async () => {
    const store = await richStore();
    store.selectTool("spawn");
    store.placeObjectAt(0, 0);
    const { container } = render(<ObjectInspector store={store} />);
    act(() => {
      expect(store.play()).toBe(true);
    });
    const controls = container.querySelectorAll("input, select, button");
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) expect((c as HTMLInputElement).disabled).toBe(true);
  });
});

describe("App: Select and Event keys", () => {
  it("V selects the Select tool and T the Event tool; not in text fields", async () => {
    const store = await richStore();
    render(<App store={store} />);
    fireEvent.keyDown(window, { code: "KeyV" });
    expect(store.getState().tool).toBe("select");
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(store.getState().tool).toBe("event");
    fireEvent.keyDown(window, { code: "KeyB" });
    const name = screen.getByLabelText("Name");
    fireEvent.keyDown(name, { code: "KeyV" });
    expect(store.getState().tool).toBe("brush");
    fireEvent.keyDown(window, { code: "KeyV", ctrlKey: true });
    expect(store.getState().tool).toBe("brush");
  });

  it("toolbar has Select and Event buttons", async () => {
    const store = await richStore();
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(store.getState().tool).toBe("select");
    fireEvent.click(screen.getByRole("button", { name: "Trigger tile" }));
    expect(store.getState().tool).toBe("event");
  });
});
