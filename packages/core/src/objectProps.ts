import { z } from "zod";
import type { Condition } from "./dialogSchema.js";
import { MAX_VALUE, conditionSchema } from "./dialogSchema.js";
import { NestError, describeFirstIssue } from "./errors.js";
import { MAX_MAP_SIZE } from "./schema.js";
import { idSchema, intRange, isRecord, safeParseGuarded } from "./schemaUtil.js";

/** An event runs 1..MAX_EVENT_ACTIONS actions in order. */
export const MAX_EVENT_ACTIONS = 8;

const valueSchema = z.union([z.boolean(), intRange(-MAX_VALUE, MAX_VALUE)], {
  error: (iss) =>
    iss.input === undefined
      ? "this field is missing"
      : `must be true or false, or a whole number from -${MAX_VALUE} to ${MAX_VALUE}`,
});

const dialogActionSchema = z.looseObject({
  type: z.literal("dialog"),
  dialog: idSchema,
});

const setActionSchema = z
  .looseObject({
    type: z.literal("set"),
    variable: idSchema,
    op: z.enum(["set", "add"]),
    value: valueSchema,
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

const teleportActionSchema = z.looseObject({
  type: z.literal("teleport"),
  map: idSchema,
  x: intRange(0, MAX_MAP_SIZE),
  y: intRange(0, MAX_MAP_SIZE),
});

export const eventActionSchema = z.discriminatedUnion(
  "type",
  [dialogActionSchema, setActionSchema, teleportActionSchema],
  { error: 'action type must be "dialog", "set" or "teleport"' },
);

/** Names of NPCs and events are 1..MAX_OBJECT_NAME characters. */
export const MAX_OBJECT_NAME = 60;

const nameSchema = z.string().min(1).max(MAX_OBJECT_NAME);

export const npcPropsSchema = z.looseObject({
  name: nameSchema,
  dialog: idSchema.optional(),
});

export const eventPropsSchema = z.looseObject({
  name: nameSchema,
  trigger: z.enum(["touch", "interact"]),
  once: z.boolean(),
  condition: conditionSchema.optional(),
  actions: z.array(eventActionSchema).min(1).max(MAX_EVENT_ACTIONS),
});

// Explicit interfaces (no index signature); unknown extra keys are still kept at runtime.
export type EventAction =
  | { type: "dialog"; dialog: string }
  | { type: "set"; variable: string; op: "set" | "add"; value: boolean | number }
  | { type: "teleport"; map: string; x: number; y: number };
export interface NpcProps {
  name: string;
  dialog?: string;
}
export interface EventProps {
  name: string;
  trigger: "touch" | "interact";
  once: boolean;
  condition?: Condition;
  actions: EventAction[];
}

function parseProps<T>(schema: z.ZodType, raw: unknown, what: string): T {
  const where = `in ${what} properties`;
  if (!isRecord(raw)) throw new NestError("invalid_props", `${where}: must be an object`);
  // Cheap check on the raw data first: zod would parse every action before looking at the limit.
  if (Array.isArray(raw.actions) && raw.actions.length > MAX_EVENT_ACTIONS) {
    throw new NestError(
      "invalid_props",
      `${where}, field actions: too many actions: ${raw.actions.length}, the limit is ${MAX_EVENT_ACTIONS}`,
    );
  }
  const res = safeParseGuarded(schema, raw, "invalid_props", where, undefined);
  if (!res.success) throw new NestError("invalid_props", describeFirstIssue(res.error, where));
  return res.data as T;
}

export function parseNpcProps(raw: unknown): NpcProps {
  return parseProps<NpcProps>(npcPropsSchema, raw, "NPC");
}

export function parseEventProps(raw: unknown): EventProps {
  return parseProps<EventProps>(eventPropsSchema, raw, "event");
}
