import type { Condition, EventAction, EventProps, MapObject } from "@nestst/core";
import { canEditMode } from "../editorForms.js";
import type { EditorStore } from "../editorStore.js";
import { LABELS, TOOL_LABELS, TRIGGER_LABELS } from "../labels.js";
import { useEditorState } from "../useEditorState.js";
import { ActionListEditor } from "./ActionListEditor.js";
import { ConditionEditor } from "./ConditionEditor.js";
import { CheckField, CommitField, Labeled, SelectField } from "./fields.js";

/** Properties of the selected NPC or event (right panel on the Map tab). */
export function ObjectInspector({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  const project = s.project;
  const map = project && s.currentMapId ? project.maps[s.currentMapId] : undefined;
  const obj = map?.objects.find((o) => o.id === s.selectedObjectId);
  if (!project || !map || !obj || (obj.kind !== "npc" && obj.kind !== "event")) return null;
  const disabled = !canEditMode(s.mode);
  const props = obj.props as Record<string, unknown>;
  const patch = (changes: Record<string, unknown>) => {
    const next = { ...props, ...changes };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    store.setObjectProps(obj.id, next);
  };
  const name = typeof props.name === "string" ? props.name : "";

  return (
    <aside className="inspector card" aria-label="Object properties" key={obj.id}>
      <h2 className="panel-title">{obj.kind === "npc" ? TOOL_LABELS.npc : TOOL_LABELS.event}</h2>
      <Labeled label="Name">
        <CommitField label="Name" value={name} maxLength={60} disabled={disabled} onCommit={(name) => patch({ name })} />
      </Labeled>
      {obj.kind === "npc" ? (
        <Labeled label="Dialog">
          <SelectField
            label="Dialog"
            value={typeof props.dialog === "string" ? props.dialog : ""}
            disabled={disabled}
            options={[
              { value: "", label: "None" },
              ...project.manifest.dialogs.map((d) => ({ value: d.id, label: project.dialogs[d.id]?.name ?? d.name })),
            ]}
            onChange={(v) => patch({ dialog: v === "" ? undefined : v })}
          />
        </Labeled>
      ) : (
        <EventFields obj={obj} disabled={disabled} store={store} patch={patch} />
      )}
      <button
        type="button"
        className="button button--danger"
        disabled={disabled}
        onClick={() => store.removeObjectAt(obj.x, obj.y)}
      >
        Delete
      </button>
    </aside>
  );
}

function EventFields(props: {
  obj: MapObject;
  disabled: boolean;
  store: EditorStore;
  patch(changes: Record<string, unknown>): void;
}) {
  const { store, disabled, patch } = props;
  const s = store.getState();
  const project = s.project!;
  const ev = props.obj.props as unknown as EventProps;
  return (
    <>
      <Labeled label={LABELS.trigger}>
        <SelectField
          label={LABELS.trigger}
          value={ev.trigger}
          disabled={disabled}
          options={[
            { value: "touch", label: TRIGGER_LABELS.touch },
            { value: "interact", label: TRIGGER_LABELS.interact },
          ]}
          onChange={(trigger) => patch({ trigger })}
        />
      </Labeled>
      <CheckField label="Only once" checked={ev.once === true} disabled={disabled} onChange={(once) => patch({ once })} />
      <h3 className="panel-subtitle">Condition</h3>
      <ConditionEditor
        condition={ev.condition}
        variables={project.manifest.variables}
        disabled={disabled}
        onInvalid={store.reportError}
        onChange={(condition: Condition | undefined) => patch({ condition })}
      />
      <h3 className="panel-subtitle">Actions</h3>
      <ActionListEditor
        actions={ev.actions}
        project={project}
        mapId={s.currentMapId!}
        disabled={disabled}
        onInvalid={store.reportError}
        onChange={(actions: EventAction[]) => patch({ actions })}
      />
    </>
  );
}
