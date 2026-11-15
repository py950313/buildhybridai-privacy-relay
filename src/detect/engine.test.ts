// protects: the pipeline glue: chunk offsets -> global offsets, merge priority, entity grouping
//   across chunks, and the "unlocated" path for hallucinated model output.
// fails_when: chunk-local positions leak into results, a duplicate from chunk overlap creates a
//   second mention, the same name gets two placeholders, or invented snippets are dropped/marked.
// no_claim: real GLiNER/Nano quality. Model layers here are fakes returning fixed items; real
//   model accuracy is measured in #8.
import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk';
import { detect } from './engine';
import { mergeEntities, splitVariant } from './entities';
import type { DetectionLayer, RawItem } from './types';

const fake = (source: 'gliner' | 'nano', fn: (chunk: string) => RawItem[]): DetectionLayer & { calls: string[] } => {
  const calls: string[] = [];
  return { source, calls, detect: async (c) => { calls.push(c); return fn(c); } };
};

describe('chunkText', () => {
  it('chunks are exact slices, cover the text, and overlap', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(40)).join('\n');
    const chunks = chunkText(text, 120, 60);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.text);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeLessThan(chunks[i - 1].end); // overlap
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start); // progress
    }
  });
  it('hard-splits a single oversized paragraph', () => {
    const text = '這是一句很長的話。'.repeat(200);
    const chunks = chunkText(text, 300, 0);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });
});

describe('detect', () => {
  it('same person in paragraph 1 and 3 (different chunks) gets one placeholder', async () => {
    const filler = 'Nothing sensitive here, just a long paragraph about schedules. '.repeat(30);
    const text = `John Smith joined the call.\n${filler}\n${filler}\nLater, John said the budget is fine.`;
    const g = fake('gliner', (c) => [
      ...(c.includes('John Smith') ? [{ text: 'John Smith', type: 'PERSON' as const }] : []),
      ...(c.includes('John said') ? [{ text: 'John', type: 'PERSON' as const }] : []),
    ]);
    const r = await detect(text, { layers: [g], chunkTokens: 500, overlapTokens: 50 });
    expect(g.calls.length).toBeGreaterThan(1);
    const people = r.mentions.filter((m) => m.type === 'PERSON');
    expect(people.map((m) => m.text)).toEqual(['John Smith', 'John']);
    expect(new Set(people.map((m) => m.entityId)).size).toBe(1);
    expect(r.entities.find((e) => e.type === 'PERSON')!.placeholder).toBe('[PERSON_1]');
  });

  it('Chinese given name merges with the full name', async () => {
    const text = '王小明今天請假。小明下週回來。李大華代理。';
    const g = fake('gliner', () => [
      { text: '王小明', type: 'PERSON' }, { text: '小明', type: 'PERSON' }, { text: '李大華', type: 'PERSON' },
    ]);
    const r = await detect(text, { layers: [g] });
    const ids = r.mentions.map((m) => m.entityId);
    expect(ids).toEqual(['PERSON_1', 'PERSON_1', 'PERSON_2']);
  });

  it('Nano snippet missing from the text goes to unlocated, not to mentions', async () => {
    const text = 'Please summarize the attached notes.';
    const n = fake('nano', () => [{ text: 'Dr. Alice Chen', type: 'PERSON', reason: 'invented' }]);
    const r = await detect(text, { layers: [n] });
    expect(r.mentions).toEqual([]);
    expect(r.unlocated).toEqual([{ text: 'Dr. Alice Chen', type: 'PERSON', reason: 'invented', source: 'nano', chunkIndex: 0 }]);
  });

  it('overlapping spans merge with regex > nano > gliner priority', async () => {
    const text = 'Call 0912-345-678 now';
    const g = fake('gliner', () => [{ text: 'Call 0912', type: 'OTHER' }]);
    const n = fake('nano', () => [{ text: '0912-345-678', type: 'ACCOUNT' }]);
    const r = await detect(text, { layers: [g, n] });
    expect(r.mentions).toHaveLength(1);
    expect(r.mentions[0]).toMatchObject({ text: 'Call 0912-345-678', type: 'PHONE', source: 'regex' });
  });

  it('a duplicate from chunk overlap does not create a second mention', async () => {
    const para = 'Alpha beta gamma delta. '.repeat(20);
    const text = `${para}\nMary Jones signed.\n${para}`;
    const g = fake('gliner', (c) => (c.includes('Mary Jones') ? [{ text: 'Mary Jones', type: 'PERSON' }] : []));
    const r = await detect(text, { layers: [g], chunkTokens: 130, overlapTokens: 130 });
    expect(g.calls.filter((c) => c.includes('Mary Jones')).length).toBeGreaterThan(1);
    expect(r.mentions).toHaveLength(1);
  });

  it('a failing layer is reported as a warning and regex results remain', async () => {
    const bad: DetectionLayer = { source: 'nano', detect: async () => { throw new Error('boom'); } };
    const r = await detect('mail a@b.co', { layers: [bad] });
    expect(r.mentions.map((m) => m.type)).toEqual(['EMAIL']);
    expect(r.warnings[0]).toContain('boom');
  });
});

describe('manual merge and split', () => {
  it('merge then split restores two entities', async () => {
    const text = 'Ann met Annie.';
    const g = fake('gliner', () => [{ text: 'Ann', type: 'PERSON' }, { text: 'Annie', type: 'PERSON' }]);
    const r = await detect(text, { layers: [g] });
    expect(r.entities).toHaveLength(2); // "Ann" is not a word inside "Annie"
    const merged = mergeEntities(r, 'PERSON_1', 'PERSON_2');
    expect(new Set(merged.mentions.map((m) => m.entityId))).toEqual(new Set(['PERSON_1']));
    const split = splitVariant(merged, 'PERSON_1', 'Annie');
    const [ann, annie] = split.mentions.map((m) => m.entityId);
    expect(ann).toBe('PERSON_1');
    expect(annie).not.toBe('PERSON_1');
    const placeholders = split.entities.map((e) => e.placeholder);
    expect(new Set(placeholders).size).toBe(placeholders.length);
    expect(split.entities.find((e) => e.id === annie)!.variants).toEqual(['Annie']);
  });
});
