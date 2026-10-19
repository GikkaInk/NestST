import { describe, expect, it } from "vitest";
import type { Condition } from "@nestst/core";
import { evalCondition } from "./conditions.js";

const cond = (op: Condition["op"], value: boolean | number): Condition => ({ variable: "v", op, value });

describe("evalCondition", () => {
  const vars = { v: 5, f: true };
  it.each([
    ["==", 5, true],
    ["==", 4, false],
    ["!=", 4, true],
    ["!=", 5, false],
    [">", 4, true],
    [">", 5, false],
    ["<", 6, true],
    ["<", 5, false],
    [">=", 5, true],
    [">=", 6, false],
    ["<=", 5, true],
    ["<=", 4, false],
  ] as const)("number 5 %s %s is %s", (op, value, expected) => {
    expect(evalCondition(vars, cond(op, value))).toBe(expected);
  });

  it("compares flags with == and !=", () => {
    expect(evalCondition(vars, { variable: "f", op: "==", value: true })).toBe(true);
    expect(evalCondition(vars, { variable: "f", op: "==", value: false })).toBe(false);
    expect(evalCondition(vars, { variable: "f", op: "!=", value: false })).toBe(true);
    expect(evalCondition(vars, { variable: "f", op: "!=", value: true })).toBe(false);
  });

  it("is false for an unknown variable", () => {
    expect(evalCondition(vars, { variable: "nope", op: "!=", value: 1 })).toBe(false);
  });
});
