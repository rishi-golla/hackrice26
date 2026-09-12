import type { FlickyBridge, FlickyTransport } from '../shared/contracts';
import { ServiceError, type IpcResult } from '../shared/verification';

/** Recreate errors in the renderer, after both IPC and contextBridge serialization. */
export function createFlickyBridge(transport: FlickyTransport): FlickyBridge {
  return Object.fromEntries(Object.entries(transport).map(([name, method]) => {
    if (name === 'onEvent' || name === 'onPassive') return [name, method];
    return [name, async (...args: unknown[]) => {
      const result = await (method as (...args: unknown[]) => Promise<IpcResult<unknown>>)(...args);
      if (!result.ok) throw new ServiceError(result.error.message, result.error.code, result.error.requestId, result.error.status);
      return result.value;
    }];
  })) as FlickyBridge;
}
