import { app, BrowserWindow, Tray, Menu, nativeImage, screen, desktopCapturer, ipcMain, globalShortcut, systemPreferences, powerMonitor, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { createMonitor } from './monitor';
import { clampCard } from './coordinates';
import { recognize, disposeRecognizer } from './recognize';
import { extractPurchase } from './extract';
import type { Frame, Rect } from './types';
import type { Answer, CursorState, DesktopEvent, PublicConfig } from '../shared/contracts';
import { registerNativeAltSpaceToggle } from './talk-hotkey';

let card: BrowserWindow;
let passive: BrowserWindow;
let tray: Tray;
let service: ChildProcessWithoutNullStreams;
let servicePort = 0;
let sessionId = '';
let authSessionId = '';
const token = randomBytes(32).toString('hex');
let config: PublicConfig;
let state: CursorState = 'idle';
let generation = 0;
let captureBusy = false;
let annotation: Rect | undefined;
let annotationExpires = 0;
let quitting = false;
let captureGeneration = 0;
let nativeTalkHotkeyCleanup: (() => void) | undefined;
let lastScreenText = '';
const cursorStates = z.enum(['idle', 'listening', 'thinking', 'speaking', 'clarifying', 'error']);
const shortcut = 'Alt+Space';

async function request<T>(route: string, body?: unknown, useAuthSession = true): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${servicePort}${route}`, {
    method: body === undefined ? 'GET' : route.startsWith('/profile') ? 'PUT' : 'POST', headers: { Authorization: `Bearer ${useAuthSession && authSessionId ? authSessionId : token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Request failed');
  return result as T;
}
function send(event: DesktopEvent) { if (card && !card.isDestroyed()) card.webContents.send('flicky:event', event); }
function setState(next: CursorState) { state = next; send({ type: 'state', state }); }
function selectedDisplay() { return screen.getAllDisplays().find(d => String(d.id) === config.displayId) ?? screen.getPrimaryDisplay(); }
function clearAnnotation() { annotation = undefined; annotationExpires = 0; }
function showCard(focus = false) {
  const display = selectedDisplay();
  const point = screen.getCursorScreenPoint();
  const bounds = clampCard({ x: point.x + 24, y: point.y + 24 }, { width: 384, height: card.getBounds().height }, display.workArea);
  card.setPosition(Math.round(bounds.x), Math.round(bounds.y));
  if (focus) card.show(); else card.showInactive();
}
async function cancel() {
  generation++; captureGeneration++; clearAnnotation(); setState('idle'); send({ type: 'cancel' });
  if (servicePort && sessionId) await request('/cancel', { sessionId }).catch(() => {});
}
const monitor = createMonitor(async () => { await capture(); });

async function analyze(text: string, candidateId?: string, allowStale = false, hover = false) {
  await cancel();
  const own = ++generation;
  setState('thinking');
  try {
    const answer = await request<Answer>('/turn', { sessionId, turnId: randomUUID(), text, candidateId, allowStale, hover });
    if (own !== generation) throw new Error('Turn canceled');
    setState(answer.state === 'clarify' || answer.state === 'clarifying' ? 'clarifying' : 'idle');
    send({ type: 'answer', answer });
    return answer;
  } catch (error) {
    if (own === generation) setState('error');
    throw error;
  }
}
async function capture() {
  if (captureBusy) return;
  captureBusy = true;
  const own = ++captureGeneration;
  clearAnnotation();
  const display = selectedDisplay();
  const cursor = screen.getCursorScreenPoint();
  const wasCardVisible = card.isVisible();
  const wasPassiveVisible = passive.isVisible();
  try {
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
      throw new Error('Screen access is denied. Enable Flicky in System Settings → Privacy & Security → Screen Recording, then restart. You can enter an amount instead.');
    }
    card.hide(); passive.hide();
    await new Promise(resolve => setTimeout(resolve, 100));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor),
    }, fetchWindowIcons: false });
    const source = sources.find(item => item.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('No screen image. Check screen permission or enter an amount.');
    const size = source.thumbnail.getSize();
    const frame: Frame = { id: randomUUID(), capturedAt: Date.now(), displayId: String(display.id), bounds: display.bounds,
      workArea: display.workArea, imageWidth: size.width, imageHeight: size.height, png: source.thumbnail.toPNG() };
    // The overlay is hidden only for capture, not for local recognition.
    if (wasPassiveVisible) passive.showInactive();
    if (wasCardVisible) card.showInactive();
    const words = await recognize(frame);
    lastScreenText = words.map(w => w.text).join(' ');
    if (own !== captureGeneration || config.displayId !== String(display.id)) return;
    const candidate = extractPurchase(words, frame, { ...cursor, displayId: String(display.id), at: Date.now() });
    const id = randomUUID();
    send({ type: 'candidate', candidate: { id, amountCents: candidate.amountCents, sourceText: candidate.sourceText.slice(0, 160), state: candidate.state, reason: candidate.reason } });
    showCard();
    if (candidate.state === 'preview' && candidate.amountCents !== null) {
      const snapshot = await request<{ today: string }>('/snapshot?accountId=' + encodeURIComponent(config.accountId));
      if (own !== captureGeneration) return;
      await request('/candidate', { sessionId, purchase: { id, label: 'Screen purchase', cents: candidate.amountCents, date: snapshot.today, origin: 'screen', confirmed: false } });
      const answer = await analyze('Can I afford this?', id, false, true);
      // analyze invalidates old captures; current coordinates must still be fresh.
      if (answer.forecast?.status === 'negative' && candidate.buttonBox && frame.capturedAt !== undefined && Date.now() - frame.capturedAt <= 3000 && config.monitoring) {
        annotation = { x: candidate.buttonBox.x - 6, y: candidate.buttonBox.y - 6, width: candidate.buttonBox.width + 12, height: candidate.buttonBox.height + 12 };
        annotationExpires = Date.now() + 5000;
      }
    } else setState('clarifying');
  } catch (error) {
    if (own === captureGeneration) { setState('error'); send({ type: 'error', message: error instanceof Error ? error.message : 'Screen analysis failed. Enter the price instead.' }); showCard(); }
  } finally {
    captureBusy = false;
    if (!quitting) { passive.showInactive(); if (wasCardVisible && !card.isVisible()) card.showInactive(); }
  }
}

