import type { Span, SpanSource } from './types';

// Higher wins. Manual marks from the confirmation screen beat every detector.
const SOURCE_RANK: Record<SpanSource, number> = { manual: 3, regex: 2, nano: 1, gliner: 0 };

/**
 * Overlapping spans become one span covering their union. Its type, source and reason come from
 * the highest-ranked source in the group (regex > nano > gliner); ties go to the longer span.
 * Identical spans found twice (chunk overlap) collapse into one.
 */
export function mergeSpans(text: string, spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  let group: Span[] = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const end = Math.max(...group.map((s) => s.end));
    const win = group.reduce((a, b) =>
      SOURCE_RANK[b.source] > SOURCE_RANK[a.source] ||
      (SOURCE_RANK[b.source] === SOURCE_RANK[a.source] && b.end - b.start > a.end - a.start) ? b : a);
    out.push({ start, end, text: text.slice(start, end), type: win.type, source: win.source, reason: win.reason });
    group = [];
  };
  for (const s of sorted) {
    if (group.length && s.start >= groupEnd) flush();
    group.push(s);
    groupEnd = Math.max(groupEnd, s.end);
    if (group.length === 1) groupEnd = s.end;
  }
  flush();
  return out;
}
