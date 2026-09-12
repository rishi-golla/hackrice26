import { z } from 'zod';
import { addDays } from '../../domain/calendar';
import { parseUSD } from '../../domain/money';
import type { Intent, IntentRouter, RouterInput } from './types';
export const intentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('evaluate'), purchaseIds: z.array(z.string()).default([]), amountCents: z.number().int().nonnegative().optional(), date: z.string().optional() }).strict(),
  z.object({ kind: z.literal('remember'), purchaseId: z.string() }).strict(), z.object({ kind: z.literal('explain') }).strict(), z.object({ kind: z.literal('forget') }).strict(), z.object({ kind: z.literal('clarify'), question: z.string() }).strict(), z.object({ kind: z.literal('unsupported') }).strict(),
]);
const money = (text: string) => { const match = text.match(/\$\s*([0-9][\d,]*(?:\.\d{1,2})?)|\b([0-9][\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/i); const value = match?.[1] ?? match?.[2]; if (value) { try { return parseUSD(`$${value}`); } catch { return undefined; } } const words: Record<string, number> = { ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, one: 1, five: 5 }; const spoken = text.match(new RegExp(`\\b(${Object.keys(words).join('|')})\\s+dollars?\\b`, 'i')); return spoken ? words[spoken[1].toLowerCase()] * 100 : undefined; };
export function isGenericHelpRequest(text: string): boolean {
  return /^(?:help|hello|hi|hey|what can you do(?: for me)?|how can you help(?: me)?|how does this work)\??$/i.test(text.trim());
}
function dateFrom(text: string, input: RouterInput): string | undefined {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]; if (iso) return iso;
  const lower = text.toLowerCase(); if (/\btoday\b/.test(lower)) return input.today;
  const month = lower.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/);
  if (month) { const parsed = new Date(`${month[0]} ${new Date(`${input.today}T00:00:00Z`).getUTCFullYear()} UTC`); if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10); }
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']; const index = weekdays.findIndex(day => lower.includes(day)); if (index < 0) return undefined;
  const baseDate = /\bthen\b/.test(lower) && input.lastScenario[0]?.date ? input.lastScenario[0].date : input.today;
  const today = new Date(`${baseDate}T00:00:00Z`).getUTCDay(); let delta = (index - today + 7) % 7;
  if (/next\s+/.test(lower) && delta === 0) delta = 7; if (/next\s+/.test(lower) && delta < 7) delta += 7;
  return addDays(baseDate, delta);
}
export async function routeIntent(input: RouterInput): Promise<Intent> {
  const lower = input.text.toLowerCase().trim();
  if (/forget|clear (?:this|the) conversation/.test(lower)) return { kind: 'forget' };
  if (/^why\b|explain/.test(lower)) return { kind: 'explain' };
  if (/send|transfer|pay someone|execute/.test(lower)) return { kind: 'unsupported' };
  if (/remember/.test(lower)) return { kind: 'remember', purchaseId: input.candidates[0]?.id ?? input.references[0]?.id ?? '' };
  const amountCents = money(lower); const date = dateFrom(lower, input);
  if (amountCents !== undefined || date || /afford|buy|purchase|what if|can i|\bboth\b|estimate|earlier/.test(lower)) {
    const ids = /both/.test(lower) ? input.references.map(ref => ref.id) : input.lastScenario.length ? [input.lastScenario[0].id] : [];
    return { kind: 'evaluate', purchaseIds: ids, ...(amountCents === undefined ? {} : { amountCents }), ...(date ? { date } : {}) };
  }
  return { kind: 'unsupported' };
}
export class ValidatedIntentRouter implements IntentRouter {
  readonly mode: string;
  constructor(private readonly delegate: IntentRouter) { this.mode = delegate.mode; }
  async route(input: RouterInput): Promise<Intent> { const result = await this.delegate.route(input); const parsed = intentSchema.safeParse(result); return parsed.success ? parsed.data : { kind: 'unsupported' }; }
}
export const deterministicRouter: IntentRouter = { mode: 'deterministic-fallback', route: routeIntent };
