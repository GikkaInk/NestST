import type { Project } from "@nestst/core";

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
  const line = npcs.some((o) => {
    const id = o.props["dialog"];
    if (project === null || typeof id !== "string" || !Object.hasOwn(project.dialogs, id)) return false;
    return project.dialogs[id]!.nodes.some((n) => n.type === "say");
  });

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
