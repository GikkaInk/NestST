import { useEffect, useState } from "react";
import { MAX_CHOICE_OPTIONS, MAX_OPTION_TEXT, MAX_SAY_TEXT, MAX_SPEAKER } from "@nestst/core";
import type { Dialog, DialogNode, VariableDef } from "@nestst/core";
import { canEditMode } from "../editorForms.js";
import type { EditorStore } from "../editorStore.js";
import { addOption, removeNode, removeOption, setStart } from "../dialogGraph.js";
import { useEditorState } from "../useEditorState.js";
import { ConditionEditor } from "./ConditionEditor.js";
import { CommitField, Labeled, SelectField, ValueField } from "./fields.js";

type Node<T extends DialogNode["type"]> = Extract<DialogNode, { type: T }>;

const TITLES = { say: "Say", choice: "Choice", set: "Set variable", branch: "Branch" } as const;

/** A multi-line text field that keeps a draft and commits on blur (Escape drops the draft). */
function CommitTextArea(props: {
  label: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  onCommit(text: string): void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <textarea
      className="field field--area"
      aria-label={props.label}
      rows={4}
      value={draft}
      maxLength={props.maxLength}
      disabled={props.disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === props.value) return;
        props.onCommit(draft);
        setDraft(props.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setDraft(props.value);
      }}
    />
  );
}

function defaultsFor(v: VariableDef): { op: "set" | "add"; value: boolean | number } {
  return v.type === "flag" ? { op: "set", value: true } : { op: "add", value: 1 };
}

/** Properties of the selected dialog node (right panel of the Dialogs tab). Every committed change is one saveDialog. */
export function NodeInspector({ store, dialog, nodeId }: { store: EditorStore; dialog: Dialog; nodeId: string | null }) {
  const s = useEditorState(store);
  const node = nodeId === null ? undefined : dialog.nodes.find((n) => n.id === nodeId);
  if (!node || !s.project) {
    return (
      <aside className="inspector card" aria-label="Node properties">
        <h2 className="panel-title">Node</h2>
        <p className="hint">Select a node on the graph to edit it.</p>
      </aside>
    );
  }
  const disabled = !canEditMode(s.mode);
  const variables = s.project.manifest.variables;
  const save = (next: DialogNode) =>
    store.saveDialog({ ...dialog, nodes: dialog.nodes.map((n) => (n.id === next.id ? next : n)) });
  const noVariables = (node.type === "set" || node.type === "branch") && variables.length === 0;

  return (
    <aside className="inspector card" aria-label="Node properties" key={node.id}>
      <h2 className="panel-title">{TITLES[node.type]}</h2>
      {noVariables && <p className="hint">Create a variable first</p>}
      {node.type === "say" && <SayFields node={node} disabled={disabled} save={save} store={store} />}
      {node.type === "choice" && (
        <ChoiceFields
          node={node}
          dialog={dialog}
          variables={variables}
          disabled={disabled}
          save={save}
          store={store}
        />
      )}
      {node.type === "set" && (
        <SetFields node={node} variables={variables} disabled={disabled || noVariables} save={save} store={store} />
      )}
      {node.type === "branch" && (
        <div className="editor-block">
          <ConditionEditor
            condition={node.condition}
            variables={variables}
            disabled={disabled || noVariables}
            required
            onChange={(condition) => condition && save({ ...node, condition })}
            onInvalid={store.reportError}
          />
          <p className="hint">Connect the then and else handles on the graph.</p>
        </div>
      )}
      <button
        type="button"
        className="button"
        disabled={disabled || dialog.start === node.id}
        onClick={() => store.saveDialog({ ...setStart(dialog, node.id) })}
      >
        Set as start
      </button>
      <button
        type="button"
        className="button button--danger"
        disabled={disabled}
        onClick={() => store.saveDialog(removeNode(dialog, node.id))}
      >
        Delete node
      </button>
    </aside>
  );
}

