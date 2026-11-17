// Live smoke test against real Gemini through Firebase AI Logic + App Check (no mocks).
// Uses quota; run by hand: start `npx vite --port 5182`, then `node tests/e2e/live-gemini.mjs [baseUrl]`.
import { launchChrome } from '../../prototype/chrome.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5182';
const ctx = await launchChrome();
const page = await ctx.newPage();
const fails = [];
page.on('response', (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url().slice(0, 120)}`); });
page.on('console', (m) => { if (m.type() === 'error') fails.push('console: ' + m.text().slice(0, 300)); });
await page.goto(`${BASE}/?gliner=off&nano=off`);
await page.selectOption('[data-testid=task]', 'rewrite');
await page.fill('[data-testid=content]', 'hey Sarah Lin, pls send teh signed offer to sarah.lin@northwind-demo.com or call 0912-345-678 asap thx');
await page.selectOption('[data-testid=route-choice]', 'cloud');
await page.click('[data-testid=submit]');
await page.waitForSelector('[data-testid=confirm]');
await page.click('[data-testid=send]');
await page.waitForSelector('[data-testid=turn]', { timeout: 90_000 });
await page.waitForTimeout(4000);
const turn = page.locator('[data-testid=turn]').last();
console.log(JSON.stringify({
  sent: await turn.locator('[data-testid=sent]').textContent().catch(() => null),
  answer: await turn.locator('[data-testid=answer]').textContent().catch(() => null),
  error: await turn.locator('[data-testid=turn-error]').textContent().catch(() => null),
  invalid: await turn.locator('[data-testid=invalid]').allTextContents(),
  note: (await turn.textContent()).match(/Statistics[^.]*\./)?.[0] ?? null,
  fails,
}, null, 1));
await ctx.close();
