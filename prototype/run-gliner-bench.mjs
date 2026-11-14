// Drive prototype/gliner.html in installed Chrome for each model variant and print results.
// Requires `npx vite --port 5179` running. Usage: node prototype/run-gliner-bench.mjs
import { chromium } from 'playwright';

const variants = [
  { repo: 'onnx-community/gliner_multi_pii-v1', file: 'model_int8.onnx', ep: 'wasm' },
  { repo: 'onnx-community/gliner_multi_pii-v1', file: 'model_fp16.onnx', ep: 'webgpu' },
  { repo: 'onnx-community/gliner_multi_pii-v1', file: 'model.onnx', ep: 'webgpu' },
  { repo: 'onnx-community/gliner_multi_pii-v1', file: 'model_bnb4.onnx', ep: 'wasm' },
  { repo: 'onnx-community/gliner_multi', file: 'model_quantized.onnx', ep: 'wasm' },
];

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
for (const v of variants) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const url = `http://localhost:5179/prototype/gliner.html?repo=${v.repo}&file=${v.file}&ep=${v.ep}&mt=0`;
  const t = Date.now();
  await page.goto(url);
  try {
    await page.waitForFunction(() => (window).__result, null, { timeout: 30 * 60_000, polling: 2000 });
    const r = await page.evaluate(() => (window).__result);
    console.log(JSON.stringify({ ...v, wallSec: Math.round((Date.now() - t) / 1000), result: r }));
  } catch (e) {
    console.log(JSON.stringify({ ...v, error: String(e.message).slice(0, 300) }));
  }
  await page.close();
}
await browser.close();
