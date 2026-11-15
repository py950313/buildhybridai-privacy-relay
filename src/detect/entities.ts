// Groups mentions into entities so every occurrence of the same person/number gets the same
// placeholder, wherever in the document it appears.
import { isAsciiWordChar, normalize } from './normalize';
import type { Entity, EntityType, Mention, Span } from './types';

// Name-like types merge when one spelling contains the other ("John" / "John Smith",
// "小明" / "王小明"). Other types merge only on an exact match of their key.
const SUBSTRING_TYPES = new Set<EntityType>(['PERSON', 'ORG', 'LOCATION', 'ADDRESS']);
const DIGIT_TYPES = new Set<EntityType>(['PHONE', 'CARD', 'ACCOUNT', 'ID_NUMBER']);

export function entityKey(type: EntityType, text: string): string {
  const n = normalize(text, { lower: true }).text.trim();
  if (DIGIT_TYPES.has(type)) {
    const d = n.replace(/[^0-9a-z]/g, '');
    return type === 'PHONE' ? d.replace(/^886/, '0') : d;
  }
  return n;
}

/** True if `part` appears in `whole` and, for ASCII edges, on word boundaries. */
export function containsAsWord(whole: string, part: string): boolean {
  if (part.length < 2 || part.length >= whole.length) return false;
  let i = whole.indexOf(part);
  while (i >= 0) {
    const okStart = !isAsciiWordChar(part[0]) || !isAsciiWordChar(whole[i - 1]);
    const okEnd = !isAsciiWordChar(part[part.length - 1]) || !isAsciiWordChar(whole[i + part.length]);
    if (okStart && okEnd) return true;
    i = whole.indexOf(part, i + 1);
  }
  return false;
}

type Group = { type: EntityType; keys: Set<string>; variants: string[]; firstAt: number };

export function buildEntities(spans: Span[]): { mentions: Mention[]; entities: Entity[] } {
  const groups: Group[] = [];
  const keyOf = spans.map((s) => entityKey(s.type, s.text));
  // Longest spellings first, so short forms attach to the full name rather than the reverse.
  const order = spans.map((_, i) => i).sort((a, b) => keyOf[b].length - keyOf[a].length || spans[a].start - spans[b].start);
  const groupOf = new Array<Group>(spans.length);
  for (const i of order) {
    const s = spans[i];
    const k = keyOf[i];
    let g = groups.find((x) => x.type === s.type && x.keys.has(k));
    if (!g && SUBSTRING_TYPES.has(s.type)) {
      g = groups.find((x) => x.type === s.type && [...x.keys].some((key) => containsAsWord(key, k)));
    }
    if (!g) {
      g = { type: s.type, keys: new Set(), variants: [], firstAt: s.start };
      groups.push(g);
    }
    g.keys.add(k);
    if (!g.variants.includes(s.text)) g.variants.push(s.text);
    g.firstAt = Math.min(g.firstAt, s.start);
    groupOf[i] = g;
  }
  // Number placeholders per type in order of first appearance in the text.
  const counters = new Map<EntityType, number>();
  const entities: Entity[] = [];
  const idOf = new Map<Group, string>();
  for (const g of [...groups].sort((a, b) => a.firstAt - b.firstAt)) {
    const n = (counters.get(g.type) ?? 0) + 1;
    counters.set(g.type, n);
    const id = `${g.type}_${n}`;
    idOf.set(g, id);
    const canonical = g.variants.reduce((a, b) => (b.length > a.length ? b : a));
    entities.push({ id, type: g.type, canonical, variants: g.variants, placeholder: `[${id}]` });
  }
  const mentions = spans.map((s, i) => ({ ...s, entityId: idOf.get(groupOf[i])! }));
  return { mentions, entities };
}

/** Confirmation screen: fold entity `dropId` into `keepId` (same placeholder from now on). */
export function mergeEntities(
  r: { mentions: Mention[]; entities: Entity[] }, keepId: string, dropId: string,
): { mentions: Mention[]; entities: Entity[] } {
  const keep = r.entities.find((e) => e.id === keepId);
  const drop = r.entities.find((e) => e.id === dropId);
  if (!keep || !drop || keepId === dropId) return r;
  const variants = [...keep.variants, ...drop.variants.filter((v) => !keep.variants.includes(v))];
  return {
    entities: r.entities.filter((e) => e.id !== dropId).map((e) => (e.id === keepId ? { ...e, variants } : e)),
    mentions: r.mentions.map((m) => (m.entityId === dropId ? { ...m, entityId: keepId } : m)),
  };
}

/**
 * Confirmation screen: give every mention spelled `variant` inside entity `fromId` its own new
 * entity (e.g. split "John" away from "John Smith" when they are different people).
 */
export function splitVariant(
  r: { mentions: Mention[]; entities: Entity[] }, fromId: string, variant: string,
): { mentions: Mention[]; entities: Entity[] } {
  const from = r.entities.find((e) => e.id === fromId);
  if (!from || from.variants.length < 2 || !from.variants.includes(variant)) return r;
  const used = r.entities.filter((e) => e.type === from.type).map((e) => Number(e.id.split('_').pop()));
  const id = `${from.type}_${Math.max(...used) + 1}`;
  return {
    entities: [
      ...r.entities.map((e) => (e.id === fromId ? { ...e, variants: e.variants.filter((v) => v !== variant),
        canonical: e.canonical === variant ? e.variants.find((v) => v !== variant)! : e.canonical } : e)),
      { id, type: from.type, canonical: variant, variants: [variant], placeholder: `[${id}]` },
    ],
    mentions: r.mentions.map((m) => (m.entityId === fromId && m.text === variant ? { ...m, entityId: id } : m)),
  };
}
