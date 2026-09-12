import { createRequire } from 'node:module';

export type TalkHotkeyKeyCodes = {
  controlLeft: number;
  controlRight: number;
  space: number;
};

export type TalkHotkeyHook = {
  on(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): unknown;
  removeListener(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): unknown;
  start(): void;
  stop(): void;
};

export type TalkHotkeyHandlers = {
  press(): void;
  release(): void;
};

/**
 * Converts global key transitions into one press/release pair. Keeping this
 * state machine separate makes auto-repeat and either-control-key handling
 * deterministic and testable without opening a native input hook.
 */
export function registerHoldToTalk(
  hook: TalkHotkeyHook,
  keys: TalkHotkeyKeyCodes,
  handlers: TalkHotkeyHandlers,
): () => void {
  let controlDown = false;
  let spaceDown = false;
  let active = false;
  let disposed = false;

  const release = () => {
    if (!active) return;
    active = false;
    handlers.release();
  };

  const onKeyDown = ({ keycode }: { keycode: number }) => {
    if (disposed) return;
    if (keycode === keys.controlLeft || keycode === keys.controlRight) controlDown = true;
    if (keycode === keys.space) spaceDown = true;
    if (controlDown && spaceDown && !active) {
      active = true;
      handlers.press();
    }
  };

  const onKeyUp = ({ keycode }: { keycode: number }) => {
    if (disposed) return;
    if (keycode === keys.controlLeft || keycode === keys.controlRight) controlDown = false;
    if (keycode === keys.space) spaceDown = false;
    if (!controlDown || !spaceDown) release();
  };

  hook.on('keydown', onKeyDown);
  hook.on('keyup', onKeyUp);
  return () => {
    if (disposed) return;
    disposed = true;
    release();
    hook.removeListener('keydown', onKeyDown);
    hook.removeListener('keyup', onKeyUp);
  };
}

type NativeHookModule = {
  uIOhook: TalkHotkeyHook;
  UiohookKey: { Ctrl: number; CtrlRight: number; Space: number };
};

/**
 * Starts the cross-platform native hook when its prebuilt N-API binding is
 * available. The caller can fall back to Electron's toggle shortcut when the
 * OS denies global input-hook access or the native module is unavailable.
 */
export function registerNativeHoldToTalk(handlers: TalkHotkeyHandlers): (() => void) | undefined {
  try {
    const require = createRequire(import.meta.url);
    const native = require('uiohook-napi') as NativeHookModule;
    const cleanup = registerHoldToTalk(native.uIOhook, {
      controlLeft: native.UiohookKey.Ctrl,
      controlRight: native.UiohookKey.CtrlRight,
      space: native.UiohookKey.Space,
    }, handlers);
    try {
      native.uIOhook.start();
    } catch {
      cleanup();
      return undefined;
    }
    return () => {
      cleanup();
      native.uIOhook.stop();
    };
  } catch {
    return undefined;
  }
}
