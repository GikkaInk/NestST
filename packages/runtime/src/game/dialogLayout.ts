/**
 * Pure, deterministic layout of the dialog box: word-wrapping, a height that follows the
 * content (clamped to 60% of the screen), clipped text and a scrolling option window that
 * always contains the selected option. No Pixi, so it is unit-tested with a fake `measure`.
 */
export interface LayoutInput {
  screenW: number;
  screenH: number;
  /** Heading line (speaker name or "Error"), or null. */
  head: string | null;
  /** Body text (say text or error text); may contain "\n". */
  text: string;
  /** Choice options; when set the body text is ignored. */
  options: readonly string[] | null;
  selected: number;
  /** Last line, always visible (e.g. the error hint). */
  footer: string | null;
  /** Width in px of one line of text. */
  measure: (s: string) => number;
  /** Height of one text line. */
  lineH: number;
}

export interface Layout {
  boxW: number;
  boxH: number;
  head: string | null;
  /** Wrapped body lines that fit; the last ends with an ellipsis when `bodyClipped`. */
  body: string[];
  bodyClipped: boolean;
  /** Visible options, each wrapped to lines; `index` is the original index. */
  options: { index: number; lines: string[] }[];
  moreAbove: boolean;
  moreBelow: boolean;
  footer: string | null;
}

export const MARGIN = 8;
export const PAD = 10;
const MAX_FRACTION = 0.6;

/** Greedy word wrap; honours "\n" and hard-breaks words wider than `maxW`. */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    const flush = (): void => {
      out.push(line);
      line = "";
    };
    for (const word of para.split(" ")) {
      const cand = line === "" ? word : `${line} ${word}`;
      if (measure(cand) <= maxW) {
        line = cand;
        continue;
      }
      if (line !== "") flush();
      let rest = word;
      while (measure(rest) > maxW && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > maxW) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    flush();
  }
  return out;
}

export function layoutDialog(i: LayoutInput): Layout {
  const boxW = Math.max(40, Math.floor(i.screenW) - MARGIN * 2);
  const innerW = Math.max(10, boxW - PAD * 2);
  const lineH = Math.max(1, i.lineH);
  const maxH = Math.max(
    lineH + PAD * 2,
    Math.min(Math.floor(i.screenH * MAX_FRACTION), Math.floor(i.screenH) - MARGIN * 2),
  );
  const cap = Math.max(1, Math.floor((maxH - PAD * 2) / lineH));
  const fixed = (i.head !== null ? 1 : 0) + (i.footer !== null ? 1 : 0);
  const room = Math.max(1, cap - fixed);

  let body: string[] = [];
  let bodyClipped = false;
  let options: Layout["options"] = [];
  let moreAbove = false;
  let moreBelow = false;

  if (i.options === null) {
    body = wrapText(i.text, innerW, i.measure);
    if (body.length > room) {
      body = body.slice(0, room);
      body[room - 1] = `${body[room - 1]!.replace(/\s+$/, "")}...`;
      bodyClipped = true;
    }
  } else {
    const marker = i.measure("> ");
    const wrapped = i.options.map((o) => wrapText(o, Math.max(10, innerW - marker), i.measure));
    const n = wrapped.length;
    const sel = Math.min(Math.max(0, i.selected), Math.max(0, n - 1));
    let s = sel;
    let e = sel;
    const size = (): number => {
      let used = 0;
      for (let k = s; k <= e; k++) used += wrapped[k]!.length;
      return used + (s > 0 ? 1 : 0) + (e < n - 1 ? 1 : 0);
    };
    // Grow the window around the selection (below first, then above) while it fits.
    for (let grew = true; grew; ) {
      grew = false;
      if (e < n - 1) {
        e++;
        if (size() <= room) grew = true;
        else e--;
      }
      if (s > 0) {
        s--;
        if (size() <= room) grew = true;
        else s++;
      }
    }
    options = [];
    for (let k = s; k <= e; k++) options.push({ index: k, lines: wrapped[k]! });
    moreAbove = s > 0;
    moreBelow = e < n - 1;
    // A single option taller than the room is clipped to what fits.
    const avail = Math.max(1, room - (moreAbove ? 1 : 0) - (moreBelow ? 1 : 0));
    if (options.length === 1 && options[0]!.lines.length > avail) {
      options[0] = { index: options[0]!.index, lines: options[0]!.lines.slice(0, avail) };
    }
  }

  const optLines = options.reduce((a, o) => a + o.lines.length, 0);
  const lines =
    fixed + body.length + optLines + (moreAbove ? 1 : 0) + (moreBelow ? 1 : 0);
  const boxH = Math.min(maxH, Math.max(0, lines) * lineH + PAD * 2);
  return { boxW, boxH, head: i.head, body, bodyClipped, options, moreAbove, moreBelow, footer: i.footer };
}
