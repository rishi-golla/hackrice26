import { describe, expect, it } from 'vitest';
import {
  registerTalkHotkey,
  type TalkHotkeyAdapter,
  type TalkHotkeyHandlers,
} from '../../src/desktop/talk-hotkey.js';

function fakeAdapter(supportsKeyRelease = true) {
  let handlers: TalkHotkeyHandlers | undefined;
  let binding: string | undefined;
  let cleaned = false;
  const adapter: TalkHotkeyAdapter = {
    supportsKeyRelease,
    canRegister: () => true,
    register: (nextBinding, nextHandlers) => {
      binding = nextBinding;
      handlers = nextHandlers;
      return () => {
        cleaned = true;
      };
    },
  };
  return {
    adapter,
    get handlers() { return handlers; },
    get binding() { return binding; },
    get cleaned() { return cleaned; },
  };
}

describe('talk hotkey lifecycle', () => {
  it('registers Control+Space by default', () => {
    const source = fakeAdapter();

    registerTalkHotkey(() => undefined, () => undefined, source.adapter);

    expect(source.binding).toBe('Control+Space');
  });

  it('starts once, ignores auto-repeat, releases on key-up, and cleans up', () => {
    const source = fakeAdapter();
    const events: string[] = [];
    const cleanup = registerTalkHotkey(
      () => events.push('press'),
      () => events.push('release'),
      source.adapter,
    );

    source.handlers?.down({ repeat: false });
    source.handlers?.down({ repeat: true });
    source.handlers?.up();
    cleanup();

    expect(events).toEqual(['press', 'release']);
    expect(source.cleaned).toBe(true);
  });

  it('cancels an active recording on Escape, suspend, or permission loss', () => {
    const source = fakeAdapter();
    const events: string[] = [];
    registerTalkHotkey(
      () => events.push('press'),
      () => events.push('release'),
      source.adapter,
      { onCancel: (reason) => events.push(`cancel:${reason}`) },
    );

    source.handlers?.down({ repeat: false });
    source.handlers?.escape();
    source.handlers?.down({ repeat: false });
    source.handlers?.suspend();
    source.handlers?.down({ repeat: false });
    source.handlers?.permissionLost();

    expect(events).toEqual([
      'press',
      'release',
      'cancel:escape',
      'press',
      'release',
      'cancel:suspend',
      'press',
      'release',
      'cancel:permission-loss',
    ]);
  });

  it('uses explicit toggle behavior when key release is unavailable', () => {
    const source = fakeAdapter(false);
    const events: string[] = [];
    registerTalkHotkey(
      () => events.push('press'),
      () => events.push('release'),
      source.adapter,
    );

    source.handlers?.down({ repeat: false });
    source.handlers?.up();
    source.handlers?.down({ repeat: false });

    expect(events).toEqual(['press', 'release']);
  });

  it('rejects a configured shortcut collision before registering', () => {
    const source = fakeAdapter();
    source.adapter.canRegister = () => false;

    expect(() => registerTalkHotkey(() => undefined, () => undefined, source.adapter)).toThrow(
      /collision/i,
    );
  });
});
