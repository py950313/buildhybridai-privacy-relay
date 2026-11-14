// Probe the Prompt API in installed Chrome and Edge using isolated profiles (never the user's).
// Usage: node prototype/probe-availability.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const results = {};
for (const channel of ['chrome', 'msedge']) {
  const dir = path.resolve('prototype/.profiles', channel);
  const ctx = await chromium.launchPersistentContext(dir, { channel, headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://example.com');
  results[channel] = await page.evaluate(async () => {
    const out = { ua: navigator.userAgent, hasLanguageModel: 'LanguageModel' in self };
    if (!out.hasLanguageModel) return out;
    for (const langs of [['en'], ['ja'], ['zh'], ['zh-Hant']]) {
      try {
        out['avail_' + langs.join('_')] = await LanguageModel.availability({
          expectedInputs: [{ type: 'text', languages: langs }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });
      } catch (e) {
        out['avail_' + langs.join('_')] = 'ERR ' + e.name + ': ' + e.message;
      }
    }
    try {
      out.avail_image = await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] });
    } catch (e) {
      out.avail_image = 'ERR ' + e.name + ': ' + e.message;
    }
    return out;
  });
  await ctx.close();
}
console.log(JSON.stringify(results, null, 2));
