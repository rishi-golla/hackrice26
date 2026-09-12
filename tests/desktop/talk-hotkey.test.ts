import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerHoldToTalk, type TalkHotkeyHook } from '../../src/desktop/talk-hotkey';

class FakeHook extends EventEmitter implements TalkHotkeyHook {
  start = vi.fn();
  stop = vi.fn();
  on(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): this {
    return super.on(event, listener);
  }
  removeListener(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): this {
    return super.removeListener(event, listener);
  }
}

describe('global hold-to-talk hotkey', () => {
  it('starts once when Ctrl+Space is pressed and stops when Space is released', () => {
    const hook = new FakeHook();
    const press = vi.fn();
    const release = vi.fn();
    const cleanup = registerHoldToTalk(hook, { controlLeft: 29, controlRight: 3613, space: 57 }, { press, release });

    hook.emit('keydown', { keycode: 29 });
    hook.emit('keydown', { keycode: 57 });
    hook.emit('keydown', { keycode: 57 });
    hook.emit('keyup', { keycode: 57 });

    expect(press).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    cleanup();
  });

  it('also accepts the right Control key and releases if Control is lifted first', () => {
    const hook = new FakeHook();
    const press = vi.fn();
    const release = vi.fn();
    registerHoldToTalk(hook, { controlLeft: 29, controlRight: 3613, space: 57 }, { press, release });

    hook.emit('keydown', { keycode: 3613 });
    hook.emit('keydown', { keycode: 57 });
    hook.emit('keyup', { keycode: 3613 });

    expect(press).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
