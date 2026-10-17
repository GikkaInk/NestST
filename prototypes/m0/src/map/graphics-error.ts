export const GPU_ERROR_MESSAGE =
  "Не удалось запустить графику. Обновите драйвер видеокарты или откройте журнал.";

/** Maps any graphics init failure to the user-facing Russian message. */
export function describeGraphicsError(_err: unknown): string {
  return GPU_ERROR_MESSAGE;
}
