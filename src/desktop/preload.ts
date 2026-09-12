import { contextBridge, ipcRenderer } from 'electron';
import type { FlickyBridge } from '../shared/contracts';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`flicky:${channel}`, ...args);
const bridge: FlickyBridge = {
  login: (email, password) => invoke('login', { email, password }),
  logout: () => invoke('logout'),
  getSession: () => invoke('getSession'),
  getProfile: () => invoke('getProfile'),
  updateProfile: profile => invoke('updateProfile', profile),
  initial: () => invoke('initial'), monitor: enabled => invoke('monitor', enabled),
  selectDisplay: id => invoke('display', id), capture: () => invoke('capture'),
  turn: (text, candidateId, allowStale) => invoke('turn', { text, candidateId, allowStale }),
  cancel: () => invoke('cancel'), forget: () => invoke('forget'), hide: () => invoke('hide'),
  resize: height => invoke('resize', height), consent: enabled => invoke('consent', enabled),
  transcribe: (audio, mimeType, durationMs) => invoke('transcribe', { audio, mimeType, durationMs }),
  speak: replyId => invoke('speak', replyId), state: state => invoke('state', state),
  getConvaiToken: context => invoke('getConvaiToken', context),
  executeTool: (name, input) => invoke('executeTool', { name, input }),
  onEvent: listener => {
    const handler = (_: unknown, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('flicky:event', handler);
    return () => ipcRenderer.removeListener('flicky:event', handler);
  },
  onPassive: listener => {
    const handler = (_: unknown, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('flicky:passive', handler);
    return () => ipcRenderer.removeListener('flicky:passive', handler);
  },
};
contextBridge.exposeInMainWorld('flicky', bridge);
