import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorStore } from "./editorStore.js";
import { closeWindow, onCloseRequested, setWindowTitle } from "./appWindow.js";
import { useEditorState } from "./useEditorState.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { MapEditor } from "./components/MapEditor.js";
import { Palette } from "./components/Palette.js";
import { StartScreen } from "./components/StartScreen.js";
import { Toolbar } from "./components/Toolbar.js";
import type { ZoomControls } from "./components/Toolbar.js";

type Leave = "new" | "open" | "close";

/** Keys typed into these belong to the field, not to editor shortcuts. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function App({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  const [showStart, setShowStart] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [controls, setControls] = useState<ZoomControls | null>(null);
  const [pending, setPending] = useState<Leave | null>(null);
  const editing = s.project !== null && !showStart;

  const proceed = useCallback(
    (kind: Leave) => {
      if (kind === "new") setShowStart(true);
      else if (kind === "open") void store.open().then((ok) => ok && setShowStart(false));
      else closeWindow();
    },
    [store],
  );

  const request = useCallback(
    (kind: Leave) => {
      if (store.getState().dirty) setPending(kind);
      else proceed(kind);
    },
    [store, proceed],
  );

  // Title: "• Name — NestST" while there are unsaved changes.
  useEffect(() => {
    const base = s.project ? `${s.projectName} — NestST` : "NestST";
    setWindowTitle(s.dirty ? `• ${base}` : base);
  }, [s.project, s.projectName, s.dirty]);

  // Closing the window with unsaved work asks first.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () =>
      onCloseRequested(() => {
        if (!store.getState().dirty) return false;
        if (pendingRef.current === null) setPending("close");
        return true;
      }),
    [store],
  );

  // Keyboard shortcuts. `code` (not `key`) so they work with any keyboard layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingRef.current !== null || !editing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.altKey) {
        if (isTextField(e.target)) return;
        if (e.code === "KeyS") void store.save();
        else if (e.code === "KeyZ" && e.shiftKey) store.redo();
        else if (e.code === "KeyZ") store.undo();
        else if (e.code === "KeyY") store.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey || isTextField(e.target)) return;
      if (e.code === "KeyB") store.selectTool("brush");
      else if (e.code === "KeyE") store.selectTool("eraser");
      else if (e.code === "Equal" || e.code === "NumpadAdd") controls?.zoomIn();
      else if (e.code === "Minus" || e.code === "NumpadSubtract") controls?.zoomOut();
      else if (e.code === "Digit0" || e.code === "Numpad0") controls?.fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, editing, controls]);

  const map = s.project && s.currentMapId ? s.project.maps[s.currentMapId] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ✿
          </span>
          <span className="brand__name">NestST</span>
          {s.project && (
            <>
              <span className="brand__project" title={s.rootLabel}>
                {s.projectName}
              </span>
              <span className={s.dirty ? "save-state save-state--dirty" : "save-state"} role="status">
                {s.dirty ? "• Unsaved changes" : "All changes saved"}
              </span>
            </>
          )}
        </div>
        {editing && (
          <Toolbar
            store={store}
            zoom={zoom}
            zoomControls={controls}
            onNew={() => request("new")}
            onOpen={() => request("open")}
          />
        )}
      </header>

      <ErrorBanner message={s.error} onDismiss={store.dismissError} />

      {editing ? (
        <main className="workspace">
          <Palette store={store} />
          <MapEditor store={store} onZoomChange={setZoom} onControls={setControls} />
        </main>
      ) : (
        <StartScreen
          store={store}
          onDone={() => setShowStart(false)}
          onBack={s.project ? () => setShowStart(false) : undefined}
        />
      )}

      {editing && map && (
        <footer className="statusbar">
          <span className="statusbar__folder" title={s.rootLabel}>Folder: {s.rootLabel}</span>
          <span>
            Map “{map.name}” · {map.width} × {map.height} tiles
          </span>
        </footer>
      )}

      {pending && (
        <ConfirmDialog
          title={pending === "close" ? "Close NestST?" : "Leave this project?"}
          message={`“${s.projectName}” has changes that are not saved yet. If you go on without saving, they will be lost.`}
          discardLabel={pending === "close" ? "Close without saving" : "Don't save"}
          onCancel={() => setPending(null)}
          onDiscard={() => {
            setPending(null);
            proceed(pending);
          }}
          onSave={() => {
            const kind = pending;
            setPending(null);
            void store.save().then((ok) => ok && proceed(kind));
          }}
        />
      )}
    </div>
  );
}
