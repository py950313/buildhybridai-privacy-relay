// Can each provider be called directly from a browser page? Uses a FAKE key: a readable 401
// means CORS allows it; a TypeError means the browser blocked it.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('https://example.com');
const out = await page.evaluate(async () => {
  const body = JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 });
  const cases = {
    openai: ['https://api.openai.com/v1/chat/completions', { Authorization: 'Bearer sk-fake', 'Content-Type': 'application/json' }],
    xai: ['https://api.x.ai/v1/chat/completions', { Authorization: 'Bearer xai-fake', 'Content-Type': 'application/json' }],
    anthropic: ['https://api.anthropic.com/v1/messages', {
      'x-api-key': 'fake', 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true' }],
    anthropic_no_header: ['https://api.anthropic.com/v1/messages', {
      'x-api-key': 'fake', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }],
  };
  const r = {};
  for (const [k, [url, headers]] of Object.entries(cases)) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      r[k] = 'readable HTTP ' + res.status;
    } catch (e) {
      r[k] = 'BLOCKED ' + e.name + ': ' + e.message;
    }
  }
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
