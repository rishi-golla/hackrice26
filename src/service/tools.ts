import { z } from 'zod';
import { explain } from '../domain/explain';
import { evaluateScenario } from '../domain/scenario';
import type { Forecast, HypotheticalPurchase, Snapshot } from '../domain/types';
import { validateSnapshot } from '../domain/types';
import type { CappyProfile } from './profile';
import type { CappySession } from './auth';
import { requireVerification } from './policy';
import { unavailableVerificationGate, type VerificationGate } from './verification';

export type CappyToolPolicy = { readOnly: true; requiresSession: true; accountScoped: true };
export type CappyToolContext = { session: CappySession; profile: CappyProfile };
export type CappyTool = {
  name: string;
  description: string;
  policy: CappyToolPolicy;
  execute(input: unknown, context: CappyToolContext): Promise<unknown>;
};
export interface CappyToolRegistry {
  register(tool: CappyTool): void;
  call(name: string, input: unknown, context: CappyToolContext): Promise<unknown>;
}

const policy: CappyToolPolicy = { readOnly: true, requiresSession: true, accountScoped: true };
const account = z.string().min(1).max(120);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const purchase = z.object({ id: z.string().min(1).max(120), label: z.string().min(1).max(120), cents, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const accountInput = z.object({ accountId: account }).strict();
const accountScopedInput = z.object({ accountId: account }).passthrough();

function validContext(context: CappyToolContext): void {
  if (!context?.session || typeof context.session.id !== 'string' || !context.session.id ||
      !context.session.userId || !context.session.accountId || Date.parse(context.session.expiresAt) <= Date.now()) {
    throw Object.assign(new Error('Valid session required'), { statusCode: 401 });
  }
  if (!context.profile) throw Object.assign(new Error('Profile required'), { statusCode: 401 });
}

export class InMemoryCappyToolRegistry implements CappyToolRegistry {
  private readonly tools = new Map<string, CappyTool>();
  constructor(private readonly verification: VerificationGate = unavailableVerificationGate) {}
  register(tool: CappyTool): void {
    if (!tool.name || this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    if (tool.policy?.readOnly !== true || tool.policy?.requiresSession !== true || tool.policy?.accountScoped !== true) {
      throw new Error(`Tool ${tool.name} violates the read-only account policy`);
    }
    this.tools.set(tool.name, tool);
  }
  async call(name: string, input: unknown, context: CappyToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 404 });
    if (tool.policy.readOnly !== true || tool.policy.requiresSession !== true || tool.policy.accountScoped !== true) {
      throw new Error(`Tool ${name} violates the read-only account policy`);
    }
    validContext(context);
    const scopedInput = accountScopedInput.parse(input);
    requireVerification(context.session, scopedInput.accountId, 'account-sensitive-read', this.verification);
    return tool.execute(input, context);
  }
  names(): string[] { return [...this.tools.keys()]; }
}

export type CappyToolRegistryOptions = {
  snapshot: (accountId: string) => Promise<Snapshot>;
  forecastId?: (forecast: Forecast) => string;
  verification?: VerificationGate;
};

export function createCappyToolRegistry(options: CappyToolRegistryOptions): InMemoryCappyToolRegistry {
  const verification = options.verification ?? unavailableVerificationGate;
  const registry = new InMemoryCappyToolRegistry(verification);
  const get = async (input: unknown, context: CappyToolContext) => {
    const parsed = accountInput.parse(input);
    return structuredClone(await options.snapshot(parsed.accountId));
  };
  registry.register({ name: 'getSnapshot', description: 'Read the current account snapshot.', policy, execute: get });
  registry.register({
    name: 'forecastPurchase', description: 'Forecast one hypothetical purchase against the account.', policy,
    async execute(input, context) {
      const parsed = z.object({ accountId: account, purchaseCents: cents, reserveCents: cents, purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().parse(input);
      const snapshot = await options.snapshot(parsed.accountId);
      const item: HypotheticalPurchase = { id: 'tool-purchase', label: 'Purchase', cents: parsed.purchaseCents, date: parsed.purchaseDate ?? snapshot.today };
      return evaluateScenario(validateSnapshot(snapshot), parsed.purchaseCents ? [item] : [], parsed.reserveCents);
    },
  });
  registry.register({
    name: 'compareScenario', description: 'Compare a set of hypothetical purchases against the account.', policy,
    async execute(input, context) {
      const parsed = z.object({ accountId: account, purchases: z.array(purchase).max(20), reserveCents: cents }).strict().parse(input);
      const snapshot = await options.snapshot(parsed.accountId);
      return evaluateScenario(validateSnapshot(snapshot), parsed.purchases, parsed.reserveCents);
    },
  });
  registry.register({
    name: 'explainForecast', description: 'Explain a deterministic forecast result.', policy,
    async execute(input, context) {
      validContext(context);
      const parsed = z.object({ accountId: account, forecast: z.unknown() }).strict().parse(input);
      const forecast = parsed.forecast as Forecast;
      if (!forecast || !Array.isArray(forecast.reasons) || typeof forecast.minimumCents !== 'number') throw new TypeError('Invalid forecast');
      return { text: explain(forecast), forecast: structuredClone(forecast), id: options.forecastId?.(forecast) };
    },
  });
  return registry;
}
