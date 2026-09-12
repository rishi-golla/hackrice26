import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { buildServer } from './server';
import { createSpeechDependencies } from './speech-config';
import { createDemoAuthProvider } from './auth';
import { demoSnapshot } from '../fixtures/demo';
import type { Snapshot } from '../domain/types';
import { createHttpModelProvider } from './providers/model';
import { createDeterministicFormatter } from './model';
import { createPersonaProvider } from './providers/persona';
import { VerificationStore } from './verification';

async function main() {
  const mode = process.env.FLICKY_DATA_MODE ?? 'synthetic';
  if (mode !== 'synthetic' && mode !== 'recorded-sandbox') throw new Error('Live Nessie contract is not verified. Select synthetic or recorded-sandbox explicitly.');
  let recording: Snapshot | undefined;
  if (mode === 'recorded-sandbox') {
    if (!process.env.FLICKY_SNAPSHOT_PATH) throw new Error('Recorded mode requires FLICKY_SNAPSHOT_PATH.');
    recording = JSON.parse(await readFile(process.env.FLICKY_SNAPSHOT_PATH, 'utf8'));
    if (recording?.mode !== mode) throw new Error('Recorded snapshot must be labeled recorded-sandbox.');
  }
  const sample = recording ?? demoSnapshot();
  const personaConfig = { apiKey: process.env.PERSONA_API_KEY ?? '', templateId: process.env.PERSONA_INQUIRY_TEMPLATE_ID ?? '',
    environmentId: process.env.PERSONA_ENVIRONMENT_ID ?? '' };
  const ttlSeconds = Number(process.env.PERSONA_VERIFICATION_TTL_SECONDS ?? 300);
  const configured = personaConfig.apiKey.length > 0 && /^itmpl_[A-Za-z0-9]+$/.test(personaConfig.templateId) &&
    /^env_[A-Za-z0-9]+$/.test(personaConfig.environmentId) && Number.isFinite(ttlSeconds) && ttlSeconds > 0;
  const verification = new VerificationStore({ templateId: personaConfig.templateId, environmentId: personaConfig.environmentId, environment: process.env.PERSONA_ENVIRONMENT,
    mode, ttlMs: ttlSeconds * 1000, provider: configured ? createPersonaProvider(personaConfig) : undefined });
  const speech = createSpeechDependencies();
  const model = process.env.CAPPY_MODEL_BASE_URL && process.env.CAPPY_MODEL
    ? createHttpModelProvider()
    : createDeterministicFormatter();
  const server = buildServer({ sessionToken: process.env.FLICKY_SESSION_TOKEN ?? '', accountIds: [sample.accountId], mode }, {
    async read(accountId) {
      if (accountId !== sample.accountId) throw new Error('Unknown account');
      // Fixtures retain their stated date/asOf; never relabel recorded data as fresh live data.
      return structuredClone(recording ?? demoSnapshot());
    },
  }, { auth: createDemoAuthProvider(), verification, model, transcribe: speech.transcribe, synthesize: speech.synthesize });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(JSON.stringify({ port: Number(new URL(address).port), accountId: sample.accountId, mode,
    capabilities: { router: true, ...speech.capabilities, financialActions: false } }) + '\n');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.resume(); process.stdin.on('end', stop);
}
main().catch(error => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'Service failed\n'); process.exit(1); });
