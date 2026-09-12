/**
 * One-time setup: creates the Flicky Financial Advisor ElevenLabs Conversational AI agent
 * and writes ELEVENLABS_AGENT_ID to .env.
 *
 * Run: node scripts/setup-elevenlabs-agent.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Load .env manually (dotenv may not be importable as ESM from scripts)
const envFile = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => { const [k, ...v] = line.split('='); return [k.trim(), v.join('=').trim()]; })
);

const apiKey = env.ELEVENLABS_API_KEY;
const voiceId = env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

if (!apiKey) {
  console.error('✗ ELEVENLABS_API_KEY not set in .env');
  process.exit(1);
}

// ── Master system prompt ──────────────────────────────────────────────────────
// Uses {{financial_summary}} and {{browser_context}} as dynamic variables
// that are injected per-session via the signed URL override.
const SYSTEM_PROMPT = `You are Flicky, a real-time personal financial advisor embedded directly in the user's cursor on their desktop. You have live access to their bank account data and can see what they are currently browsing on screen.

## Live Financial Context
{{financial_summary}}

## Current Screen / Browser Context
{{browser_context}}

## Your Identity & Style
You are the user's trusted financial advisor — warm, specific, and direct. You speak like a brilliant friend who happens to know everything about their money. You give short, grounded answers using their actual numbers. You do not give generic advice.

## When to Call Tools
- Call \`get_financial_insights\` any time you need fresh financial data (balance, bills, income, safe-to-spend).
- Call \`forecast_purchase\` with the exact amount_cents whenever the user asks about affording something specific or is looking at a product with a visible price.
- Always call a tool rather than guessing a number.

## Core Financial Rules
1. NEVER fabricate financial figures — use tools to get real data.
2. "Safe to spend" is already net of their reserve buffer — this is their real available amount.
3. Upcoming bills in the next 14 days are certain obligations — always factor them in.
4. Amounts from tools are in cents — convert to dollars for the user ($1234 cents = $12.34).
5. If the snapshot is stale or incomplete, say so and offer to re-check.
6. Stay consistent with what the user sees on their financial dashboard.
7. Never execute transactions, transfers, or payments — you advise only.

## Response Format
- Keep it to 2-3 sentences for most situations.
- Lead with the decision or the key number.
- Be specific: name the bill, the date, the amount.
- If the situation is tight, say so plainly — do not soften the truth.

## Response Examples
"You have $312 safe to spend. After this $45.99 Amazon purchase you'll have $266 — with your $650 rent due in 8 days, you're still fine."
"Hold off on this one. You have $89 safe to spend and $420 in bills due this week. This $75 laptop cable cuts it too close."
"Great timing — your $1,200 paycheck lands in 3 days. Even with rent coming up, you'll be comfortable after this purchase."
"Your balance is $1,234 but your real spending room is $934 after your reserve. Rent and utilities together are $730 due next week, so you have about $200 of true flexibility right now."

## What You Never Do
- Make up account balances, bill amounts, or dates not given in the context or tool results.
- Give advice that contradicts the numbers on the user's financial dashboard.
- Recommend financial products, investments, or services.
- Execute or simulate any financial transaction.`;

// ── Tool definitions (client-side: executed by Electron renderer) ─────────────
const TOOLS = [
  {
    type: 'client',
    name: 'get_financial_insights',
    description: 'Retrieve the user\'s current real-time financial snapshot: account balance, safe-to-spend after reserve, upcoming bills (next 14 days), expected income, loan obligations, recent 30-day activity, rewards points, and data quality/freshness indicators. Call this whenever you need current financial data.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'client',
    name: 'forecast_purchase',
    description: 'Forecast the impact of a specific purchase on the user\'s account. Returns the projected minimum balance, when it occurs, whether the account would go negative, whether it falls below the reserve, and the reasons driving the low point. Use this whenever the user mentions a specific amount they want to spend.',
    parameters: {
      type: 'object',
      properties: {
        amount_cents: {
          type: 'integer',
          description: 'The purchase amount in cents (e.g., 4999 for $49.99, 18999 for $189.99).',
        },
      },
      required: ['amount_cents'],
    },
  },
];

// ── Create agent ──────────────────────────────────────────────────────────────
console.log('Creating Flicky Financial Advisor agent on ElevenLabs…');

const response = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
  method: 'POST',
  headers: {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Flicky Financial Advisor',
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: 'claude-3-5-sonnet',
          temperature: 0.4,
          max_tokens: 300,
        },
        first_message: "Hi! I'm Flicky, your personal financial advisor. I can see your account and what you're browsing. What would you like to know?",
        language: 'en',
      },
      asr: {
        quality: 'high',
        user_input_audio_format: 'pcm_16000',
        keywords: [],
      },
      tts: {
        model_id: 'eleven_flash_v2_5',
        voice_id: voiceId,
        agent_output_audio_format: 'pcm_16000',
        optimize_streaming_latency: 3,
      },
      conversation: {
        max_duration_seconds: 300,
        client_events: ['audio', 'transcript', 'interruption', 'agent_response'],
      },
    },
    tools: TOOLS,
  }),
});

if (!response.ok) {
  const error = await response.text();
  console.error('✗ Failed to create agent:', response.status, error);
  process.exit(1);
}

const agent = await response.json();
const agentId = agent.agent_id;

if (!agentId) {
  console.error('✗ Unexpected response (no agent_id):', JSON.stringify(agent));
  process.exit(1);
}

console.log('✓ Agent created:', agentId);

// ── Write agent ID to .env ─────────────────────────────────────────────────────
let envContent = readFileSync('.env', 'utf8');
if (envContent.includes('ELEVENLABS_AGENT_ID=')) {
  envContent = envContent.replace(/ELEVENLABS_AGENT_ID=.*/g, `ELEVENLABS_AGENT_ID=${agentId}`);
} else {
  envContent = envContent.trimEnd() + `\nELEVENLABS_AGENT_ID=${agentId}\n`;
}
writeFileSync('.env', envContent);

console.log('✓ Saved to .env: ELEVENLABS_AGENT_ID=' + agentId);
console.log('');
console.log('Next steps:');
console.log('  1. Restart the app (npm run dev) to pick up the new agent ID');
console.log('  2. The voice button will now use the Conversational AI agent');
