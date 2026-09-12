import { describe, expect, it, vi } from 'vitest';
import { createDemoAuthProvider } from '../../src/service/auth';
import { createSessionStore } from '../../src/service/session';

describe('Cappy local auth', () => {
  it('logs in the deterministic demo identity and rejects bad credentials', async () => {
    const auth = createDemoAuthProvider(createSessionStore({ id: () => 'session-1' }));
    await expect(auth.login('demo@example.com', 'demo-password')).resolves.toMatchObject({ userId: 'demo-user', accountId: 'demo-checking', id: 'session-1' });
    await expect(auth.login('demo@example.com', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('does not log credentials', async () => {
    const spy = vi.spyOn(console, 'log');
    const auth = createDemoAuthProvider();
    await expect(auth.login('bad@example.com', 'secret')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
  });
});
