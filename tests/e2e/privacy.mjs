// Privacy core test (#4 acceptance 1-5). Real Chrome with real GLiNER and Gemini Nano; Firebase
// Auth/Firestore on emulators; the Gemini cloud endpoint is intercepted and answered by a mock.
// Every request the page makes is recorded (URL + body) and must not contain any marked original.
//
// protects: no marked original leaves the device in any tier (full, GLiNER-only, manual), in
//   follow-ups, or on the local route; mangled placeholders are not restored; offline shows a
//   message; a browser without the Prompt API still works; receipts hold no text.
// fails_when: masking, the leak guard, follow-up reconciliation or receipt fields regress, or
//   the app starts sending original text anywhere (including non-Gemini endpoints).
// no_claim: real Gemini behaviour (mocked here) and the direct third-party APIs / copy-paste mode
//   (#6 adds those cases). Detection quality is measured in #8, not here.
//
// Run: npm run test:privacy  (wraps this in `firebase emulators:exec --only auth,firestore`)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { launchChrome } from '../../prototype/chrome.mjs';

const PORT = 5180;
const BASE = `http://localhost:${PORT}`;
const PROJECT = 'buildhybridai-2026-fdbba';

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  shell: true, env: { ...process.env, VITE_USE_EMULATORS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const requests = []; // { url, body }
let mockMode = 'echo';
const geminiBodies = [];

const ctx = await launchChrome();
ctx.on('request', (r) => requests.push({ url: r.url(), body: r.postData() ?? '', headers: JSON.stringify(r.headers()) }));

// Bring-your-own-key providers: fake keys, mocked endpoints (no real account is used).
const FAKE_KEYS = { anthropic: 'sk-ant-e2e-FAKE-000111222333', xai: 'xai-e2e-FAKE-444555666777' };
const VAULT_PASSWORD = 'e2e vault password';
const byokBodies = { anthropic: [], xai: [] };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const placeholdersOf = (text) => [...new Set(text.match(/\[[A-Z_]+_\d+\]/g) ?? [])];
await ctx.route(/api\.anthropic\.com/, async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = route.request().postData() ?? '';
  byokBodies.anthropic.push(body);
  const last = JSON.parse(body).messages.at(-1).content;
  const text = `Claude draft mentioning ${placeholdersOf(typeof last === 'string' ? last : JSON.stringify(last)).join(' and ') || 'nobody'}.`;
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const sse = ev('message_start', { message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
    + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } })
    + ev('message_stop', {});
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse });
});
await ctx.route(/api\.x\.ai/, async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = route.request().postData() ?? '';
  byokBodies.xai.push(body);
  const text = `Grok draft mentioning ${placeholdersOf(JSON.parse(body).messages.at(-1).content).join(' and ') || 'nobody'}.`;
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }) });
});
await ctx.route(/firebasevertexai\.googleapis\.com/, async (route) => {
  const body = route.request().postData() ?? '';
  geminiBodies.push(body);
  const json = JSON.parse(body);
  const lastText = json.contents.at(-1).parts.map((p) => p.text ?? '').join('');
  const phs = [...new Set(lastText.match(/\[[A-Z_]+_\d+\]/g) ?? [])];
  const text = mockMode === 'mangle' ? 'Dear [Person 1], thank you.' : `Draft reply mentioning ${phs.join(' and ') || 'nobody'}.`;
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] }),
  });
});

// Warm-up: the first load after a source change makes Vite re-bundle dependencies and reload the
// page, which would break whichever scenario runs first.
{
  const warm = await ctx.newPage();
  await warm.goto(`${BASE}/?nano=off&gliner=off`);
  await warm.waitForSelector('[data-testid=tier]', { timeout: 120_000 });
  // The profile is reused between runs but the Auth emulator is new each time: drop the stored
  // anonymous session so every run starts signed out.
  await warm.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('firebaseLocalStorageDb');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await warm.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('byok-vault');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await warm.waitForTimeout(5000);
  await warm.reload();
  await warm.waitForSelector('[data-testid=tier]', { timeout: 120_000 });
  await warm.close();
}

