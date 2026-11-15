// protects: the confirmation-screen edits (un-mark, manual mark, merge, split) feed into exactly
//   the text that gets sent, follow-ups reuse placeholders and re-mask earlier spellings, and
//   prepareOutgoing refuses to send when a marked spelling would remain.
// fails_when: an edit is lost between screen and send, a manual mark covers only one of several
//   occurrences, a follow-up leaks a name masked in an earlier turn, or the leak guard is bypassed.
// no_claim: rendering or network behaviour (covered by the e2e privacy test).
import { describe, expect, it } from 'vitest';
import { detect } from '../detect/engine';
import type { DetectionLayer, RawItem } from '../detect/types';
import { spanKey } from './placeholders';
import { addManual, derive, draftFrom, prepareOutgoing, setEntityMasked, toggleMention } from './session';

const layer = (items: RawItem[]): DetectionLayer => ({ source: 'gliner', detect: async () => items });
const id = (s: string) => s;

describe('session', () => {
  it('manual mark covers every occurrence and is masked', async () => {
    const text = 'Project Falcon is late. Falcon needs budget.';
    let d = draftFrom(await detect(text));
    d = addManual(d, 8, 14, 'OTHER');
    const out = prepareOutgoing(d, [], id);
    expect(out.masked).toBe('Project [OTHER_1] is late. [OTHER_1] needs budget.');
  });

  it('un-marking one occurrence keeps it in clear without tripping the leak guard', async () => {
    const text = 'Ann wrote to Ann.';
    let d = draftFrom(await detect(text, { layers: [layer([{ text: 'Ann', type: 'PERSON' }])] }));
    const first = derive(d, []).mentions[0];
    d = toggleMention(d, first);
    expect(prepareOutgoing(d, [], id).masked).toBe('Ann wrote to [PERSON_1].');
  });

  it('un-marking a whole entity sends it in clear', async () => {
    const text = 'Mail bob@demo.io now';
    let d = draftFrom(await detect(text));
    d = setEntityMasked(d, derive(d, []), 'EMAIL_1', false);
    expect(d.excluded).toEqual([spanKey(derive(d, []).mentions[0])]);
    expect(prepareOutgoing(d, [], id).masked).toBe(text);
  });

  it('follow-up reuses placeholders and masks earlier names the detector missed', async () => {
    const t1 = 'John Smith asked about the contract.';
    const d1 = draftFrom(await detect(t1, { layers: [layer([{ text: 'John Smith', type: 'PERSON' }])] }));
    const o1 = prepareOutgoing(d1, [], id);
    expect(o1.masked).toBe('[PERSON_1] asked about the contract.');
    // Turn 2: the detector misses "John Smith" entirely and finds a new person.
    const t2 = 'Should John Smith or Mary Lee sign?';
    const d2 = draftFrom(await detect(t2, { layers: [layer([{ text: 'Mary Lee', type: 'PERSON' }])] }));
    const o2 = prepareOutgoing(d2, o1.table, id);
    expect(o2.masked).toBe('Should [PERSON_1] or [PERSON_2] sign?');
  });

  it('merge and split edits reach the outgoing text', async () => {
    const text = 'Dr. Lin and Lin Mei-ling met.';
    let d = draftFrom(await detect(text, { layers: [layer([{ text: 'Dr. Lin', type: 'PERSON' }, { text: 'Lin Mei-ling', type: 'PERSON' }])] }));
    expect(prepareOutgoing(d, [], id).masked).toBe('[PERSON_1] and [PERSON_2] met.');
    d = { ...d, ops: [{ kind: 'merge', keep: 'PERSON_1', drop: 'PERSON_2' }] };
    expect(prepareOutgoing(d, [], id).masked).toBe('[PERSON_1] and [PERSON_1] met.');
    d = { ...d, ops: [...d.ops, { kind: 'split', from: 'PERSON_1', variant: 'Lin Mei-ling' }] };
    expect(prepareOutgoing(d, [], id).masked).toBe('[PERSON_1] and [PERSON_2] met.');
  });

  it('the wrapper is not leak-checked but the body is', async () => {
    const text = 'Contact Rewrite Inc.';
    const d = draftFrom(await detect(text, { layers: [layer([{ text: 'Rewrite Inc', type: 'ORG' }])] }));
    const out = prepareOutgoing(d, [], (b) => `Rewrite Inc. style guide:\n${b}`);
    expect(out.masked).toBe('Rewrite Inc. style guide:\nContact [ORG_1].');
  });
});
