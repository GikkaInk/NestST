import { describe, expect, it } from "vitest";
import { TOOLS } from "./editorStore.js";
import { LABELS, TOOL_LABELS, TRIGGER_LABELS } from "./labels.js";

describe("labels", () => {
  it("uses friendly tool names", () => {
    expect(TOOL_LABELS.spawn).toBe("Start point");
    expect(TOOL_LABELS.npc).toBe("Character");
    expect(TOOL_LABELS.event).toBe("Trigger tile");
  });

  it("covers every tool", () => {
    expect(Object.keys(TOOL_LABELS).sort()).toEqual([...TOOLS].sort());
  });

  it("uses friendly trigger names", () => {
    expect(TRIGGER_LABELS.touch).toBe("Steps on it");
    expect(TRIGGER_LABELS.interact).toBe("Presses the action key");
  });

  it("has the palette labels", () => {
    expect(LABELS.solid).toBe("Can't walk through");
    expect(LABELS.showSolid).toBe("Show blocked tiles");
  });
});
