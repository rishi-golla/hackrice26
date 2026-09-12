import React, { useEffect, useRef, useState } from 'react';
import type { FlickyBridge } from '../shared/contracts';
import type { VerificationView } from '../shared/verification';

type Props = { view: VerificationView; bridge: Pick<FlickyBridge, 'verificationStart' | 'verificationStatus' | 'verificationCancel' | 'verificationResume'> };
const messages: Record<VerificationView['state'], string> = {
  locked: 'Verify your identity to view account information.',
  pending: 'Complete verification in your browser. This window will update when the check finishes.',
  approved: 'Verification approved. Continue to get a fresh answer.',
  declined: 'Verification did not pass. Cancel and try your request again when you are ready.',
  expired: 'Verification expired. Ask your question again to start a new check.',
  unavailable: 'Verification is unavailable. Retry, or cancel and try your request again.',
  retry: 'The check is taking longer than expected. Retry to check its status again.',
  canceled: 'Verification canceled. Your account information stays hidden.',
  unlocked: '',
};
export function VerificationPrompt({ view, bridge }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollFailed, setPollFailed] = useState(false);
  const actionBusy = useRef(false);
  const identity = useRef(view.requestId);
  identity.current = view.requestId;

  useEffect(() => { setError(''); setPollFailed(false); }, [view.requestId, view.state]);
  useEffect(() => {
    if (view.state !== 'pending' || !view.requestId || pollFailed) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await bridge.verificationStatus(view.requestId!);
        if (!disposed && status.state === 'pending') timer = setTimeout(poll, Math.max(2000, status.pollAfterMs ?? 2000));
      } catch {
        if (!disposed) { setPollFailed(true); setError('Could not check verification. Retry when your connection is ready.'); }
      }
    };
    timer = setTimeout(poll, Math.max(2000, view.pollAfterMs ?? 2000));
    return () => { disposed = true; clearTimeout(timer); };
  }, [view.requestId, view.state, bridge, pollFailed]);

  async function act(action: 'start' | 'cancel' | 'resume') {
    if (!view.requestId || (actionBusy.current && action !== 'cancel')) return;
    const id = view.requestId;
    actionBusy.current = true; setBusy(true); setError('');
    try {
      if (action === 'start') { await bridge.verificationStart(id); setPollFailed(false); }
      else if (action === 'cancel') await bridge.verificationCancel(id);
      else await bridge.verificationResume(id);
    } catch (e) {
      if (identity.current === id) setError(e instanceof Error ? e.message : 'Verification is unavailable. Try again.');
    } finally { actionBusy.current = false; setBusy(false); }
  }
  if (view.state === 'unlocked') return null;
  const retry = pollFailed || ['retry', 'unavailable'].includes(view.state);
  return <section className="verification" aria-labelledby="verification-title" aria-busy={busy}>
    <h2 id="verification-title">{view.state === 'approved' ? 'Ready to continue' : 'Identity verification'}</h2>
    <p role="status">{messages[view.state]}</p>
    {view.state === 'locked' && view.requestId && <small>Opens Persona in your browser. Sandbox checks unlock synthetic demo data only.</small>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="verification-actions">
      {view.requestId && (view.state === 'locked' || retry) && <button disabled={busy} onClick={() => void act('start')}>{busy ? 'Opening…' : retry ? 'Retry verification' : 'Verify identity'}</button>}
      {view.state === 'approved' && <button disabled={busy} onClick={() => void act('resume')}>{busy ? 'Getting answer…' : 'Continue'}</button>}
      {view.requestId && <button onClick={() => void act('cancel')}>Cancel</button>}
    </div>
  </section>;
}
