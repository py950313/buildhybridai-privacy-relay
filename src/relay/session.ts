// Confirmation-screen state: detected spans + the user's edits, derived into mentions/entities
// that share placeholders with earlier turns. Pure functions; the React layer just stores Draft.
import { buildEntities, mergeEntities, splitVariant } from '../detect/entities';
import { locate } from '../detect/locate';
import { mergeSpans } from '../detect/merge';
import type { DetectionResult, Entity, EntityType, Mention, Span, Unlocated } from '../detect/types';
import { expandOccurrences, findLeaks, mask, reconcile, spanKey } from './placeholders';

export type EditOp = { kind: 'merge'; keep: string; drop: string } | { kind: 'split'; from: string; variant: string };

export type Draft = {
  text: string;
  spans: Span[];
  ops: EditOp[];
  excluded: string[]; // spanKey of mentions the user chose not to mask
  unlocated: Unlocated[];
  warnings: string[];
};

export const draftFrom = (r: DetectionResult): Draft => ({
  text: r.text, spans: r.mentions.map((m) => ({ start: m.start, end: m.end, text: m.text, type: m.type, source: m.source, reason: m.reason })), ops: [], excluded: [], unlocated: r.unlocated, warnings: r.warnings,
});

export type Derived = { mentions: Mention[]; entities: Entity[]; table: Entity[] };

/** `table` = all entities of the session (earlier turns + this draft); `entities` = this draft's. */
export function derive(d: Draft, table: Entity[]): Derived {
  const base = buildEntities(mergeSpans(d.text, d.spans));
  const rec = reconcile(table, base);
  let state = { mentions: rec.mentions, entities: rec.table };
  for (const op of d.ops) {
    state = op.kind === 'merge' ? mergeEntities(state, op.keep, op.drop) : splitVariant(state, op.from, op.variant);
  }
  const used = new Set(state.mentions.map((m) => m.entityId));
  return { mentions: state.mentions, entities: state.entities.filter((e) => used.has(e.id)), table: state.entities };
}

/** Manual mark: every occurrence of the selected text becomes a manual span of `type`. */
export function addManual(d: Draft, start: number, end: number, type: EntityType): Draft {
  const sel = d.text.slice(start, end).trim();
  if (!sel) return d;
  const hits = locate(d.text, sel);
  const spans = hits.length ? hits : [[start, end] as [number, number]];
  const manual = spans.map(([s, e]) => ({ start: s, end: e, text: d.text.slice(s, e), type, source: 'manual' as const }));
  const keys = new Set(manual.map(spanKey));
  return { ...d, spans: [...d.spans, ...manual], excluded: d.excluded.filter((k) => !keys.has(k)) };
}

export function toggleMention(d: Draft, m: { start: number; end: number }): Draft {
  const k = spanKey(m);
  return { ...d, excluded: d.excluded.includes(k) ? d.excluded.filter((x) => x !== k) : [...d.excluded, k] };
}

export function setEntityMasked(d: Draft, derived: Derived, entityId: string, masked: boolean): Draft {
  const keys = derived.mentions.filter((m) => m.entityId === entityId).map(spanKey);
  const rest = d.excluded.filter((k) => !keys.includes(k));
  return { ...d, excluded: masked ? rest : [...rest, ...keys] };
}

export type Outgoing = { masked: string; table: Entity[]; maskedIds: Set<string>; mentions: Mention[] };

/**
 * Produces the text to send. Throws if any masked spelling is still present, so a bug here can
 * never turn into a silent leak.
 */
export function prepareOutgoing(d: Draft, table: Entity[], wrap: (maskedBody: string) => string): Outgoing {
  const der = derive(d, table);
  const excluded = new Set(d.excluded);
  // An earlier entity the user un-marked in this draft is not forced back in.
  const unmarked = new Set(der.mentions.filter((m) => excluded.has(spanKey(m))).map((m) => m.entityId));
  for (const m of der.mentions) if (!excluded.has(spanKey(m))) unmarked.delete(m.entityId);
  const earlier = new Set(table.map((e) => e.id).filter((id) => !unmarked.has(id)));
  const mentions = expandOccurrences(d.text, der.mentions, der.table, excluded, earlier);
  const body = mask(d.text, mentions, der.table);
  const maskedIds = new Set([...mentions.map((m) => m.entityId), ...earlier]);
  // Checked on the masked body only (the wrapper is our fixed instruction text), with the
  // positions the user deliberately left in clear blanked out.
  const SKIP = '__USER_EXCLUDED__';
  const skipEntity: Entity = { id: SKIP, type: 'OTHER', canonical: '', variants: [], placeholder: '⁣' };
  const left = der.mentions.filter((m) => excluded.has(spanKey(m))).map((m) => ({ ...m, entityId: SKIP }));
  const checkText = mask(d.text, [...mentions, ...left], [...der.table, skipEntity]);
  const leaks = findLeaks(checkText, der.table, maskedIds);
  if (leaks.length) throw new Error(`Refusing to send: ${leaks.length} marked item(s) still visible in the outgoing text`);
  return { masked: wrap(body), table: der.table, maskedIds, mentions };
}

export function countByType(mentions: Mention[]): Partial<Record<EntityType, number>> {
  const ids = new Map<string, EntityType>();
  for (const m of mentions) ids.set(m.entityId, m.type);
  const out: Partial<Record<EntityType, number>> = {};
  for (const t of ids.values()) out[t] = (out[t] ?? 0) + 1;
  return out;
}
