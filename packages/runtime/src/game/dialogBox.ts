import { Container, Graphics, Text } from "pixi.js";
import { layoutDialog, MARGIN, PAD } from "./dialogLayout.js";
import type { DialogView } from "./session.js";

export interface DialogBox {
  /** Screen-space overlay: put it on the stage above everything, unscaled. */
  container: Container;
  /** `null` hides; `errorText` (with no view) shows an error line. */
  show(view: DialogView | null, errorText?: string): void;
  resize(w: number, h: number): void;
  destroy(): void;
}

const BG = 0x2a2238;
const BORDER = 0xb9a8e0;
const NAME_COLOR = 0xffc8dd;
const TEXT_COLOR = 0xf6f1ff;
const PICK_COLOR = 0xffe08a;
const ERROR_COLOR = 0xff9a9a;
const HINT_COLOR = 0xb9a8e0;
const FONT = 14;
const LINE_H = FONT + 4;
const ERROR_HINT = "Press Space to continue";

/** Conservative width estimate (the layout wraps the text itself, so Text never re-wraps). */
const measure = (s: string): number => s.length * FONT * 0.6;

/** What was last shown: a cheap snapshot to compare against without serialising. */
interface Shown {
  view: DialogView | null;
  error: string | undefined;
  selected: number;
  speaker: string;
  text: string;
  options: string[];
}

function snapshot(view: DialogView | null, error: string | undefined): Shown {
  return {
    view,
    error,
    selected: view?.kind === "choice" ? view.selected : -1,
    speaker: view?.kind === "say" ? view.speaker : "",
    text: view?.kind === "say" ? view.text : "",
    options: view?.kind === "choice" ? view.options.map((o) => o.text) : [],
  };
}

function same(a: Shown, b: DialogView | null, error: string | undefined): boolean {
  if (a.error !== error) return false;
  if (a.view === null || b === null) return a.view === b;
  if (a.view.kind !== b.kind) return false;
  if (b.kind === "say") return a.speaker === b.speaker && a.text === b.text;
  return (
    a.selected === b.selected &&
    a.options.length === b.options.length &&
    a.options.every((t, i) => t === b.options[i]!.text)
  );
}

/** Soft rounded dark box at the bottom of the screen; its height follows the content. */
export function createDialogBox(width: number, height: number): DialogBox {
  const container = new Container({ label: "dialog-box" });
  container.visible = false;
  const bg = new Graphics();
  const content = new Container({ label: "dialog-content" });
  container.addChild(bg, content);

  let w = width;
  let h = height;
  let shown: Shown | null = null;
  let destroyed = false;

  const text = (value: string, fill: number, row: number): Text => {
    const t = new Text({ text: value, style: { fontSize: FONT, fill, lineHeight: LINE_H } });
    t.position.set(PAD, PAD + row * LINE_H);
    return t;
  };

  const rebuild = (): void => {
    for (const child of content.removeChildren()) child.destroy({ children: true });
    if (shown === null || (shown.view === null && shown.error === undefined)) return;
    const v = shown.view;
    const layout = layoutDialog({
      screenW: w,
      screenH: h,
      head: v === null ? "Error" : v.kind === "say" ? v.speaker : null,
      text: v === null ? (shown.error ?? "") : v.kind === "say" ? v.text : "",
      options: v !== null && v.kind === "choice" ? shown.options : null,
      selected: shown.selected,
      footer: v === null ? ERROR_HINT : null,
      measure,
      lineH: LINE_H,
    });
    let row = 0;
    if (layout.head !== null) content.addChild(text(layout.head, v === null ? ERROR_COLOR : NAME_COLOR, row++));
    if (layout.body.length > 0) {
      content.addChild(text(layout.body.join("\n"), TEXT_COLOR, row));
      row += layout.body.length;
    }
    if (layout.moreAbove) content.addChild(text("   ^", HINT_COLOR, row++));
    for (const o of layout.options) {
      const picked = o.index === shown.selected;
      const lines = o.lines.map((l, k) => (k === 0 ? (picked ? "> " : "  ") : "  ") + l);
      content.addChild(text(lines.join("\n"), picked ? PICK_COLOR : TEXT_COLOR, row));
      row += o.lines.length;
    }
    if (layout.moreBelow) content.addChild(text("   v", HINT_COLOR, row++));
    if (layout.footer !== null) content.addChild(text(layout.footer, HINT_COLOR, row++));
    container.position.set(MARGIN, Math.max(0, h - layout.boxH - MARGIN));
    bg.clear()
      .roundRect(0, 0, layout.boxW, layout.boxH, 10)
      .fill({ color: BG, alpha: 0.94 })
      .stroke({ width: 2, color: BORDER });
  };

  return {
    container,
    show(view, errorText) {
      if (destroyed) return;
      const error = view === null ? errorText : undefined;
      container.visible = view !== null || error !== undefined;
      if (shown !== null && same(shown, view, error)) return;
      shown = snapshot(view, error);
      rebuild();
    },
    resize(nw, nh) {
      if (destroyed) return;
      w = nw;
      h = nh;
      rebuild();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.destroy({ children: true });
    },
  };
}
