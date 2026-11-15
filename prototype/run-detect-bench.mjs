// Drive prototype/detect.html in the isolated Chrome profile (Nano downloaded there).
// Requires `npx vite --port 5179` running. Usage: node prototype/run-detect-bench.mjs
import { launchChrome } from './chrome.mjs';

const ctx = await launchChrome();
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5179/prototype/detect.html');
try {
  await page.waitForFunction(() => window.__result, null, { timeout: 30 * 60_000, polling: 2000 });
  console.log(JSON.stringify(await page.evaluate(() => window.__result), null, 1));
} catch (e) {
  console.log('timeout/error', String(e.message).slice(0, 300));
  console.log(await page.locator('#log').textContent());
}
await ctx.close();
