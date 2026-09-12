import type { IntentRouter, RouterInput } from '../conversation/types';
import { ProviderUnavailableError } from './speech';
export function createAnthropicIntentRouter(options: { apiKey?: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number }): IntentRouter {
  return { mode: 'anthropic', async route(_input: RouterInput) { if (!options.apiKey) throw new ProviderUnavailableError('Anthropic router unavailable: API key missing'); throw new ProviderUnavailableError('Anthropic router adapter requires configured schema transport'); } };
}
