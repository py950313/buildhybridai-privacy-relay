// protects: model snippets are placed by exact search with word boundaries and width folding,
//   every occurrence is marked, and offsets point at the user's original characters.
// fails_when: boundary checks are dropped ("Ann" inside "Annual"), full-width/half-width folding
//   breaks, or offset mapping drifts after collapsed whitespace.
// no_claim: fuzzy matching; a snippet the model paraphrased is intentionally NOT located.
import { describe, expect, it } from 'vitest';
import { locate } from './locate';

describe('locate', () => {
  it('"Ann" does not match inside "Annual"', () => {
    expect(locate('Annual review with Ann.', 'Ann')).toEqual([[19, 22]]);
  });
  it('half-width snippet matches full-width text', () => {
    const t = '手機０９１２３４５６７８';
    const hits = locate(t, '0912345678');
    expect(hits).toHaveLength(1);
    expect(t.slice(...hits[0])).toBe('０９１２３４５６７８');
  });
  it('marks every occurrence', () => {
    expect(locate('王小明說，王小明會到。', '王小明')).toEqual([[0, 3], [5, 8]]);
  });
  it('is case-insensitive and tolerant of whitespace runs', () => {
    const t = 'Contact  JOHN\n Smith today';
    const hits = locate(t, 'John Smith');
    expect(hits).toHaveLength(1);
    expect(t.slice(...hits[0])).toBe('JOHN\n Smith');
  });
  it('returns nothing for text that is not there', () => {
    expect(locate('Meeting notes', 'Dr. Alice Chen')).toEqual([]);
    expect(locate('anything', '   ')).toEqual([]);
  });
});
