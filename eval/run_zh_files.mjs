// Chinese image/PDF samples: renders zh01-zh10 as files (3 screenshots, 2 simulated phone photos,
// 3 text-layer PDFs, 2 scanned PDFs), reads them back with the app's own extractor in Chrome, and
// writes data/zhimg.jsonl: the extracted text plus gold spans re-located in it by exact search.
// Entities that OCR garbled cannot be located; they are listed as `garbled` and reported, not scored.
// Usage: node eval/run_zh_files.mjs   (then run_engine.mjs / presidio_run.py / score.py with "zhimg")
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { launchChrome } from '../prototype/chrome.mjs';

const here = new URL('./', import.meta.url);
const samples = JSON.parse(readFileSync(new URL('zh_samples.json', here), 'utf8')).samples.slice(0, 10);
const FORMS = ['screen', 'photo', 'pdf-text', 'pdf-scan', 'screen', 'pdf-text', 'photo', 'pdf-scan', 'screen', 'pdf-text'];
const FAMILY = { ADDRESS: 'LOCATION', DATE_OF_BIRTH: 'DOB' };
mkdirSync(new URL('data/zhimg/', here), { recursive: true });

// 1) Render the files.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const gen = await chromium.launch({ channel: 'chrome' });
const gp = await gen.newPage({ viewport: { width: 900, height: 420 } });
const files = [];
for (const [i, s] of samples.entries()) {
  const form = FORMS[i];
  const photo = form === 'photo';
  const style = photo
    ? 'transform: rotate(-3deg) skewX(2deg); filter: blur(0.8px) contrast(0.82) brightness(1.05); background: radial-gradient(circle at 30% 20%, #fff 0%, #e9e4d8 70%, #cfc8b8 100%);'
    : 'background:#fff;';
  const noise = photo
    ? `<canvas id="n" width="900" height="420" style="position:absolute;inset:0;opacity:.15"></canvas><script>const c=document.getElementById('n').getContext('2d');const d=c.createImageData(900,420);for(let k=0;k<d.data.length;k+=4){const v=Math.random()*255;d.data[k]=d.data[k+1]=d.data[k+2]=v;d.data[k+3]=255}c.putImageData(d,0,0)</script>`
    : '';
  const card = `<div id="d" style="position:relative;width:900px;height:420px;overflow:hidden;${style}">
    <div style="padding:40px 48px;font:22px/1.7 'Microsoft JhengHei UI','Segoe UI',sans-serif;color:#222">${esc(s.text)}</div>${noise}</div>`;
  let name;
  if (form === 'pdf-text') {
    name = `${s.id}.pdf`;
    await gp.setContent(`<html><body style="font:14px/1.7 'Microsoft JhengHei UI',sans-serif">${esc(s.text)}</body></html>`);
    writeFileSync(new URL(`data/zhimg/${name}`, here), await gp.pdf({ format: 'A4', margin: { top: '18mm', left: '16mm', right: '16mm', bottom: '18mm' } }));
  } else {
    await gp.setContent(`<html><body style="margin:0">${card}</body></html>`);
    const png = await gp.locator('#d').screenshot();
    if (form === 'pdf-scan') {
      name = `${s.id}-scan.pdf`;
      await gp.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" style="width:100%"></body></html>`);
      writeFileSync(new URL(`data/zhimg/${name}`, here), await gp.pdf({ format: 'A4' }));
    } else {
      name = `${s.id}-${form}.png`;
      writeFileSync(new URL(`data/zhimg/${name}`, here), png);
    }
  }
  files.push({ id: s.id, name, form });
}
await gen.close();

// 2) Read them back with the app's extractor.
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

const rows = [];
let garbledTotal = 0;
for (const f of files) {
  const s = samples.find((x) => x.id === f.id);
  const b64 = readFileSync(new URL(`data/zhimg/${f.name}`, here)).toString('base64');
  const ex = await page.evaluate(([b, n]) => window.evalApi.extract(b, n), [b64, f.name]);
  const gold = [];
  const garbled = [];
  for (const [text, type] of s.entities) {
    let at = ex.text.indexOf(text);
    if (at < 0) garbled.push(text);
    while (at >= 0) {
      gold.push({ start: at, end: at + text.length, label: type, family: FAMILY[type] ?? type });
      at = ex.text.indexOf(text, at + text.length);
    }
  }
  garbledTotal += garbled.length;
  rows.push({ id: f.id, form: f.form, text: ex.text, gold: gold.sort((a, b) => a.start - b.start), ignored: [], garbled, engine: ex.engine, ocrPages: ex.ocrPages });
  console.log(f.name, 'engine', ex.engine, 'entities', s.entities.length, 'garbled', JSON.stringify(garbled));
}
writeFileSync(new URL('data/zhimg.jsonl', here), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('files', rows.length, 'gold spans', rows.reduce((a, r) => a + r.gold.length, 0), 'garbled by OCR', garbledTotal);
await ctx.close();
spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { shell: true });
process.exit(0);
