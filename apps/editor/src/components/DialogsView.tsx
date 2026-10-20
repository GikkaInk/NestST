import { useEffect, useState } from "react";
import type { Dialog } from "@nestst/core";
import { canEditMode } from "../editorForms.js";
import type { EditorStore } from "../editorStore.js";
import { useEditorState } from "../useEditorState.js";
import { LABELS } from "../labels.js";
import { DialogGraph } from "./DialogGraph.js";
import { EmptyState } from "./EmptyState.js";
import { NodeInspector } from "./NodeInspector.js";

/** Dialogs in manifest order. */
function listDialogs(dialogs: Record<string, Dialog>, order: ReadonlyArray<{ id: string }>): Dialog[] {
  const seen = new Set<string>();
  const out: Dialog[] = [];
  for (const { id } of order) {
    const d = Object.hasOwn(dialogs, id) ? dialogs[id] : undefined;
    if (d && !seen.has(id)) {
      seen.add(id);
      out.push(d);
    }
  }
  for (const d of Object.values(dialogs)) if (!seen.has(d.id)) out.push(d);
  return out;
}

function RenameField({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [text, setText] = useState(initial);
  return (
    <input
      type="text"
      className="field"
      aria-label="Dialog name"
      autoFocus
      value={text}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(text);
        } else if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

/** The Dialogs tab: list of dialogs on the left, node editor and node properties on the right. */
export function DialogsView({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const project = s.project;
  const active = project && s.activeDialogId !== null && Object.hasOwn(project.dialogs, s.activeDialogId)
    ? project.dialogs[s.activeDialogId]
    : undefined;

  // A node selection belongs to one dialog and disappears with its node.
  const activeId = active?.id ?? null;
  useEffect(() => setSelectedNode(null), [activeId]);
  const nodeId = active && selectedNode !== null && active.nodes.some((n) => n.id === selectedNode) ? selectedNode : null;

  if (!project) return null;
  const disabled = !canEditMode(s.mode);
  const dialogs = listDialogs(project.dialogs, project.manifest.dialogs);

  const create = () => {
    if (newName.trim() === "") return;
    if (store.newDialog(newName) !== null) setNewName("");
  };
  const finishRename = (d: Dialog, name: string | null) => {
    setRenaming(null);
    if (name === null || name === d.name) return;
    store.saveDialog({ ...d, name: name.trim() });
  };

  return (
    <div className="dialogs-layout">
      <section className="card dialogs-list" aria-label="Dialogs">
        <h2 className="panel-title">Dialogs</h2>
        <form
          className="dialogs-list__new"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            type="text"
            className="field"
            aria-label="New dialog name"
            placeholder="New dialog name"
            value={newName}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="button button--small" disabled={disabled || newName.trim() === ""}>
            Create dialog
          </button>
        </form>
        <ul className="dialogs-list__items">
          {dialogs.map((d) => (
            <li key={d.id} className={d.id === activeId ? "dialog-row dialog-row--active" : "dialog-row"}>
              {renaming === d.id ? (
                <RenameField initial={d.name} onDone={(name) => finishRename(d, name)} />
              ) : (
                <>
                  <button
                    type="button"
                    className="dialog-row__name"
                    aria-pressed={d.id === activeId}
                    onClick={() => store.selectDialog(d.id)}
                  >
                    {d.name}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rename ${d.name}`}
                    title="Rename"
                    disabled={disabled}
                    onClick={() => setRenaming(d.id)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete ${d.name}`}
                    title="Delete"
                    disabled={disabled}
                    onClick={() => store.deleteDialog(d.id)}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {active ? (
        <>
          <DialogGraph
            key={active.id}
            dialog={active}
            variables={project.manifest.variables}
            selectedId={nodeId}
            disabled={disabled}
            onChange={(d) => store.saveDialog(d)}
            onSelect={setSelectedNode}
          />
          <NodeInspector store={store} dialog={active} nodeId={nodeId} />
        </>
      ) : (
        <section className="card dialogs-empty" aria-label="No dialog selected">
          {dialogs.length === 0 ? (
            <EmptyState
              title={LABELS.noDialogsTitle}
              text={LABELS.noDialogsText}
              actionLabel={LABELS.createFirstDialog}
              disabled={disabled}
              onAction={() => store.newDialog(LABELS.firstDialogName)}
            />
          ) : (
            <>
              <h2 className="panel-title">Pick a dialog</h2>
              <p className="hint">Choose a dialog from the list on the left, or create a new one.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
