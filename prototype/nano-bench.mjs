// Gemini Nano (Chrome Prompt API) checks in the isolated profile:
// 1) language availability now that the model is downloaded, 2) input quota and the real limit,
// 3) semantic detection on samples.json with a JSON responseConstraint (EN declared as en; ZH tried
// both declared as zh and as en). Usage: node prototype/nano-bench.mjs
import { readFileSync } from 'node:fs';
import { launchChrome } from './chrome.mjs';

const samples = JSON.parse(readFileSync('prototype/samples.json', 'utf8'));
const ctx = await launchChrome();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://example.com');

const out = await page.evaluate(async (samples) => {
  const res = {};
  const io = (inLang) => ({
    expectedInputs: [{ type: 'text', languages: [inLang] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  for (const l of ['en', 'ja', 'zh', 'zh-Hant', 'es']) {
    try { res['avail_' + l] = await LanguageModel.availability(io(l)); } catch (e) { res['avail_' + l] = 'ERR ' + e.name; }
  }
  try { res.avail_image = await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] }); } catch (e) { res.avail_image = 'ERR ' + e.name; }

  // 2) Quota and limit.
  const s0 = await LanguageModel.create(io('en'));
  res.contextWindow = s0.contextWindow;
  const para = 'The quarterly review covers revenue, hiring plans, customer escalations and the product roadmap. ';
  res.usagePer100Chars = Math.round((await s0.measureContextUsage(para.repeat(10))) / ((para.length * 10) / 100));
  let lastOk = 0;
  for (const n of [50, 100, 200, 300, 400, 600]) {
    const s = await s0.clone();
    const text = para.repeat(n);
    try {
      const used = await s.measureContextUsage(text);
      await s.prompt('Summarize in one sentence:\n' + text);
      lastOk = used;
      res['ok_' + n] = used;
    } catch (e) {
      res['fail_' + n] = e.name + ': ' + String(e.message).slice(0, 120);
      s.destroy();
      break;
    }
    s.destroy();
  }
  res.largestOkUsage = lastOk;
  s0.destroy();

  // 3) Semantic detection.
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            type: { type: 'string', enum: ['PERSON', 'ORG', 'LOCATION', 'ADDRESS', 'EMAIL', 'PHONE', 'ID_NUMBER',
              'CARD', 'ACCOUNT', 'DATE_OF_BIRTH', 'MEDICAL', 'FINANCIAL', 'OTHER'] },
            reason: { type: 'string' },
          },
          required: ['text', 'type'],
        },
      },
    },
    required: ['items'],
  };
  const system = 'You find sensitive information in the user text that should be hidden before sending it to a cloud AI: ' +
    'names of people, companies and organizations, addresses, emails, phone numbers, ID numbers, card or bank account ' +
    'numbers, dates of birth, medical conditions, salaries and money amounts, and private personal situations. ' +
    'Copy each item exactly as it appears in the text. Return an empty list if there is nothing sensitive.';
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  async function detect(lang, declared) {
    let tp = 0, fn = 0, pred = 0, fp = 0, located = 0;
    const times = [], misses = [], extras = [];
    let errors = 0;
    for (const s of samples[lang]) {
      let items = [];
      const t = performance.now();
      try {
        const session = await LanguageModel.create({
          ...io(declared),
          initialPrompts: [{ role: 'system', content: system }],
        });
        const raw = await session.prompt(s.text, { responseConstraint: schema });
        items = JSON.parse(raw).items ?? [];
        session.destroy();
      } catch (e) {
        errors++;
        misses.push('ERR ' + e.name);
      }
      times.push(performance.now() - t);
      const got = items.map((i) => i.text);
      for (const e of s.expected) {
        if (got.some((x) => norm(x).includes(norm(e)) || (norm(e).includes(norm(x)) && norm(x).length >= 2))) tp++;
        else { fn++; misses.push(e); }
      }
      for (const i of items) {
        pred++;
        if (s.text.includes(i.text)) located++;
        if (!s.expected.some((e) => norm(e).includes(norm(i.text)) || norm(i.text).includes(norm(e)))) { fp++; extras.push(i.text + '(' + i.type + ')'); }
      }
    }
    times.sort((a, b) => a - b);
    return {
      recall: +(tp / (tp + fn)).toFixed(3), precision: +(pred ? (pred - fp) / pred : 1).toFixed(3),
      exactlyLocatable: pred ? +(located / pred).toFixed(3) : 1, errors,
      medianMs: Math.round(times[Math.floor(times.length / 2)]), misses, extras,
    };
  }
  res.detect_en = await detect('en', 'en');
  res.detect_zh_declared_en = await detect('zh', 'en');
  try { res.detect_zh_declared_zh = await detect('zh', 'zh'); } catch (e) { res.detect_zh_declared_zh = 'ERR ' + e.name; }
  return res;
}, samples);

console.log(JSON.stringify(out, null, 2));
await ctx.close();
