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

/** One-line explanation of each tool, shown above the map. */
export const TOOL_HINTS: Record<Tool, string> = {
  brush: "Brush: click or drag to paint the selected tile",
  eraser: "Eraser: click or drag to wipe tiles away",
  spawn: "Start point: this is where your hero appears",
  npc: "Character: click a tile to add someone to talk to",
  event: "Trigger tile: click a tile to make something happen there",
  select: "Select: click an object to change its settings",
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
  noStartPoint: "Place a start point first",
  onboardingTitle: "First steps",
  onboardingAllSet: "All set!",
  onboardingShowAgain: "Show again",
  onboardingClose: "Close first steps",
  onboardingCollapse: "Hide",
  onboardingNeedCharacter: "Add a character on this map first",
  onboardingFixRefs: "Fix the broken references first",
  noDialogsTitle: "No dialogs yet",
  noDialogsText: "A dialog is what a character says. Create one, then give it lines and choices.",
  createFirstDialog: "Create your first dialog",
  firstDialogName: "First talk",
  noVariablesTitle: "No variables yet",
  noVariablesText: "Flags and numbers let events and dialogs remember things.",
  createFirstVariable: "Create your first variable",
  createDialogOption: "Create a dialog…",
} as const;

/** Text and action label of each first-steps item. */
export const ONBOARDING_LABELS: Record<"ground" | "start" | "character" | "line" | "play", { text: string; action: string }> = {
  ground: { text: "Draw some ground", action: "Draw" },
  start: { text: "Place the start point", action: "Place it" },
  character: { text: "Add a character", action: "Add one" },
  line: { text: "Write them a line", action: "Write a line" },
  play: { text: "Press Play", action: "Play" },
};
