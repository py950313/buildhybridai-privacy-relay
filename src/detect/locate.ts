import { isAsciiWordChar, normalize, toOriginal } from './normalize';

/**
 * Finds every non-overlapping occurrence of `snippet` in `text` and returns original offsets.
 * Matching ignores width, case and whitespace differences. A snippet that starts or ends with an
 * ASCII letter/digit must sit on a word boundary there, so "Ann" never matches inside "Annual".
 */
export function locate(text: string, snippet: string): [number, number][] {
  const needle = normalize(snippet.trim(), { lower: true }).text;
  if (!needle) return [];
  const hay = normalize(text, { lower: true });
  const h = hay.text;
  const checkStart = isAsciiWordChar(needle[0]);
  const checkEnd = isAsciiWordChar(needle[needle.length - 1]);
  const out: [number, number][] = [];
  let from = 0;
  while (from <= h.length - needle.length) {
    const i = h.indexOf(needle, from);
    if (i < 0) break;
    const j = i + needle.length;
    const okStart = !checkStart || !isAsciiWordChar(h[i - 1]);
    const okEnd = !checkEnd || !isAsciiWordChar(h[j]);
    if (okStart && okEnd) {
      out.push(toOriginal(hay, i, j));
      from = j;
    } else {
      from = i + 1;
    }
  }
  return out;
}
