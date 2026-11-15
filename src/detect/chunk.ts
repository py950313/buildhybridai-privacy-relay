// Splits long input into paragraph-bounded chunks for the model layers. Offsets are kept so that
// chunk-local positions can be mapped back to the full text before merging.

export type Chunk = { index: number; start: number; end: number; text: string };

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/g;

/** Rough token estimate: one token per CJK/kana/hangul char, ~4 chars per token otherwise. */
export function estimateTokens(s: string): number {
  const cjk = s.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

type Piece = { start: number; end: number; tokens: number };

/** Paragraphs (split on newlines), with any paragraph larger than maxTokens hard-split. */
function pieces(text: string, maxTokens: number): Piece[] {
  const out: Piece[] = [];
  const re = /[^\n]+\n*|\n+/g;
  for (const m of text.matchAll(re)) {
    const s = m.index!;
    const e = s + m[0].length;
    const t = estimateTokens(m[0]);
    if (t <= maxTokens) {
      out.push({ start: s, end: e, tokens: t });
      continue;
    }
    // Oversized paragraph: cut at sentence ends where possible, else at a fixed char width.
    const width = Math.max(1, Math.floor((m[0].length * maxTokens) / t));
    let p = s;
    while (p < e) {
      let q = Math.min(e, p + width);
      if (q < e) {
        const window = text.slice(p, q);
        const cut = Math.max(...['。', '！', '？', '. ', '! ', '? ', '；', '; '].map((x) => window.lastIndexOf(x)));
        if (cut > width / 2) q = p + cut + 1;
      }
      out.push({ start: p, end: q, tokens: estimateTokens(text.slice(p, q)) });
      p = q;
    }
  }
  return out;
}

export function chunkText(text: string, maxTokens: number, overlapTokens: number): Chunk[] {
  if (!text) return [];
  const ps = pieces(text, maxTokens);
  const chunks: Chunk[] = [];
  let i = 0; // first piece not yet covered
  let prevFirst = -1; // first piece of the previous chunk
  while (i < ps.length) {
    // Overlap: re-include trailing pieces of the previous chunk, up to overlapTokens, but never
    // all of them (each chunk must make progress past the previous one's start).
    let first = i;
    let budget = overlapTokens;
    while (first - 1 > prevFirst && ps[first - 1].tokens <= budget) {
      budget -= ps[first - 1].tokens;
      first--;
    }
    let tokens = 0;
    let j = i;
    while (j < ps.length && (j === i || tokens + ps[j].tokens <= maxTokens)) {
      tokens += ps[j].tokens;
      j++;
    }
    const start = ps[first].start;
    const end = ps[j - 1].end;
    chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) });
    prevFirst = first;
    i = j;
  }
  return chunks;
}
