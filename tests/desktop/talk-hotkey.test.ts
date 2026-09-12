import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
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
  it('loads the external native hook from the CommonJS desktop bundle', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cappy-hotkey-bundle-'));
    try {
      const moduleDirectory = path.join(directory, 'node_modules', 'uiohook-napi');
      await mkdir(moduleDirectory, { recursive: true });
      await writeFile(path.join(moduleDirectory, 'index.js'), `
        const { EventEmitter } = require('node:events');
        const uIOhook = new EventEmitter();
        uIOhook.start = () => {};
        uIOhook.stop = () => {};
        module.exports = { uIOhook, UiohookKey: { Ctrl: 29, CtrlRight: 3613, Space: 57 } };
      `);
      const bundlePath = path.join(directory, 'talk-hotkey.cjs');
      await build({
        entryPoints: [path.resolve('src/desktop/talk-hotkey.ts')],
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['uiohook-napi'],
      });
      const bundled = createRequire(bundlePath)(bundlePath) as typeof import('../../src/desktop/talk-hotkey');

      const cleanup = bundled.registerNativeHoldToTalk({ press: vi.fn(), release: vi.fn() });

      expect(cleanup).toEqual(expect.any(Function));
      cleanup?.();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
