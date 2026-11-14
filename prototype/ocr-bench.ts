// Prototype benchmark: Tesseract.js (chi_tra+eng) on clean screenshots vs simulated phone photos.
// Score = share of expected sensitive strings found in the OCR text (whitespace-insensitive).
import { createWorker } from 'tesseract.js';
import manifest from './ocr-images/manifest.json';

const log = (s: string) => { document.getElementById('log')!.textContent += '\n' + s; };
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

async function run() {
  const t0 = performance.now();
  const worker = await createWorker(['chi_tra', 'eng']);
  log(`worker ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const rows = [];
  for (const m of manifest as { name: string; photo: boolean; expected: string[] }[]) {
    const t = performance.now();
    const { data } = await worker.recognize(`/prototype/ocr-images/${m.name}`);
    const ms = Math.round(performance.now() - t);
    const text = norm(data.text);
    const found = m.expected.filter((e) => text.includes(norm(e)));
    rows.push({ name: m.name, photo: m.photo, ms, found: found.length, total: m.expected.length,
      missing: m.expected.filter((e) => !found.includes(e)), ocr: data.text.trim().slice(0, 160) });
    log(JSON.stringify(rows[rows.length - 1]));
  }
  await worker.terminate();
  const sum = (photo: boolean) => {
    const r = rows.filter((x) => x.photo === photo);
    return { found: r.reduce((a, x) => a + x.found, 0), total: r.reduce((a, x) => a + x.total, 0),
      medianMs: r.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(r.length / 2)] };
  };
  (window as unknown as { __result: unknown }).__result = { screen: sum(false), photo: sum(true), rows };
}
run().catch((e) => { (window as unknown as { __result: unknown }).__result = { error: String(e?.message ?? e) }; });