function SayFields(props: {
  node: Node<"say">;
  disabled: boolean;
  save(n: DialogNode): void;
  store: EditorStore;
}) {
  const { node, disabled, save, store } = props;
  return (
    <>
      <Labeled label="Speaker">
        <CommitField
          label="Speaker"
          value={node.speaker}
          maxLength={MAX_SPEAKER}
          disabled={disabled}
          onCommit={(speaker) => save({ ...node, speaker })}
        />
      </Labeled>
      <Labeled label="Text">
        <CommitTextArea
          label="Text"
          value={node.text}
          maxLength={MAX_SAY_TEXT}
          disabled={disabled}
          onCommit={(text) => (text.trim() === "" ? store.reportError("The text of a line cannot be empty.") : save({ ...node, text }))}
        />
      </Labeled>
      <p className="hint">Connect the next line by dragging from the right handle.</p>
    </>
  );
}

function ChoiceFields(props: {
  node: Node<"choice">;
  dialog: Dialog;
  variables: readonly VariableDef[];
  disabled: boolean;
  save(n: DialogNode): void;
  store: EditorStore;
}) {
  const { node, dialog, variables, disabled, save, store } = props;
  return (
    <>
      <ul className="action-list">
        {node.options.map((o, i) => (
          <li className="action-item" key={i}>
            <div className="action-item__head">
              <span>Option {i + 1}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove option ${i + 1}`}
                title="Remove option"
                disabled={disabled || node.options.length <= 1}
                onClick={() => store.saveDialog(removeOption(dialog, node.id, i))}
              >
                ✕
              </button>
            </div>
            <CommitField
              label={`Option ${i + 1} text`}
              value={o.text}
              maxLength={MAX_OPTION_TEXT}
              disabled={disabled}
              onCommit={(text) =>
                text.trim() === ""
                  ? store.reportError("The text of an option cannot be empty.")
                  : save({ ...node, options: node.options.map((x, j) => (j === i ? { ...x, text } : x)) })
              }
            />
            <div role="group" aria-label={`Option ${i + 1} condition`}>
              <ConditionEditor
                condition={o.condition}
                variables={variables}
                disabled={disabled}
                onInvalid={store.reportError}
                onChange={(condition) =>
                  save({
                    ...node,
                    options: node.options.map((x, j) => {
                      if (j !== i) return x;
                      const { condition: _old, ...rest } = x;
                      return condition ? { ...rest, condition } : rest;
                    }),
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button--small"
        disabled={disabled || node.options.length >= MAX_CHOICE_OPTIONS}
        onClick={() => store.saveDialog(addOption(dialog, node.id))}
      >
        Add option
      </button>
      <p className="hint">Connect each option by dragging from its own handle.</p>
    </>
  );
}

function SetFields(props: {
  node: Node<"set">;
  variables: readonly VariableDef[];
  disabled: boolean;
  save(n: DialogNode): void;
  store: EditorStore;
}) {
  const { node, variables, disabled, save, store } = props;
  const variable = variables.find((v) => v.id === node.variable);
  const type = variable?.type ?? (typeof node.value === "boolean" ? "flag" : "number");
  return (
    <div className="form-grid">
      <Labeled label="Variable">
        <SelectField
          label="Set variable"
          value={node.variable}
          disabled={disabled}
          options={variables.map((v) => ({ value: v.id, label: v.name }))}
          onChange={(id) => {
            const v = variables.find((x) => x.id === id);
            if (v) save({ ...node, variable: id, ...(v.type === variable?.type ? {} : defaultsFor(v)) });
          }}
        />
      </Labeled>
      <Labeled label="Operation">
        <SelectField
          label="Set operation"
          value={node.op}
          disabled={disabled}
          options={
            type === "number"
              ? [{ value: "set", label: "Set to" }, { value: "add", label: "Add" }]
              : [{ value: "set", label: "Set to" }]
          }
          onChange={(op) => save({ ...node, op: op as "set" | "add" })}
        />
      </Labeled>
      <Labeled label="Value">
        <ValueField
          label="Set value"
          type={type}
          value={node.value}
          disabled={disabled}
          onInvalid={store.reportError}
          onCommit={(value) => save({ ...node, value })}
        />
      </Labeled>
      <p className="hint">Connect the next line by dragging from the right handle.</p>
    </div>
  );
}
