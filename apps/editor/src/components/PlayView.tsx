import { useEffect, useRef } from "react";
import { createGame } from "@nestst/runtime";
import type { Game } from "@nestst/runtime";
import type { EditorStore } from "../editorStore.js";

/** The game window. Replaces the map editor while playing; Esc stops. */
export function PlayView({ store }: { store: EditorStore }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const { project, playingMapId } = store.getState();
    if (host === null || project === null || playingMapId === null) {
      store.stopPlay();
      return;
    }
    let cancelled = false;
    let game: Game | null = null;
    createGame({ project, mapId: playingMapId, host }).then(
      (g) => {
        // Unmounted while Pixi was starting: it can only be destroyed now.
        if (cancelled) g.destroy();
        else game = g;
      },
      (e: unknown) => {
        if (cancelled) return;
        const reason = e instanceof Error && e.message ? e.message : String(e);
        const text = reason.charAt(0).toUpperCase() + reason.slice(1);
        store.reportError(`Could not start the game. ${/[.!?]$/.test(text) ? text : `${text}.`}`);
        store.stopPlay();
      },
    );
    return () => {
      cancelled = true;
      game?.destroy();
      game = null;
    };
  }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A confirm dialog open over the game handles its own Esc (and marks it handled).
      if (e.code !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      store.stopPlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  return (
    <section className="stage card play" aria-label="Game">
      <div ref={hostRef} className="play__host" />
      <div className="stage__hud">
        <span className="hud-pill hud-pill--hint">Arrow keys or WASD to walk · Esc to stop</span>
      </div>
    </section>
  );
}
