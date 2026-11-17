// protects: the pure parts of the GLiNER and Nano layers: stop-list, model-window splitting,
//   language declaration, the DATE_OF_BIRTH rule and defensive JSON parsing.
// fails_when: pronouns leak through as PERSON, split pieces lose text, zh is declared as zh
//   (throws NotSupportedError in Chrome 157), or malformed model JSON crashes detection.
// no_claim: anything about the real models; they cannot run under Node/Vitest.
import { describe, expect, it } from 'vitest';
import { filterItems, passesScore, splitForModel } from './gliner';
import { declaredLang, guessLang, parseItems, postFilter } from './nano';

describe('gliner helpers', () => {
  it('drops pronouns and punctuation-only items', () => {
    const out = filterItems([
      { text: '我', type: 'PERSON' }, { text: '幫我', type: 'PERSON' }, { text: '王小明', type: 'PERSON' }, { text: '，', type: 'OTHER' },
    ]);
    expect(out.map((i) => i.text)).toEqual(['王小明']);
  });
  it('drops role nouns, field labels, generic lowercase nouns and digit-less numbers', () => {
    const out = filterItems([
      { text: 'Seller', type: 'PERSON' }, { text: 'maintenance personnel', type: 'PERSON' }, { text: 'sarah', type: 'PERSON' },
      { text: 'Supplier Name', type: 'ORG' }, { text: 'patient portal', type: 'ORG' }, { text: 'Acme Logistics', type: 'ORG' },
      { text: 'area', type: 'LOCATION' }, { text: 'Houston', type: 'LOCATION' }, { text: '台積電', type: 'ORG' },
      { text: 'Phone Number', type: 'PHONE' }, { text: 'Email', type: 'EMAIL' }, { text: 'Delivery Address', type: 'ADDRESS' },
      { text: '88 W Capitol Ave', type: 'ADDRESS' }, { text: 'ID Number', type: 'ID_NUMBER' }, { text: 'MRN 0002873546', type: 'ID_NUMBER' },
    ]);
    expect(out.map((i) => i.text)).toEqual(['sarah', 'Acme Logistics', 'Houston', '台積電', '88 W Capitol Ave', 'MRN 0002873546']);
  });
  it('fp16: Latin person/organization need 0.9; CJK and other labels keep the base threshold', () => {
    expect(passesScore({ spanText: 'Instructor', label: 'person', score: 0.6 }, 'fp16')).toBe(false);
    expect(passesScore({ spanText: 'Sarah Lin', label: 'person', score: 0.95 }, 'fp16')).toBe(true);
    expect(passesScore({ spanText: '王小明', label: 'person', score: 0.4 }, 'fp16')).toBe(true);
    expect(passesScore({ spanText: 'Houston', label: 'city', score: 0.6 }, 'fp16')).toBe(true);
    expect(passesScore({ spanText: 'Instructor', label: 'person', score: 0.05 }, 'int8')).toBe(true);
  });
  it('splits long text into pieces under the token cap without losing text', () => {
    const text = '這是測試句子，內容不重要。'.repeat(100);
    const parts = splitForModel(text, 300);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
  });
});

describe('nano helpers', () => {
  it('guesses language', () => {
    expect(guessLang('請幫我整理這封信')).toBe('zh');
    expect(guessLang('会議の議事録をまとめてください')).toBe('ja');
    expect(guessLang('Please summarize the email for the team')).toBe('en');
    expect(guessLang('Por favor resume el correo para el equipo')).toBe('es');
  });
  it('zh is declared as en only when the flag is on', () => {
    expect(declaredLang('zh', true)).toBe('en');
    expect(declaredLang('zh', false)).toBeNull();
    expect(declaredLang('ja', false)).toBe('ja');
  });
  it('drops DATE_OF_BIRTH unless the text mentions a birthday', () => {
    const items = [{ text: 'Monday', type: 'DATE_OF_BIRTH' as const }];
    expect(postFilter('See you Monday', items)).toEqual([]);
    expect(postFilter('Born on Monday', items)).toEqual(items);
  });
  it('parses defensively', () => {
    expect(parseItems('not json')).toEqual([]);
    expect(parseItems('{"items":[{"text":"x","type":"WEIRD"},{"type":"PERSON"}]}')).toEqual([{ text: 'x', type: 'OTHER', reason: 'nano' }]);
  });
});
