import { MAX_VARIABLES } from "@nestst/core";
import type { VariableDef } from "@nestst/core";
import { canEditMode, newVariableId, variableRows } from "../editorForms.js";
import type { EditorStore } from "../editorStore.js";
import { useEditorState } from "../useEditorState.js";
import { LABELS } from "../labels.js";
import { EmptyState } from "./EmptyState.js";
import { CommitField, SelectField, ValueField } from "./fields.js";

/** The Variables tab: a table of the project's flags and numbers. */
export function VariablesView({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  if (!s.project) return null;
  const vars = s.project.manifest.variables;
  const rows = variableRows(s.project);
  const disabled = !canEditMode(s.mode);
  const save = (next: VariableDef[]) => store.setVariables(next);
  const addVariable = () => {
    const id = newVariableId(rows);
    save([...vars, { id, name: `Variable ${id.slice("var-".length)}`, type: "flag", initial: false }]);
  };
  const change = (i: number, patch: Partial<VariableDef>) =>
    save(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <section className="variables card" aria-label="Variables">
      <div className="variables__head">
        <h2 className="panel-title">Variables</h2>
        <button
          type="button"
          className="button button--small"
          disabled={disabled || rows.length >= MAX_VARIABLES}
          onClick={addVariable}
        >
          Add variable
        </button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={LABELS.noVariablesTitle}
          text={LABELS.noVariablesText}
          actionLabel={LABELS.createFirstVariable}
          disabled={disabled}
          onAction={addVariable}
        />
      ) : (
        <table className="var-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Initial value</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <CommitField
                    label={`Name of ${r.id}`}
                    value={r.name}
                    maxLength={60}
                    disabled={disabled}
                    onCommit={(name) => change(i, { name })}
                  />
                </td>
                <td>
                  <SelectField
                    label={`Type of ${r.id}`}
                    value={r.type}
                    disabled={disabled}
                    options={[
                      { value: "flag", label: "Flag" },
                      { value: "number", label: "Number" },
                    ]}
                    onChange={(type) =>
                      change(i, type === "flag" ? { type: "flag", initial: false } : { type: "number", initial: 0 })
                    }
                  />
                </td>
                <td>
                  <ValueField
                    label={`Initial value of ${r.id}`}
                    type={r.type}
                    value={r.initial}
                    disabled={disabled}
                    onInvalid={store.reportError}
                    onCommit={(initial) => change(i, { initial })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete ${r.id}`}
                    title="Delete"
                    disabled={disabled}
                    onClick={() => save(vars.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
