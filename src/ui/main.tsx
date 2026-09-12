import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Answer, CandidateView, CursorState, FinancialInsightsView, PublicConfig } from '../shared/contracts';
import { VoiceControl } from './VoiceControl';
import { ForecastChart } from './ForecastChart';
import { createBrowserVoiceRuntime, ConvAIVoiceController, VoiceTurnController } from './voice';
import './styles.css';

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const stateLabel: Record<CursorState, string> = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', clarifying: 'Needs a detail', error: 'Needs attention' };
function App() {
  const passive = new URLSearchParams(location.search).get('surface') === 'passive';
  const [config, setConfig] = useState<PublicConfig>();
  const [answer, setAnswer] = useState<Answer>();
  const [convaiInsights, setConvaiInsights] = useState<FinancialInsightsView>();
  const [candidate, setCandidate] = useState<CandidateView>();
  const [state, setState] = useState<CursorState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [annotation, setAnnotation] = useState<{ x: number; y: number; width: number; height: number }>();
  const candidateRef = useRef<CandidateView | undefined>(undefined);
  const configRef = useRef<PublicConfig | undefined>(undefined);
  candidateRef.current = candidate;
  configRef.current = config;

  // Legacy STT+TTS controller (used when ConvAI is not available)
  const voice = useMemo(() => new VoiceTurnController(window.flicky, createBrowserVoiceRuntime(), setState, setError), []);

  // ElevenLabs Conversational AI controller (used when convai capability is enabled)
  const convai = useMemo(() => new ConvAIVoiceController(
    window.flicky,
    '', // accountId filled in at start time from config
    10_000,
    {
      onState: setState,
      onError: setError,
      onInsights: setConvaiInsights,
    },
  ), []);

  // Build a fresh ConvAI context from current screen state
  const buildConvaiContext = () => ({
    ocrText: candidateRef.current?.sourceText || undefined,
    candidateCents: candidateRef.current?.amountCents ?? undefined,
  });

  // Whether to use ConvAI or the legacy voice pipeline
  const useConvAI = () => Boolean(configRef.current?.capabilities?.convai);

  const startVoice = async () => {
    setError('');
    try {
      const next = await window.flicky.consent(true);
      setConfig(next);
      if (!next.microphoneConsent) throw new Error('Microphone permission is required.');
      if (next.capabilities?.convai) {
        // Use ElevenLabs Conversational AI — full duplex, agent handles turn-taking
        const ctrl = new ConvAIVoiceController(
          window.flicky,
          next.accountId,
          10_000,
          { onState: setState, onError: setError, onInsights: setConvaiInsights },
        );
        // Store reference for toggling
        (window as any).__convai = ctrl;
        await ctrl.start(buildConvaiContext());
      } else {
        await voice.start(candidateRef.current?.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access failed.');
    }
  };

  const stopVoice = () => {
    const ctrl = (window as any).__convai as ConvAIVoiceController | undefined;
    if (ctrl?.isActive()) { void ctrl.stop(); (window as any).__convai = undefined; return; }
    voice.stop();
  };

  const toggleVoice = async () => {
    const ctrl = (window as any).__convai as ConvAIVoiceController | undefined;
    if (ctrl?.isActive()) { stopVoice(); return; }
    if (voice.isRecording()) { voice.stop(); return; }
    await startVoice();
  };
  useEffect(() => {
    const passiveOff = window.flicky.onPassive(value => { setCursor(value.cursor); setAnnotation(value.annotation); setState(value.state); });
    if (passive) return () => passiveOff();
    window.flicky.initial().then(setConfig).catch(e => setError(String(e)));
    const off = window.flicky.onEvent(event => {
      if (event.type === 'config') setConfig(event.config);
      if (event.type === 'answer') {
        setAnswer(event.answer);
        if (event.answer.insights) setConvaiInsights(event.answer.insights);
      }
      if (event.type === 'candidate') { candidateRef.current = event.candidate; setCandidate(event.candidate); }
      if (event.type === 'state') setState(event.state);
      if (event.type === 'error') setError(event.message);
      if (event.type === 'voice-start') void startVoice();
      if (event.type === 'voice-stop') stopVoice();
      if (event.type === 'voice-toggle') void toggleVoice();
      if (event.type === 'cancel') voice.handleHostCancel();
    });
    return () => { off(); passiveOff(); voice.cancelLocal(); };
  }, [passive, voice]);
  if (passive) return <div className="passive"><div className={`halo ${state}`} style={{ left: cursor.x + 18, top: cursor.y + 18 }} aria-hidden="true" />{state === 'listening' && <div className="talk-dots" style={{ left: cursor.x + 18, top: cursor.y + 34 }} aria-label="Listening"><span className="talk-dot" /><span className="talk-dot" /><span className="talk-dot" /></div>}{annotation && <div className="annotation" style={annotation}><span>Check this total</span></div>}</div>;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!text.trim()) return; setError(''); try { await window.flicky.turn(text, candidate?.id); setText(''); } catch (e) { setError(e instanceof Error ? e.message : 'Turn failed'); } };
  const toggleMute = () => { const next = !muted; setMuted(next); voice.setMuted(next); };
  const forecast = answer?.forecast;
  // Insights: prefer ConvAI live-updated, fall back to last /turn answer
  const insights = convaiInsights ?? answer?.insights;
  const isConvAIActive = Boolean(config?.capabilities?.convai);
  const convAIConnected = isConvAIActive && (state === 'listening' || state === 'speaking' || state === 'thinking');

  return <main className="card" aria-label="Flicky cursor companion">
    <header>
      <div className={`status-dot ${state}`} aria-hidden="true" />
      <div>
        <strong>Flicky</strong>
        <span className="status">
          {stateLabel[state]}
          {isConvAIActive && <span className="convai-badge"> · AI Advisor</span>}
        </span>
      </div>
      <button className="icon" aria-label="Hide Flicky" onClick={() => window.flicky.hide()}>×</button>
    </header>
    <section className="mode">
      <span>{config?.mode === 'synthetic' ? 'Synthetic demo' : config?.mode}</span>
      <span>{config?.permission === 'denied' ? 'Screen permission needed' : config?.monitoring ? 'Monitoring on' : 'Monitoring off'}</span>
    </section>
    {candidate && <section className="candidate">
      <span className="eyebrow">Screen read</span>
      <strong>{candidate.amountCents === null ? 'Amount needs confirmation' : money(candidate.amountCents)}</strong>
      <small>{candidate.sourceText || candidate.reason}</small>
      {candidate.amountCents !== null && (
        isConvAIActive
          ? <button onClick={() => void startVoice()}>Ask Flicky about this</button>
          : <button onClick={() => setText(`Can I afford $${(candidate.amountCents! / 100).toFixed(2)} today?`)}>Ask about this</button>
      )}
    </section>}
    {forecast && <Forecast answer={answer!} />}
    {insights && <Insights insights={insights} />}
    {isConvAIActive && !convAIConnected && !insights && (
      <div className="convai-prompt">
        <p>Hold <strong>{config?.shortcut || 'Ctrl+Space'}</strong> to talk to your financial advisor</p>
        <small>I can see your screen and banking data — just ask anything</small>
      </div>
    )}
    {error && <p className="error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      <label htmlFor="ask">Talk to your cursor</label>
      <div className="composer">
        <input id="ask" value={text} onChange={e => setText(e.target.value)} placeholder={isConvAIActive ? 'Or type your question…' : 'Can I afford this?'} autoComplete="off" />
        <button type="submit" aria-label="Send question">↵</button>
      </div>
      <div className="voice-row">
        <VoiceControl
          state={state}
          muted={muted}
          disabled={isConvAIActive ? false : (!config?.capabilities.transcription || !config?.capabilities.speech)}
          onStart={() => void startVoice()}
          onStop={stopVoice}
          onToggleMute={toggleMute}
        />
        <small>{isConvAIActive ? 'AI advisor mode — full conversation' : `Hold ${config?.shortcut || 'Ctrl+Shift+Space'} for voice.`}</small>
      </div>
      <small>Typed input always works.</small>
    </form>
    <footer>
      <button onClick={() => window.flicky.monitor(!config?.monitoring)}>{config?.monitoring ? 'Pause screen reading' : 'Arm screen reading'}</button>
      <button onClick={() => window.flicky.capture()}>Read screen now</button>
      <button onClick={() => window.flicky.forget()}>Forget</button>
    </footer>
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
function Insights({ insights }: { insights: FinancialInsightsView }) {
  const [billsOpen, setBillsOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const safeClass = insights.safeToSpendCents <= 0 ? 'danger' : insights.safeToSpendCents < 5000 ? 'warn' : 'ok';
  const alertHighlights = insights.highlights.filter(h => /negative|stale|incomplete|overdraft/i.test(h));
  const infoHighlights = insights.highlights.filter(h => !/negative|stale|incomplete|overdraft/i.test(h));
  return (
    <section className="insights" aria-label="Financial snapshot">
      <div className="insights-header">
        <span className="eyebrow">Live financial snapshot</span>
        {(insights.coverage.stale || !insights.coverage.complete) && (
          <span className="insights-badge warn">{insights.coverage.stale ? 'Stale' : 'Partial data'}</span>
        )}
        {insights.account.last4 && <span className="insights-badge mode">····{insights.account.last4}</span>}
      </div>

      <div className="insights-metrics">
        <div className="insights-metric">
          <span className="insights-label">Balance</span>
          <strong className="insights-value">{money(insights.balanceCents)}</strong>
        </div>
        <div className={`insights-metric insights-metric--${safeClass}`}>
          <span className="insights-label">Safe to spend</span>
          <strong className={`insights-value insights-safe--${safeClass}`}>{money(insights.safeToSpendCents)}</strong>
        </div>
        {insights.rewardsPoints !== null && (
          <div className="insights-metric">
            <span className="insights-label">Rewards</span>
            <strong className="insights-value insights-rewards">{insights.rewardsPoints.toLocaleString()} pts</strong>
          </div>
        )}
      </div>

      {alertHighlights.length > 0 && (
        <ul className="insights-alerts" role="alert">
          {alertHighlights.map((h, i) => <li key={i} className="insights-alert">⚠ {h}</li>)}
        </ul>
      )}

      {infoHighlights.length > 0 && (
        <ul className="insights-info-list">
          {infoHighlights.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      )}

      {(insights.recurringOutflowCents > 0 || insights.loanObligationsCents > 0) && (
        <div className="insights-row">
          {insights.recurringOutflowCents > 0 && (
            <span className="insights-chip">↓ {money(insights.recurringOutflowCents)} recurring/14d</span>
          )}
          {insights.loanObligationsCents > 0 && (
            <span className="insights-chip insights-chip--loan">⬌ {money(insights.loanObligationsCents)} loans/14d</span>
          )}
        </div>
      )}

      {insights.upcomingBills.length > 0 && (
        <div className="insights-expandable">
          <button className="insights-toggle" type="button" onClick={() => setBillsOpen(v => !v)} aria-expanded={billsOpen}>
            <span>Upcoming bills <strong className="insights-count">{insights.upcomingBills.length}</strong></span>
            <span aria-hidden="true">{billsOpen ? '−' : '+'}</span>
          </button>
          {billsOpen && (
            <ul className="insights-item-list">
              {insights.upcomingBills.slice(0, 6).map(b => (
                <li key={b.id} className="insights-item">
                  <span className="insights-item-label">{b.label}{b.recurring && <span className="insights-recur">↻</span>}</span>
                  <span className="insights-item-right">
                    <strong>{money(b.cents)}</strong>
                    <small>{b.date}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {insights.expectedIncome.length > 0 && (
        <div className="insights-expandable">
          <button className="insights-toggle" type="button" onClick={() => setIncomeOpen(v => !v)} aria-expanded={incomeOpen}>
            <span>Expected income <strong className="insights-count insights-count--income">{insights.expectedIncome.length}</strong></span>
            <span aria-hidden="true">{incomeOpen ? '−' : '+'}</span>
          </button>
          {incomeOpen && (
            <ul className="insights-item-list">
              {insights.expectedIncome.slice(0, 4).map(inc => (
                <li key={inc.id} className="insights-item">
                  <span className="insights-item-label">{inc.label}</span>
                  <span className="insights-item-right insights-item-right--income">
                    <strong>+{money(inc.cents)}</strong>
                    <small>{inc.date}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="insights-activity">
        <span>↑ {money(insights.recentDepositsCents)} in</span>
        <span>↓ {money(insights.recentWithdrawalsCents)} out</span>
        <span className="insights-period">30 days</span>
      </div>
    </section>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
