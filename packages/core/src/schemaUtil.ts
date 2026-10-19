import { z } from "zod";
import { NestError, messageForIssue } from "./errors.js";

/** Current format version of each file kind. */
export const FORMAT_VERSIONS = { manifest: 4, map: 2, dialog: 1 } as const;
export type FormatKind = keyof typeof FORMAT_VERSIONS;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ID_MESSAGE =
  "id must use lowercase Latin letters, digits, \"_\" and \"-\", start with a letter or digit and be at most 64 characters long";

/** Whole number in a range; one clear message for every reason of rejection. */
export function intRange(min: number, max: number) {
  const message = `must be a whole number from ${min} to ${max}`;
  const error = (iss: { input?: unknown }) =>
    iss.input === undefined ? "this field is missing" : message;
  return z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
}

/** Device names Windows refuses as file names (`maps/<id>.json` must work everywhere). */
const RESERVED_ID = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const RESERVED_MESSAGE =
  "id is a reserved device name on Windows (con, prn, aux, nul, com1-com9, lpt1-lpt9); choose another id";

export const idSchema = z
  .string()
  .regex(ID_PATTERN, { error: ID_MESSAGE })
  .refine((v) => !RESERVED_ID.test(v), { error: RESERVED_MESSAGE });

export const schemaVersionSchema = <K extends FormatKind>(kind: K) =>
  z.literal(FORMAT_VERSIONS[kind], {
    error: (iss) =>
      iss.input === undefined
        ? "this field is missing"
        : `format version must be ${FORMAT_VERSIONS[kind]}`,
  });

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function withFile(file: string | undefined, where: string): string {
  return file ? `file ${file}: ${where}` : where;
}

/**
 * `safeParse` that never lets an engine error out: if the data is so damaged
 * that validation itself runs out of stack, report it as a NestError.
 */
export function safeParseGuarded<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  code: string,
  where: string,
  file: string | undefined,
): ReturnType<T["safeParse"]> {
  try {
    return schema.safeParse(raw, { error: messageForIssue }) as ReturnType<T["safeParse"]>;
  } catch (e) {
    if (e instanceof RangeError) {
      throw new NestError(code, `${where}: the data is too damaged to read`, file);
    }
    throw e;
  }
}

