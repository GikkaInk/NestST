import { builtinTileColor } from "@nestst/runtime";
import type { EditorStore } from "../editorStore.js";
import { useEditorState } from "../useEditorState.js";

/** The palette shows the first 32 built-in tiles (ids 1..32). */
export const PALETTE_SIZE = 32;

export function tileCss(id: number): string {
  const [r, g, b] = builtinTileColor(id);
  return `rgb(${r} ${g} ${b})`;
}

export function Palette({ store }: { store: EditorStore }) {
  const { selectedTile, tool } = useEditorState(store);
  const ids = Array.from({ length: PALETTE_SIZE }, (_, i) => i + 1);
  return (
    <aside className="palette card" aria-label="Tile palette">
      <h2 className="panel-title">Tiles</h2>
      <div className="palette__current">
        <span
          className="swatch swatch--big"
          style={{ background: tool === "eraser" ? undefined : tileCss(selectedTile) }}
          data-empty={tool === "eraser" || undefined}
          aria-hidden="true"
        />
        <span>{tool === "eraser" ? "Eraser" : `Tile ${selectedTile}`}</span>
      </div>
      <div className="palette__grid" role="group" aria-label="Choose a tile">
        {ids.map((id) => {
          const selected = tool === "brush" && id === selectedTile;
          return (
            <button
              key={id}
              type="button"
              className="swatch"
              style={{ background: tileCss(id) }}
              aria-label={`Tile ${id}`}
              title={`Tile ${id}`}
              aria-pressed={selected}
              onClick={() => store.selectTile(id)}
            />
          );
        })}
      </div>
    </aside>
  );
}
