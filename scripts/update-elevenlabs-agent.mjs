/**
 * Updates the existing Flicky ElevenLabs ConvAI agent to add new tools:
 *   - search_products   (compare prices online)
 *   - navigate_browser  (open URL in user's browser)
 *   - get_screen_context (read current screen text via OCR)
 *
 * Run: node scripts/update-elevenlabs-agent.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const envFile = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => { const [k, ...v] = line.split('='); return [k.trim(), v.join('=').trim()]; })
);

const apiKey = env.ELEVENLABS_API_KEY;
const agentId = env.ELEVENLABS_AGENT_ID;

if (!apiKey) { console.error('✗ ELEVENLABS_API_KEY not set in .env'); process.exit(1); }
if (!agentId) { console.error('✗ ELEVENLABS_AGENT_ID not set in .env — run setup-elevenlabs-agent.mjs first'); process.exit(1); }

const SYSTEM_PROMPT = `You are Flicky, a real-time personal financial advisor embedded directly in the user's cursor on their desktop. You have live access to their bank account data and can see what they are currently browsing on screen.

## Live Financial Context
{{financial_summary}}

## Current Screen / Browser Context
{{browser_context}}

## Your Identity & Style
You are the user's trusted financial advisor — warm, specific, and direct. You speak like a brilliant friend who knows everything about their money AND helps them find the best deals online. You give short, grounded answers using their actual numbers. You never fabricate figures.

## Tool Usage

### Financial Tools
- Call \`get_financial_insights\` any time you need fresh financial data (balance, bills, income, safe-to-spend).
- Call \`forecast_purchase\` with the exact amount_cents whenever the user asks about affording something specific or is looking at a product with a visible price.

### Screen Tools
- Call \`get_screen_context\` when you need to see what the user is currently looking at — product name, price, website.

### Search & Navigate Tools
- Call \`search_products\` when the user asks "should I buy this?", "is this a good deal?", or wants to know about alternatives. Search broadly — new and used markets.
- After \`search_products\` returns results, tell the user what you found (best price, best value).
- If you find a deal that is >10% cheaper OR is significantly better value, call \`navigate_browser\` to take the user there AUTOMATICALLY. Say "I'm opening the better deal for you now" before calling it.
- For used/second-hand items: always search eBay used and Facebook Marketplace. If there's a great used deal (>30% savings), navigate directly.
- Call \`navigate_browser\` with the best URL when you want the user to see a product, comparison, or deal.

## Core Financial Rules
1. NEVER fabricate financial figures — use tools to get real data.
2. "Safe to spend" is already net of their reserve buffer — this is their real available amount.
3. Upcoming bills in the next 14 days are certain obligations — always factor them in.
4. Amounts from tools are in cents — convert to dollars for the user ($4999 cents = $49.99).
5. If the snapshot is stale or incomplete, say so and offer to re-check.
6. Stay consistent with what the user sees on their financial dashboard.
7. Never execute transactions, transfers, or payments — you advise only.

## Response Format
- Keep it to 2-3 sentences for most situations.
- Lead with the decision or the key number.
- Be specific: name the bill, the date, the amount, the alternative you found.
- If the situation is tight, say so plainly — do not soften the truth.
- When navigating, say "Opening [site] now — [brief reason]" before calling navigate_browser.

## Response Examples
"You have $312 safe to spend. After this $45.99 Amazon purchase you'll have $266 — with your $650 rent due in 8 days, you're still fine."
"Hold off on this one. You have $89 safe to spend and $420 in bills due this week. This $75 laptop cable cuts it too close."
"I found the same headphones for $149 on eBay — $50 less than what you're looking at. Opening that for you now."
"Great news — this is actually the best price I found. Amazon, Best Buy and eBay are all higher. And you can afford it with $200 left over."
"There's an insane deal — same item, excellent condition on eBay for $89. Opening it now. That's 55% off."

## What You Never Do
- Make up account balances, bill amounts, or dates.
- Give advice that contradicts the numbers on the user's financial dashboard.
- Recommend financial products, investments, or services.
- Execute or simulate any financial transaction.
- Navigate to a URL without telling the user first.`;

const ALL_TOOLS = [
  {
    type: 'client',
    name: 'get_financial_insights',
    description: 'Retrieve the user\'s current real-time financial snapshot: account balance, safe-to-spend after reserve, upcoming bills (next 14 days), expected income, loan obligations, recent 30-day activity, rewards points, and data quality/freshness indicators. Call this whenever you need current financial data.',
    parameters: { type: 'object', properties: {}, required: [] },
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
  {
    type: 'client',
    name: 'get_screen_context',
    description: 'Get the text currently visible on the user\'s screen via OCR. Call this when you need to identify what product the user is viewing, the price displayed, or the website they are on. Returns the raw OCR text from the screen.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'client',
    name: 'search_products',
    description: 'Search the web for product alternatives and price comparisons. Call this when the user asks if they should buy something, wants to know if there is a better deal, or you want to compare options. Returns a list of results with prices and purchase URLs, plus direct search URLs for Amazon, eBay, Google Shopping, and Facebook Marketplace.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name or description to search for. Be specific — include brand and model if known (e.g., "Sony WH-1000XM4 headphones" not just "headphones").',
        },
        context: {
          type: 'string',
          description: 'Optional context about what the user is considering, e.g. "considering $199 Sony WH-1000XM4 on Amazon, user has $312 safe to spend".',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'client',
    name: 'navigate_browser',
    description: 'Open a URL in the user\'s default browser. Call this to take the user to a product page, a better deal you found, or comparison search results. ALWAYS tell the user what you are opening and why BEFORE calling this tool.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to open (must start with https://).',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why you are navigating here, e.g. "eBay listing for same item at $89 — $60 cheaper".',
        },
      },
      required: ['url', 'reason'],
    },
  },
];

console.log(`Updating agent ${agentId}…`);

const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
  method: 'PATCH',
  headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Flicky Financial Advisor',
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: 'gemini-2.0-flash',
          temperature: 0.4,
          max_tokens: 400,
        },
        first_message: "Hi! I'm Flicky, your financial advisor. I can see your screen and banking data — I'll also search for better deals when you're shopping. What do you want to know?",
      },
      conversation: { max_duration_seconds: 600 },
    },
    tools: ALL_TOOLS,
  }),
});

if (!response.ok) {
  const error = await response.text();
  console.error('✗ Failed to update agent:', response.status, error);
  process.exit(1);
}

console.log('✓ Agent updated with new tools:');
console.log('  · get_financial_insights');
console.log('  · forecast_purchase');
console.log('  · get_screen_context  (NEW)');
console.log('  · search_products     (NEW)');
console.log('  · navigate_browser    (NEW)');
console.log('');
console.log('Run the app and try: "Should I buy this?" or "Find me a better deal"');
