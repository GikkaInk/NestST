import { z } from "zod";

/** NestST error: the message is always plain English, `code` is a machine-readable reason. */
export class NestError extends Error {
  readonly code: string;
  readonly file?: string;

  constructor(code: string, message: string, file?: string) {
    super(message);
    this.name = "NestError";
    this.code = code;
    if (file !== undefined) this.file = file;
  }
}

const TYPE_NAMES: Record<string, string> = {
  string: "must be text",
  number: "must be a number",
  int: "must be a whole number",
  boolean: "must be true or false",
  array: "must be a list",
  object: "must be an object",
  null: "must be empty (null)",
  undefined: "must be empty",
};

function isCountable(origin: string): boolean {
  return origin === "string" || origin === "array" || origin === "set";
}

function bound(origin: string, n: number): string {
  if (origin === "string") return `${n} ${n === 1 ? "character" : "characters"}`;
  if (origin === "array" || origin === "set") return `${n} ${n === 1 ? "item" : "items"}`;
  return String(n);
}

function subject(origin: string): string {
  if (origin === "string") return "text length";
  if (isCountable(origin)) return "number of items";
  return "value";
}

/**
 * Shared zod error map: an English message for every kind of issue.
 * Returns only the requirement on the field ("must be ..."); the file/map name
 * and field path are added by `describeFirstIssue`.
 */
export function messageForIssue(iss: z.core.$ZodRawIssue): string {
  switch (iss.code) {
    case "invalid_type": {
      if (iss.input === undefined && (iss.path?.length ?? 0) > 0) return "this field is missing";
      return TYPE_NAMES[iss.expected] ?? "value has the wrong type";
    }
    case "too_small": {
      const origin = String(iss.origin);
      const min = Number(iss.minimum);
      if (origin === "string" && min === 1) return "must not be empty";
      if (origin === "array" && min === 1) return "must contain at least one item";
      return `${subject(origin)} must not be less than ${bound(origin, min)}`;
    }
    case "too_big": {
      const origin = String(iss.origin);
      return `${subject(origin)} must not be greater than ${bound(origin, Number(iss.maximum))}`;
    }
    case "invalid_value": {
      const list = iss.values.map((v) => JSON.stringify(v)).join(", ");
      return `value is not allowed; allowed: ${list}`;
    }
    case "invalid_format":
      return "text has the wrong format";
    case "not_multiple_of":
      return `number must be divisible by ${String(iss.divisor)}`;
    case "unrecognized_keys":
      return `unknown fields: ${iss.keys.join(", ")}`;
    case "invalid_union":
      return "value matches none of the allowed variants";
    case "invalid_key":
      return "key is not allowed";
    case "invalid_element":
      return "item is not allowed";
    case "custom":
      return "value failed validation";
    default:
      return "value is not valid";
  }
}

/** Field path in readable form: `layers[0].tiles[5]`. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

/** Message for the first issue: "<where>, field <path>: <what is wrong>". */
export function describeFirstIssue(error: z.ZodError, where: string): string {
  const issue = error.issues[0];
  if (!issue) return `${where}: invalid data`;
  const path = formatPath(issue.path);
  return path ? `${where}, field ${path}: ${issue.message}` : `${where}: ${issue.message}`;
}
