import type { MapObject, Project } from "@nestst/core";

export type OnboardingStepId = "ground" | "start" | "character" | "line" | "play";
export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
}

/** Same fields as `EditorState` (`playedOnce` arrives there with the store change), declared locally. */
export interface OnboardingInput {
  project: Project | null;
  currentMapId: string | null;
  playedOnce: boolean;
}

function hasWorkingDialog(project: Project, o: MapObject): boolean {
  const id = o.props["dialog"];
  if (typeof id !== "string" || !Object.hasOwn(project.dialogs, id)) return false;
  return project.dialogs[id]!.nodes.some((n) => n.type === "say");
}

/**
 * Character that step 4 should write a line for: the first npc without a working dialog on the
 * current map, else the first such npc on any map, else null.
 */
export function findLineTarget(s: Pick<OnboardingInput, "project" | "currentMapId">): { mapId: string; objectId: string } | null {
  const project = s.project;
  if (project === null) return null;
  const entries = Object.entries(project.maps);
  const ordered = [
    ...entries.filter(([id]) => id === s.currentMapId),
    ...entries.filter(([id]) => id !== s.currentMapId),
  ];
  for (const [mapId, map] of ordered) {
    const o = map.objects.find((x) => x.kind === "npc" && !hasWorkingDialog(project, x));
    if (o !== undefined) return { mapId, objectId: o.id };
  }
  return null;
}

/** Onboarding checklist, always five steps in this order. Never throws on a missing map or dangling dialog id. */
export function getOnboardingSteps(s: Pick<OnboardingInput, "project" | "currentMapId" | "playedOnce">): OnboardingStep[] {
  const project = s.project;
  const maps = project === null ? [] : Object.values(project.maps);
  const objects = maps.flatMap((m) => m.objects);
  const current =
    project !== null && s.currentMapId !== null && Object.hasOwn(project.maps, s.currentMapId)
      ? project.maps[s.currentMapId]
      : undefined;

  const ground = current !== undefined && current.layers.some((l) => l.tiles.some((t) => t !== 0));
  const start = objects.some((o) => o.kind === "spawn");
  const npcs = objects.filter((o) => o.kind === "npc");
  const line = project !== null && npcs.some((o) => hasWorkingDialog(project, o));

  return [
    { id: "ground", done: ground },
    { id: "start", done: start },
    { id: "character", done: npcs.length > 0 },
    { id: "line", done: line },
    { id: "play", done: s.playedOnce },
  ];
}

export function allDone(steps: readonly OnboardingStep[]): boolean {
  return steps.every((x) => x.done);
}
