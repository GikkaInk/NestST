// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryStorage } from "@nestst/core/testing";
import type { Dialog } from "@nestst/core";
import { createEditorStore } from "../editorStore.js";
import type { EditorStore } from "../editorStore.js";
import { App } from "../App.js";
import { dialogToFlow, nodeSummary, START_MARKER_ID } from "../dialogGraph.js";
import { DialogGraph } from "./DialogGraph.js";
import { DialogsView } from "./DialogsView.js";
import { NodeInspector } from "./NodeInspector.js";

// happy-dom has no layout, so the real xyflow is replaced by a stub that records its props.
const flow = vi.hoisted(() => ({ props: null as any }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (p: any) => {
    flow.props = p;
    return <div data-testid="flow">{p.children}</div>;
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));
vi.mock("./MapEditor.js", () => ({ MapEditor: () => <div /> }));

afterEach(cleanup);
beforeEach(() => {
  flow.props = null;
});

const VARS = [
  { id: "met", name: "Met", type: "flag" as const, initial: false },
  { id: "coins", name: "Coins", type: "number" as const, initial: 0 },
];

const DIALOG: Dialog = {
  schemaVersion: 1,
  id: "hello",
  name: "Hello",
  start: "n1",
  nodes: [
    { id: "n1", x: 10, y: 20, type: "say", speaker: "Mo", text: "Hi there", next: "n2" },
    { id: "n2", x: 300, y: 20, type: "choice", options: [{ text: "A", next: null }, { text: "B", next: null }] },
    { id: "n3", x: 600, y: 20, type: "set", variable: "coins", op: "add", value: 1, next: null },
    { id: "n4", x: 900, y: 20, type: "branch", condition: { variable: "met", op: "==", value: true }, then: null, else: null },
  ],
};

async function openStore(withVars = true): Promise<EditorStore> {
  const storage = new MemoryStorage();
  const store = createEditorStore({
    pickNew: async () => ({ storage, label: "/tmp/game" }),
    pickOpen: async () => ({ storage, label: "/tmp/game" }),
  });
  await store.newProject("Test");
  if (withVars) store.setVariables(VARS);
  return store;
}

async function storeWithDialog(withVars = true): Promise<EditorStore> {
  const store = await openStore(withVars);
  store.newDialog("Hello");
  store.saveDialog({ ...DIALOG, nodes: withVars ? DIALOG.nodes : DIALOG.nodes.filter((n) => n.type === "say" || n.type === "choice") });
  return store;
}

const dialogOf = (store: EditorStore): Dialog => store.getState().project!.dialogs["hello"]!;

describe("DialogsView list", () => {
  it("shows a friendly empty state and creates the first dialog", async () => {
    const store = await openStore();
    render(<DialogsView store={store} />);
    expect(screen.getByText("Create your first dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New dialog name"), { target: { value: "Intro" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dialog" }));
    expect(store.getState().project!.dialogs["intro"]!.name).toBe("Intro");
    expect(store.getState().activeDialogId).toBe("intro");
    expect(screen.queryByText("Create your first dialog")).toBeNull();
  });

  it("selects a dialog from the list", async () => {
    const store = await storeWithDialog();
    store.newDialog("Second");
    render(<DialogsView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Hello" }));
    expect(store.getState().activeDialogId).toBe("hello");
  });

  it("renames a dialog with one history step", async () => {
    const store = await storeWithDialog();
    render(<DialogsView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Hello" }));
    const input = screen.getByLabelText("Dialog name");
    fireEvent.change(input, { target: { value: "Greeting" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialogOf(store).name).toBe("Greeting");
    expect(dialogOf(store).nodes).toHaveLength(4);
    store.undo();
    expect(dialogOf(store).name).toBe("Hello");
  });

  it("deletes an unused dialog", async () => {
    const store = await storeWithDialog();
    render(<DialogsView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Hello" }));
    expect(store.getState().project!.dialogs["hello"]).toBeUndefined();
  });

  it("keeps a dialog that is in use and reports the reason", async () => {
    const store = await storeWithDialog();
    store.selectTool("npc");
    store.placeObjectAt(1, 1);
    store.selectObject("npc-1");
    const npc = store.getState().project!.maps[store.getState().currentMapId!]!.objects.find((o) => o.kind === "npc")!;
    store.setObjectProps(npc.id, { ...(npc.props as object), dialog: "hello" });
    expect(store.getState().error).toBeNull();
    render(<DialogsView store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Hello" }));
    expect(store.getState().project!.dialogs["hello"]).toBeDefined();
    expect(store.getState().error).toMatch(/Could not delete the dialog/);
  });

  it("disables the controls while the game is playing", async () => {
    const store = await storeWithDialog();
    store.selectTool("spawn");
    store.placeObjectAt(0, 0);
    expect(store.play()).toBe(true);
    render(<DialogsView store={store} />);
    expect((screen.getByRole("button", { name: "Create dialog" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete Hello" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is mounted by the Dialogs tab of the app", async () => {
    const store = await storeWithDialog();
    store.setView("dialogs");
    render(<App store={store} />);
    expect(screen.getByRole("button", { name: "Delete Hello" })).toBeTruthy();
    expect(screen.getByTestId("flow")).toBeTruthy();
  });
});

describe("DialogGraph glue", () => {
  function setup(extra: Partial<React.ComponentProps<typeof DialogGraph>> = {}) {
    const onChange = vi.fn<(d: Dialog) => boolean>(() => true);
    const onSelect = vi.fn();
    render(
      <DialogGraph dialog={DIALOG} variables={VARS} selectedId={null} disabled={false} onChange={onChange} onSelect={onSelect} {...extra} />,
    );
    return { onChange, onSelect };
  }

  it("passes the nodes and edges from dialogToFlow to xyflow", () => {
    setup();
    const expected = dialogToFlow(DIALOG);
    expect(flow.props.nodes.map((n: any) => n.id)).toEqual(expected.nodes.map((n) => n.id));
    expect(flow.props.edges.map((e: any) => e.id)).toEqual(expected.edges.map((e) => e.id));
    expect(flow.props.nodes.find((n: any) => n.id === "n2").position).toEqual({ x: 300, y: 20 });
  });

  it("connecting calls the pure function and reports the new dialog", () => {
    const { onChange } = setup();
    act(() => flow.props.onConnect({ source: "n2", sourceHandle: "opt-1", target: "n3" }));
    const next = onChange.mock.calls[0]![0] as Dialog;
    expect((next.nodes[1] as any).options[1].next).toBe("n3");
  });

  it("ignores a connection that changes nothing", () => {
    const { onChange } = setup();
    act(() => flow.props.onConnect({ source: "n1", sourceHandle: "next", target: "n2" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dragging commits once, on drag stop", () => {
    const { onChange } = setup();
    act(() => {
      flow.props.onNodesChange([{ type: "position", id: "n3", position: { x: 1, y: 1 }, dragging: true }]);
      flow.props.onNodesChange([{ type: "position", id: "n3", position: { x: 50, y: 60 }, dragging: true }]);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(flow.props.nodes.find((n: any) => n.id === "n3").position).toEqual({ x: 50, y: 60 }); // follows the pointer
    act(() => flow.props.onNodeDragStop({}, { id: "n3", position: { x: 50, y: 60 } }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as Dialog).nodes[2]).toMatchObject({ x: 50, y: 60 });
  });

  it("a drag that ends where it started commits nothing", () => {
    const { onChange } = setup();
    act(() => flow.props.onNodeDragStop({}, { id: "n3", position: { x: 600, y: 20 } }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Delete removes selected nodes and edges in one change", () => {
    const withEdge: Dialog = { ...DIALOG };
    const { onChange } = setup({ dialog: withEdge });
    act(() =>
      flow.props.onDelete({
        nodes: [{ id: "n2" }],
        edges: [{ id: "n1:next", source: "n1", sourceHandle: "next", target: "n2" }],
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as Dialog;
    expect(next.nodes.map((n) => n.id)).toEqual(["n1", "n3", "n4"]);
    expect((next.nodes[0] as any).next).toBeNull();
  });

  it("deleting the start edge clears start; the marker cannot be deleted", () => {
    const { onChange } = setup();
    const marker = flow.props.nodes.find((n: any) => n.id === START_MARKER_ID);
    expect(marker.deletable).toBe(false);
    act(() => flow.props.onDelete({ nodes: [], edges: [{ id: `${START_MARKER_ID}:start` }] }));
    expect((onChange.mock.calls[0]![0] as Dialog).start).toBeNull();
  });

  it("Delete is the delete key", () => {
    setup();
    expect(flow.props.deleteKeyCode).toBe("Delete");
  });

  it("selecting a node reports it; deselecting clears it", () => {
    const { onSelect } = setup({ selectedId: "n1" });
    act(() => flow.props.onNodesChange([{ type: "select", id: "n3", selected: true }]));
    expect(onSelect).toHaveBeenLastCalledWith("n3");
    act(() => flow.props.onNodesChange([{ type: "select", id: "n3", selected: false }]));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("add buttons add a node at a free spot and select it", () => {
    const { onChange, onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    const next = onChange.mock.calls[0]![0] as Dialog;
    expect(next.nodes).toHaveLength(5);
    expect(next.nodes[4]).toMatchObject({ id: "n5", type: "choice" });
    expect(onSelect).toHaveBeenCalledWith("n5");
    for (const n of DIALOG.nodes) {
      const added = next.nodes[4]!;
      expect(Math.abs(n.x - added.x) < 100 && Math.abs(n.y - added.y) < 100).toBe(false);
    }
  });

  it("set and branch need a variable", () => {
    setup({ variables: [] });
    expect((screen.getByRole("button", { name: "Add set" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add branch" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add say" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("when disabled nothing can be changed", () => {
    const { onChange } = setup({ disabled: true });
    expect((screen.getByRole("button", { name: "Add say" }) as HTMLButtonElement).disabled).toBe(true);
    expect(flow.props.nodesConnectable).toBe(false);
    expect(flow.props.nodesDraggable).toBe(false);
    act(() => flow.props.onConnect({ source: "n2", sourceHandle: "opt-1", target: "n3" }));
    act(() => flow.props.onNodeDragStop({}, { id: "n3", position: { x: 5, y: 5 } }));
    act(() => flow.props.onDelete({ nodes: [{ id: "n3" }], edges: [] }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a refused save does not break the next change", () => {
    const onChange = vi.fn<(d: Dialog) => boolean>().mockReturnValueOnce(false).mockReturnValue(true);
    setup({ onChange });
    act(() => flow.props.onConnect({ source: "n2", sourceHandle: "opt-1", target: "n3" }));
    act(() => flow.props.onConnect({ source: "n2", sourceHandle: "opt-0", target: "n3" }));
    const second = onChange.mock.calls[1]![0] as Dialog;
    expect((second.nodes[1] as any).options[1].next).toBeNull(); // built from the dialog that was really saved
  });
});

describe("NodeInspector", () => {
  it("asks to pick a node when none is selected", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId={null} />);
    expect(screen.getByText(/Select a node/)).toBeTruthy();
  });

  it("changes the say text on blur with one saveDialog", async () => {
    const store = await storeWithDialog();
    const spy = vi.spyOn(store, "saveDialog");
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    const text = screen.getByLabelText("Text");
    fireEvent.change(text, { target: { value: "Hello!" } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.blur(text);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((dialogOf(store).nodes[0] as any).text).toBe("Hello!");
    fireEvent.change(screen.getByLabelText("Speaker"), { target: { value: "Zed" } });
    fireEvent.blur(screen.getByLabelText("Speaker"));
    expect((dialogOf(store).nodes[0] as any).speaker).toBe("Zed");
  });

  it("does not save an empty say text", async () => {
    const store = await storeWithDialog();
    const spy = vi.spyOn(store, "saveDialog");
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Text"));
    expect(spy).not.toHaveBeenCalled();
    expect(store.getState().error).toMatch(/text/i);
  });

  it("sets the start node", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n3" />);
    fireEvent.click(screen.getByRole("button", { name: "Set as start" }));
    expect(dialogOf(store).start).toBe("n3");
  });

  it("disables 'Set as start' for the start node", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    expect((screen.getByRole("button", { name: "Set as start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes the node", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    expect(dialogOf(store).nodes.map((n) => n.id)).toEqual(["n2", "n3", "n4"]);
    expect(dialogOf(store).start).toBeNull();
  });

  it("edits choice options: text, add up to 6, remove down to 1", async () => {
    const store = await storeWithDialog();
    const view = render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n2" />);
    fireEvent.change(screen.getByLabelText("Option 1 text"), { target: { value: "Yes" } });
    fireEvent.blur(screen.getByLabelText("Option 1 text"));
    expect((dialogOf(store).nodes[1] as any).options[0].text).toBe("Yes");
    for (let i = 0; i < 4; i++) {
      view.rerender(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n2" />); // props follow the store
      fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    }
    view.rerender(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n2" />);
    expect((dialogOf(store).nodes[1] as any).options).toHaveLength(6);
    expect((screen.getByRole("button", { name: "Add option" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));
    expect((dialogOf(store).nodes[1] as any).options).toHaveLength(5);
    expect((dialogOf(store).nodes[1] as any).options[0].text).toBe("B");
  });

  it("the last option cannot be removed", async () => {
    const store = await storeWithDialog();
    store.saveDialog({ ...dialogOf(store), nodes: [{ id: "n1", x: 0, y: 0, type: "choice", options: [{ text: "Only", next: null }] }], start: "n1" });
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    expect((screen.getByRole("button", { name: "Remove option 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds a condition to an option", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n2" />);
    const group = screen.getByRole("group", { name: "Option 2 condition" });
    fireEvent.click(within(group).getByLabelText("Has condition"));
    expect((dialogOf(store).nodes[1] as any).options[1].condition).toEqual({ variable: "met", op: "==", value: true });
  });

  it("edits a set node: variable, operation, value", async () => {
    const store = await storeWithDialog();
    const view = render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n3" />);
    fireEvent.change(screen.getByLabelText("Set value"), { target: { value: "5" } });
    fireEvent.blur(screen.getByLabelText("Set value"));
    expect(dialogOf(store).nodes[2]).toMatchObject({ variable: "coins", op: "add", value: 5 });
    view.rerender(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n3" />);
    fireEvent.change(screen.getByLabelText("Set operation"), { target: { value: "set" } });
    expect(dialogOf(store).nodes[2]).toMatchObject({ op: "set", value: 5 });
    view.rerender(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n3" />);
    fireEvent.change(screen.getByLabelText("Set variable"), { target: { value: "met" } });
    expect(dialogOf(store).nodes[2]).toMatchObject({ variable: "met", op: "set", value: true });
    view.rerender(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n3" />);
    // a flag variable can only be set, not added to
    const ops = Array.from((screen.getByLabelText("Set operation") as HTMLSelectElement).options).map((o) => o.value);
    expect(ops).toEqual(["set"]);
  });

  it("edits a branch condition and cannot remove it", async () => {
    const store = await storeWithDialog();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n4" />);
    const group = screen.getByRole("group", { name: "Condition" });
    expect((within(group).getByLabelText("Has condition") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(group).getByLabelText("Condition operator"), { target: { value: "!=" } });
    expect((dialogOf(store).nodes[3] as any).condition.op).toBe("!=");
  });

  it("hints to create a variable first for set and branch, and disables them", async () => {
    const orphan: Dialog = { ...DIALOG, nodes: [DIALOG.nodes[2]!, DIALOG.nodes[3]!] };
    const s2 = await openStore(false);
    const { unmount } = render(<NodeInspector store={s2} dialog={orphan} nodeId="n3" />);
    expect(screen.getByText("Create a variable first")).toBeTruthy();
    expect((screen.getByLabelText("Set variable") as HTMLSelectElement).disabled).toBe(true);
    unmount();
    render(<NodeInspector store={s2} dialog={orphan} nodeId="n4" />);
    expect(screen.getByText("Create a variable first")).toBeTruthy();
  });

  it("is disabled while the game is playing", async () => {
    const store = await storeWithDialog();
    store.selectTool("spawn");
    store.placeObjectAt(0, 0);
    store.play();
    render(<NodeInspector store={store} dialog={dialogOf(store)} nodeId="n1" />);
    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete node" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("nodeSummary", () => {
  const names = new Map([["coins", "Coins"], ["met", "Met"]]);
  it("is short and names variables", () => {
    expect(nodeSummary(DIALOG.nodes[0]!)).toBe("Mo: Hi there");
    expect(nodeSummary({ ...DIALOG.nodes[0]!, speaker: "", text: "x".repeat(200) } as any).length).toBeLessThanOrEqual(60);
    expect(nodeSummary(DIALOG.nodes[1]!)).toBe("2 options");
    expect(nodeSummary(DIALOG.nodes[2]!, names)).toBe("Coins += 1");
    expect(nodeSummary(DIALOG.nodes[3]!, names)).toBe("if Met == true");
  });
});
