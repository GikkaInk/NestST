import { useCallback, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GRAPH_STORAGE_KEY,
  loadGraphOrDemo,
  serializeDialogue,
  type DialogueGraph,
} from "./graph";

/** Returns a new graph with `source -> target` added (no duplicates). */
export function connectNodes(graph: DialogueGraph, source: string, target: string): DialogueGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === source && !n.next.includes(target) ? { ...n, next: [...n.next, target] } : n,
    ),
  };
}

function toFlow(graph: DialogueGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n, i) => ({
    id: n.id,
    position: { x: 40 + i * 240, y: 80 + (i % 2) * 80 },
    data: { label: `${n.kind}: ${n.text ?? n.id}` },
  }));
  const edges: Edge[] = graph.nodes.flatMap((n) =>
    n.next.map((t) => ({ id: `${n.id}->${t}`, source: n.id, target: t })),
  );
  return { nodes, edges };
}

export function GraphView({
  graph,
  onChange,
}: {
  graph: DialogueGraph;
  onChange(g: DialogueGraph): void;
}) {
  const initial = useMemo(() => toFlow(graph), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, , onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [current, setCurrent] = useState(graph);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      setEdges((es) => addEdge(c, es));
      const next = connectNodes(current, c.source, c.target);
      setCurrent(next);
      onChange(next);
    },
    [current, onChange, setEdges],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}

/** Loads the saved graph (falling back to the demo on errors), shows the error, persists changes. */
export function GraphScreen() {
  const [loaded] = useState(() => loadGraphOrDemo(window.localStorage));
  const save = useCallback((g: DialogueGraph) => {
    try {
      window.localStorage.setItem(GRAPH_STORAGE_KEY, serializeDialogue(g));
    } catch (e) {
      console.error(e);
    }
  }, []);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      {loaded.error && (
        <p role="alert" style={{ position: "absolute", zIndex: 10, margin: 8, padding: 8, background: "#fff", color: "#b00020", font: "14px sans-serif" }}>
          {loaded.error}. Загружен демо-граф.
        </p>
      )}
      <GraphView graph={loaded.graph} onChange={save} />
    </div>
  );
}
