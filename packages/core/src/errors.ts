import { z } from "zod";

/** Ошибка NestST: сообщение всегда на русском, `code` — машинное имя причины. */
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
  string: "должна быть строка",
  number: "должно быть число",
  int: "должно быть целое число",
  boolean: "должно быть «да» или «нет» (true или false)",
  array: "должен быть список",
  object: "должен быть объект",
  null: "должно быть пустое значение (null)",
  undefined: "должно быть пустое значение",
};

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function isCountable(origin: string): boolean {
  return origin === "string" || origin === "array" || origin === "set";
}

function bound(origin: string, n: number): string {
  if (origin === "string") return `${n} ${plural(n, "символ", "символа", "символов")}`;
  if (origin === "array" || origin === "set") return `${n} ${plural(n, "элемент", "элемента", "элементов")}`;
  return String(n);
}

function subject(origin: string): string {
  if (origin === "string") return "длина текста";
  if (isCountable(origin)) return "количество элементов";
  return "значение";
}

/**
 * Общая карта ошибок zod: русский текст для каждого вида проблемы.
 * Возвращает только требование к полю («должно быть …»); имя файла/карты и путь
 * к полю добавляет `describeFirstIssue`.
 */
export function russianErrorMap(iss: z.core.$ZodRawIssue): string {
  switch (iss.code) {
    case "invalid_type": {
      if (iss.input === undefined && (iss.path?.length ?? 0) > 0) return "поле обязательно, но отсутствует";
      return TYPE_NAMES[iss.expected] ?? "значение неподходящего вида";
    }
    case "too_small": {
      const origin = String(iss.origin);
      const min = Number(iss.minimum);
      if (origin === "string" && min === 1) return "не должно быть пустым";
      if (origin === "array" && min === 1) return "должен быть хотя бы один элемент";
      return `${subject(origin)} не может быть меньше ${bound(origin, min)}`;
    }
    case "too_big": {
      const origin = String(iss.origin);
      return `${subject(origin)} не может быть больше ${bound(origin, Number(iss.maximum))}`;
    }
    case "invalid_value": {
      const list = iss.values.map((v) => JSON.stringify(v)).join(", ");
      return `недопустимое значение, допустимо: ${list}`;
    }
    case "invalid_format":
      return "текст имеет неверный формат";
    case "not_multiple_of":
      return `число должно делиться на ${String(iss.divisor)}`;
    case "unrecognized_keys":
      return `неизвестные поля: ${iss.keys.join(", ")}`;
    case "invalid_union":
      return "значение не подходит ни под один из допустимых вариантов";
    case "invalid_key":
      return "недопустимый ключ";
    case "invalid_element":
      return "недопустимый элемент";
    case "custom":
      return "значение не прошло проверку";
    default:
      return "некорректное значение";
  }
}

/** Путь к полю в читаемом виде: `layers[0].tiles[5]`. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

/** Сообщение по первой проблеме: «<где>, поле <путь>: <что не так>». */
export function describeFirstIssue(error: z.ZodError, where: string): string {
  const issue = error.issues[0];
  if (!issue) return `${where}: некорректные данные`;
  const path = formatPath(issue.path);
  return path ? `${where}, поле ${path}: ${issue.message}` : `${where}: ${issue.message}`;
}
