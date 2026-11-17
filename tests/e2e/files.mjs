// Image and PDF input (#5 acceptance). Real Chrome; every file is loaded twice: with Gemini Nano
// reading images, and with Nano off (Tesseract.js).
//
// protects: all 10 test files yield text on the device, scanned pages go through OCR, and no
//   request carries file bytes or text read from the file.
// fails_when: a file type stops extracting, the text-layer check sends scans down the wrong path,
//   or any code path uploads the file (or its text) while reading it.
// no_claim: OCR accuracy on real photos. `found/total` below is reported, not asserted beyond
//   "some text came out"; misreads are expected and the UI tells the user to check.
//
// Run: npm run test:files
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../../prototype/chrome.mjs';

const PORT = 5184;
const BASE = `http://localhost:${PORT}`;
const dir = new URL('./files/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const ctx = await launchChrome();
const bodies = []; // { url, buf }
ctx.on('request', (r) => { const buf = r.postDataBuffer(); if (buf?.length) bodies.push({ url: r.url(), buf }); });

const results = [];
for (const mode of ['nano', 'tesseract']) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?gliner=off${mode === 'tesseract' ? '&nano=off' : ''}`);
  await page.waitForSelector('[data-testid=tier]', { timeout: 120_000 });
  if (mode === 'nano') await page.waitForSelector('[data-testid=nano-state][data-state=available]', { timeout: 30_000 });
  for (const m of manifest) {
    const r = { mode, file: m.file, kind: m.kind };
    try {
      await page.fill('[data-testid=content]', '');
      const t0 = Date.now();
      await page.setInputFiles('[data-testid=file-input]', fileURLToPath(new URL(m.file, dir)));
      await page.waitForSelector('[data-testid=file-note], [data-testid=file-error]', { timeout: 300_000 });
      r.sec = +((Date.now() - t0) / 1000).toFixed(1);
      r.error = await page.locator('[data-testid=file-error]').textContent({ timeout: 500 }).catch(() => null);
      const text = await page.inputValue('[data-testid=content]');
      r.chars = text.length;
      const note = page.locator('[data-testid=file-note]');
      if (await note.count()) {
        r.pages = Number(await note.getAttribute('data-pages'));
        r.ocrPages = Number(await note.getAttribute('data-ocr'));
        r.engine = await note.getAttribute('data-engine');
        r.confidence = await note.getAttribute('data-confidence');
      }
      r.found = m.expected.filter((e) => norm(text).includes(norm(e))).length;
      r.total = m.expected.length;
      r.missing = m.expected.filter((e) => !norm(text).includes(norm(e)));
      assert.equal(r.error, null, `extraction error: ${r.error}`);
      assert.ok(r.chars > 20, 'no text extracted');
      if (m.expectOcrPages !== undefined) assert.equal(r.ocrPages, m.expectOcrPages, 'wrong number of OCR pages');
      r.ok = true;
    } catch (e) {
      r.ok = false;
      r.fail = String(e.message).slice(0, 200);
    }
    results.push(r);
    // Reload between files so one file's note never satisfies the next wait.
    await page.reload();
    await page.waitForSelector('[data-testid=tier]');
    if (mode === 'nano') await page.waitForSelector('[data-testid=nano-state][data-state=available]', { timeout: 30_000 });
  }
  await page.close();
}

// No request body may contain file bytes (PDF/PNG signatures or a slice of any test file) or any
// expected string read from the files.
const leaks = [];
const needles = manifest.flatMap((m) => {
  const bytes = readFileSync(new URL(m.file, dir));
  const mid = Math.floor(bytes.length / 2);
  return [{ what: `${m.file} bytes`, buf: bytes.subarray(mid, mid + 48) },
    ...m.expected.map((e) => ({ what: `"${e}"`, buf: Buffer.from(e, 'utf8') }))];
});
needles.push({ what: 'PDF header', buf: Buffer.from('%PDF-') }, { what: 'PNG header', buf: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) });
for (const b of bodies) for (const n of needles) if (b.buf.includes(n.buf)) leaks.push(`${n.what} in request to ${b.url.slice(0, 80)}`);

await ctx.close();
spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { shell: true });
const summary = (mode) => {
  const rs = results.filter((r) => r.mode === mode);
  return { extracted: `${rs.filter((r) => r.ok).length}/${rs.length}`, expectedStrings: `${rs.reduce((a, r) => a + (r.found ?? 0), 0)}/${rs.reduce((a, r) => a + (r.total ?? 0), 0)}` };
};
console.log(JSON.stringify({ nano: summary('nano'), tesseract: summary('tesseract'), requestsWithBody: bodies.length, leaks, results }, null, 1));
process.exit(results.every((r) => r.ok) && leaks.length === 0 ? 0 : 1);
