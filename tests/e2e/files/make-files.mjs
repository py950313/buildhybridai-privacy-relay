// Builds the 10 synthetic test files for image/PDF input: 5 images (from prototype/ocr-images)
// and 5 PDFs (text layer EN, text layer ZH, scanned ZH, mixed text+scan, multi-page EN).
// Usage: node tests/e2e/files/make-files.mjs   (writes into tests/e2e/files/)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = new URL('./', import.meta.url);
const sample = (f) => readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8').trim();
const samples = JSON.parse(readFileSync(new URL('../samples/samples.json', import.meta.url), 'utf8'));
const hide = (f) => samples.find((s) => s.file === f).mustHide;
const ocrManifest = JSON.parse(readFileSync('prototype/ocr-images/manifest.json', 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const textHtml = (text, size = 13) => `<html><body style="margin:0;font:${size}px/1.6 'Microsoft JhengHei UI','Segoe UI',sans-serif;color:#111">
  <div style="white-space:pre-wrap">${esc(text)}</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2 });
const pdfOpts = { format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } };

async function scanOf(text) {
  await page.setContent(`<html><body style="margin:0;background:#fff"><div id="d" style="width:900px;padding:40px;
    font:20px/1.7 'Microsoft JhengHei UI','Segoe UI',sans-serif;color:#222;white-space:pre-wrap">${esc(text)}</div></body></html>`);
  const png = await page.locator('#d').screenshot();
  return `<img src="data:image/png;base64,${png.toString('base64')}" style="width:100%">`;
}
async function pdf(name, html) {
  await page.setContent(html);
  writeFileSync(new URL(name, out), await page.pdf(pdfOpts));
}

const manifest = [];
for (const n of ['01-screen.png', '02-photo.png', '05-screen.png', '06-photo.png', '08-photo.png']) {
  const m = ocrManifest.find((x) => x.name === n);
  copyFileSync(`prototype/ocr-images/${n}`, new URL(`image-${n}`, out));
  manifest.push({ file: `image-${n}`, kind: m.photo ? 'photo' : 'screenshot', expected: m.expected });
}

await pdf('pdf-text-en.pdf', textHtml(sample('contract-en.txt')));
manifest.push({ file: 'pdf-text-en.pdf', kind: 'pdf text layer', expected: hide('contract-en.txt'), expectOcrPages: 0 });

await pdf('pdf-text-zh.pdf', textHtml(sample('contract-zh.txt')));
manifest.push({ file: 'pdf-text-zh.pdf', kind: 'pdf text layer (CJK)', expected: hide('contract-zh.txt'), expectOcrPages: 0 });

await pdf('pdf-scan-zh.pdf', `<html><body style="margin:0">${await scanOf(sample('health-zh.txt'))}</body></html>`);
manifest.push({ file: 'pdf-scan-zh.pdf', kind: 'pdf scan (no text layer)', expected: hide('health-zh.txt'), expectOcrPages: 1 });

const scan2 = await scanOf('收件人：吳佩珊\n手機：0987654321\n地址：高雄市苓雅區四維三路 2 號 12 樓');
await pdf('pdf-mixed.pdf', `<html><body style="margin:0;font:13px/1.6 'Segoe UI',sans-serif">
  <div style="white-space:pre-wrap">${esc(sample('email-en-short.txt'))}</div>
  <div style="page-break-before:always">${scan2}</div></body></html>`);
manifest.push({ file: 'pdf-mixed.pdf', kind: 'pdf text page + scanned page',
  expected: [...hide('email-en-short.txt'), '吳佩珊', '0987654321', '高雄市苓雅區四維三路 2 號 12 樓'], expectOcrPages: 1 });

await pdf('pdf-multipage-en.pdf', textHtml([sample('health-en.txt'), sample('contract-en.txt'), sample('health-en.txt')].join('\n\n\n'), 16));
manifest.push({ file: 'pdf-multipage-en.pdf', kind: 'pdf multi-page', expected: [...hide('health-en.txt'), ...hide('contract-en.txt')], expectOcrPages: 0 });

writeFileSync(new URL('manifest.json', out), JSON.stringify(manifest, null, 2));
await browser.close();
console.log('wrote', manifest.length, 'files');
