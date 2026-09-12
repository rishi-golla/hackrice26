import type { FinancialInsights } from '../../domain/insights';

export type BrowserContextInput = {
  pageTitle?: string;
  browserUrl?: string;
  ocrText?: string;
  candidateCents?: number;
};

/** Format a human-readable financial summary for injection into the system prompt. */
export function formatFinancialSummary(insights: FinancialInsights): string {
  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  const lines: string[] = [];

  // Account identity
  const account = insights.account;
  const accountDesc = [
    account.type,
    account.nickname,
    account.last4 ? `····${account.last4}` : null,
  ].filter(Boolean).join(' ');
  if (accountDesc) lines.push(`Account: ${accountDesc}`);

  // Core numbers
  lines.push(`Balance: ${money(insights.balanceCents)}`);
  lines.push(`Safe to spend (after reserve): ${money(insights.safeToSpendCents)}`);

  // Data quality
  const mode =
    insights.coverage.mode === 'live-sandbox'
      ? 'Live bank data'
      : insights.coverage.mode === 'recorded-sandbox'
      ? 'Recorded sandbox'
      : 'Synthetic demo';
  const freshness = insights.coverage.stale ? ' — DATA IS STALE' : '';
  const completeness = !insights.coverage.complete ? ' — PARTIAL DATA' : '';
  lines.push(`Data mode: ${mode}${freshness}${completeness}`);

  // Upcoming bills
  if (insights.upcomingBills.length > 0) {
    lines.push('');
    lines.push('Upcoming bills (next 14 days):');
    for (const bill of insights.upcomingBills.slice(0, 6)) {
      const recurring = bill.recurring ? ' (recurring)' : '';
      lines.push(`  • ${bill.label}: ${money(bill.cents)} on ${bill.date}${recurring}`);
    }
  } else {
    lines.push('Upcoming bills (next 14 days): none');
  }

  // Expected income
  if (insights.expectedIncome.length > 0) {
    lines.push('');
    lines.push('Expected income:');
    for (const inc of insights.expectedIncome.slice(0, 4)) {
      lines.push(`  • ${inc.label}: ${money(inc.cents)} on ${inc.date}`);
    }
  }

  // Obligations
  if (insights.recurringOutflowCents > 0) {
    lines.push(`Recurring outflow next 14 days: ${money(insights.recurringOutflowCents)}`);
  }
  if (insights.loanObligationsCents > 0) {
    lines.push(`Loan obligations next 14 days: ${money(insights.loanObligationsCents)}`);
  }

  // Recent activity
  lines.push('');
  lines.push(
    `Last 30 days: ${money(insights.recentDepositsCents)} in ↑ | ${money(insights.recentWithdrawalsCents)} out ↓`,
  );

  // Rewards
  if (insights.rewardsPoints !== null) {
    lines.push(`Rewards: ${insights.rewardsPoints.toLocaleString()} points`);
  }

  // Highlights (only the first 3 key ones)
  if (insights.highlights.length > 0) {
    lines.push('');
    lines.push('Key alerts:');
    for (const h of insights.highlights.slice(0, 3)) {
      lines.push(`  ! ${h}`);
    }
  }

  return lines.join('\n');
}

/** Format the browser / screen context for injection into the system prompt. */
export function formatBrowserContext(input: BrowserContextInput): string {
  if (!input.browserUrl && !input.pageTitle && !input.ocrText && !input.candidateCents) {
    return 'No browser context available. User has not navigated to a specific page.';
  }

  const lines: string[] = [];

  if (input.browserUrl) {
    try {
      const url = new URL(input.browserUrl);
      lines.push(`Site: ${url.hostname}`);
      lines.push(`URL: ${input.browserUrl.slice(0, 200)}`);
    } catch {
      lines.push(`URL: ${input.browserUrl.slice(0, 200)}`);
    }
  }
  if (input.pageTitle) lines.push(`Page title: ${input.pageTitle}`);
  if (input.candidateCents !== undefined && input.candidateCents > 0) {
    const dollars = (input.candidateCents / 100).toFixed(2);
    lines.push(`Detected price on screen: $${dollars} — user may be considering this purchase`);
  }
  if (input.ocrText) {
    const truncated = input.ocrText.slice(0, 800);
    lines.push('');
    lines.push('Text visible on screen (from OCR):');
    lines.push(truncated);
    if (input.ocrText.length > 800) lines.push('… (truncated)');
  }

  return lines.join('\n');
}

export type ConvaiSignedUrlOptions = {
  apiKey: string;
  agentId: string;
  financialSummary: string;
  browserContext: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Get a short-lived signed WebSocket URL from ElevenLabs for a Conversational AI session.
 * The financial summary and browser context are injected as dynamic variables so the
 * agent receives full context without the renderer ever seeing the API key.
 */
export async function getConvaiSignedUrl(options: ConvaiSignedUrlOptions): Promise<string> {
  const { apiKey, agentId, financialSummary, browserContext, fetchImpl = fetch, timeoutMs = 10_000 } = options;

  if (!apiKey) throw new Error('ElevenLabs API key not configured');
  if (!agentId) throw new Error('ElevenLabs agent ID not configured. Run: node scripts/setup-elevenlabs-agent.mjs');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
        signal: controller.signal,
      },
    );

    if (response.status === 403 || response.status === 401) {
      throw new Error('ElevenLabs ConvAI: API key lacks convai permission. Check key scopes in the ElevenLabs dashboard.');
    }
    if (!response.ok) {
      throw new Error(`ElevenLabs ConvAI signed URL request failed: HTTP ${response.status}`);
    }

    const body = await response.json() as { signed_url?: string };
    if (typeof body.signed_url !== 'string' || !body.signed_url) {
      throw new Error('ElevenLabs ConvAI returned no signed URL');
    }

    return body.signed_url;
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error('ElevenLabs ConvAI signed URL request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
