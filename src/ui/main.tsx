import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Answer, CandidateView, CursorState, FinancialInsightsView, PublicConfig } from '../shared/contracts';
import { VoiceControl } from './VoiceControl';
import { ForecastChart } from './ForecastChart';
import { createBrowserVoiceRuntime, ConvAIVoiceController, VoiceTurnController } from './voice';
import './styles.css';

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const stateLabel: Record<CursorState, string> = {
  idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…',
  speaking: 'Speaking…', clarifying: 'Needs a detail', error: 'Error',
};

// ── Login Modal ───────────────────────────────────────────────────────────────
type LoginModalProps = {
  onLogin: (email: string) => Promise<void>;
  onDismiss: () => void;
};
function LoginModal({ onLogin, onDismiss }: LoginModalProps) {
  const [email, setEmail] = useState('demo@flicky.ai');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    // Simulate network auth (actual auth is hardcoded in the backend)
    await new Promise(r => setTimeout(r, 1400));
    setDone(true);
    await new Promise(r => setTimeout(r, 700));
    await onLogin(email);
  };

  if (done) {
    return (
      <div className="login-modal">
        <div className="login-success">
          <span className="login-check">✓</span>
          <span>Connected to Capital One</span>
        </div>
      </div>
    );
  }

  return (
    <div className="login-modal">
      <div className="login-header">
        <span className="login-bank-icon">🏦</span>
        <div>
          <strong>Connect your bank</strong>
          <small>Capital One · Secured by Nessie API</small>
        </div>
        <button className="login-dismiss" onClick={onDismiss}>×</button>
      </div>
      <form onSubmit={handleSubmit} className="login-form">
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Any password for demo"
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="login-submit" disabled={loading}>
          {loading ? <span className="login-spinner" /> : 'Connect →'}
        </button>
        <small className="login-footer">
          256-bit encrypted · Read-only access · Demo account
        </small>
      </form>
    </div>
  );
}

