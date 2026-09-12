import { _electron as electron } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

// The fixture never imports service/entry or dotenv and cannot create Persona inquiries.
const app = await electron.launch({ args: [path.resolve('tests/e2e/verification-electron.cjs')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, timeout: 20_000 });
try {
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('Talk to your cursor', { exact: true }).fill('Explain my balance');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByRole('button', { name: 'Verify identity' }).waitFor();
  assert.equal(await page.locator('.error').count(), 0, 'Renderer must recognize the typed verification error.');
  const result = await page.evaluate(() => window.flicky.turn('Explain my balance'));
  assert.deepEqual(result, { ok: false, error: { message: 'Verify first.', code: 'verification_required', requestId: 'test-request', status: 403 } });
  assert.deepEqual(errors, []);
  console.log('Electron preload smoke passed: sandboxed context isolation preserves verification metadata. No env files or Persona calls.');
} finally { await app.close(); }
