/** The bundled "lost-cat" example: project-relative path -> file text (README is not included). */
const raw = import.meta.glob("../../../examples/lost-cat/**/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PREFIX = "examples/lost-cat/";

export const EXAMPLE_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(raw).map(([key, text]) => [key.slice(key.indexOf(PREFIX) + PREFIX.length), text]),
);
