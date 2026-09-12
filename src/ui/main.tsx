import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Answer, CandidateView, CursorState, PublicConfig } from '../shared/contracts';
import { VoiceControl } from './VoiceControl';
import { ForecastChart } from './ForecastChart';
import { createBrowserVoiceRuntime, VoiceTurnController } from './voice';
import './styles.css';

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const stateLabel: Record<CursorState, string> = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', clarifying: 'Needs a detail', error: 'Needs attention' };
function App() {
  const passive = new URLSearchParams(location.search).get('surface') === 'passive';
  const [config, setConfig] = useState<PublicConfig>(); const [answer, setAnswer] = useState<Answer>(); const [candidate, setCandidate] = useState<CandidateView>(); const [state, setState] = useState<CursorState>('idle'); const [text, setText] = useState(''); const [error, setError] = useState(''); const [muted, setMuted] = useState(false); const [cursor, setCursor] = useState({ x: 0, y: 0 }); const [annotation, setAnnotation] = useState<{ x: number; y: number; width: number; height: number }>();
  const candidateRef = useRef<CandidateView | undefined>(undefined);
  candidateRef.current = candidate;
  const voice = useMemo(() => new VoiceTurnController(window.flicky, createBrowserVoiceRuntime(), setState, setError), []);
  const startVoice = async () => { setError(''); try { const next = await window.flicky.consent(true); setConfig(next); if (!next.microphoneConsent) throw new Error('Microphone permission is required.'); await voice.start(candidateRef.current?.id); } catch (e) { setError(e instanceof Error ? e.message : 'Microphone access failed.'); } };
  const toggleVoice = async () => { if (voice.isRecording()) { voice.stop(); return; } await startVoice(); };
  useEffect(() => { const passiveOff = window.flicky.onPassive(value => { setCursor(value.cursor); setAnnotation(value.annotation); setState(value.state); }); if (passive) return () => passiveOff(); window.flicky.initial().then(setConfig).catch(e => setError(String(e))); const off = window.flicky.onEvent(event => { if (event.type === 'config') setConfig(event.config); if (event.type === 'answer') setAnswer(event.answer); if (event.type === 'candidate') { candidateRef.current = event.candidate; setCandidate(event.candidate); } if (event.type === 'state') setState(event.state); if (event.type === 'error') setError(event.message); if (event.type === 'voice-start') void startVoice(); if (event.type === 'voice-stop') voice.stop(); if (event.type === 'voice-toggle') void toggleVoice(); if (event.type === 'cancel') voice.handleHostCancel(); }); return () => { off(); passiveOff(); voice.cancelLocal(); }; }, [passive, voice]);
  if (passive) return <div className="passive"><div className={`halo ${state}`} style={{ left: cursor.x + 18, top: cursor.y + 18 }} aria-hidden="true" />{state === 'listening' && <div className="talk-dots" style={{ left: cursor.x + 18, top: cursor.y + 34 }} aria-label="Listening"><span className="talk-dot" /><span className="talk-dot" /><span className="talk-dot" /></div>}{annotation && <div className="annotation" style={annotation}><span>Check this total</span></div>}</div>;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!text.trim()) return; setError(''); try { await window.flicky.turn(text, candidate?.id); setText(''); } catch (e) { setError(e instanceof Error ? e.message : 'Turn failed'); } };
  const toggleMute = () => { const next = !muted; setMuted(next); voice.setMuted(next); };
  const forecast = answer?.forecast;
  return <main className="card" aria-label="Flicky cursor companion">
    <header><div className={`status-dot ${state}`} aria-hidden="true" /><div><strong>Flicky</strong><span className="status">{stateLabel[state]}</span></div><button className="icon" aria-label="Hide Flicky" onClick={() => window.flicky.hide()}>×</button></header>
    <section className="mode"><span>{config?.mode === 'synthetic' ? 'Synthetic demo' : config?.mode}</span><span>{config?.permission === 'denied' ? 'Screen permission needed' : config?.monitoring ? 'Monitoring on' : 'Monitoring off'}</span></section>
    {candidate && <section className="candidate"><span className="eyebrow">Screen read</span><strong>{candidate.amountCents === null ? 'Amount needs confirmation' : money(candidate.amountCents)}</strong><small>{candidate.sourceText || candidate.reason}</small>{candidate.amountCents !== null && <button onClick={() => setText(`Can I afford $${(candidate.amountCents! / 100).toFixed(2)} today?`)}>Ask about this</button>}</section>}
    {forecast && <Forecast answer={answer!} />}
    {error && <p className="error" role="alert">{error}</p>}
    <form onSubmit={submit}><label htmlFor="ask">Talk to your cursor</label><div className="composer"><input id="ask" value={text} onChange={e => setText(e.target.value)} placeholder="Can I afford this?" autoComplete="off" /><button type="submit" aria-label="Send question">↵</button></div><div className="voice-row"><VoiceControl state={state} muted={muted} disabled={!config?.capabilities.transcription || !config?.capabilities.speech} onStart={() => void startVoice()} onStop={() => voice.stop()} onToggleMute={toggleMute} /><small>Hold {config?.shortcut || 'Ctrl+Shift+Space'} for voice.</small></div><small>Typed input always works.</small></form>
    <footer><button onClick={() => window.flicky.monitor(!config?.monitoring)}>{config?.monitoring ? 'Pause screen reading' : 'Arm screen reading'}</button><button onClick={() => window.flicky.capture()}>Read screen now</button><button onClick={() => window.flicky.forget()}>Forget</button></footer>
  </main>;
}
function Forecast({ answer }: { answer: Answer }) {
  const forecast = answer.forecast!;
  return <section className={`forecast ${forecast.status}`}>
    <div className="forecast-head"><span className="eyebrow">14-day projection</span><strong>{forecast.status === 'negative' ? 'Purchase risks overdraft' : forecast.status === 'below-reserve' ? 'Below reserve' : 'Within reserve'}</strong></div>
    <div className="numbers"><span>Lowest <b>{money(forecast.minimumCents)}</b><small>{forecast.minimumDate}</small></span><span>Safe to spend <b>{money(forecast.safeToSpendCents)}</b><small>reserve {money(forecast.reserveCents)}</small></span></div>
    <ForecastChart baseline={forecast.baseline} afterPurchase={forecast.afterPurchase} reserveCents={forecast.reserveCents} />
    <p>{answer.text}</p><small className="fresh">{forecast.stale ? 'Stale snapshot' : 'Fresh snapshot'} · {forecast.complete ? 'Complete inputs' : 'Incomplete inputs'}</small>
  </section>;
}
createRoot(document.getElementById('root')!).render(<App />);
