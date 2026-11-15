// Masking and restoring. The placeholder table lives only in memory (React state); nothing here
// persists or sends anything.
import { containsAsWord, entityKey } from '../detect/entities';
import { locate } from '../detect/locate';
import { normalize } from '../detect/normalize';
import type { Entity, Mention } from '../detect/types';

export const spanKey = (m: { start: number; end: number }) => `${m.start}:${m.end}`;

/** Variants shorter than this are not auto-expanded or leak-checked (single chars are too noisy). */
const MIN_VARIANT = 2;

/**
 * Adds a mention for every other occurrence of an included entity's spelling, so a name the
 * detector caught once is masked everywhere. Positions the user explicitly excluded stay excluded.
 */
export function expandOccurrences(
  text: string, mentions: Mention[], entities: Entity[], excluded: Set<string>,
  /** Entities masked in earlier turns: their spellings are masked in follow-ups too. */
  earlierIds: Set<string> = new Set(),
): Mention[] {
  const included = mentions.filter((m) => !excluded.has(spanKey(m)));
  const live = new Set([...included.map((m) => m.entityId), ...earlierIds]);
  const out = [...included];
  const overlaps = (s: number, e: number) => mentions.some((m) => s < m.end && m.start < e) || out.some((m) => s < m.end && m.start < e);
  for (const ent of entities) {
    if (!live.has(ent.id)) continue;
    for (const v of ent.variants) {
      if (normalize(v).text.trim().length < MIN_VARIANT) continue;
      for (const [s, e] of locate(text, v)) {
        if (overlaps(s, e)) continue;
        out.push({ start: s, end: e, text: text.slice(s, e), type: ent.type, source: 'manual', reason: 'same spelling as a marked item', entityId: ent.id });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function mask(text: string, mentions: Mention[], entities: Entity[]): string {
  const byId = new Map(entities.map((e) => [e.id, e]));
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.start - a.start)) {
    const e = byId.get(m.entityId);
    if (e) out = out.slice(0, m.start) + e.placeholder + out.slice(m.end);
  }
  return out;
}

/**
 * Last line of defence before anything leaves the device: returns the spellings of masked
 * entities that still appear in the outgoing text. Callers must refuse to send when non-empty.
 */
export function findLeaks(outgoing: string, entities: Entity[], maskedIds: Set<string>): string[] {
  const leaks: string[] = [];
  for (const e of entities) {
    if (!maskedIds.has(e.id)) continue;
    for (const v of e.variants) {
      if (normalize(v).text.trim().length < MIN_VARIANT) continue;
      if (locate(outgoing, v).length) leaks.push(v);
    }
  }
  return leaks;
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'restored'; text: string; placeholder: string; entityId: string }
  | { kind: 'invalid'; text: string; reason: 'malformed' | 'unknown' };

export type Restored = { segments: Segment[]; text: string; missing: string[]; invalid: number };

const TYPE_WORDS = new Set([
  'person', 'org', 'organization', 'organisation', 'location', 'address', 'email', 'phone', 'idnumber', 'id',
  'card', 'account', 'dateofbirth', 'dob', 'medical', 'financial', 'other',
]);
// Anything that could be a placeholder after the model touched it: [..N], 【..N】, ［..N］, or a
// bare PERSON_1 without brackets.
const CANDIDATE = /\[[^[\]\n]{1,40}?\d+\s*\]|【[^【】\n]{1,40}?\d+\s*】|［[^［］\n]{1,40}?\d+\s*］|\b[A-Z]+(?:_[A-Z]+)*_\d+\b/g;
const EXACT = /^\[([A-Z]+(?:_[A-Z]+)*_\d+)\]$/;

function looksLikePlaceholder(token: string): boolean {
  const inner = token.replace(/^[[【［]|[\]】］]$/g, '').replace(/\d+\s*$/, '');
  return TYPE_WORDS.has(inner.toLowerCase().replace(/[\s_-]/g, ''));
}

/**
 * Only an exact `[TYPE_N]` from the table is restored. A known type word in any other shape
 * ("[Person 1]", "PERSON_1", "【PERSON_1】") or an unknown id is flagged, never guessed.
 */
export function restore(response: string, entities: Entity[], sentPlaceholders: string[]): Restored {
  const byPlaceholder = new Map(entities.map((e) => [e.placeholder, e]));
  const segments: Segment[] = [];
  const seen = new Set<string>();
  let last = 0;
  let invalid = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = segments[segments.length - 1];
    if (prev?.kind === 'text') prev.text += t;
    else segments.push({ kind: 'text', text: t });
  };
  for (const m of response.matchAll(CANDIDATE)) {
    const tok = m[0];
    const exact = EXACT.exec(tok);
    let seg: Segment | null = null;
    if (exact) {
      const e = byPlaceholder.get(tok);
      if (e) {
        seg = { kind: 'restored', text: e.canonical, placeholder: tok, entityId: e.id };
        seen.add(tok);
      } else if (looksLikePlaceholder(tok)) {
        seg = { kind: 'invalid', text: tok, reason: 'unknown' };
      }
    } else if (looksLikePlaceholder(tok)) {
      seg = { kind: 'invalid', text: tok, reason: 'malformed' };
    }
    if (!seg) continue;
    pushText(response.slice(last, m.index));
    segments.push(seg);
    if (seg.kind === 'invalid') invalid++;
    last = m.index! + tok.length;
  }
  pushText(response.slice(last));
  return {
    segments,
    text: segments.map((s) => s.text).join(''),
    missing: [...new Set(sentPlaceholders)].filter((p) => !seen.has(p)),
    invalid,
  };
}

export const placeholdersIn = (masked: string, entities: Entity[]) =>
  entities.map((e) => e.placeholder).filter((p) => masked.includes(p));

/**
 * Follow-up questions: entities found in the new input reuse the placeholder of a matching
 * entity from earlier turns (same type and same or containing spelling); others get new numbers.
 */
export function reconcile(
  table: Entity[], fresh: { mentions: Mention[]; entities: Entity[] },
): { mentions: Mention[]; table: Entity[] } {
  const next = table.map((e) => ({ ...e, variants: [...e.variants] }));
  const idMap = new Map<string, string>();
  const nextNumber = (type: string) =>
    1 + Math.max(0, ...next.filter((e) => e.type === type).map((e) => Number(e.id.split('_').pop())));
  for (const f of fresh.entities) {
    const fKeys = f.variants.map((v) => entityKey(f.type, v));
    const match = next.find((e) => {
      if (e.type !== f.type) return false;
      const eKeys = e.variants.map((v) => entityKey(e.type, v));
      if (fKeys.some((k) => eKeys.includes(k))) return true;
      const nameLike = ['PERSON', 'ORG', 'LOCATION', 'ADDRESS'].includes(e.type);
      return nameLike && fKeys.some((fk) => eKeys.some((ek) => containsAsWord(ek, fk) || containsAsWord(fk, ek)));
    });
    if (match) {
      idMap.set(f.id, match.id);
      for (const v of f.variants) if (!match.variants.includes(v)) match.variants.push(v);
      if (f.canonical.length > match.canonical.length) match.canonical = f.canonical;
    } else {
      const id = `${f.type}_${nextNumber(f.type)}`;
      idMap.set(f.id, id);
      next.push({ ...f, id, placeholder: `[${id}]` });
    }
  }
  return { mentions: fresh.mentions.map((m) => ({ ...m, entityId: idMap.get(m.entityId) ?? m.entityId })), table: next };
}
