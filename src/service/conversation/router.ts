import { z } from 'zod';
import type {
  ConversationSession,
  Intent,
  IntentRouterContext,
  IntentRouterProvider,
  RouterReference,
} from './types.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const evaluateSchema = z
  .object({
    kind: z.literal('evaluate'),
    purchaseIds: z.array(z.string().min(1)).max(10),
    amountCents: z.number().int().nonnegative().optional(),
    date: dateSchema.optional(),
  })
  .strict();

const rememberSchema = z
  .object({
    kind: z.literal('remember'),
    purchaseId: z.string().min(1),
  })
  .strict();

const explainSchema = z.object({ kind: z.literal('explain') }).strict();
const forgetSchema = z.object({ kind: z.literal('forget') }).strict();
const clarifySchema = z
  .object({
    kind: z.literal('clarify'),
    question: z.string().min(1).max(500),
  })
  .strict();
const unsupportedSchema = z.object({ kind: z.literal('unsupported') }).strict();

export const intentSchema = z.discriminatedUnion('kind', [
  evaluateSchema,
  rememberSchema,
  explainSchema,
  forgetSchema,
  clarifySchema,
  unsupportedSchema,
]);

export type IntentRouterErrorCode = 'invalid-input' | 'invalid-output' | 'unknown-reference' | 'provider-failed';

export class IntentRouterError extends Error {
  public readonly name = 'IntentRouterError';

  public constructor(
    public readonly code: IntentRouterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const ALLOWED_INTENTS: readonly Intent['kind'][] = [
  'evaluate',
  'remember',
  'explain',
  'forget',
  'clarify',
  'unsupported',
];

function toRouterReferences(
  session: ConversationSession,
  context: IntentRouterContext,
): RouterReference[] {
  const references = new Map<string, ConversationSession['references'][number]>();
  for (const reference of [...session.references.filter((reference) => reference.confirmed), ...(context.freshReferences ?? [])]) {
    if (!references.has(reference.id)) {
      references.set(reference.id, reference);
    }
  }
  return [...references.values()]
    .map((reference) => ({
      id: reference.id,
      label: JSON.stringify(reference.label),
      cents: reference.cents,
      date: reference.date,
      origin: reference.origin,
    }));
}

function validateReferenceIds(
  intent: Intent,
  session: ConversationSession,
  context: IntentRouterContext,
): void {
  const confirmedIds = new Set(
    session.references.filter((reference) => reference.confirmed).map((reference) => reference.id),
  );
  const evaluableIds = new Set([
    ...confirmedIds,
    ...(context.freshReferences ?? []).map((reference) => reference.id),
  ]);
  const ids = intent.kind === 'evaluate' ? intent.purchaseIds : intent.kind === 'remember' ? [intent.purchaseId] : [];
  const knownIds = intent.kind === 'evaluate' ? evaluableIds : confirmedIds;
  if (ids.some((id) => !knownIds.has(id)) || new Set(ids).size !== ids.length) {
    throw new IntentRouterError(
      'unknown-reference',
      'The intent referenced a purchase that is not confirmed in this session.',
    );
  }
}

export async function routeIntent(
  text: string,
  session: ConversationSession,
  provider: IntentRouterProvider,
  context: IntentRouterContext = {},
): Promise<Intent> {
  const utterance = text.trim();
  if (utterance.length === 0) {
    throw new IntentRouterError('invalid-input', 'An empty utterance cannot be routed.');
  }

  let raw: unknown;
  try {
    const routerRequest = {
      utterance,
      references: toRouterReferences(session, context),
      allowedIntents: ALLOWED_INTENTS,
      ...(context.today ? { today: context.today } : {}),
      ...(context.timezone ? { timezone: context.timezone } : {}),
    } satisfies Parameters<IntentRouterProvider>[0];
    raw = await provider(routerRequest);
  } catch (error) {
    throw new IntentRouterError('provider-failed', 'The intent provider failed.', {
      cause: error,
    });
  }

  const parsed = intentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntentRouterError('invalid-output', 'The intent provider returned an unsupported result.', {
      cause: parsed.error,
    });
  }

  const intent = parsed.data;
  validateReferenceIds(intent, session, context);
  return intent;
}
