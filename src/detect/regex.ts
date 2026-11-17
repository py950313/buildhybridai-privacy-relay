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
// Identifiers with no fixed format, recognized by the keyword right before them.
const ID_KEYWORDS =
  '護照(?:號碼)?|員工(?:編號|代號)|工號|學號|會員(?:編號|號碼)|病歷號碼?|保單號碼|健保卡號|' +
  'passport(?: number| no\\.?)?|employee (?:id|number)|student (?:id|number)|member(?:ship)? (?:id|number)|' +
  'policy number|medical record number|mrn';
const KEYWORD_ID = new RegExp(
  `(?<=(?:${ID_KEYWORDS})\\s*(?:為|是|[:：#])?\\s*)[A-Za-z0-9][A-Za-z0-9-]{5,19}(?![A-Za-z0-9-])`,
  'gi',
);
const SWIFT_CONTEXT = /(swift|bic)/i;
const ROUTING_CONTEXT = /(routing|aba)/i;
const BIRTH_CONTEXT = /(生日|出生|誕生|生於|生年月日|born|birth|dob|d\.o\.b)/i;

// Dates: western numeric, 西元/民國 with 年月日 (Arabic or Chinese numerals), English month names.
const ZH_NUM = '[〇零一二三四五六七八九十０-９0-9]';
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE = new RegExp(
  [
    String.raw`(?<!\d)(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?!\d)`,
    String.raw`(?<!\d)(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}(?!\d)`,
    `(?:西元|民國|民国)?${ZH_NUM}{2,4}年${ZH_NUM}{1,3}月${ZH_NUM}{1,3}[日號号]`,
    String.raw`(?:民國|民国)\d{2,3}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)`,
    String.raw`\b(?:${MONTHS})\.? \d{1,2}(?:st|nd|rd|th)?,? (?:19|20)\d{2}\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\.?,? (?:19|20)\d{2}\b`,
  ].join('|'),
  'gi',
);

// Taiwan street address. Anchored on the 22 county/city names so the match never starts in the
// middle of a sentence; must reach a house number (號). Addresses without the city are left to
// the model layers.
const TW_CITIES = '(?:[台臺](?:北|中|南|東)|新北|桃園|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|澎湖|金門|連江)[市縣]';
const TW_ADDRESS = new RegExp(
  String.raw`(?:\d{3,6} ?)?${TW_CITIES} ?(?:[一-鿿]{1,3}?[區鄉鎮市])? ?(?:[一-鿿]{1,3}?[里村](?: ?\d+ ?鄰)?)? ?` +
    String.raw`[一-鿿]{1,5}?(?:路|街|大道)(?: ?[一二三四五六七八九十\d]+ ?段)?(?: ?\d+ ?巷)?(?: ?\d+ ?弄)? ?` +
    String.raw`\d+(?:[-之]\d+)? ?號(?: ?\d+ ?樓(?:[-之]\d+)?)?(?: ?\d+ ?室)?`,
  'g',
);

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
    // US Social Security number / ITIN format. Area 000, 666 and group 00, serial 0000 never issued.
    name: 'us-ssn',
    type: 'ID_NUMBER',
    pattern: /(?<![\d-])(?!000|666)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g,
  },
  {
    // SWIFT/BIC: 8 or 11 characters, only with "SWIFT" or "BIC" within 30 chars before.
    name: 'swift-bic',
    type: 'ACCOUNT',
    pattern: /(?<![A-Za-z0-9])[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?(?![A-Za-z0-9])/g,
    validate: (_m, text, index) => SWIFT_CONTEXT.test(text.slice(Math.max(0, index - 30), index)),
  },
  {
    // US bank routing number: 9 digits, only with "routing" or "ABA" within 30 chars before.
    name: 'us-routing',
    type: 'ACCOUNT',
    pattern: /(?<![\d-])\d{9}(?![\d-])/g,
    validate: (_m, text, index) => ROUTING_CONTEXT.test(text.slice(Math.max(0, index - 30), index)),
  },
  {
    name: 'keyword-id',
    type: 'ID_NUMBER',
    pattern: KEYWORD_ID,
    validate: (m) => digitsOf(m).length >= 4,
  },
  {
    // A date is only a date of birth when a birth word sits within 15 chars before or 6 after.
    name: 'date-of-birth',
    type: 'DATE_OF_BIRTH',
    pattern: DATE,
    validate: (m, text, index) =>
      BIRTH_CONTEXT.test(text.slice(Math.max(0, index - 15), index)) ||
      BIRTH_CONTEXT.test(text.slice(index + m.length, index + m.length + 6)) ||
      /^ ?生(?![意活產产氣气效])/.test(text.slice(index + m.length)), // 「…三月十二日生」
  },
  {
    name: 'tw-address',
    type: 'ADDRESS',
    pattern: TW_ADDRESS,
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