const results = [];
async function scenario(name, fn) {
  const start = requests.length;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const marked = await fn(page, errors);
    const mine = requests.slice(start);
    for (const m of marked ?? []) {
      const hit = mine.find((r) => r.url.includes(m) || r.body.includes(m) || r.body.includes(JSON.stringify(m).slice(1, -1)));
      assert.equal(hit, undefined, `"${m}" found in request to ${hit?.url}`);
    }
    results.push({ name, ok: true, requests: mine.length, marked: marked?.length ?? 0 });
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message).slice(0, 400) });
  }
  await page.close();
}

const markedTexts = (page) => page.$$eval('[data-testid=mention]:not(.off)', (els) => els.map((e) => e.firstChild.textContent));

async function ensureGliner(page) {
  const btn = page.locator('[data-testid=gliner-download]');
  if (await btn.isVisible().catch(() => false)) await btn.click();
  await page.waitForFunction(() => /ready \((fp16|int8)\)/.test(document.querySelector('[data-testid=status]')?.textContent ?? ''), null, { timeout: 300_000 });
}

async function cloudRun(page, text, { task = 'analyze', expect = [], provider = null } = {}) {
  await page.selectOption('[data-testid=task]', task);
  await page.fill('[data-testid=content]', text);
  await page.selectOption('[data-testid=route-choice]', 'cloud');
  if (provider) await page.selectOption('[data-testid=provider]', provider);
  await page.click('[data-testid=submit]');
  await page.waitForSelector('[data-testid=confirm]', { timeout: 120_000 });
  const marked = await markedTexts(page);
  for (const e of expect) assert.ok(marked.some((m) => m.includes(e)), `expected "${e}" to be marked; got ${JSON.stringify(marked)}`);
  return marked;
}

async function send(page) {
  const n = await page.locator('[data-testid=turn]').count();
  await page.click('[data-testid=send]');
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid=turn]').length > k, n, { timeout: 60_000 });
  await receiptSaved(page);
}

// The receipt write is async; wait for its outcome so closing the page does not cancel it.
async function receiptSaved(page) {
  const turn = page.locator('[data-testid=turn]').last();
  let state = 'pending';
  for (let i = 0; i < 60 && state === 'pending'; i++) {
    await page.waitForTimeout(500);
    state = await turn.getAttribute('data-receipt');
  }
  assert.equal(state, 'saved', `receipt state after 30 s: ${state}`);
}

const EN = 'Hi team, Sarah Lin from Northwind Demo Ltd asked us to send the signed offer to sarah.lin@northwind-demo.com '
  + 'or call 0912-345-678. Her ID is A123456789. What should we reply?';
const ZH = '王小明的電話是 0912-345-678，住在台北市大安區和平東路一段 999 號 8 樓，請幫我寫一封道歉信給他。';

// 1 + 4: full tier, then a follow-up on the same placeholder table.
await scenario('full tier (Nano + GLiNER), cloud, then follow-up', async (page) => {
  await page.goto(BASE);
  await ensureGliner(page);
  await page.waitForFunction(() => /On-device AI: ready/.test(document.querySelector('[data-testid=status]')?.textContent ?? ''), null, { timeout: 30_000 });
  const m1 = await cloudRun(page, EN, { expect: ['Sarah Lin', 'sarah.lin@northwind-demo.com', '0912-345-678', 'A123456789'] });
  await send(page);
  const answer = await page.locator('[data-testid=answer]').last().textContent();
  assert.ok(answer.includes('Sarah Lin'), `answer not restored: ${answer}`);
  // Follow-up mentions the earlier person (detector may or may not catch it) and a new email.
  await page.fill('[data-testid=followup]', 'Should Sarah Lin also cc tom.wu@northwind-demo.com?');
  await page.click('[data-testid=followup-submit]');
  await page.waitForSelector('[data-testid=confirm]', { timeout: 120_000 });
  const m2 = await markedTexts(page);
  await send(page);
  const sent2 = await page.locator('[data-testid=sent]').last().textContent();
  assert.ok(sent2.includes('[PERSON_1]'), `follow-up did not reuse [PERSON_1]: ${sent2}`);
  assert.ok(!sent2.includes('Sarah'), 'earlier name leaked in follow-up');
  return [...m1, ...m2, 'Sarah Lin'];
});

