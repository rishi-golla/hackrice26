import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { buildServer } from './server';
import { createSpeechDependencies } from './speech-config';
import { createDemoAuthProvider } from './auth';
import { demoSnapshot } from '../fixtures/demo';
import type { Snapshot } from '../domain/types';
import { createHttpModelProvider } from './providers/model';
import { createDeterministicFormatter } from './model';
import { createNessieProvider } from './providers/nessie';
import type { SnapshotProvider } from './snapshot';

async function main() {
  const mode = process.env.FLICKY_DATA_MODE ?? 'synthetic';
  if (mode === 'live-sandbox' && !process.env.NESSIE_API_KEY) {
    throw new Error('Live Nessie mode requires NESSIE_API_KEY. Select synthetic or recorded-sandbox explicitly, or set the key.');
  }
  if (mode !== 'synthetic' && mode !== 'recorded-sandbox' && mode !== 'live-sandbox') {
    throw new Error('FLICKY_DATA_MODE must be synthetic, recorded-sandbox, or live-sandbox.');
  }
  let recording: Snapshot | undefined;
  if (mode === 'recorded-sandbox') {
    if (!process.env.FLICKY_SNAPSHOT_PATH) throw new Error('Recorded mode requires FLICKY_SNAPSHOT_PATH.');
    recording = JSON.parse(await readFile(process.env.FLICKY_SNAPSHOT_PATH, 'utf8'));
    if (recording?.mode !== mode) throw new Error('Recorded snapshot must be labeled recorded-sandbox.');
  }
  const liveAccountId = process.env.NESSIE_ACCOUNT_ID;
  if (mode === 'live-sandbox' && !liveAccountId) throw new Error('Live Nessie mode requires NESSIE_ACCOUNT_ID.');
  const sample = mode === 'live-sandbox'
    ? { ...demoSnapshot(), accountId: liveAccountId!, mode: 'live-sandbox' as const }
    : recording ?? demoSnapshot();
  const speech = createSpeechDependencies();
  const model = process.env.CAPPY_MODEL_BASE_URL && process.env.CAPPY_MODEL
    ? createHttpModelProvider()
    : createDeterministicFormatter();
  const nessieProvider: SnapshotProvider | undefined = mode === 'live-sandbox'
    ? createNessieProvider({ apiKey: process.env.NESSIE_API_KEY, baseUrl: process.env.NESSIE_BASE_URL, timezone: process.env.FLICKY_TIMEZONE })
    : undefined;
  const server = buildServer({ sessionToken: process.env.FLICKY_SESSION_TOKEN ?? '', accountIds: [sample.accountId], mode }, {
    async read(accountId) {
      if (accountId !== sample.accountId) throw new Error('Unknown account');
      if (nessieProvider) return nessieProvider.read(accountId);
      // Fixtures retain their stated date/asOf; never relabel recorded data as fresh live data.
      return structuredClone(recording ?? demoSnapshot());
    },
  }, { auth: createDemoAuthProvider(undefined, sample.accountId), model, transcribe: speech.transcribe, synthesize: speech.synthesize });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(JSON.stringify({ port: Number(new URL(address).port), accountId: sample.accountId, mode,
    capabilities: { router: true, ...speech.capabilities, financialActions: false } }) + '\n');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.resume(); process.stdin.on('end', stop);
}
main().catch(error => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'Service failed\n'); process.exit(1); });
