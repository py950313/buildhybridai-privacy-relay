// #7 acceptance: two samples per scenario through the full flow in Chrome with the real models
// and real Gemini (uses quota; run by hand). The user is simulated accepting the detector's marks
// as-is, so `missed` lists what a user would have had to mark manually.
// Start `npx vite --port 5182`, then: node tests/e2e/scenarios-live.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { launchChrome } from '../../prototype/chrome.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5182';
const dir = new URL('./samples/', import.meta.url);
const samples = JSON.parse(readFileSync(new URL('samples.json', dir), 'utf8'));
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

const ctx = await launchChrome();
const outgoing = [];
ctx.on('request', (r) => { if (r.url().includes('firebasevertexai')) outgoing.push(r.postData() ?? ''); });
const results = [];

for (const s of samples) {
  const text = readFileSync(new URL(s.file, dir), 'utf8').trim();
  const page = await ctx.newPage();
  const r = { file: s.file, scenario: s.scenario };
  const before = outgoing.length;
  try {
    await page.goto(BASE);
    const dl = page.locator('[data-testid=gliner-download]');
    if (await dl.isVisible().catch(() => false)) await dl.click();
    await page.waitForSelector('[data-testid=gliner-state][data-state=ready]', { timeout: 300_000 });
    await page.waitForSelector('[data-testid=nano-state][data-state=available]', { timeout: 30_000 });
    await page.selectOption('[data-testid=scenario]', s.scenario);
    await page.selectOption('[data-testid=task]', s.task);
    await page.fill('[data-testid=content]', text);
    r.route = await page.locator('[data-testid=route]').getAttribute('data-route');
    r.routeOk = r.route === s.expectRoute;
    const t0 = Date.now();
    await page.click('[data-testid=submit]');
    if (r.route === 'cloud') {
      await page.waitForSelector('[data-testid=confirm]', { timeout: 300_000 });
      r.detectSec = +((Date.now() - t0) / 1000).toFixed(1);
      const marked = await page.$$eval('[data-testid=mention]:not(.off)', (els) => els.map((e) => e.firstChild.textContent));
      r.markedCount = marked.length;
      r.missed = s.mustHide.filter((m) => !marked.some((x) => norm(x).includes(norm(m))));
      r.unlocated = await page.locator('[data-testid=unlocated] li').count();
      await page.click('[data-testid=send]');
    }
    await page.waitForSelector('[data-testid=turn]', { timeout: 120_000 });
    await page.waitForSelector('[data-testid=turn]:not([data-receipt=pending])', { timeout: 30_000 }).catch(() => {});
    const turn = page.locator('[data-testid=turn]').last();
    r.error = await turn.locator('[data-testid=turn-error]').textContent({ timeout: 1000 }).catch(() => null);
    const answer = await turn.locator('[data-testid=answer]').textContent({ timeout: 1000 }).catch(() => '');
    r.answerChars = answer.length;
    r.answerHead = answer.slice(0, 160).replace(/\s+/g, ' ');
    r.receipt = await turn.getAttribute('data-receipt');
    r.disclaimer = (await page.locator('[data-testid=disclaimer]').count()) > 0;
    if (r.route === 'cloud') {
      const sent = await turn.locator('[data-testid=sent]').textContent();
      r.leakedInSent = s.mustHide.filter((m) => norm(sent).includes(norm(m)));
      r.restored = await turn.locator('.restored').count();
      r.invalid = await turn.locator('[data-testid=invalid]').allTextContents();
      r.missing = (await turn.locator('[data-testid=missing]').textContent({ timeout: 1000 }).catch(() => '')).length > 0;
    }
    const bodies = outgoing.slice(before);
    r.cloudRequests = bodies.length;
    r.leakedInRequests = s.mustHide.filter((m) => bodies.some((b) => norm(b).includes(norm(m)) || b.includes(JSON.stringify(m).slice(1, -1))));
  } catch (e) {
    r.exception = String(e.message).slice(0, 300);
  }
  results.push(r);
  await page.close();
}
await ctx.close();
console.log(JSON.stringify(results, null, 1));
