import { z } from "zod";

export type NodeKind = "line" | "choice" | "condition" | "end";

export interface DialogueNode {
  id: string;
  kind: NodeKind;
  text?: string;
  next: string[];
}

export interface DialogueGraph {
  schemaVersion: 1;
  start: string;
  nodes: DialogueNode[];
}

export class DialogueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DialogueError";
  }
}

const nodeSchema = z.object({
  id: z.string({ error: "у узла нет идентификатора" }),
  kind: z.enum(["line", "choice", "condition", "end"], {
    error: (issue) => `неизвестный тип узла: ${JSON.stringify(issue.input)}`,
  }),
  text: z.string().optional(),
  next: z.array(z.string()),
});

const graphSchema = z.object({
  schemaVersion: z.literal(1),
  start: z.string(),
  nodes: z.array(nodeSchema),
});

export function parseDialogue(json: unknown): DialogueGraph {
  const res = graphSchema.safeParse(json);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
    throw new DialogueError(`некорректный формат диалога${where}: ${issue.message}`);
  }
  const graph = res.data as DialogueGraph;
  if (graph.nodes.length === 0) throw new DialogueError("пустой диалог: нет ни одного узла");

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) throw new DialogueError(`идентификатор узла «${n.id}» повторяется`);
    ids.add(n.id);
  }
  if (!ids.has(graph.start)) {
    throw new DialogueError(`нет стартового узла «${graph.start}»`);
  }
  for (const n of graph.nodes) {
    for (const target of n.next) {
      if (!ids.has(target)) {
        throw new DialogueError(`узел «${n.id}» ссылается на несуществующий узел «${target}»`);
      }
    }
  }
  return graph;
}

export function serializeDialogue(graph: DialogueGraph): string {
  return JSON.stringify(graph, null, 2);
}

export const GRAPH_STORAGE_KEY = "m0-graph";

export function demoGraph(): DialogueGraph {
  return {
    schemaVersion: 1,
    start: "n1",
    nodes: [
      { id: "n1", kind: "line", text: "Здравствуй, путник!", next: ["n2"] },
      { id: "n2", kind: "choice", text: "Куда пойдёшь?", next: ["n3"] },
      { id: "n3", kind: "end", text: "Конец", next: [] },
    ],
  };
}

export interface LoadResult {
  graph: DialogueGraph;
  error?: string;
}

/** Reads the saved graph; on any failure falls back to the demo graph with a Russian message. */
export function loadGraphOrDemo(storage: Pick<Storage, "getItem">): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(GRAPH_STORAGE_KEY);
  } catch {
    return { graph: demoGraph(), error: "Не удалось прочитать сохранённый граф: хранилище недоступно" };
  }
  if (raw === null) return { graph: demoGraph() };
  try {
    return { graph: parseDialogue(JSON.parse(raw)) };
  } catch (e) {
    const msg =
      e instanceof DialogueError
        ? `Сохранённый граф повреждён: ${e.message}`
        : "Сохранённый граф повреждён: некорректный JSON";
    return { graph: demoGraph(), error: msg };
  }
}
