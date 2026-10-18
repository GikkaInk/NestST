import { useSyncExternalStore } from "react";
import type { EditorState, EditorStore } from "./editorStore.js";

/** Current store state; the component re-renders on every change. */
export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
