// Spec #2 done-definition item 2: scenario 1 (work email) end to end in Firefox, a browser without
// the Prompt API. Uses Playwright's Firefox build, real GLiNER and real Gemini (uses quota; run by hand).
// Protects: the non-Chrome tier routes to cloud, detects on device, and sends no marked original.
// Fails if: GLiNER cannot load in Firefox, the flow errors, or a must-hide value appears in any
// request to the AI Logic endpoint. Passing does NOT cover real Firefox release builds or iPhone Safari.
// Start `npx vite --port 5182`, then: node tests/e2e/firefox-scenario1.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { firefox } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5182';
const dir = new URL('./samples/', import.meta.url);
const samples = JSON.parse(readFileSync(new URL('samples.json', dir), 'utf8')).filter((s) => s.scenario === 'email');
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

const browser = await firefox.launch();
const ctx = await browser.newContext();
const outgoing = [];
ctx.on('request', (r) => { if (r.url().includes('firebasevertexai')) outgoing.push(r.postData() ?? ''); });
const results = [];

for (const s of samples) {
  const text = readFileSync(new URL(s.file, dir), 'utf8').trim();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const r = { file: s.file, userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null) };
  const before = outgoing.length;
  try {
    await page.goto(BASE);
    r.webgpu = await page.evaluate(() => 'gpu' in navigator);
    r.promptApi = await page.evaluate(() => 'LanguageModel' in self);
    const dl = page.locator('[data-testid=gliner-download]');
    if (await dl.isVisible().catch(() => false)) await dl.click();
    await page.waitForSelector('[data-testid=gliner-state][data-state=ready]', { timeout: 600_000 });
    r.gliner = await page.locator('[data-testid=gliner-state]').textContent().catch(() => null);
    r.nanoState = await page.locator('[data-testid=nano-state]').getAttribute('data-state').catch(() => null);
    await page.selectOption('[data-testid=scenario]', s.scenario);
    await page.selectOption('[data-testid=task]', s.task);
    await page.fill('[data-testid=content]', text);
    r.route = await page.locator('[data-testid=route]').getAttribute('data-route');
    const t0 = Date.now();
    await page.click('[data-testid=submit]');
    await page.waitForSelector('[data-testid=confirm]', { timeout: 300_000 });
    r.detectSec = +((Date.now() - t0) / 1000).toFixed(1);
    const marked = await page.$$eval('[data-testid=mention]:not(.off)', (els) => els.map((e) => e.firstChild.textContent));
    r.marked = marked;
    r.missed = s.mustHide.filter((m) => !marked.some((x) => norm(x).includes(norm(m))));
    await page.click('[data-testid=send]');
    await page.waitForSelector('[data-testid=turn]', { timeout: 120_000 });
    await page.waitForSelector('[data-testid=turn]:not([data-receipt=pending])', { timeout: 30_000 }).catch(() => {});
    const turn = page.locator('[data-testid=turn]').last();
    r.error = await turn.locator('[data-testid=turn-error]').textContent({ timeout: 1000 }).catch(() => null);
    r.answerHead = (await turn.locator('[data-testid=answer]').textContent({ timeout: 1000 }).catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
    r.receipt = await turn.getAttribute('data-receipt');
    r.restored = await turn.locator('.restored').count();
    const sentNow = outgoing.slice(before).join('\n');
    // Leak = an original the user confirmed as marked appears in a request. A must-hide value the
    // detector missed (r.missed) is a detection gap the user would fix on the confirm screen, not a leak.
    r.leakedMarked = marked.filter((m) => norm(sentNow).includes(norm(m)));
  } catch (e) {
    r.exception = String(e).slice(0, 300);
  }
  r.consoleErrors = errors.slice(0, 5);
  results.push(r);
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
const bad = results.filter((r) => r.exception || r.error || r.leakedMarked?.length);
process.exit(bad.length ? 1 : 0);
