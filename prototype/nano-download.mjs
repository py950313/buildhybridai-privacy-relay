// Trigger and wait for the Gemini Nano download in the isolated Chrome profile.
// Usage: node prototype/nano-download.mjs   (prints progress; exits when available or after 90 min)
import { launchChrome } from './chrome.mjs';

const ctx = await launchChrome();
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto('https://example.com');
console.log('before:', await page.evaluate(() => LanguageModel.availability({
  expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })));

// create() needs a user activation, so click a button we inject.
await page.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'go'; b.textContent = 'download';
  b.onclick = () => {
    LanguageModel.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => console.log('progress ' + (e.loaded * 100).toFixed(1) + '%'));
      },
    }).then(() => console.log('CREATE_OK')).catch((e) => console.log('CREATE_ERR ' + e.name + ': ' + e.message));
  };
  document.body.append(b);
});
await page.click('#go');

const deadline = Date.now() + 90 * 60_000;
let state = '';
while (Date.now() < deadline) {
  await page.waitForTimeout(30_000);
  state = await page.evaluate(() => LanguageModel.availability({
    expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }));
  console.log(new Date().toISOString(), 'availability:', state);
  if (state === 'available' || state === 'unavailable') break;
}
await ctx.close();
console.log('FINAL', state);