// 2: GLiNER tier (no Prompt API), Chinese text.
await scenario('GLiNER tier, Chinese', async (page) => {
  await page.goto(`${BASE}/?nano=off`);
  await ensureGliner(page);
  const m = await cloudRun(page, ZH, { expect: ['王小明', '0912-345-678', '台北市大安區和平東路一段 999 號 8 樓'] });
  await send(page);
  return m;
});

// 3: manual mode with a hand-marked name.
await scenario('manual mode with a manual mark', async (page) => {
  await page.goto(`${BASE}/?nano=off&gliner=off`);
  await page.waitForFunction(() => /Manual mode/.test(document.querySelector('[data-testid=tier]')?.textContent ?? ''));
  await cloudRun(page, 'Kevin Huang needs the Falcon budget, and Kevin Huang approves it. Card 4111 1111 1111 1111.', { expect: ['4111 1111 1111 1111'] });
  await page.evaluate(() => { document.querySelector('details.manual').open = true; });
  await page.evaluate(() => {
    const ta = document.querySelector('[data-testid=mark-source]');
    const i = ta.value.indexOf('Kevin Huang');
    ta.focus();
    ta.setSelectionRange(i, i + 'Kevin Huang'.length);
  });
  await page.click('[data-testid=mark-button]');
  const m = await markedTexts(page);
  assert.equal(m.filter((x) => x === 'Kevin Huang').length, 2, 'manual mark should cover both occurrences');
  await send(page);
  return m;
});

// Local route: nothing about the text may leave the device.
await scenario('local route (Nano answers, nothing sent)', async (page) => {
  await page.goto(BASE);
  await page.waitForFunction(() => /On-device AI: ready/.test(document.querySelector('[data-testid=status]')?.textContent ?? ''), null, { timeout: 30_000 });
  const text = 'Please make this nicer: Dana Whitfield will be late to the Orion review because of her dentist appointment.';
  await page.selectOption('[data-testid=task]', 'rewrite');
  await page.fill('[data-testid=content]', text);
  assert.match(await page.locator('[data-testid=route]').textContent(), /On this device/);
  await page.click('[data-testid=submit]');
  await page.waitForSelector('[data-testid=answer]', { timeout: 120_000 });
  await receiptSaved(page);
  return ['Dana Whitfield', 'Orion review', 'dentist appointment'];
});

// Acceptance 3: a mangled placeholder is flagged red, not restored.
await scenario('mangled placeholder is not restored', async (page) => {
  mockMode = 'mangle';
  await page.goto(`${BASE}/?nano=off&gliner=off`);
  const m = await cloudRun(page, 'Email jane.roe@demo-mail.com about the invoice.', { expect: ['jane.roe@demo-mail.com'] });
  await send(page);
  mockMode = 'echo';
  const invalid = await page.locator('[data-testid=invalid]').allTextContents();
  assert.deepEqual(invalid, ['[Person 1]']);
  return m;
});

// Acceptance 4: offline shows a message instead of spinning.
await scenario('offline: cloud disabled with a message', async (page) => {
  await page.goto(`${BASE}/?nano=off&gliner=off`);
  await page.fill('[data-testid=content]', 'Summarize: call 0912-345-678 tomorrow.');
  await page.selectOption('[data-testid=route-choice]', 'cloud');
  await ctx.setOffline(true);
  try {
    await page.waitForSelector('[data-testid=offline-msg]', { timeout: 5_000 });
    assert.ok(await page.locator('[data-testid=submit]').isDisabled(), 'submit should be disabled offline');
  } finally {
    await ctx.setOffline(false);
  }
  return ['0912-345-678'];
});

