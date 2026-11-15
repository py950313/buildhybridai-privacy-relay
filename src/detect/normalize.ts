// Width/whitespace normalization that keeps a map back to original offsets, so matches found on
// the normalized string can be reported against the text the user actually typed.

export type Normalized = {
  text: string;
  /** map[i] = original index of normalized char i; map[text.length] = original length. */
  map: number[];
};

const DASHES = /[‐-―−﹘﹣]/;

function foldChar(ch: string, lower: boolean): string {
  const c = ch.charCodeAt(0);
  let out = ch;
  if (c >= 0xff01 && c <= 0xff5e) out = String.fromCharCode(c - 0xfee0); // full-width ASCII
  else if (DASHES.test(ch)) out = '-';
  if (lower) {
    const l = out.toLowerCase();
    if (l.length === out.length) out = l; // skip length-changing cases (e.g. U+0130)
  }
  return out;
}

/**
 * Full-width ASCII -> half-width, dash variants -> '-', every whitespace run -> one space.
 * Output length never exceeds input length and each output char comes from exactly one input char.
 */
export function normalize(input: string, opts: { lower?: boolean } = {}): Normalized {
  const lower = opts.lower ?? false;
  let text = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (/\s/.test(ch) || ch === '　') {
      if (!inSpace) {
        text += ' ';
        map.push(i);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    text += foldChar(ch, lower);
    map.push(i);
  }
  map.push(input.length);
  return { text, map };
}

/** Converts a [start, end) range on the normalized string to the original string. */
export function toOriginal(n: Normalized, start: number, end: number): [number, number] {
  return [n.map[start], end > start ? n.map[end - 1] + 1 : n.map[start]];
}

export const isAsciiWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
