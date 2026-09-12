export type TalkHotkeyHandlers = {
  down(event: { repeat: boolean }): void;
  up(): void;
  escape(): void;
  suspend(): void;
  permissionLost(): void;
};

export type TalkHotkeyAdapter = {
  supportsKeyRelease: boolean;
  canRegister?: (binding: string) => boolean;
  register(binding: string, handlers: TalkHotkeyHandlers): () => void;
};

export type TalkHotkeyOptions = {
  binding?: string;
  onCancel?: (reason: 'escape' | 'suspend' | 'permission-loss') => void;
};

export function registerTalkHotkey(
  onPress: () => void,
  onRelease: () => void,
  adapter: TalkHotkeyAdapter,
  options: TalkHotkeyOptions = {},
): () => void {
  const binding = options.binding ?? 'Control+Shift+Space';
  if (adapter.canRegister && !adapter.canRegister(binding)) {
    throw new Error(`Hotkey collision: ${binding}`);
  }

  let active = false;
  let disposed = false;

  const stop = (reason?: 'escape' | 'suspend' | 'permission-loss') => {
    if (!active) {
      return;
    }
    active = false;
    onRelease();
    if (reason) {
      options.onCancel?.(reason);
    }
  };

  const handlers: TalkHotkeyHandlers = {
    down: ({ repeat }) => {
      if (disposed || repeat) {
        return;
      }
      if (!adapter.supportsKeyRelease && active) {
        stop();
        return;
      }
      if (!active) {
        active = true;
        onPress();
      }
    },
    up: () => {
      if (disposed || !adapter.supportsKeyRelease) {
        return;
      }
      stop();
    },
    escape: () => stop('escape'),
    suspend: () => stop('suspend'),
    permissionLost: () => stop('permission-loss'),
  };

  const cleanupAdapter = adapter.register(binding, handlers);
  return () => {
    if (disposed) {
      return;
    }
    stop();
    disposed = true;
    cleanupAdapter();
  };
}
