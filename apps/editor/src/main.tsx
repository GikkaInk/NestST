// Pixi compiles shaders with `new Function` unless this polyfill is loaded;
// the editor's CSP has no 'unsafe-eval', so it must come first.
import "pixi.js/unsafe-eval";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { App } from "./App.js";
import { createEditorStore } from "./editorStore.js";
import { createTauriSession } from "./tauriStorage.js";

const store = createEditorStore(createTauriSession(invoke));
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
}
