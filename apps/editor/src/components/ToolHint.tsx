import type { EditorStore } from "../editorStore.js";
import { TOOL_HINTS } from "../labels.js";
import { useEditorState } from "../useEditorState.js";

/** One-line explanation of the selected tool, shown above the map. */
export function ToolHint({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  if (s.project === null) return null;
  return (
    <p className="tool-hint">
      {TOOL_HINTS[s.tool]}
    </p>
  );
}
