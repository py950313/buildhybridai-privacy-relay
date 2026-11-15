// Orchestrates the detection layers: regex on the whole text, model layers chunk by chunk, then
// program-side location, merge and entity grouping. Model layers never supply offsets.
import { chunkText } from './chunk';
import { buildEntities } from './entities';
import { locate } from './locate';
import { mergeSpans } from './merge';
import { detectRegex } from './regex';
import type { DetectionLayer, DetectionResult, Span, Unlocated } from './types';

export type DetectOptions = {
  layers?: DetectionLayer[];
  chunkTokens?: number;
  overlapTokens?: number;
  /** Spans the user marked by hand on the confirmation screen. */
  manual?: Span[];
};

export async function detect(text: string, opts: DetectOptions = {}): Promise<DetectionResult> {
  const { layers = [], chunkTokens = 1500, overlapTokens = 200, manual = [] } = opts;
  const spans: Span[] = [...detectRegex(text), ...manual];
  const unlocated: Unlocated[] = [];
  const warnings: string[] = [];
  const chunks = layers.length ? chunkText(text, chunkTokens, overlapTokens) : [];

  for (const layer of layers) {
    for (const chunk of chunks) {
      let items;
      try {
        items = await layer.detect(chunk.text);
      } catch (e) {
        warnings.push(`${layer.source} failed on chunk ${chunk.index}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const item of items) {
        const hits = locate(chunk.text, item.text);
        if (!hits.length) {
          const dup = unlocated.some((u) => u.text === item.text && u.source === layer.source);
          if (!dup && item.text.trim()) unlocated.push({ ...item, source: layer.source, chunkIndex: chunk.index });
          continue;
        }
        for (const [s, e] of hits) {
          const start = chunk.start + s;
          const end = chunk.start + e;
          spans.push({ start, end, text: text.slice(start, end), type: item.type, source: layer.source, reason: item.reason });
        }
      }
    }
  }

  const merged = mergeSpans(text, spans);
  const { mentions, entities } = buildEntities(merged);
  return { text, mentions, entities, unlocated, warnings };
}
