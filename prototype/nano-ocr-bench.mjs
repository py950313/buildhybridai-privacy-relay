// Can Gemini Nano transcribe images reliably? Runs the 10 OCR prototype images through the Prompt
// API (image input) and reports: expected strings found, and how much of the output is NOT in the
// source text (invented or altered content). Usage: node prototype/nano-ocr-bench.mjs
import { readFileSync } from 'node:fs';
import { launchChrome } from './chrome.mjs';

const manifest = JSON.parse(readFileSync('prototype/ocr-images/manifest.json', 'utf8'));
const images = manifest.map((m) => ({ ...m, b64: readFileSync(`prototype/ocr-images/${m.name}`).toString('base64') }));
const ctx = await launchChrome();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://example.com');

const out = await page.evaluate(async (images) => {
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  const rows = [];
  const session = await LanguageModel.create({
    expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  for (const m of images) {
    const blob = await (await fetch(`data:image/png;base64,${m.b64}`)).blob();
    const s = await session.clone();
    const t = performance.now();
    let text = '';
    let error = null;
    try {
      text = await s.prompt([{ role: 'user', content: [
        { type: 'text', value: 'Transcribe all the text in this image exactly as written, character for character. Output only the text.' },
        { type: 'image', value: blob },
      ] }]);
    } catch (e) {
      error = e.name + ': ' + String(e.message).slice(0, 120);
    }
    s.destroy();
    const got = norm(text);
    const src = norm(m.text);
    // Share of output characters (in 6-char windows) that do not occur in the source text.
    let windows = 0, foreign = 0;
    for (let i = 0; i + 6 <= got.length; i += 3) { windows++; if (!src.includes(got.slice(i, i + 6))) foreign++; }
    rows.push({ name: m.name, photo: m.photo, ms: Math.round(performance.now() - t), error,
      found: m.expected.filter((e) => got.includes(norm(e))).length, total: m.expected.length,
      missing: m.expected.filter((e) => !got.includes(norm(e))),
      foreignShare: windows ? +(foreign / windows).toFixed(2) : null, head: text.slice(0, 120) });
  }
  session.destroy();
  return rows;
}, images);
for (const r of out) console.log(JSON.stringify(r));
const sum = (photo) => out.filter((r) => r.photo === photo).reduce((a, r) => [a[0] + r.found, a[1] + r.total], [0, 0]);
console.log('screens', sum(false).join('/'), 'photos', sum(true).join('/'));
await ctx.close();
