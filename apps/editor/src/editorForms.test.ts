import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@nestst/core";
import type { Project } from "@nestst/core";
import {
  checkNumber,
  checkTeleport,
  defaultAction,
  newVariableId,
  operatorsFor,
  variableRows,
} from "./editorForms.js";

function projectWith(): Project {
  const p = createEmptyProject("T");
  return {
    ...p,
    manifest: {
      ...p.manifest,
      variables: [
        { id: "met", name: "Met the cat", type: "flag", initial: false },
        { id: "coins", name: "Coins", type: "number", initial: 3 },
      ],
      dialogs: [{ id: "hello", name: "Hello", file: "dialogs/hello.json" }],
    },
    dialogs: { hello: { schemaVersion: 1, id: "hello", name: "Hello", start: null, nodes: [] } },
  };
}

describe("variableRows", () => {
  it("lists the variables in manifest order", () => {
    expect(variableRows(projectWith())).toEqual([
      { id: "met", name: "Met the cat", type: "flag", initial: false },
      { id: "coins", name: "Coins", type: "number", initial: 3 },
    ]);
  });
  it("is empty without variables", () => {
    expect(variableRows(createEmptyProject("T"))).toEqual([]);
  });
});

describe("newVariableId", () => {
  it("picks the first free var-N", () => {
    expect(newVariableId([])).toBe("var-1");
    expect(newVariableId([{ id: "var-1" }, { id: "var-3" }])).toBe("var-2");
  });
});

describe("operatorsFor", () => {
  it("flags compare for equality only", () => {
    expect(operatorsFor("flag")).toEqual(["==", "!="]);
  });
  it("numbers have all six comparisons", () => {
    expect(operatorsFor("number")).toEqual(["==", "!=", ">", "<", ">=", "<="]);
  });
});

describe("checkNumber", () => {
  it("accepts whole numbers within the limit", () => {
    expect(checkNumber("42")).toEqual({ ok: true, value: 42 });
    expect(checkNumber(" -1000000 ")).toEqual({ ok: true, value: -1000000 });
    expect(checkNumber("1000000")).toEqual({ ok: true, value: 1000000 });
  });
  it("refuses empty, fractional, out of range and non-numbers", () => {
    for (const bad of ["", "  ", "1.5", "1000001", "-1000001", "abc", "1e3"]) {
      expect(checkNumber(bad).ok).toBe(false);
    }
  });
});

describe("checkTeleport", () => {
  it("accepts a cell inside the target map", () => {
    const p = projectWith();
    const id = p.manifest.startMapId;
    const m = p.maps[id]!;
    expect(checkTeleport(p, id, 0, 0).ok).toBe(true);
    expect(checkTeleport(p, id, m.width - 1, m.height - 1).ok).toBe(true);
  });
  it("refuses outside cells and unknown maps", () => {
    const p = projectWith();
    const id = p.manifest.startMapId;
    const m = p.maps[id]!;
    expect(checkTeleport(p, id, m.width, 0).ok).toBe(false);
    expect(checkTeleport(p, id, 0, m.height).ok).toBe(false);
    expect(checkTeleport(p, id, -1, 0).ok).toBe(false);
    expect(checkTeleport(p, "nope", 0, 0).ok).toBe(false);
  });
});

describe("defaultAction", () => {
  it("dialog: first dialog", () => {
    expect(defaultAction("dialog", projectWith(), "x")).toEqual({ type: "dialog", dialog: "hello" });
  });
  it("dialog: null when the project has no dialogs", () => {
    expect(defaultAction("dialog", createEmptyProject("T"), "x")).toBeNull();
  });
  it("set: first variable, flag -> true, number -> add 1", () => {
    const p = projectWith();
    expect(defaultAction("set", p, "x")).toEqual({ type: "set", variable: "met", op: "set", value: true });
    const onlyNumber = { ...p, manifest: { ...p.manifest, variables: [p.manifest.variables[1]!] } };
    expect(defaultAction("set", onlyNumber, "x")).toEqual({ type: "set", variable: "coins", op: "add", value: 1 });
  });
  it("set: null without variables", () => {
    expect(defaultAction("set", createEmptyProject("T"), "x")).toBeNull();
  });
  it("teleport: the given map, cell 0,0", () => {
    const p = projectWith();
    const id = p.manifest.startMapId;
    expect(defaultAction("teleport", p, id)).toEqual({ type: "teleport", map: id, x: 0, y: 0 });
  });
});
