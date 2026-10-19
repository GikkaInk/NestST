import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { checkNumber } from "../editorForms.js";

/**
 * A text field that keeps a local draft and commits it on blur or Enter, not on
 * every keystroke. Escape drops the draft. If the commit is refused, the draft
 * goes back to the stored value.
 */
export function CommitField(props: {
  label: string;
  value: string;
  onCommit(text: string): void;
  disabled?: boolean;
  maxLength?: number;
  numeric?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft === props.value) return;
    props.onCommit(draft);
    setDraft(props.value); // follows the stored value again once the store accepted the change
  };
  return (
    <input
      type="text"
      className={props.className ?? "field"}
      aria-label={props.label}
      value={draft}
      disabled={props.disabled}
      maxLength={props.maxLength}
      inputMode={props.numeric ? "numeric" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(props.value);
        }
      }}
    />
  );
}

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-row">
      <span className="form-row__label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const known = props.options.some((o) => o.value === props.value);
  return (
    <select
      className="field"
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {!known && <option value={props.value}>{props.value === "" ? "None" : props.value}</option>}
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckField(props: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <label className="check-field">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** A flag value (checkbox) or a number value (committed on blur/Enter). */
export function ValueField(props: {
  label: string;
  type: "flag" | "number";
  value: boolean | number;
  onCommit(value: boolean | number): void;
  onInvalid(message: string): void;
  disabled?: boolean;
}) {
  if (props.type === "flag") {
    return (
      <CheckField
        label={props.label}
        checked={props.value === true}
        disabled={props.disabled}
        onChange={props.onCommit}
      />
    );
  }
  return (
    <CommitField
      label={props.label}
      numeric
      className="field field--number"
      value={String(props.value)}
      disabled={props.disabled}
      onCommit={(text) => {
        const r = checkNumber(text);
        if (r.ok) props.onCommit(r.value);
        else props.onInvalid(r.message);
      }}
    />
  );
}
