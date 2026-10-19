import type { ReactNode } from "react";
import { canPlay, isBusy } from "../editorStore.js";
import type { EditorStore, Tool } from "../editorStore.js";
import { useEditorState } from "../useEditorState.js";
import {
  IconBrush,
  IconEraser,
  IconEvent,
  IconFit,
  IconNew,
  IconNpc,
  IconOpen,
  IconPlay,
  IconRedo,
  IconSelect,
  IconSave,
  IconSpawn,
  IconStop,
  IconUndo,
  IconZoomIn,
  IconZoomOut,
} from "./icons.js";

export interface ZoomControls {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

interface Props {
  store: EditorStore;
  /** Zoom of the map view, 1 = 100 %. */
  zoom: number;
  zoomControls: ZoomControls | null;
  onNew(): void;
  onOpen(): void;
}

function ToolButton(props: {
  label: string;
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  /** Overrides the tooltip, e.g. to say why the button is disabled. */
  hint?: string;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
  showLabel?: boolean;
}) {
  const tip = props.hint ?? (props.shortcut ? `${props.label} (${props.shortcut})` : props.label);
  return (
    <button
      type="button"
      className={props.className ?? "tool-button"}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      aria-label={props.label}
      aria-keyshortcuts={props.shortcut?.replaceAll(" ", "")}
      title={tip}
    >
      {props.children}
      {props.showLabel && <span className="tool-button__label">{props.label}</span>}
    </button>
  );
}

/** Why Play is off: broken references or a missing Spawn point. */
function playHint(s: ReturnType<typeof useEditorState>): string | undefined {
  if (canPlay(s) || s.project === null || s.mode !== "idle") return undefined;
  if (s.refProblems.length > 0) return "Fix the broken references first";
  return "Place a Spawn point first";
}

export function Toolbar({ store, zoom, zoomControls, onNew, onOpen }: Props) {
  const s = useEditorState(store);
  const hasProject = s.project !== null;
  const playing = s.mode === "playing";
  const tools: Array<{ id: Tool; label: string; key: string; icon: ReactNode }> = [
    { id: "brush", label: "Brush", key: "B", icon: <IconBrush /> },
    { id: "eraser", label: "Eraser", key: "E", icon: <IconEraser /> },
    { id: "spawn", label: "Spawn", key: "P", icon: <IconSpawn /> },
    { id: "npc", label: "NPC", key: "N", icon: <IconNpc /> },
    { id: "event", label: "Event", key: "T", icon: <IconEvent /> },
    { id: "select", label: "Select", key: "V", icon: <IconSelect /> },
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label="Editor tools">
      <div className="toolbar__group">
        {playing ? (
          <ToolButton
            key="stop"
            label="Stop"
            shortcut="Esc"
            className="tool-button tool-button--play"
            onClick={() => store.stopPlay()}
            showLabel
          >
            <IconStop />
          </ToolButton>
        ) : (
          <ToolButton
            key="play"
            label="Play"
            shortcut="F5"
            className="tool-button tool-button--play"
            onClick={() => store.play()}
            disabled={!canPlay(s)}
            hint={playHint(s)}
            showLabel
          >
            <IconPlay />
          </ToolButton>
        )}
      </div>
      <div className="toolbar__group">
        <ToolButton label="New project" onClick={onNew} disabled={isBusy(s)}>
          <IconNew />
        </ToolButton>
        <ToolButton label="Open project" onClick={onOpen} disabled={isBusy(s)}>
          <IconOpen />
        </ToolButton>
        <ToolButton
          label="Save"
          shortcut="Ctrl + S"
          className="tool-button tool-button--primary"
          onClick={() => void store.save()}
          disabled={!hasProject || isBusy(s)}
          showLabel
        >
          <IconSave />
        </ToolButton>
      </div>
      <div className="toolbar__group">
        <ToolButton label="Undo" shortcut="Ctrl + Z" onClick={() => store.undo()} disabled={!s.canUndo || playing}>
          <IconUndo />
        </ToolButton>
        <ToolButton
          label="Redo"
          shortcut="Ctrl + Shift + Z"
          onClick={() => store.redo()}
          disabled={!s.canRedo || playing}
        >
          <IconRedo />
        </ToolButton>
      </div>
      <div className="toolbar__group" role="group" aria-label="Drawing tool">
        {tools.map((t) => (
          <ToolButton
            key={t.id}
            label={t.label}
            shortcut={t.key}
            pressed={s.tool === t.id}
            onClick={() => store.selectTool(t.id)}
            disabled={!hasProject}
          >
            {t.icon}
          </ToolButton>
        ))}
      </div>
      <div className="toolbar__group toolbar__zoom">
        <ToolButton label="Zoom out" shortcut="-" onClick={() => zoomControls?.zoomOut()} disabled={!zoomControls}>
          <IconZoomOut />
        </ToolButton>
        <output className="zoom-readout" aria-label="Zoom level" title="Zoom level (mouse wheel to zoom)">
          {Math.round(zoom * 100)}%
        </output>
        <ToolButton label="Zoom in" shortcut="+" onClick={() => zoomControls?.zoomIn()} disabled={!zoomControls}>
          <IconZoomIn />
        </ToolButton>
        <ToolButton label="Fit map to view" shortcut="0" onClick={() => zoomControls?.fit()} disabled={!zoomControls}>
          <IconFit />
        </ToolButton>
      </div>
    </div>
  );
}
