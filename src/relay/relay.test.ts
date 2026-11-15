// protects: masking replaces every included mention (and every other occurrence of the same
//   spelling), the leak check catches anything left, restore only accepts exact placeholders,
//   follow-ups reuse placeholders, and the router keeps unsupported work off the device.
// fails_when: a marked spelling survives in outgoing text, a mangled placeholder ("[Person 1]")
//   is silently restored or guessed, a follow-up name gets a new number, or a zh/long/analyze
//   task is routed locally.
// no_claim: what the network actually carries; that is the Playwright privacy test (tests/e2e).
import { describe, expect, it } from 'vitest';
import { detect } from '../detect/engine';
import type { DetectionLayer, RawItem } from '../detect/types';
import { expandOccurrences, findLeaks, mask, placeholdersIn, reconcile, restore, spanKey } from './placeholders';
import { decideRoute } from './router';

const layer = (items: RawItem[]): DetectionLayer => ({ source: 'gliner', detect: async () => items });

describe('mask', () => {
  it('replaces mentions and leaves nothing marked in the text', async () => {
    const text = 'John Smith (john@acme-demo.com) met John at Acme.';
    const r = await detect(text, { layers: [layer([{ text: 'John Smith', type: 'PERSON' }, { text: 'John', type: 'PERSON' }])] });
    const ms = expandOccurrences(text, r.mentions, r.entities, new Set());
    const out = mask(text, ms, r.entities);
    expect(out).toBe('[PERSON_1] ([EMAIL_1]) met [PERSON_1] at Acme.');
    expect(findLeaks(out, r.entities, new Set(ms.map((m) => m.entityId)))).toEqual([]);
  });

  it('expands a name found once to its other occurrences', async () => {
    const text = 'Mary Jones called. Later Mary Jones emailed.';
    const r = await detect(text, { layers: [layer([])] });
    // Simulate a detector that only saw the first occurrence.
    const one = [{ start: 0, end: 10, text: 'Mary Jones', type: 'PERSON' as const, source: 'gliner' as const, entityId: 'PERSON_1' }];
    const ents = [{ id: 'PERSON_1', type: 'PERSON' as const, canonical: 'Mary Jones', variants: ['Mary Jones'], placeholder: '[PERSON_1]' }];
    expect(r.mentions).toEqual([]);
    const out = mask(text, expandOccurrences(text, one, ents, new Set()), ents);
    expect(out).toBe('[PERSON_1] called. Later [PERSON_1] emailed.');
  });

  it('an excluded mention stays in clear text and its entity is not leak-checked', async () => {
    const text = 'Call 0912-345-678.';
    const r = await detect(text);
    const excluded = new Set([spanKey(r.mentions[0])]);
    const ms = expandOccurrences(text, r.mentions, r.entities, excluded);
    expect(mask(text, ms, r.entities)).toBe(text);
  });

  it('findLeaks reports a masked spelling still present', () => {
    const ents = [{ id: 'PERSON_1', type: 'PERSON' as const, canonical: 'Ann Lee', variants: ['Ann Lee'], placeholder: '[PERSON_1]' }];
    expect(findLeaks('Hello ann  lee', ents, new Set(['PERSON_1']))).toEqual(['Ann Lee']);
  });
});

describe('restore', () => {
  const ents = [
    { id: 'PERSON_1', type: 'PERSON' as const, canonical: 'John Smith', variants: ['John Smith'], placeholder: '[PERSON_1]' },
    { id: 'EMAIL_1', type: 'EMAIL' as const, canonical: 'john@acme-demo.com', variants: ['john@acme-demo.com'], placeholder: '[EMAIL_1]' },
  ];
  it('restores exact placeholders', () => {
    const r = restore('Dear [PERSON_1], see [EMAIL_1].', ents, ['[PERSON_1]', '[EMAIL_1]']);
    expect(r.text).toBe('Dear John Smith, see john@acme-demo.com.');
    expect(r.invalid).toBe(0);
    expect(r.missing).toEqual([]);
  });
  it('flags "[Person 1]" and other mangled forms without restoring', () => {
    const r = restore('Dear [Person 1] and PERSON_1 and 【PERSON_1】.', ents, ['[PERSON_1]']);
    expect(r.segments.filter((s) => s.kind === 'invalid').map((s) => s.text)).toEqual(['[Person 1]', 'PERSON_1', '【PERSON_1】']);
    expect(r.text).not.toContain('John Smith');
    expect(r.missing).toEqual(['[PERSON_1]']);
  });
  it('flags unknown ids and ignores ordinary brackets', () => {
    const r = restore('See [PERSON_9] and reference [1] and [Step 2].', ents, []);
    expect(r.segments.filter((s) => s.kind === 'invalid').map((s) => s.text)).toEqual(['[PERSON_9]']);
    expect(r.text).toBe('See [PERSON_9] and reference [1] and [Step 2].');
  });
  it('lists placeholders that were sent but did not come back', () => {
    expect(restore('Thanks!', ents, ['[PERSON_1]']).missing).toEqual(['[PERSON_1]']);
    expect(placeholdersIn('Hi [EMAIL_1]', ents)).toEqual(['[EMAIL_1]']);
  });
});

describe('reconcile (follow-up questions)', () => {
  it('reuses earlier placeholders and numbers new entities after them', async () => {
    const first = await detect('John Smith called.', { layers: [layer([{ text: 'John Smith', type: 'PERSON' }])] });
    const second = await detect('Ask John and Mary Lee.', {
      layers: [layer([{ text: 'John', type: 'PERSON' }, { text: 'Mary Lee', type: 'PERSON' }])],
    });
    expect(second.entities.map((e) => e.id)).toEqual(['PERSON_1', 'PERSON_2']); // fresh numbering collides
    const { mentions, table } = reconcile(first.entities, second);
    expect(mentions.map((m) => m.entityId)).toEqual(['PERSON_1', 'PERSON_2']);
    expect(table.find((e) => e.id === 'PERSON_1')!.variants).toEqual(['John Smith', 'John']);
    expect(table.find((e) => e.id === 'PERSON_2')!.canonical).toBe('Mary Lee');
  });
});

describe('decideRoute', () => {
  const base = { task: 'rewrite' as const, tokens: 100, lang: 'en' as const, nanoReady: true, maxTokens: 3000 };
  it('short supported task stays local', () => expect(decideRoute(base).route).toBe('local'));
  it.each([
    ['no Nano', { nanoReady: false }],
    ['analyze', { task: 'analyze' as const }],
    ['Chinese input', { lang: 'zh' as const }],
    ['too long', { tokens: 3001 }],
    ['translate to Chinese', { task: 'translate' as const, translateTarget: 'zh' as const }],
  ])('%s goes to the cloud', (_, patch) => expect(decideRoute({ ...base, ...patch }).route).toBe('cloud'));
});
