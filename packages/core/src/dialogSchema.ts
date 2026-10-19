import { z } from "zod";
import { NestError, describeFirstIssue } from "./errors.js";
import {
  idSchema,
  intRange,
  isRecord,
  safeParseGuarded,
  schemaVersionSchema,
  withFile,
} from "./schemaUtil.js";

export const MAX_VARIABLES = 200;
export const MAX_DIALOGS = 200;
export const MAX_DIALOG_NODES = 500;
export const MAX_CHOICE_OPTIONS = 6;
export const MAX_SAY_TEXT = 500;
export const MAX_OPTION_TEXT = 200;
export const MAX_SPEAKER = 60;
export const MAX_VARIABLE_NAME = 60;
/** Variable values are whole numbers in -MAX_VALUE..MAX_VALUE. */
export const MAX_VALUE = 1000000;
/** Editor positions of dialog nodes stay within this range. */
const MAX_POSITION = 1000000;

const valueSchema = intRange(-MAX_VALUE, MAX_VALUE);
const BOOLEAN_OPS = new Set(["==", "!="]);

export const compareOpSchema = z.enum(["==", "!=", ">", "<", ">=", "<="]);
export type CompareOp = z.infer<typeof compareOpSchema>;

// Variable ids use the project id pattern, so the Windows-reserved device names
// (con, nul, ...) are refused for variables too. Accepted: it keeps one id rule everywhere.
export const variableDefSchema = z
  .looseObject({
    id: idSchema,
    name: z.string().min(1).max(MAX_VARIABLE_NAME),
    type: z.enum(["flag", "number"]),
    initial: z.union([z.boolean(), valueSchema], {
      error: (iss) =>
        iss.input === undefined
          ? "this field is missing"
          : `must be true or false, or a whole number from -${MAX_VALUE} to ${MAX_VALUE}`,
    }),
  })
  .check((ctx) => {
    const { type, initial } = ctx.value;
    const ok = type === "flag" ? typeof initial === "boolean" : typeof initial === "number";
    if (!ok) {
      ctx.issues.push({
        code: "custom",
        input: initial,
        path: ["initial"],
        message: `initial value of a ${type} variable must be ${type === "flag" ? "true or false" : "a number"}`,
      });
    }
  });

export const conditionSchema = z
  .looseObject({
    variable: idSchema,
    op: compareOpSchema,
    value: z.union([z.boolean(), valueSchema], {
      error: (iss) =>
        iss.input === undefined
          ? "this field is missing"
          : `must be true or false, or a whole number from -${MAX_VALUE} to ${MAX_VALUE}`,
    }),
  })
  .check((ctx) => {
    const { op, value } = ctx.value;
    if (typeof value === "boolean" && !BOOLEAN_OPS.has(op)) {
      ctx.issues.push({
        code: "custom",
        input: value,
        path: ["op"],
        message: `condition on a flag can only use "==" or "!=", not "${op}"`,
      });
    }
  });

const nodeId = z.string().min(1).max(64);
const nextId = nodeId.nullable();
const position = {
  x: intRange(-MAX_POSITION, MAX_POSITION),
  y: intRange(-MAX_POSITION, MAX_POSITION),
};

const sayNodeSchema = z.looseObject({
  id: nodeId,
  ...position,
  type: z.literal("say"),
  speaker: z.string().max(MAX_SPEAKER),
  text: z.string().min(1).max(MAX_SAY_TEXT),
  next: nextId,
});

const choiceOptionSchema = z.looseObject({
  text: z.string().min(1).max(MAX_OPTION_TEXT),
  next: nextId,
  condition: conditionSchema.optional(),
});

const choiceNodeSchema = z.looseObject({
  id: nodeId,
  ...position,
  type: z.literal("choice"),
  options: z.array(choiceOptionSchema).min(1).max(MAX_CHOICE_OPTIONS),
});

const setNodeSchema = z
  .looseObject({
    id: nodeId,
    ...position,
    type: z.literal("set"),
    variable: idSchema,
    op: z.enum(["set", "add"]),
    value: z.union([z.boolean(), valueSchema], {
      error: (iss) =>
        iss.input === undefined
          ? "this field is missing"
          : `must be true or false, or a whole number from -${MAX_VALUE} to ${MAX_VALUE}`,
    }),
    next: nextId,
  })
  .check((ctx) => {
    if (ctx.value.op === "add" && typeof ctx.value.value !== "number") {
      ctx.issues.push({
        code: "custom",
        input: ctx.value.value,
        path: ["op"],
        message: 'op "add" works only with a number value',
      });
    }
  });

const branchNodeSchema = z.looseObject({
  id: nodeId,
  ...position,
  type: z.literal("branch"),
  condition: conditionSchema,
  then: nextId,
  else: nextId,
});

export const dialogNodeSchema = z.discriminatedUnion(
  "type",
  [sayNodeSchema, choiceNodeSchema, setNodeSchema, branchNodeSchema],
  { error: 'node type must be "say", "choice", "set" or "branch"' },
);

export const dialogSchema = z.looseObject({
  schemaVersion: schemaVersionSchema("dialog"),
  id: idSchema,
  name: z.string().min(1).max(200),
  start: nodeId.nullable(),
  nodes: z.array(dialogNodeSchema).max(MAX_DIALOG_NODES),
});

export type VariableDef = z.infer<typeof variableDefSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type DialogNode = z.infer<typeof dialogNodeSchema>;
export type Dialog = z.infer<typeof dialogSchema>;

function dialogLabel(raw: unknown): string {
  if (isRecord(raw)) {
    if (typeof raw.name === "string" && raw.name !== "") return `in dialog "${raw.name}"`;
    if (typeof raw.id === "string" && raw.id !== "") return `in dialog "${raw.id}"`;
  }
  return "in dialog";
}

export function parseDialog(raw: unknown, file?: string): Dialog {
  const where = withFile(file, dialogLabel(raw));
  // Cheap check on the raw data first: zod would parse every node before looking at the limit.
  if (isRecord(raw) && Array.isArray(raw.nodes) && raw.nodes.length > MAX_DIALOG_NODES) {
    throw new NestError(
      "invalid_dialog",
      `${where}, field nodes: too many nodes: ${raw.nodes.length}, the limit is ${MAX_DIALOG_NODES}`,
      file,
    );
  }
  const res = safeParseGuarded(dialogSchema, raw, "invalid_dialog", where, file);
  if (!res.success) {
    throw new NestError("invalid_dialog", describeFirstIssue(res.error, where), file);
  }
  const dialog = res.data;
  const fail = (text: string): never => {
    throw new NestError("invalid_dialog", `${where}: ${text}`, file);
  };

  const ids = new Set<string>();
  for (const node of dialog.nodes) {
    if (ids.has(node.id)) fail(`node id "${node.id}" is used more than once`);
    ids.add(node.id);
  }
  const check = (target: string | null, from: string): void => {
    if (target !== null && !ids.has(target)) fail(`${from} points to node "${target}", which does not exist`);
  };
  check(dialog.start, "start");
  for (const node of dialog.nodes) {
    switch (node.type) {
      case "say":
      case "set":
        check(node.next, `node "${node.id}" (next)`);
        break;
      case "choice":
        node.options.forEach((o, i) => check(o.next, `node "${node.id}" option ${i + 1}`));
        break;
      case "branch":
        check(node.then, `node "${node.id}" (then)`);
        check(node.else, `node "${node.id}" (else)`);
        break;
    }
  }
  return dialog;
}
