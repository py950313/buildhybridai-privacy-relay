// Runs our detection engine (real Chrome, real GLiNER + Gemini Nano) over data/<lang>.jsonl.
// Usage: node eval/run_engine.mjs <config: regex|gliner|full> <lang...>   (starts its own Vite)
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { launchChrome } from '../prototype/chrome.mjs';

const [config = 'gliner', ...langs] = process.argv.slice(2);
const PORT = 5183;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/eval/web/index.html`)).ok) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 1000));
}
const ctx = await launchChrome();
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/eval/web/index.html`);
await page.waitForFunction(() => window.evalApi, null, { timeout: 120_000 });
const info = await page.evaluate(() => window.evalApi.init());
console.log('engine', JSON.stringify(info), 'config', config);

for (const lang of langs.length ? langs : ['en', 'zh']) {
  const docs = readFileSync(new URL(`./data/${lang}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const out = createWriteStream(new URL(`./out/engine_${config}_${lang}.jsonl`, import.meta.url));
  let totalMs = 0;
  let warnings = 0;
  for (const [i, d] of docs.entries()) {
    const r = await page.evaluate(([t, c]) => window.evalApi.run(t, c), [d.text, config]);
    totalMs += r.ms;
    warnings += r.warnings.length;
    out.write(JSON.stringify({ id: d.id, preds: r.preds, ms: r.ms, unlocated: r.unlocated, warnings: r.warnings }) + '\n');
    if ((i + 1) % 50 === 0) console.log(lang, i + 1, '/', docs.length);
  }
  await new Promise((r) => out.end(r));
  console.log(lang, 'docs', docs.length, 'avg ms', Math.round(totalMs / docs.length), 'warnings', warnings);
}
await ctx.close();
spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { shell: true });
process.exit(0);
