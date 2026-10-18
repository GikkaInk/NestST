import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { EditorStore } from "../editorStore.js";
import { useEditorState } from "../useEditorState.js";
import { IconOpen } from "./icons.js";

interface Props {
  store: EditorStore;
  /** Called after a project was created or opened. */
  onDone?(): void;
  /** Shown when a project is already open: go back to it. */
  onBack?(): void;
}

export function StartScreen({ store, onDone, onBack }: Props) {
  const { busy } = useEditorState(store);
  const [name, setName] = useState("");
  const nameId = useId();
  const hintId = useId();
  const canCreate = name.trim() !== "" && !busy;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    if (await store.newProject(name)) onDone?.();
  };

  const open = async () => {
    if (await store.open()) onDone?.();
  };

  return (
    <main className="start">
      <div className="start__hello">
        <div className="start__logo" aria-hidden="true">
          ✿
        </div>
        <h1 className="start__title">NestST</h1>
        <p className="start__tagline">Make a cozy little story game, one tile at a time.</p>
      </div>
      <div className="start__cards">
        <form className="card start__card" onSubmit={create} aria-labelledby={`${nameId}-title`}>
          <h2 id={`${nameId}-title`} className="card__title">
            Start something new
          </h2>
          <label htmlFor={nameId} className="field-label">
            Project name
          </label>
          <input
            id={nameId}
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My first adventure"
            maxLength={200}
            autoFocus
            aria-describedby={hintId}
          />
          <p id={hintId} className="field-hint">
            Next you will choose an empty folder for it.
          </p>
          <button type="submit" className="button button--primary" disabled={!canCreate}>
            Choose folder &amp; create
          </button>
        </form>
        <section className="card start__card start__card--mint" aria-labelledby={`${nameId}-open`}>
          <h2 id={`${nameId}-open`} className="card__title">
            Continue a project
          </h2>
          <p className="field-hint">Pick the folder that holds your nestst.project.json file.</p>
          <button type="button" className="button" onClick={() => void open()} disabled={busy}>
            <IconOpen />
            Open existing project…
          </button>
        </section>
      </div>
      {onBack ? (
        <button type="button" className="button button--ghost start__back" onClick={onBack}>
          ← Back to my map
        </button>
      ) : (
        <p className="start__empty">No project open yet — create one above, it only takes a moment.</p>
      )}
    </main>
  );
}