// Acceptance 2: a browser without the Prompt API loads without errors.
await scenario('no Prompt API: page works, no errors', async (page, errors) => {
  await page.addInitScript(() => { delete globalThis.LanguageModel; });
  await page.goto(`${BASE}/?gliner=off`);
  await page.waitForSelector('[data-testid=tier]');
  assert.match(await page.locator('[data-testid=tier]').textContent(), /Manual mode/);
  assert.match(await page.locator('[data-testid=status]').textContent(), /not in this browser/);
  await page.waitForTimeout(1500);
  assert.deepEqual(errors, []);
  return [];
});

// --- Bring your own key (#6) ---
const keysPanel = (page, state) => page.waitForSelector(`[data-testid=keys-panel][data-state=${state}]`, { timeout: 30_000 });

await scenario('key vault: ciphertext only in IndexedDB, wrong password refused', async (page) => {
  await page.goto(`${BASE}/?nano=off&gliner=off`);
  await keysPanel(page, 'none');
  await page.click('[data-testid=keys-panel] summary');
  await page.fill('[data-testid=key-anthropic]', FAKE_KEYS.anthropic);
  await page.fill('[data-testid=key-xai]', FAKE_KEYS.xai);
  await page.fill('[data-testid=vault-password]', VAULT_PASSWORD);
  await page.click('[data-testid=vault-create]');
  await keysPanel(page, 'unlocked');
  // #6 acceptance 1: the stored record holds no key in clear.
  const dump = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('byok-vault');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('vault').objectStore('vault').get('keys');
      get.onsuccess = () => {
        const r = get.result;
        const latin1 = (u) => Array.from(u, (b) => String.fromCharCode(b)).join('');
        resolve({ fields: Object.keys(r).sort(), iterations: r.iterations, raw: latin1(r.ct) + latin1(r.salt) + latin1(r.iv) + JSON.stringify(r) });
      };
    };
  }));
  assert.deepEqual(dump.fields, ['ct', 'iterations', 'iv', 'salt', 'v']);
  assert.equal(dump.iterations, 600000);
  for (const k of Object.values(FAKE_KEYS)) assert.ok(!dump.raw.includes(k), 'API key stored in clear');
  // #6 acceptance 2: a wrong password does not unlock.
  await page.click('[data-testid=vault-lock]');
  await keysPanel(page, 'locked');
  await page.fill('[data-testid=vault-password]', VAULT_PASSWORD + 'x');
  await page.click('[data-testid=vault-unlock]');
  await page.waitForSelector('[data-testid=vault-error]');
  assert.match(await page.locator('[data-testid=vault-error]').textContent(), /Wrong password/);
  await keysPanel(page, 'locked');
  assert.ok(await page.locator('[data-testid=provider]').count() === 0 || await page.locator('[data-testid=provider] option[value=anthropic]').isDisabled());
  return [];
});

async function unlockVault(page) {
  await keysPanel(page, 'locked');
  await page.click('[data-testid=keys-panel] summary');
  await page.fill('[data-testid=vault-password]', VAULT_PASSWORD);
  await page.click('[data-testid=vault-unlock]');
  await keysPanel(page, 'unlocked');
}

for (const [provider, label] of [['anthropic', 'Claude'], ['xai', 'Grok']]) {
  await scenario(`own key: ${provider} direct call (mocked endpoint)`, async (page) => {
    await page.goto(`${BASE}/?nano=off&gliner=off`);
    await unlockVault(page);
    const m = await cloudRun(page, 'Ask Olivia Marsh (olivia.marsh@demo-mail.com, 0933-222-111) to confirm the delivery.',
      { provider, expect: ['olivia.marsh@demo-mail.com', '0933-222-111'] });
    await send(page);
    const answer = await page.locator('[data-testid=answer]').last().textContent();
    assert.ok(answer.includes(`${label} draft`) && answer.includes('olivia.marsh@demo-mail.com'), `not restored: ${answer}`);
    assert.equal(byokBodies[provider].length > 0, true, 'provider endpoint was not called');
    return m;
  });
}

