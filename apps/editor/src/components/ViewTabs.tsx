import type { EditorStore, EditorView } from "../editorStore.js";
import { canEditMode } from "../editorForms.js";
import { useEditorState } from "../useEditorState.js";

const TABS: Array<{ id: EditorView; label: string }> = [
  { id: "map", label: "Map" },
  { id: "dialogs", label: "Dialogs" },
  { id: "variables", label: "Variables" },
];

/** Map | Dialogs | Variables under the top bar. Switching only changes the view, never the history. */
export function ViewTabs({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  const disabled = !canEditMode(s.mode);
  return (
    <div className="view-tabs" role="tablist" aria-label="Editor views">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="view-tab"
          aria-selected={s.view === t.id}
          disabled={disabled}
          onClick={() => store.setView(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
