import { useCallback, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow } from "@xyflow/react";
import type { Edge, Node, NodeChange, EdgeChange, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dialog, DialogNode, VariableDef } from "@nestst/core";
import {
  START_HANDLE,
  START_MARKER_ID,
  addNode,
  applyConnect,
  applyDisconnect,
  dialogToFlow,
  findFreeSpot,
  moveNode,
  nodeSummary,
  removeNode,
} from "../dialogGraph.js";
import type { NodeType } from "../dialogGraph.js";

interface Props {
  dialog: Dialog;
  variables: readonly VariableDef[];
  selectedId: string | null;
  disabled: boolean;
  /** Saves the new dialog; returns false if it was refused. */
  onChange(dialog: Dialog): boolean | void;
  onSelect(id: string | null): void;
}

type CardData = { node: DialogNode | null; isStart: boolean; summary: string };

const TITLES: Record<NodeType, string> = { say: "Say", choice: "Choice", set: "Set", branch: "Branch" };

function Card({ type, data, children }: { type: string; data: CardData; children?: React.ReactNode }) {
  return (
    <div className={`flow-node flow-node--${type}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node__head">
        <span className="flow-node__title">{TITLES[type as NodeType]}</span>
        {data.isStart && <span className="flow-node__badge">Start</span>}
      </div>
      {children ?? <p className="flow-node__summary">{data.summary}</p>}
    </div>
  );
}

function SayNode({ data }: NodeProps) {
  return (
    <Card type="say" data={data as CardData}>
      <p className="flow-node__summary">{(data as CardData).summary}</p>
      <Handle type="source" position={Position.Right} id="next" />
    </Card>
  );
}

function SetNode({ data }: NodeProps) {
  return (
    <Card type="set" data={data as CardData}>
      <p className="flow-node__summary">{(data as CardData).summary}</p>
      <Handle type="source" position={Position.Right} id="next" />
    </Card>
  );
}

function ChoiceNode({ data }: NodeProps) {
  const d = data as CardData;
  const options = d.node?.type === "choice" ? d.node.options : [];
  return (
    <Card type="choice" data={d}>
      <ul className="flow-node__options">
        {options.map((o, i) => (
          <li key={i} className="flow-node__option">
            <span>{o.text}</span>
            <Handle type="source" position={Position.Right} id={`opt-${i}`} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BranchNode({ data }: NodeProps) {
  const d = data as CardData;
  return (
    <Card type="branch" data={d}>
      <p className="flow-node__summary">{d.summary}</p>
      <div className="flow-node__option">
        <span>then</span>
        <Handle type="source" position={Position.Right} id="then" />
      </div>
      <div className="flow-node__option">
        <span>else</span>
        <Handle type="source" position={Position.Right} id="else" />
      </div>
    </Card>
  );
}

function StartNode() {
  return (
    <div className="flow-node flow-node--start">
      <span className="flow-node__title">Start</span>
      <Handle type="source" position={Position.Right} id={START_HANDLE} />
    </div>
  );
}

const nodeTypes = { say: SayNode, choice: ChoiceNode, set: SetNode, branch: BranchNode, start: StartNode };

const ADD_TYPES: NodeType[] = ["say", "choice", "set", "branch"];

/** xyflow view of one dialog. All edits go through the pure functions of dialogGraph and `onChange`. */
export function DialogGraph({ dialog, variables, selectedId, disabled, onChange, onSelect }: Props) {
  // The dialog the editor really holds: updated on every successful change, so
  // two edits in one tick (e.g. Delete of a node with edges) build on each other.
  const latest = useRef(dialog);
  latest.current = dialog;
  const selNode = useRef(selectedId);
  selNode.current = selectedId;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // Positions of nodes while they are dragged; committed once on drag stop.
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});

  const commit = useCallback(
    (next: Dialog): boolean => {
      if (disabled || next === latest.current) return false;
      const res = onChange(next);
      if (res === false) return false;
      latest.current = next;
      return true;
    },
    [disabled, onChange],
  );

  const names = useMemo(() => new Map(variables.map((v) => [v.id, v.name] as const)), [variables]);

  const { nodes, edges } = useMemo(() => {
    const flow = dialogToFlow(dialog);
    const nodes = flow.nodes.map((n) => ({
      ...n,
      position: drag[n.id] ?? n.position,
      selected: n.id === selectedId,
      data: { ...n.data, summary: n.data.node ? nodeSummary(n.data.node, names) : "" },
    }));
    const edges = flow.edges.map((e) => ({ ...e, selected: e.id === selectedEdge }));
    return { nodes: nodes as unknown as Node[], edges: edges as unknown as Edge[] };
  }, [dialog, drag, selectedId, selectedEdge, names]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === "position" && ch.position && ch.dragging) {
          const pos = ch.position;
          setDrag((d) => ({ ...d, [ch.id]: pos }));
        } else if (ch.type === "select" && ch.id !== START_MARKER_ID) {
          if (ch.selected) {
            selNode.current = ch.id;
            setSelectedEdge(null);
            onSelect(ch.id);
          } else if (selNode.current === ch.id) {
            selNode.current = null;
            onSelect(null);
          }
        }
      }
    },
    [onSelect],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const ch of changes) {
      if (ch.type !== "select") continue;
      if (ch.selected) setSelectedEdge(ch.id);
      else setSelectedEdge((cur) => (cur === ch.id ? null : cur));
    }
  }, []);

  const addOfType = (type: NodeType) => {
    const next = addNode(latest.current, type, findFreeSpot(latest.current), variables);
    if (next !== latest.current && commit(next)) onSelect(next.nodes[next.nodes.length - 1]!.id);
  };

  const needsVariable = (t: NodeType) => (t === "set" || t === "branch") && variables.length === 0;

  return (
    <div className="dialog-graph">
      <div className="dialog-graph__tools" role="toolbar" aria-label="Add node">
        {ADD_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`button button--small flow-add flow-add--${t}`}
            aria-label={`Add ${t}`}
            title={needsVariable(t) ? "Create a variable first" : `Add a ${t} node`}
            disabled={disabled || needsVariable(t)}
            onClick={() => addOfType(t)}
          >
            + {TITLES[t]}
          </button>
        ))}
      </div>
      <div className="dialog-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(c) => {
            if (c.source && c.target) commit(applyConnect(latest.current, c));
          }}
          onNodeDragStop={(_, n) => {
            setDrag((d) => {
              const { [n.id]: _gone, ...rest } = d;
              return rest;
            });
            commit(moveNode(latest.current, n.id, n.position));
          }}
          onDelete={({ nodes: gone, edges: cut }) => {
            let next = latest.current;
            for (const e of cut) next = applyDisconnect(next, e.id);
            for (const n of gone) next = removeNode(next, n.id);
            commit(next);
          }}
          onPaneClick={() => setSelectedEdge(null)}
          deleteKeyCode={disabled ? null : "Delete"}
          nodesDraggable={!disabled}
          nodesConnectable={!disabled}
          fitView
          minZoom={0.2}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
