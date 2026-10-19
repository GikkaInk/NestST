import { describe, expect, it } from "vitest";
import { NestError } from "./errors.js";
import { parseEventProps, parseNpcProps } from "./objectProps.js";

const say = { type: "dialog", dialog: "intro" };
const ev = (over: Record<string, unknown> = {}) => ({
  name: "Door",
  trigger: "touch",
  once: false,
  actions: [say],
  ...over,
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as NestError).code;
  }
  return "none";
}

describe("parseNpcProps", () => {
  it("accepts a name without a dialog", () => {
    expect(parseNpcProps({ name: "NPC 1" })).toEqual({ name: "NPC 1" });
  });
  it("accepts a dialog id", () => {
    expect(parseNpcProps({ name: "Guide", dialog: "intro" }).dialog).toBe("intro");
  });
  it("rejects empty and too long names, bad dialog ids", () => {
    expect(code(() => parseNpcProps({ name: "" }))).toBe("invalid_props");
    expect(code(() => parseNpcProps({ name: "x".repeat(61) }))).toBe("invalid_props");
    expect(code(() => parseNpcProps({ name: "A", dialog: "Bad Id" }))).toBe("invalid_props");
    expect(code(() => parseNpcProps(null))).toBe("invalid_props");
  });
});

describe("parseEventProps", () => {
  it("accepts 1 and 8 actions, rejects 0 and 9", () => {
    expect(parseEventProps(ev()).actions).toHaveLength(1);
    expect(parseEventProps(ev({ actions: Array(8).fill(say) })).actions).toHaveLength(8);
    expect(code(() => parseEventProps(ev({ actions: [] })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ actions: Array(9).fill(say) })))).toBe("invalid_props");
  });
  it("accepts all action types and a condition", () => {
    const p = parseEventProps(
      ev({
        trigger: "interact",
        once: true,
        condition: { variable: "key", op: "==", value: true },
        actions: [say, { type: "set", variable: "gold", op: "add", value: 5 }, { type: "teleport", map: "main", x: 1, y: 2 }],
      }),
    );
    expect(p.actions).toHaveLength(3);
  });
  it("rejects bad trigger, add with boolean, unknown action type, name length", () => {
    expect(code(() => parseEventProps(ev({ trigger: "step" })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ actions: [{ type: "set", variable: "a", op: "add", value: true }] })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ actions: [{ type: "boom" }] })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ name: "" })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ name: "x".repeat(61) })))).toBe("invalid_props");
    expect(code(() => parseEventProps(ev({ once: "yes" })))).toBe("invalid_props");
  });
});
