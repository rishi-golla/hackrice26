export interface CappyModelProvider {
  complete(input: { system: string; user: string; tools: string[] }): Promise<{ text: string; toolCalls: unknown[] }>;
}

export class ModelTimeoutError extends Error {
  readonly code = 'MODEL_TIMEOUT';
  constructor(message = 'Model provider timed out') { super(message); this.name = 'ModelTimeoutError'; }
}

export function createDeterministicFormatter(): CappyModelProvider {
  return {
    async complete(input) {
      const user = input.user.trim();
      if (!user) return { text: 'Tell me what purchase you want to evaluate.', toolCalls: [] };
      // Grounded answers are already deterministic; the offline formatter preserves
      // every computed amount and date instead of inventing a paraphrase.
      return { text: user, toolCalls: [] };
    },
  };
}
