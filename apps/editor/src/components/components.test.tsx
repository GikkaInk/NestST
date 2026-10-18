// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryStorage } from "@nestst/core/testing";
import { createEditorStore } from "../editorStore.js";
import type { EditorStore, ProjectSession } from "../editorStore.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorBanner } from "./ErrorBanner.js";
import { PALETTE_SIZE, Palette } from "./Palette.js";
import { StartScreen } from "./StartScreen.js";
import { Toolbar } from "./Toolbar.js";

afterEach(cleanup);

function session(storage = new MemoryStorage()): ProjectSession {
  return {
    pickNew: async () => ({ storage, label: "/tmp/game" }),
    pickOpen: async () => ({ storage, label: "/tmp/game" }),
  };
}

async function openStore(): Promise<EditorStore> {
  const store = createEditorStore(session());
  await store.newProject("Test");
  return store;
}

describe("StartScreen", () => {
  it("enables create only for a non-blank name and calls the store with it", async () => {
    const store = createEditorStore(session());
    const spy = vi.spyOn(store, "newProject");
    const onDone = vi.fn();
    render(<StartScreen store={store} onDone={onDone} />);
    const create = screen.getByRole("button", { name: "Choose folder & create" });
    const input = screen.getByLabelText("Project name");
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(input, { target: { value: "   " } });
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(input, { target: { value: "  Лесная сказка " } });
    expect(create).toHaveProperty("disabled", false);
    await act(async () => {
      fireEvent.click(create);
    });
    expect(spy).toHaveBeenCalledWith("  Лесная сказка ");
    expect(store.getState().projectName).toBe("Лесная сказка");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not submit a blank name with Enter", async () => {
    const store = createEditorStore(session());
    const spy = vi.spyOn(store, "newProject");
    render(<StartScreen store={store} />);
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("Project name").closest("form")!);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("opens an existing project through the store", async () => {
    const store = createEditorStore(session());
    const spy = vi.spyOn(store, "open");
    render(<StartScreen store={store} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open existing project/ }));
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly empty state, or a way back when a project is open", () => {
    const store = createEditorStore(session());
    const { rerender } = render(<StartScreen store={store} />);
    expect(screen.getByText(/No project open yet/)).toBeTruthy();
    const onBack = vi.fn();
    rerender(<StartScreen store={store} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to my map/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ErrorBanner", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<ErrorBanner message={null} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message as an alert and dismisses it", async () => {
    const store = createEditorStore(session());
    await store.newProject("");
    const view = () => <ErrorBanner message={store.getState().error} onDismiss={store.dismissError} />;
    const { rerender } = render(view());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/name/i);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(store.getState().error).toBeNull();
    rerender(view());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Toolbar", () => {
  const renderBar = (store: EditorStore) =>
    render(<Toolbar store={store} zoom={1.5} zoomControls={null} onNew={() => {}} onOpen={() => {}} />);

  it("undo and redo follow the store", async () => {
    const store = await openStore();
    renderBar(store);
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toHaveProperty("disabled", true);
    expect(redo).toHaveProperty("disabled", true);
    act(() => {
      store.paintStroke([{ layerId: "ground", x: 0, y: 0, tile: 3 }]);
    });
    expect(undo).toHaveProperty("disabled", false);
    expect(redo).toHaveProperty("disabled", true);
    fireEvent.click(undo);
    expect(store.getState().canUndo).toBe(false);
    expect(undo).toHaveProperty("disabled", true);
    expect(redo).toHaveProperty("disabled", false);
    fireEvent.click(redo);
    expect(store.getState().canRedo).toBe(false);
    expect(redo).toHaveProperty("disabled", true);
  });

  it("tool buttons show and change the current tool", async () => {
    const store = await openStore();
    renderBar(store);
    const brush = screen.getByRole("button", { name: "Brush" });
    const eraser = screen.getByRole("button", { name: "Eraser" });
    expect(brush.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(eraser);
    expect(store.getState().tool).toBe("eraser");
    expect(eraser.getAttribute("aria-pressed")).toBe("true");
    expect(brush.getAttribute("aria-pressed")).toBe("false");
  });

  it("every button has a tooltip and the zoom is shown in percent", async () => {
    const store = await openStore();
    renderBar(store);
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("title")).toBeTruthy();
    expect(screen.getByText("150%")).toBeTruthy();
  });

  it("save is disabled without a project", () => {
    renderBar(createEditorStore(session()));
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });
});

describe("Palette", () => {
  it("shows the first 32 tiles and selecting one updates the store", () => {
    const store = createEditorStore(session());
    render(<Palette store={store} />);
    const swatches = screen.getAllByRole("button", { name: /^Tile \d+$/ });
    expect(swatches).toHaveLength(PALETTE_SIZE);
    expect(screen.getByRole("button", { name: "Tile 1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Tile 7" }));
    expect(store.getState().selectedTile).toBe(7);
    expect(screen.getByRole("button", { name: "Tile 7" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Tile 1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("no tile looks selected while the eraser is active", () => {
    const store = createEditorStore(session());
    render(<Palette store={store} />);
    act(() => store.selectTool("eraser"));
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getByText("Eraser")).toBeTruthy();
  });
});

describe("ConfirmDialog", () => {
  it("is an alert dialog with three choices; Escape cancels", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Leave this project?"
        message="Unsaved"
        discardLabel="Don't save"
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Leave this project?" })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Keep editing");
    fireEvent.click(screen.getByRole("button", { name: "Save first" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