// ── Proof Panel ───────────────────────────────────────────────────────────────
function ProofPanel({ insights, accountEmail }: { insights: FinancialInsightsView; accountEmail: string | null }) {
  const [billsOpen, setBillsOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const safeClass = insights.safeToSpendCents <= 0 ? 'danger' : insights.safeToSpendCents < 5000 ? 'warn' : 'ok';

  return (
    <section className="proof-panel">
      {/* Account header row */}
      <div className="proof-account">
        <span className="proof-bank-icon">💳</span>
        <div className="proof-account-info">
          <strong>Capital One{insights.account.last4 ? ` ····${insights.account.last4}` : ''}</strong>
          {accountEmail && <small>{accountEmail}</small>}
        </div>
        {(insights.coverage.stale || !insights.coverage.complete) && (
          <span className="proof-badge warn">{insights.coverage.stale ? 'Stale' : 'Partial'}</span>
        )}
        <span className="proof-badge mode">{insights.coverage.mode}</span>
      </div>

      {/* Key numbers */}
      <div className="proof-metrics">
        <div className="proof-metric">
          <span className="proof-label">Balance</span>
          <strong className="proof-value">{money(insights.balanceCents)}</strong>
        </div>
        <div className={`proof-metric proof-metric--${safeClass}`}>
          <span className="proof-label">Safe to spend</span>
          <strong className={`proof-value proof-safe--${safeClass}`}>{money(insights.safeToSpendCents)}</strong>
        </div>
        {insights.rewardsPoints !== null && (
          <div className="proof-metric">
            <span className="proof-label">Rewards</span>
            <strong className="proof-value proof-rewards">{insights.rewardsPoints.toLocaleString()} pts</strong>
          </div>
        )}
      </div>

      {/* Alert highlights */}
      {insights.highlights.filter(h => /negative|stale|incomplete|overdraft/i.test(h)).map((h, i) => (
        <div key={i} className="proof-alert">⚠ {h}</div>
      ))}

      {/* Info highlights */}
      {insights.highlights.filter(h => !/negative|stale|incomplete|overdraft/i.test(h)).slice(0, 2).map((h, i) => (
        <div key={i} className="proof-info">{h}</div>
      ))}

      {/* Obligations row */}
      {(insights.recurringOutflowCents > 0 || insights.loanObligationsCents > 0) && (
        <div className="proof-chips">
          {insights.recurringOutflowCents > 0 && (
            <span className="proof-chip">↓ {money(insights.recurringOutflowCents)} recurring/14d</span>
          )}
          {insights.loanObligationsCents > 0 && (
            <span className="proof-chip proof-chip--loan">⬌ {money(insights.loanObligationsCents)} loans/14d</span>
          )}
        </div>
      )}

      {/* Expandable bills */}
      {insights.upcomingBills.length > 0 && (
        <div className="proof-expandable">
          <button className="proof-toggle" type="button" onClick={() => setBillsOpen(v => !v)}>
            <span>Upcoming bills <strong className="proof-count">{insights.upcomingBills.length}</strong></span>
            <span>{billsOpen ? '−' : '+'}</span>
          </button>
          {billsOpen && (
            <ul className="proof-list">
              {insights.upcomingBills.slice(0, 5).map(b => (
                <li key={b.id} className="proof-list-item">
                  <span className="proof-item-label">{b.label}{b.recurring && <span className="proof-recur">↻</span>}</span>
                  <span className="proof-item-right">
                    <strong>{money(b.cents)}</strong>
                    <small>{b.date}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Expandable income */}
      {insights.expectedIncome.length > 0 && (
        <div className="proof-expandable">
          <button className="proof-toggle" type="button" onClick={() => setIncomeOpen(v => !v)}>
            <span>Expected income <strong className="proof-count proof-count--income">{insights.expectedIncome.length}</strong></span>
            <span>{incomeOpen ? '−' : '+'}</span>
          </button>
          {incomeOpen && (
            <ul className="proof-list">
              {insights.expectedIncome.slice(0, 4).map(inc => (
                <li key={inc.id} className="proof-list-item">
                  <span className="proof-item-label">{inc.label}</span>
                  <span className="proof-item-right proof-item-right--income">
                    <strong>+{money(inc.cents)}</strong>
                    <small>{inc.date}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 30-day flow */}
      <div className="proof-activity">
        <span>↑ {money(insights.recentDepositsCents)} in</span>
        <span>↓ {money(insights.recentWithdrawalsCents)} out</span>
        <span className="proof-period">30 days</span>
      </div>
    </section>
  );
}

// ── Forecast section ──────────────────────────────────────────────────────────
function Forecast({ answer }: { answer: Answer }) {
  const forecast = answer.forecast!;
  return <section className={`forecast ${forecast.status}`}>
    <div className="forecast-head">
      <span className="eyebrow">14-day projection</span>
      <strong>{forecast.status === 'negative' ? 'Overdraft risk' : forecast.status === 'below-reserve' ? 'Below reserve' : 'Within reserve'}</strong>
    </div>
    <div className="numbers">
      <span>Lowest <b>{money(forecast.minimumCents)}</b><small>{forecast.minimumDate}</small></span>
      <span>Safe to spend <b>{money(forecast.safeToSpendCents)}</b><small>reserve {money(forecast.reserveCents)}</small></span>
    </div>
    <ForecastChart baseline={forecast.baseline} afterPurchase={forecast.afterPurchase} reserveCents={forecast.reserveCents} />
    <p>{answer.text}</p>
    <small className="fresh">{forecast.stale ? 'Stale' : 'Fresh'} · {forecast.complete ? 'Complete' : 'Incomplete'}</small>
  </section>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
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
  const [loggedIn, setLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  const candidateRef = useRef<CandidateView | undefined>(undefined);
  const configRef = useRef<PublicConfig | undefined>(undefined);
  const convaiRef = useRef<ConvAIVoiceController | null>(null);
  candidateRef.current = candidate;
  configRef.current = config;

  const voice = useMemo(() => new VoiceTurnController(window.flicky, createBrowserVoiceRuntime(), setState, setError), []);

  const buildConvaiContext = () => ({
    ocrText: candidateRef.current?.sourceText || undefined,
    candidateCents: candidateRef.current?.amountCents ?? undefined,
  });

  const useConvAI = () => Boolean(configRef.current?.capabilities?.convai);

  const startVoice = async () => {
    setError('');
    try {
      const next = await window.flicky.consent(true);
      setConfig(next);
      if (!next.microphoneConsent) throw new Error('Microphone permission is required.');
      if (next.capabilities?.convai) {
        const ctrl = new ConvAIVoiceController(
          window.flicky,
          next.accountId,
          10_000,
          { onState: setState, onError: setError, onInsights: setConvaiInsights },
        );
        convaiRef.current = ctrl;
        await ctrl.start(buildConvaiContext());
      } else {
        await voice.start(candidateRef.current?.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access failed.');
    }
  };

  const stopVoice = () => {
    const ctrl = convaiRef.current;
    if (ctrl?.isActive()) { void ctrl.stop(); convaiRef.current = null; return; }
    voice.stop();
  };

  const toggleVoice = async () => {
    const ctrl = convaiRef.current;
    if (ctrl?.isActive()) { stopVoice(); return; }
    if (voice.isRecording()) { voice.stop(); return; }
    // Require login before starting ConvAI
    if (useConvAI() && !loggedIn) { setShowLogin(true); return; }
    await startVoice();
  };

  const handleLogin = async (email: string) => {
    setAccountEmail(email);
    setLoggedIn(true);
    setShowLogin(false);
    await startVoice();
  };

  const handleStartAdvisor = () => {
    if (!loggedIn && useConvAI()) {
      setShowLogin(true);
    } else {
      void toggleVoice();
    }
  };

  useEffect(() => {
    const passiveOff = window.flicky.onPassive(value => {
      setCursor(value.cursor); setAnnotation(value.annotation); setState(value.state);
    });
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

  if (passive) {
    return (
      <div className="passive">
        <div className={`halo ${state}`} style={{ left: cursor.x + 18, top: cursor.y + 18 }} aria-hidden="true" />
        {state === 'listening' && (
          <div className="talk-dots" style={{ left: cursor.x + 18, top: cursor.y + 34 }} aria-label="Listening">
            <span className="talk-dot" /><span className="talk-dot" /><span className="talk-dot" />
          </div>
        )}
        {annotation && (
          <div className="annotation" style={annotation}><span>Check this total</span></div>
        )}
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setError('');
    try { await window.flicky.turn(text, candidate?.id); setText(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Turn failed'); }
  };
  const toggleMute = () => { const next = !muted; setMuted(next); voice.setMuted(next); };
  const forecast = answer?.forecast;
  const insights = convaiInsights ?? answer?.insights;
  const isConvAIActive = Boolean(config?.capabilities?.convai);
  const convAIRunning = convaiRef.current?.isActive() || (state === 'listening' || state === 'speaking' || state === 'thinking');
  const permissionDenied = config?.permission === 'denied';

  return (
    <main className="card" aria-label="Flicky financial advisor">
      {/* Header */}
      <header>
        <div className={`status-dot ${state}`} aria-hidden="true" />
        <div className="header-info">
          <strong>Flicky</strong>
          <span className="status">
            {stateLabel[state]}
            {isConvAIActive && <span className="convai-badge"> · AI Advisor</span>}
          </span>
        </div>
        <div className="header-right">
          {loggedIn && insights?.account.last4 && (
            <span className="account-pill">💳 ·{insights.account.last4}</span>
          )}
          <button className="icon" aria-label="Hide Flicky" onClick={() => window.flicky.hide()}>×</button>
        </div>
      </header>

      {/* Screen reading pill */}
      <div className={`screen-pill ${permissionDenied ? 'screen-pill--denied' : candidate ? 'screen-pill--active' : 'screen-pill--scanning'}`}>
        {permissionDenied ? (
          <>
            <span>Screen access needed</span>
            <button className="screen-pill-btn" onClick={() => void window.flicky.openScreenPermissions()}>
              Grant →
            </button>
          </>
        ) : candidate?.amountCents !== null && candidate?.amountCents !== undefined ? (
          <>
            <span className="screen-dot-indicator" />
            <span>Detected <strong>{money(candidate.amountCents)}</strong> on screen</span>
            {isConvAIActive && (
              <button className="screen-pill-btn" onClick={() => void startVoice()}>Ask →</button>
            )}
          </>
        ) : (
          <>
            <span className="screen-dot-indicator scanning" />
            <span>{candidate?.sourceText ? candidate.sourceText.slice(0, 40) + '…' : 'Reading screen…'}</span>
          </>
        )}
      </div>

      {/* Login modal */}
      {showLogin && <LoginModal onLogin={handleLogin} onDismiss={() => setShowLogin(false)} />}

      {/* Forecast */}
      {forecast && !showLogin && <Forecast answer={answer!} />}

      {/* Financial proof panel */}
      {insights && !showLogin && (
        <ProofPanel insights={insights} accountEmail={loggedIn ? accountEmail : null} />
      )}

      {/* ConvAI prompt when idle and logged in */}
      {isConvAIActive && !convAIRunning && !insights && !showLogin && loggedIn && (
        <div className="convai-prompt">
          <p>Press <strong>{config?.shortcut || '⌥Space'}</strong> or tap the button to talk</p>
          <small>I can see your screen and banking data</small>
        </div>
      )}

      {/* Error */}
      {error && <p className="error" role="alert">{error}</p>}

      {/* Input area */}
      {!showLogin && (
        <div className="input-area">
          {isConvAIActive ? (
            <div className="convai-row">
              <VoiceControl
                state={state}
                muted={muted}
                disabled={false}
                onStart={handleStartAdvisor}
                onStop={stopVoice}
                onToggleMute={toggleMute}
                useToggle={true}
              />
              <form onSubmit={submit} className="inline-form">
                <input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Or type a question…"
                  autoComplete="off"
                />
                <button type="submit" aria-label="Send">↵</button>
              </form>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="composer">
                <input
                  id="ask"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Can I afford this?"
                  autoComplete="off"
                />
                <button type="submit" aria-label="Send">↵</button>
              </div>
              <div className="voice-row">
                <VoiceControl
                  state={state}
                  muted={muted}
                  disabled={!config?.capabilities.transcription || !config?.capabilities.speech}
                  onStart={() => void startVoice()}
                  onStop={stopVoice}
                  onToggleMute={toggleMute}
                />
                <small>Hold {config?.shortcut || 'Ctrl+Shift+Space'} for voice</small>
              </div>
            </form>
          )}
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
