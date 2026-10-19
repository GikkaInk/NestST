import type { Condition } from "@nestst/core";

export type VarValue = boolean | number;

/** A condition on an unknown variable, or comparing a flag with a number, is false. */
export function evalCondition(vars: Readonly<Record<string, VarValue>>, cond: Condition): boolean {
  const left = vars[cond.variable];
  const right = cond.value;
  if (left === undefined) return false;
  if (cond.op === "==") return left === right;
  if (cond.op === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  switch (cond.op) {
    case ">":
      return left > right;
    case "<":
      return left < right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
  }
}
