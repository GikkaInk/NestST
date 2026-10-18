import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../editorStore.js";
import { mountMapCanvas } from "../mapCanvas.js";
import type { ZoomControls } from "./Toolbar.js";

const ZOOM_STEP = 1.25;

interface Props {
  store: EditorStore;
  onZoomChange(scale: number): void;
  /** Receives the zoom buttons' actions once the view is running, and null when it goes away. */
  onControls(controls: ZoomControls | null): void;
}

/** The map in the middle of the window. All Pixi work happens in mapCanvas.ts. */
export function MapEditor({ store, onZoomChange, onControls }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLSpanElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [mode, setMode] = useState<"paint" | "pan" | "grab">("paint");
  // Callbacks may change identity between renders; the canvas reads the latest ones.
  const callbacks = useRef({ onZoomChange, onControls });
  callbacks.current = { onZoomChange, onControls };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const canvas = mountMapCanvas(host, store, {
      onZoom: (s) => callbacks.current.onZoomChange(s),
      onHover: (cell) => {
        if (cellRef.current) cellRef.current.textContent = cell ? `x ${cell.x}, y ${cell.y}` : "";
      },
      onError: setFailure,
      onMode: setMode,
    });
    callbacks.current.onControls({
      zoomIn: () => canvas.zoomBy(ZOOM_STEP),
      zoomOut: () => canvas.zoomBy(1 / ZOOM_STEP),
      fit: () => canvas.fit(),
    });
    return () => {
      callbacks.current.onControls(null);
      canvas.destroy();
    };
  }, [store]);

  return (
    <section className="stage card" aria-label="Map">
      <div
        ref={hostRef}
        className="stage__canvas"
        data-mode={mode}
        tabIndex={0}
        role="application"
        aria-label="Map canvas. Left mouse button paints, middle mouse button or Space plus drag moves the view, the mouse wheel zooms."
      />
      {failure && (
        <div className="stage__failure" role="alert">
          <p className="stage__failure-face" aria-hidden="true">
            (；ω；)
          </p>
          <p>{failure}</p>
        </div>
      )}
      <div className="stage__hud" aria-hidden="true">
        <span className="hud-pill hud-pill--hint">
          Left-drag paints · Middle-drag or Space+drag moves · Wheel zooms
        </span>
        <span ref={cellRef} className="hud-pill hud-pill--cell" />
      </div>
    </section>
  );
}
