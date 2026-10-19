// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryStorage } from "@nestst/core/testing";
import { createEditorStore } from "../editorStore.js";
import type { EditorStore, ProjectSession } from "../editorStore.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorBanner } from "./ErrorBanner.js";
import { NoticeBanner } from "./NoticeBanner.js";
import { App } from "../App.js";
import { PALETTE_SIZE, Palette } from "./Palette.js";
import { StartScreen } from "./StartScreen.js";
import { Toolbar } from "./Toolbar.js";

vi.mock("./MapEditor.js", () => ({ MapEditor: () => null }));

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

describe("NoticeBanner", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<NoticeBanner message={null} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message as a status (not an alert) and dismisses it", () => {
    const onDismiss = vi.fn();
    render(<NoticeBanner message="Updated to the new format" onDismiss={onDismiss} />);
    expect(screen.getByRole("status").textContent).toMatch(/Updated to the new format/);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("App: Save first", () => {
  /** Storage whose writes wait until `release()` is called. */
  function gatedStorage() {
    const inner = new MemoryStorage();
    let hold = false;
    let release: () => void = () => {};
    return {
      storage: {
        read: (p: string) => inner.read(p),
        exists: (p: string) => inner.exists(p),
        async writeAtomic(p: string, d: string) {
          if (hold) await new Promise<void>((r) => (release = r));
          await inner.writeAtomic(p, d);
        },
      },
      holdNext: () => {
        hold = true;
      },
      release: () => {
        hold = false;
        release();
      },
    };
  }

  async function dirtyApp(gate: ReturnType<typeof gatedStorage>) {
    const store = createEditorStore(session(gate.storage as unknown as MemoryStorage));
    await store.newProject("Test");
    store.paintStroke([{ layerId: "ground", x: 0, y: 0, tile: 1 }]);
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    return store;
  }

  it("leaves after a clean save", async () => {
    const gate = gatedStorage();
    const store = await dirtyApp(gate);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save first" }));
    });
    expect(store.getState().dirty).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose folder & create" })).toBeTruthy();
  });

  it("asks again, and does not leave, when strokes were made during the save", async () => {
    const gate = gatedStorage();
    const store = await dirtyApp(gate);
    gate.holdNext();
    fireEvent.click(screen.getByRole("button", { name: "Save first" }));
    act(() => {
      expect(store.paintStroke([{ layerId: "ground", x: 1, y: 0, tile: 1 }])).toBe(true);
    });
    await act(async () => {
      gate.release();
    });
    expect(store.getState().dirty).toBe(true);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose folder & create" })).toBeNull();
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

  it("Spawn and NPC buttons select their tool", async () => {
    const store = await openStore();
    renderBar(store);
    fireEvent.click(screen.getByRole("button", { name: "Spawn" }));
    expect(store.getState().tool).toBe("spawn");
    expect(screen.getByRole("button", { name: "Spawn" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Brush" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "NPC" }));
    expect(store.getState().tool).toBe("npc");
    expect(screen.getByRole("button", { name: "NPC" }).getAttribute("aria-pressed")).toBe("true");
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

describe("Palette: walls", () => {
  it("the checkbox reflects and toggles solidTiles through the store", async () => {
    const store = await openStore();
    render(<Palette store={store} />);
    act(() => store.selectTile(5));
    const box = screen.getByRole("checkbox", { name: "Blocks walking" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(store.getState().project!.manifest.solidTiles).toContain(5);
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(store.getState().project!.manifest.solidTiles).not.toContain(5);
  });

  it("solid swatches get a hatch marker", async () => {
    const store = await openStore();
    render(<Palette store={store} />);
    act(() => store.selectTile(5));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blocks walking" }));
    expect(screen.getByRole("button", { name: "Tile 5" }).hasAttribute("data-solid")).toBe(true);
    expect(screen.getByRole("button", { name: "Tile 6" }).hasAttribute("data-solid")).toBe(false);
  });

  it("the Show walls switch calls toggleShowSolid", async () => {
    const store = await openStore();
    const spy = vi.spyOn(store, "toggleShowSolid");
    render(<Palette store={store} />);
    const sw = screen.getByRole("switch", { name: "Show walls" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.getState().showSolid).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });
});

describe("App: tool keys", () => {
  it("P selects spawn and N selects NPC", async () => {
    const store = await openStore();
    render(<App store={store} />);
    fireEvent.keyDown(window, { code: "KeyP" });
    expect(store.getState().tool).toBe("spawn");
    fireEvent.keyDown(window, { code: "KeyN" });
    expect(store.getState().tool).toBe("npc");
    fireEvent.keyDown(window, { code: "KeyB" });
    expect(store.getState().tool).toBe("brush");
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

describe("ConfirmDialog focus", () => {
  it("re-rendering with new callbacks does not move focus back to Keep editing", () => {
    const props = { title: "T", message: "M", discardLabel: "Don't save", onSave: () => {}, onDiscard: () => {} };
    const { rerender } = render(<ConfirmDialog {...props} onCancel={() => {}} />);
    const save = screen.getByRole("button", { name: "Save first" });
    save.focus();
    expect(document.activeElement).toBe(save);
    const onCancel = vi.fn();
    rerender(<ConfirmDialog {...props} onCancel={onCancel} />);
    expect(document.activeElement).toBe(save);
    // The latest onCancel is the one Escape calls.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

