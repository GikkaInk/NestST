import { MAX_EVENT_ACTIONS } from "@nestst/core";
import type { EventAction, Project } from "@nestst/core";
import { checkNumber, checkTeleport, defaultAction } from "../editorForms.js";
import { LABELS } from "../labels.js";
import { CommitField, Labeled, SelectField, ValueField } from "./fields.js";

interface Props {
  actions: readonly EventAction[];
  project: Project;
  mapId: string;
  disabled: boolean;
  onChange(actions: EventAction[]): void;
  onInvalid(message: string): void;
}

const KINDS: Array<{ kind: EventAction["type"]; label: string; missing: string }> = [
  { kind: "dialog", label: "Add dialog", missing: "Create a dialog first" },
  { kind: "set", label: "Add set", missing: "Add a variable first" },
  { kind: "teleport", label: "Add teleport", missing: "" },
];

/** Ordered actions of an event: add, edit, remove (at least one stays), move up and down. */
export function ActionListEditor({ actions, project, mapId, disabled, onChange, onInvalid }: Props) {
  const replace = (i: number, a: EventAction) => onChange(actions.map((x, j) => (j === i ? a : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...actions];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const full = actions.length >= MAX_EVENT_ACTIONS;
  const dialogOptions = project.manifest.dialogs.map((d) => ({ value: d.id, label: project.dialogs[d.id]?.name ?? d.name }));
  const varOptions = project.manifest.variables.map((v) => ({ value: v.id, label: v.name }));
  const mapOptions = Object.values(project.maps).map((m) => ({ value: m.id, label: m.name }));

  const renderAction = (a: EventAction, i: number) => {
    const n = i + 1;
    if (a.type === "dialog") {
      return (
        <Labeled label="Dialog">
          <SelectField
            label={`Action ${n} dialog`}
            value={a.dialog}
            disabled={disabled}
            options={dialogOptions}
            onChange={(dialog) => replace(i, { type: "dialog", dialog })}
          />
        </Labeled>
      );
    }
    if (a.type === "set") {
      const v = project.manifest.variables.find((x) => x.id === a.variable);
      const type = v?.type ?? (typeof a.value === "boolean" ? "flag" : "number");
      return (
        <div className="form-grid">
          <Labeled label="Variable">
            <SelectField
              label={`Action ${n} variable`}
              value={a.variable}
              disabled={disabled}
              options={varOptions}
              onChange={(id) => {
                const next = project.manifest.variables.find((x) => x.id === id);
                if (!next) return;
                replace(
                  i,
                  next.type === type
                    ? { ...a, variable: id }
                    : { type: "set", variable: id, op: "set", value: next.type === "flag" ? true : 0 },
                );
              }}
            />
          </Labeled>
          <Labeled label="Operation">
            <SelectField
              label={`Action ${n} operation`}
              value={a.op}
              disabled={disabled}
              options={type === "number" ? [{ value: "set", label: "set" }, { value: "add", label: "add" }] : [{ value: "set", label: "set" }]}
              onChange={(op) => replace(i, { ...a, op: op as "set" | "add" })}
            />
          </Labeled>
          <Labeled label="Value">
            <ValueField
              label={`Action ${n} value`}
              type={type}
              value={a.value}
              disabled={disabled}
              onInvalid={onInvalid}
              onCommit={(value) => replace(i, { ...a, value })}
            />
          </Labeled>
        </div>
      );
    }
    const commitCoord = (axis: "x" | "y", text: string) => {
      const num = checkNumber(text);
      if (!num.ok) return onInvalid(num.message);
      const next = { ...a, [axis]: num.value };
      const ok = checkTeleport(project, a.map, next.x, next.y);
      if (!ok.ok) return onInvalid(ok.message);
      replace(i, next);
    };
    return (
      <div className="form-grid">
        <Labeled label="Map">
          <SelectField
            label={`Action ${n} map`}
            value={a.map}
            disabled={disabled}
            options={mapOptions}
            onChange={(map) => {
              const target = project.maps[map];
              if (!target) return;
              // Keep the cell inside the new map.
              replace(i, { ...a, map, x: Math.min(a.x, target.width - 1), y: Math.min(a.y, target.height - 1) });
            }}
          />
        </Labeled>
        <Labeled label="X">
          <CommitField label={`Action ${n} x`} numeric className="field field--number" value={String(a.x)} disabled={disabled} onCommit={(t) => commitCoord("x", t)} />
        </Labeled>
        <Labeled label="Y">
          <CommitField label={`Action ${n} y`} numeric className="field field--number" value={String(a.y)} disabled={disabled} onCommit={(t) => commitCoord("y", t)} />
        </Labeled>
      </div>
    );
  };

  return (
    <div className="editor-block" role="group" aria-label="Actions">
      <ol className="action-list">
        {actions.map((a, i) => (
          <li key={i} className="action-item">
            <div className="action-item__head">
              <span className="action-item__title">
                {i + 1}. {a.type === "dialog" ? "Dialog" : a.type === "set" ? "Set variable" : "Teleport"}
              </span>
              <span className="action-item__buttons">
                <button type="button" className="icon-button" aria-label={`Move action ${i + 1} up`} title="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-button" aria-label={`Move action ${i + 1} down`} title="Move down" disabled={disabled || i === actions.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove action ${i + 1}`}
                  title={actions.length === 1 ? LABELS.triggerNeedsAction : "Remove"}
                  disabled={disabled || actions.length === 1}
                  onClick={() => onChange(actions.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            </div>
            {renderAction(a, i)}
          </li>
        ))}
      </ol>
      <div className="action-add">
        {KINDS.map((k) => {
          const created = defaultAction(k.kind, project, mapId);
          return (
            <button
              key={k.kind}
              type="button"
              className="button button--small"
              disabled={disabled || full || created === null}
              title={full ? LABELS.triggerMaxActions(MAX_EVENT_ACTIONS) : created === null ? k.missing : undefined}
              onClick={() => created && onChange([...actions, created])}
            >
              {k.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