async function startService() {
  service = spawn(process.execPath, [path.join(__dirname, 'service.cjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FLICKY_SESSION_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise<Pick<PublicConfig, 'accountId' | 'mode' | 'capabilities'>>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Local service startup timed out')), 15000);
    service.stdout.on('data', chunk => {
      output += chunk.toString();
      if (!output.includes('\n')) return;
      try { const value = JSON.parse(output.split('\n')[0]); servicePort = value.port; clearTimeout(timer); resolve(value); }
      catch { clearTimeout(timer); reject(new Error('Invalid local service startup response')); }
    });
    service.on('error', () => { clearTimeout(timer); reject(new Error('Could not start local service')); });
    service.on('exit', () => { clearTimeout(timer); if (!servicePort) reject(new Error('Local service failed. Check data-mode configuration.')); else if (!quitting) { send({ type: 'error', message: 'Local service stopped. Restart Flicky.' }); showCard(); } });
    // Never print provider payloads, session tokens, or credentials to renderer logs.
    service.stderr.on('data', () => {});
  });
}
function secureWindow(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function handle(name: string, schema: z.ZodTypeAny, action: (value: any) => unknown) {
  ipcMain.handle(`flicky:${name}`, (event, value) => {
    if (event.sender !== card.webContents || event.senderFrame !== card.webContents.mainFrame) throw new Error('Unauthorized renderer');
    return action(schema.parse(value));
  });
}
function registerIPC() {
  const empty = z.undefined();
  handle('initial', empty, () => config);
  handle('login', z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict(), async value => { const result = await request<{ id: string; userId: string; accountId: string; issuedAt: string; expiresAt: string }>('/auth/login', value, false); authSessionId = result.id; return result; });
  handle('logout', empty, async () => { if (authSessionId) await request('/auth/logout', {}); authSessionId = ''; sessionId = ''; });
  handle('getSession', empty, () => request('/auth/session'));
  handle('getProfile', empty, () => request('/profile'));
  handle('updateProfile', z.object({ reserveCents: z.number().int().nonnegative(), riskStyle: z.enum(['calm', 'direct', 'detailed']), language: z.literal('en-US'), monitoringEnabled: z.boolean() }).strict(), value => request('/profile', value));
  handle('monitor', z.boolean(), async enabled => { await cancel(); config.monitoring = enabled; monitor.setEnabled(enabled); send({ type: 'config', config }); return config; });
  handle('display', z.string(), async id => {
    if (!screen.getAllDisplays().some(d => String(d.id) === id)) throw new Error('Unknown display');
    await cancel(); config.displayId = id; monitor.setEnabled(false); monitor.setEnabled(config.monitoring);
    passive.setBounds(selectedDisplay().bounds); showCard(); return config;
  });
  handle('capture', empty, () => capture());
  handle('turn', z.object({ text: z.string().trim().min(1).max(2000), candidateId: z.string().max(120).optional(), allowStale: z.boolean().optional() }).strict(), value => analyze(value.text, value.candidateId, value.allowStale));
  handle('cancel', empty, () => cancel());
  handle('forget', empty, async () => { await cancel(); await request('/forget', { sessionId }); });
  handle('hide', empty, () => { card.hide(); clearAnnotation(); });
  handle('resize', z.number().int().min(100).max(1000), height => { const area = selectedDisplay().workArea; card.setSize(Math.min(384, area.width), Math.min(height, area.height - 24)); const b = clampCard(card.getBounds(), card.getBounds(), area); card.setPosition(Math.round(b.x), Math.round(b.y)); });
  handle('consent', z.boolean(), async enabled => {
    await cancel();
    config.microphoneConsent = enabled && (process.platform !== 'darwin' || await systemPreferences.askForMediaAccess('microphone'));
    return config;
  });
  handle('transcribe', z.object({ audio: z.instanceof(Uint8Array), mimeType: z.string().max(100), durationMs: z.number().positive().max(30000) }).strict(), async value => {
    if (!config.microphoneConsent || value.audio.byteLength > 10 * 1024 * 1024) throw new Error('Microphone consent or valid audio required');
    const own = generation;
    const result = await request<{ text: string }>('/transcribe', { sessionId, audio: Buffer.from(value.audio).toString('base64'), mime: value.mimeType, durationMs: value.durationMs });
    if (own !== generation) throw new Error('Recording canceled');
    return result.text;
  });
  handle('speak', z.string().min(1).max(120), async replyId => {
    const own = generation;
    const result = await request<{ audio: string }>('/speak', { sessionId, replyId });
    if (own !== generation) throw new Error('Speech canceled');
    return new Uint8Array(Buffer.from(result.audio, 'base64'));
  });
  handle('state', cursorStates, next => setState(next));
  handle('getConvaiToken',
    z.object({
      browserUrl: z.string().max(500).optional(),
      pageTitle: z.string().max(200).optional(),
      ocrText: z.string().max(2000).optional(),
      candidateCents: z.number().int().nonnegative().optional(),
    }).strict(),
    async value => {
      // Use provided ocrText first; fall back to the latest captured screen text
      const ocrText = value.ocrText || lastScreenText;
      const params = new URLSearchParams();
      if (value.browserUrl) params.set('browserUrl', value.browserUrl);
      if (value.pageTitle) params.set('pageTitle', value.pageTitle);
      if (ocrText) params.set('ocrText', ocrText.slice(0, 2000));
      if (value.candidateCents !== undefined) params.set('candidateCents', String(value.candidateCents));
      const result = await request<{ signedUrl: string }>(`/convai/token?${params.toString()}`);
      return result.signedUrl;
    },
  );
  handle('openScreenPermissions', z.undefined(), () => {
    void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  handle('getScreenText', z.undefined(), () => lastScreenText);
  handle('executeTool',
    z.object({ name: z.string().min(1).max(120), input: z.record(z.unknown()) }).strict(),
    value => request('/tool', { name: value.name, input: value.input }),
  );
}

app.whenReady().then(async () => {
  const details = await startService();
  const displays = screen.getAllDisplays();
  config = { ...details, displays: displays.map((d, i) => ({ id: String(d.id), label: d.label || `Display ${i + 1}` })),
    displayId: String(screen.getPrimaryDisplay().id), monitoring: true, microphoneConsent: false,
    shortcut: process.platform === 'darwin' ? '⌥Space' : 'Alt+Space', shortcutAvailable: false,
    permission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'system-managed' };
  const authSession = await request<{ id: string }>('/auth/login', { email: 'demo@example.com', password: 'demo-password' }, false);
  authSessionId = authSession.id;
  const createdSession = await request<{ sessionId: string }>('/session', { accountId: config.accountId });
  sessionId = createdSession.sessionId;
  const common = { frame: false, transparent: true, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } };
  passive = new BrowserWindow({ ...common, ...selectedDisplay().bounds, focusable: false, skipTaskbar: true, resizable: false, show: false });
  card = new BrowserWindow({ ...common, width: 384, height: 540, minWidth: 280, resizable: false, show: false, skipTaskbar: true });
  passive.setIgnoreMouseEvents(true, { forward: true });
  passive.setAlwaysOnTop(true, 'floating'); card.setAlwaysOnTop(true, 'floating');
  secureWindow(card); secureWindow(passive); registerIPC();
  card.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === card.webContents && permission === 'media' && config.microphoneConsent));
  card.webContents.session.setPermissionCheckHandler((contents, permission) => contents === card.webContents && permission === 'media' && config.microphoneConsent);
  await Promise.all([card.loadFile(path.join(__dirname, 'renderer/index.html')), passive.loadFile(path.join(__dirname, 'renderer/index.html'), { query: { surface: 'passive' } })]);
  // Auto-enable screen reading — always on so ConvAI always has context
  monitor.setEnabled(config.permission !== 'denied');
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYPj/n4ECwESJ5lEDRg0YDAwAQCIf8WOSXPoAAAAASUVORK5CYII=');
  tray = new Tray(icon); tray.setToolTip('Flicky — talk to your cursor');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Talk to Flicky / settings', click: () => showCard(true) }, { label: 'Quit Flicky', click: () => app.quit() }]));
  tray.on('click', () => showCard(true));
  nativeTalkHotkeyCleanup = registerNativeAltSpaceToggle(() => { showCard(true); send({ type: 'voice-toggle' }); });
  if (nativeTalkHotkeyCleanup) config.shortcutAvailable = true;
  else config.shortcutAvailable = globalShortcut.register(shortcut, () => { showCard(true); send({ type: 'voice-toggle' }); });
  globalShortcut.register('Escape', () => { void cancel(); card.hide(); });
  powerMonitor.on('suspend', () => { void cancel(); config.monitoring = false; monitor.setEnabled(false); send({ type: 'config', config }); });
  powerMonitor.on('lock-screen', () => { void cancel(); config.monitoring = false; monitor.setEnabled(false); send({ type: 'config', config }); });
  screen.on('display-removed', () => { void cancel(); config.monitoring = false; monitor.setEnabled(false); config.displayId = String(screen.getPrimaryDisplay().id); config.displays = screen.getAllDisplays().map(d => ({ id: String(d.id), label: d.label || 'Display' })); passive.setBounds(selectedDisplay().bounds); send({ type: 'config', config }); });
  setInterval(() => {
    if (quitting || passive.isDestroyed()) return;
    const point = screen.getCursorScreenPoint(); const display = selectedDisplay();
    if (annotation && (Date.now() >= annotationExpires || point.x < annotation.x - 80 || point.x > annotation.x + annotation.width + 80 || point.y < annotation.y - 80 || point.y > annotation.y + annotation.height + 80)) clearAnnotation();
    passive.webContents.send('flicky:passive', { cursor: { x: point.x - display.bounds.x, y: point.y - display.bounds.y }, state, monitoring: config.monitoring,
      annotation: annotation ? { ...annotation, x: annotation.x - display.bounds.x, y: annotation.y - display.bounds.y } : undefined });
    if (config.monitoring && String(screen.getDisplayNearestPoint(point).id) === config.displayId) monitor.sample({ ...point, displayId: config.displayId, at: Date.now() });
  }, 100).unref();
  passive.showInactive();
}).catch(error => { console.error('Flicky startup failed:', error instanceof Error ? error.message : 'Unknown failure'); app.quit(); });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true; generation++; captureGeneration++; monitor.dispose(); nativeTalkHotkeyCleanup?.(); nativeTalkHotkeyCleanup = undefined; globalShortcut.unregisterAll();
  void disposeRecognizer(); service?.stdin.end(); service?.kill('SIGTERM');
});