await scenario('copy and paste: nothing sent, reply restored (works offline)', async (page) => {
  await page.goto(`${BASE}/?nano=off&gliner=off`);
  await page.selectOption('[data-testid=task]', 'analyze');
  await page.fill('[data-testid=content]', 'Remind Peter Novak at peter.novak@demo-mail.com about invoice 4111 1111 1111 1111.');
  await page.selectOption('[data-testid=route-choice]', 'cloud');
  await page.selectOption('[data-testid=provider]', 'copy');
  await ctx.setOffline(true);
  try {
    await page.click('[data-testid=submit]');
    await page.waitForSelector('[data-testid=confirm]');
    const m = await markedTexts(page);
    await page.click('[data-testid=send]');
    await page.waitForSelector('[data-testid=paste]');
    const masked = await page.locator('[data-testid=copy-text]').textContent();
    for (const x of m) assert.ok(!masked.includes(x), `"${x}" visible in the text to copy`);
    assert.ok(masked.includes('[EMAIL_1]') && masked.includes('[CARD_1]'));
    await page.fill('[data-testid=paste-reply]', 'Sure: write to [EMAIL_1] about card [CARD_1] and [Card 1].');
    await page.click('[data-testid=paste-restore]');
    const answer = await page.locator('[data-testid=answer]').last().textContent();
    assert.ok(answer.includes('peter.novak@demo-mail.com') && answer.includes('4111 1111 1111 1111'), `not restored: ${answer}`);
    assert.deepEqual(await page.locator('[data-testid=invalid]').allTextContents(), ['[Card 1]']);
    return [...m, 'Peter Novak'];
  } finally {
    await ctx.setOffline(false);
  }
});

// Acceptance 5: receipts hold no text (read with emulator owner access, bypassing rules).
const allMarked = ['Sarah Lin', 'sarah.lin@northwind-demo.com', '0912-345-678', 'A123456789', '王小明', 'Kevin Huang', 'jane.roe@demo-mail.com', 'Dana Whitfield',
  'olivia.marsh@demo-mail.com', '0933-222-111', 'peter.novak@demo-mail.com', '4111 1111 1111 1111'];
try {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/receipts?pageSize=100`, { headers: { Authorization: 'Bearer owner' } });
  const dump = await res.text();
  const docs = JSON.parse(dump).documents ?? [];
  assert.ok(docs.length >= 6, `expected receipts, got ${docs.length}`);
  for (const s of [...allMarked, '[PERSON_', '[EMAIL_', 'Draft reply']) assert.ok(!dump.includes(s), `receipt contains "${s}"`);
  const keys = new Set(docs.flatMap((d) => Object.keys(d.fields)));
  assert.deepEqual([...keys].sort(), ['createdAt', 'inputChars', 'latencyMs', 'maskedCounts', 'provider', 'route', 'scenario', 'uid']);
  results.push({ name: 'receipts contain statistics only', ok: true, receipts: docs.length });
} catch (e) {
  results.push({ name: 'receipts contain statistics only', ok: false, error: String(e.message).slice(0, 400) });
}

// Every Gemini request body, across all scenarios, must be free of every marked original.
const bodyLeaks = [...geminiBodies, ...byokBodies.anthropic, ...byokBodies.xai].flatMap((b) => allMarked.filter((s) => b.includes(s)));
// An API key may only ever travel to its own provider.
const keyLeaks = requests.flatMap((r) => Object.entries(FAKE_KEYS)
  .filter(([p, k]) => (r.url + r.body + r.headers).includes(k) && !r.url.includes(p === 'anthropic' ? 'api.anthropic.com' : 'api.x.ai'))
  .map(([p]) => `${p} key in request to ${r.url.slice(0, 60)}`));
results.push({ name: 'API keys only sent to their own provider', ok: keyLeaks.length === 0, ...(keyLeaks.length ? { error: keyLeaks.join('; ') } : {}) });
results.push({ name: 'all cloud request bodies free of marked originals', ok: bodyLeaks.length === 0, ...(bodyLeaks.length ? { error: bodyLeaks.join(', ') } : {}) });

await ctx.close();
vite.kill();
spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { shell: true });
console.log(JSON.stringify({ geminiRequests: geminiBodies.length, totalRequests: requests.length, results }, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
