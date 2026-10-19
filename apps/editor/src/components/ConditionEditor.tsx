import type { Condition, VariableDef } from "@nestst/core";
import { operatorsFor } from "../editorForms.js";
import { CheckField, Labeled, SelectField, ValueField } from "./fields.js";

interface Props {
  condition: Condition | undefined;
  variables: readonly VariableDef[];
  disabled: boolean;
  onChange(condition: Condition | undefined): void;
  onInvalid(message: string): void;
}

function defaultValue(v: VariableDef): boolean | number {
  return v.type === "flag" ? true : 0;
}

/** "Has condition" checkbox plus variable / operator / value fields. */
export function ConditionEditor({ condition, variables, disabled, onChange, onInvalid }: Props) {
  const variable = condition ? variables.find((v) => v.id === condition.variable) : undefined;
  const first = variables[0];
  return (
    <div className="editor-block" role="group" aria-label="Condition">
      <CheckField
        label="Has condition"
        checked={condition !== undefined}
        disabled={disabled || (condition === undefined && first === undefined)}
        onChange={(on) =>
          onChange(on && first ? { variable: first.id, op: "==", value: defaultValue(first) } : undefined)
        }
      />
      {condition === undefined && first === undefined && (
        <p className="hint">Add a variable on the Variables tab first.</p>
      )}
      {condition && (
        <div className="form-grid">
          <Labeled label="Variable">
            <SelectField
              label="Condition variable"
              value={condition.variable}
              disabled={disabled}
              options={variables.map((v) => ({ value: v.id, label: v.name }))}
              onChange={(id) => {
                const next = variables.find((v) => v.id === id);
                if (!next) return;
                // A different type needs a matching operator and value.
                onChange(next.type === variable?.type ? { ...condition, variable: id } : { variable: id, op: "==", value: defaultValue(next) });
              }}
            />
          </Labeled>
          <Labeled label="Operator">
            <SelectField
              label="Condition operator"
              value={condition.op}
              disabled={disabled}
              options={operatorsFor(variable?.type ?? "number").map((op) => ({ value: op, label: op }))}
              onChange={(op) => onChange({ ...condition, op: op as Condition["op"] })}
            />
          </Labeled>
          <Labeled label="Value">
            <ValueField
              label="Condition value"
              type={variable?.type ?? "number"}
              value={condition.value}
              disabled={disabled}
              onInvalid={onInvalid}
              onCommit={(value) => onChange({ ...condition, value })}
            />
          </Labeled>
        </div>
      )}
    </div>
  );
}
