import { Container, Graphics, Text } from "pixi.js";
import type { DialogView } from "./session.js";

export interface DialogBox {
  /** Screen-space overlay: put it on the stage above everything, unscaled. */
  container: Container;
  /** `null` hides; `errorText` (with no view) shows an error line. */
  show(view: DialogView | null, errorText?: string): void;
  resize(w: number, h: number): void;
  destroy(): void;
}

const MARGIN = 8;
const PAD = 10;
const FONT = 14;
const BG = 0x2a2238;
const BORDER = 0xb9a8e0;
const NAME_COLOR = 0xffc8dd;
const TEXT_COLOR = 0xf6f1ff;
const PICK_COLOR = 0xffe08a;
const ERROR_COLOR = 0xff9a9a;

/** Soft rounded dark box at the bottom of the screen: speaker, wrapped text, option list. */
export function createDialogBox(width: number, height: number): DialogBox {
  const container = new Container({ label: "dialog-box" });
  container.visible = false;
  const bg = new Graphics();
  const content = new Container({ label: "dialog-content" });
  container.addChild(bg, content);

  let w = width;
  let h = height;
  let current: { view: DialogView | null; error: string | undefined } = { view: null, error: undefined };
  let key = "";
  let destroyed = false;

  const boxW = (): number => Math.max(40, w - MARGIN * 2);
  const boxH = (): number => Math.max(60, Math.min(160, Math.round(h * 0.3)));

  const text = (value: string, fill: number, wrap: boolean, y: number): Text => {
    const t = new Text({
      text: value,
      style: {
        fontSize: FONT,
        fill,
        wordWrap: wrap,
        wordWrapWidth: Math.max(10, boxW() - PAD * 2),
        lineHeight: FONT + 4,
      },
    });
    t.position.set(PAD, y);
    return t;
  };

  const place = (): void => {
    container.position.set(MARGIN, Math.max(0, h - boxH() - MARGIN));
    bg.clear()
      .roundRect(0, 0, boxW(), boxH(), 10)
      .fill({ color: BG, alpha: 0.94 })
      .stroke({ width: 2, color: BORDER });
  };

  const rebuild = (): void => {
    for (const child of content.removeChildren()) child.destroy({ children: true });
    const { view, error } = current;
    if (view === null) {
      if (error !== undefined) {
        const head = text("Error", ERROR_COLOR, false, PAD / 2);
        content.addChild(head, text(error, TEXT_COLOR, true, PAD / 2 + FONT + 6));
      }
    } else if (view.kind === "say") {
      const name = text(view.speaker, NAME_COLOR, false, PAD / 2);
      content.addChild(name, text(view.text, TEXT_COLOR, true, PAD / 2 + FONT + 6));
    } else {
      view.options.forEach((o, i) => {
        const picked = i === view.selected;
        content.addChild(
          text(`${picked ? "> " : "  "}${o.text}`, picked ? PICK_COLOR : TEXT_COLOR, false, PAD / 2 + i * (FONT + 6)),
        );
      });
    }
  };

  place();
  return {
    container,
    show(view, errorText) {
      if (destroyed) return;
      const error = view === null ? errorText : undefined;
      const next = view === null && error === undefined ? "" : JSON.stringify([view, error]);
      container.visible = next !== "";
      if (next === key) return;
      key = next;
      current = { view, error };
      rebuild();
    },
    resize(nw, nh) {
      if (destroyed) return;
      w = nw;
      h = nh;
      place();
      rebuild();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.destroy({ children: true });
    },
  };
}
