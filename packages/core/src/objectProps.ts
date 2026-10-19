import { z } from "zod";
import { MAX_VALUE, MAX_VARIABLE_NAME, conditionSchema } from "./dialogSchema.js";
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

const nameSchema = z.string().min(1).max(MAX_VARIABLE_NAME);

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

export type EventAction = z.infer<typeof eventActionSchema>;
export type NpcProps = z.infer<typeof npcPropsSchema>;
export type EventProps = z.infer<typeof eventPropsSchema>;

function parseProps<T extends z.ZodType>(schema: T, raw: unknown, what: string): z.infer<T> {
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
  return res.data as z.infer<T>;
}

export function parseNpcProps(raw: unknown): NpcProps {
  return parseProps(npcPropsSchema, raw, "NPC");
}

export function parseEventProps(raw: unknown): EventProps {
  return parseProps(eventPropsSchema, raw, "event");
}
