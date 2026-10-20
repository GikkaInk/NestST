import type { EventProps } from "@nestst/core";
import type { Tool } from "./editorStore.js";

/** User-visible names of the drawing tools. */
export const TOOL_LABELS: Record<Tool, string> = {
  brush: "Brush",
  eraser: "Eraser",
  spawn: "Start point",
  npc: "Character",
  event: "Trigger tile",
  select: "Select",
};

/** User-visible names of the event triggers. */
export const TRIGGER_LABELS: Record<EventProps["trigger"], string> = {
  touch: "Steps on it",
  interact: "Presses the action key",
};

/** Other user-visible strings; extended by later tasks. */
export const LABELS = {
  solid: "Can't walk through",
  showSolid: "Show blocked tiles",
  trigger: "Trigger",
  noStartPoint: "Place a Start point first",
  onboardingTitle: "First steps",
  onboardingAllSet: "All set!",
  onboardingShowAgain: "Show again",
  onboardingClose: "Close first steps",
  onboardingCollapse: "Hide",
  onboardingNeedCharacter: "Add a character on this map first",
  onboardingFixRefs: "Fix the broken references first",
} as const;

/** Text and action label of each first-steps item. */
export const ONBOARDING_LABELS: Record<"ground" | "start" | "character" | "line" | "play", { text: string; action: string }> = {
  ground: { text: "Draw some ground", action: "Draw" },
  start: { text: "Place the start point", action: "Place it" },
  character: { text: "Add a character", action: "Add one" },
  line: { text: "Write them a line", action: "Write a line" },
  play: { text: "Press Play", action: "Play" },
};
