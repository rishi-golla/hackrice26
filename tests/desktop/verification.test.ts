import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopVerification } from '../../src/desktop/verification';
import { ServiceError, validatePersonaUrl } from '../../src/shared/verification';

afterEach(() => vi.useRealTimers());
describe('desktop verification lifecycle', () => {
  it.each(['https://evil.test/verify?inquiry-id=inq_x', 'https://inquiry.withpersona.com.evil.test/verify?inquiry-id=inq_x',
    'http://inquiry.withpersona.com/verify?inquiry-id=inq_x', 'https://user@inquiry.withpersona.com/verify?inquiry-id=inq_x',
    'https://inquiry.withpersona.com/verify?inquiry-id=inq_x&redirect-uri=https://evil.test'])('rejects an unapproved URL: %s', url => {
    expect(() => validatePersonaUrl(url)).toThrow();
  });
  it('opens only after a click, resumes once and clears on expiry', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce({ requestId: 'r', state: 'pending', hostedUrl: 'https://inquiry.withpersona.com/verify?inquiry-id=inq_test' })
      .mockResolvedValueOnce({ requestId: 'r', state: 'approved', expiresAt: Date.now() + 1000 })
      .mockResolvedValueOnce({ result: {}, operation: '/turn', expiresAt: Date.now() + 1000 }).mockResolvedValue({});
    const deps = { request, open: vi.fn().mockResolvedValue(undefined), clear: vi.fn(), change: vi.fn() };
    const gate = new DesktopVerification(deps);
    gate.handle(new ServiceError('Verify', 'verification_required', 'r'));
    expect(deps.open).not.toHaveBeenCalled();
    await Promise.all([gate.start('r'), gate.start('r')]); expect(deps.open).toHaveBeenCalledOnce();
    expect(deps.change.mock.lastCall?.[0]).not.toHaveProperty('hostedUrl');
    await gate.status('r'); await gate.resume('r');
    expect(gate.blocked).toBe(false);
    await expect(gate.resume('r')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000); expect(gate.blocked).toBe(true);
    expect(deps.change).toHaveBeenLastCalledWith({ state: 'expired' });
  });
  it('ignores a hosted link that arrives after cancel', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({});
    const deps = { request, open: vi.fn(), clear: vi.fn(), change: vi.fn() };
    const gate = new DesktopVerification(deps);
    gate.handle(new ServiceError('Verify', 'verification_required', 'r'));
    const work = gate.start('r'); await gate.cancel('r');
    resolve({ requestId: 'r', state: 'pending', hostedUrl: 'https://inquiry.withpersona.com/verify?inquiry-id=inq_test' });
    await expect(work).rejects.toThrow(); expect(deps.open).not.toHaveBeenCalled();
  });
  it.each(['status', 'resume'] as const)('ignores late %s results after lock', async action => {
    let finish!: (value: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({});
    const deps = { request, open: vi.fn(), clear: vi.fn(), change: vi.fn() };
    const gate = new DesktopVerification(deps);
    gate.handle(new ServiceError('Verify', 'verification_required', 'r'));
    const work = gate[action]('r'); await gate.lock();
    finish({ requestId: 'r', state: 'approved', result: { text: 'protected' }, operation: '/turn', expiresAt: Date.now() + 300_000 });
    await expect(work).rejects.toThrow(); expect(gate.blocked).toBe(true);
    expect(deps.change).toHaveBeenLastCalledWith({ state: 'locked' });
  });
});
