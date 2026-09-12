import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Render the built renderer with a test-only preload bridge. No provider or env files are read.
const root = path.resolve('dist/renderer');
const output = await mkdtemp(path.join(tmpdir(), 'cappy-verification-ui-'));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const content = await readFile(file);
    response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 384, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    let listener = () => {}; window.testSpeakCount = 0;
    const emit = verification => listener({ type: 'verification', verification });
    window.testExpire = () => emit({ state: 'expired' });
    window.testCandidate = () => listener({ type: 'candidate', candidate: { id: 'candidate', state: 'preview', amountCents: 12345, sourceText: 'Test purchase', reason: '' } });
    window.flicky = {
      initial: async () => ({ mode: 'synthetic', accountId: 'demo-checking', monitoring: false, permission: 'granted',
        microphoneConsent: false, capabilities: { transcription: true, speech: true }, shortcut: '⌘Space' }),
      onEvent: callback => { listener = callback; return () => {}; }, onPassive: () => () => {},
      state: async () => {}, cancel: async () => {},
      turn: async () => { emit({ state: 'locked', requestId: 'test-request' }); return {}; },
      verificationStart: async () => { const view = { state: 'pending', requestId: 'test-request' }; emit(view); return view; },
      verificationStatus: async () => { const view = { state: 'approved', requestId: 'test-request', expiresAt: Date.now() + 300_000 }; emit(view); return view; },
      verificationCancel: async () => emit({ state: 'canceled' }),
      verificationResume: async () => {
        emit({ state: 'unlocked', expiresAt: Date.now() + 300_000 });
        listener({ type: 'answer', answer: { sensitive: true, replyId: 'reply', state: 'idle', text: 'Synthetic account answer.' } });
      },
      speak: async () => { window.testSpeakCount++; return new Uint8Array(); },
    };
    // Match the real preload: plain result envelopes cross context isolation.
    for (const [name, method] of Object.entries(window.flicky)) {
      if (name !== 'onEvent' && name !== 'onPassive') window.flicky[name] = async (...args) => ({ ok: true, value: await method(...args) });
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Talk to your cursor', { exact: true }).fill('Can I afford $10?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByRole('button', { name: 'Verify identity' }).waitFor();
  await page.screenshot({ path: path.join(output, 'locked-384.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'locked-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Verify identity' }).click();
  await page.getByRole('button', { name: 'Continue' }).waitFor();
  await page.screenshot({ path: path.join(output, 'approved-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Synthetic account answer.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testSpeakCount), 0);
  await page.evaluate(() => window.testCandidate());
  await page.getByRole('button', { name: 'Ask about this' }).click();
  assert.match(await page.getByLabel('Talk to your cursor', { exact: true }).inputValue(), /123.45/);
  await page.evaluate(() => window.testExpire());
  await page.getByText('Verification expired. Ask your question again to start a new check.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Synthetic account answer.', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Read aloud' }).count(), 0);
  assert.equal(await page.getByLabel('Talk to your cursor', { exact: true }).inputValue(), '');
  await page.screenshot({ path: path.join(output, 'expired-320.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Renderer verification smoke test passed; screenshots:', output);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
