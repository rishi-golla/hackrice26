import { describe, expect, it, vi } from 'vitest';
import { createFlickyBridge } from '../../src/ui/bridge';
import type { FlickyTransport } from '../../src/shared/contracts';
import { ServiceError } from '../../src/shared/verification';

describe('renderer bridge', () => {
  it('reconstructs typed errors from copied plain data and preserves event subscriptions', async () => {
    const onEvent = vi.fn(() => vi.fn());
    const transport = { onEvent, turn: vi.fn(async () => structuredClone({ ok: false,
      error: { message: 'Verify first.', code: 'verification_required', requestId: 'r', status: 403 } })),
      speak: vi.fn(async () => ({ ok: true, value: new Uint8Array([1, 2]) })) } as unknown as FlickyTransport;
    const bridge = createFlickyBridge(transport);
    await expect(bridge.turn('question')).rejects.toBeInstanceOf(ServiceError);
    await expect(bridge.turn('question')).rejects.toMatchObject({ code: 'verification_required', requestId: 'r', status: 403 });
    expect(await bridge.speak('reply')).toEqual(new Uint8Array([1, 2]));
    expect(bridge.onEvent).toBe(onEvent);
  });
});
