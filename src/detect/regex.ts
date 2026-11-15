// Structured PII recognizers. They run on the width-normalized text (so "０９１２" counts as
// "0912") and report original offsets. Each pattern is paired with a validator where one exists.
import { normalize, toOriginal } from './normalize';
import type { EntityType, Span } from './types';

// Letter codes for Taiwan national ID / resident certificate (內政部 rule).
const ID_LETTER: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
  N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

/**
 * Taiwan national ID (A123456789), new-style resident certificate (second digit 8/9, since 2021)
 * and old-style resident certificate (second char A-D). Same weighted checksum for all three.
 */
export function isValidTwId(raw: string): boolean {
  const s = raw.toUpperCase();
  if (!/^[A-Z][A-D0-9]\d{8}$/.test(s)) return false;
  const first = ID_LETTER[s[0]];
  let second: number;
  if (/[A-D]/.test(s[1])) second = ID_LETTER[s[1]] % 10;
  else {
    second = Number(s[1]);
    if (![1, 2, 8, 9].includes(second)) return false;
  }
  let sum = Math.floor(first / 10) + (first % 10) * 9 + second * 8;
  for (let i = 2; i < 9; i++) sum += Number(s[i]) * (9 - i);
  sum += Number(s[9]);
  return sum % 10 === 0;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const digitsOf = (s: string) => s.replace(/\D/g, '');
const ACCOUNT_CONTEXT = /(帳號|帳戶|账号|账户|戶號|account|acct|a\/c)/i;

type Recognizer = {
  name: string;
  type: EntityType;
  pattern: RegExp; // must be global
  validate?: (match: string, normText: string, index: number) => boolean;
};

// Order = priority when two recognizers claim overlapping text.
export const RECOGNIZERS: Recognizer[] = [
  {
    name: 'email',
    type: 'EMAIL',
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
  },
  {
    name: 'tw-id',
    type: 'ID_NUMBER',
    pattern: /(?<![A-Za-z0-9])[A-Za-z][A-Da-d0-9]\d{8}(?![A-Za-z0-9])/g,
    validate: (m) => isValidTwId(m),
  },
  {
    name: 'iban',
    type: 'ACCOUNT',
    pattern: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![A-Za-z0-9])/g,
    validate: (m) => isValidIban(m),
  },
  {
    name: 'card',
    type: 'CARD',
    pattern: /(?<![\d-])[2-6]\d{3}(?:[ -]?\d){9,15}(?![\d-])/g,
    validate: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
  {
    // Context word must appear within 15 chars before the number.
    name: 'tw-bank-account',
    type: 'ACCOUNT',
    pattern: /(?<![\d-])\d[\d-]{8,20}\d(?![\d-])/g,
    validate: (m, text, index) => {
      const d = digitsOf(m);
      return d.length >= 10 && d.length <= 16 && ACCOUNT_CONTEXT.test(text.slice(Math.max(0, index - 15), index));
    },
  },
  {
    name: 'tw-mobile',
    type: 'PHONE',
    pattern: /(?<![\d+])(?:\+886[ -]?|\(?0)9\d{2}\)?[ -]?\d{3}[ -]?\d{3}(?!\d)/g,
  },
  {
    // Area codes 02-08 (and 037, 049, 082, 0836...). Total 9-10 digits including the leading 0.
    name: 'tw-landline',
    type: 'PHONE',
    pattern: /(?<![\d+])(?:\+886[ -]?\(?|\(?0)[2-8]\d{0,2}\)?[ -]?\d{3,4}[ -]?\d{4}(?!\d)/g,
    validate: (m) => {
      const d = digitsOf(m).replace(/^886/, '0');
      return d.length >= 9 && d.length <= 10;
    },
  },
  {
    // E.164: + country code, 8-15 digits in total.
    name: 'e164',
    type: 'PHONE',
    pattern: /(?<![\d+])\+[1-9]\d{0,2}(?:[ -]?\(?\d+\)?){1,6}(?!\d)/g,
    validate: (m) => {
      const n = digitsOf(m).length;
      return n >= 8 && n <= 15;
    },
  },
];

export function detectRegex(text: string): Span[] {
  const n = normalize(text);
  const taken: [number, number][] = [];
  const spans: Span[] = [];
  for (const r of RECOGNIZERS) {
    r.pattern.lastIndex = 0;
    for (const m of n.text.matchAll(r.pattern)) {
      const s = m.index!;
      const e = s + m[0].length;
      if (r.validate && !r.validate(m[0], n.text, s)) continue;
      if (taken.some(([a, b]) => s < b && a < e)) continue;
      taken.push([s, e]);
      const [os, oe] = toOriginal(n, s, e);
      spans.push({ start: os, end: oe, text: text.slice(os, oe), type: r.type, source: 'regex', reason: r.name });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
