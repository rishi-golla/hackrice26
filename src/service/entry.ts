import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { buildServer } from './server';
import { createSpeechDependencies } from './speech-config';
import { createDemoAuthProvider } from './auth';
import { demoSnapshot } from '../fixtures/demo';
import type { Snapshot } from '../domain/types';
import { createHttpModelProvider } from './providers/model';
import { createDeterministicFormatter } from './model';
import { createNessieFromEnv, readNessieCacheTtlMs } from './providers/nessie-snapshot';

async function main() {
  const mode = process.env.FLICKY_DATA_MODE ?? 'synthetic';
  if (mode !== 'synthetic' && mode !== 'recorded-sandbox' && mode !== 'live-sandbox') {
    throw new Error('Select synthetic, recorded-sandbox, or live-sandbox explicitly.');
  }
  let recording: Snapshot | undefined;
  if (mode === 'recorded-sandbox') {
    if (!process.env.FLICKY_SNAPSHOT_PATH) throw new Error('Recorded mode requires FLICKY_SNAPSHOT_PATH.');
    recording = JSON.parse(await readFile(process.env.FLICKY_SNAPSHOT_PATH, 'utf8'));
    if (recording?.mode !== mode) throw new Error('Recorded snapshot must be labeled recorded-sandbox.');
  }
  const live = mode === 'live-sandbox' ? createNessieFromEnv(process.env) : undefined;
  const sample = recording ?? demoSnapshot();
  const accountIds = live?.accountIds ?? [sample.accountId];
  const provider = live?.provider ?? {
    async read(accountId: string) {
      if (accountId !== sample.accountId) throw new Error('Unknown account');
      // Fixtures retain their stated date/asOf; never relabel recorded data as fresh live data.
      return structuredClone(recording ?? demoSnapshot());
    },
  };
  const speech = createSpeechDependencies();
  const model = process.env.CAPPY_MODEL_BASE_URL && process.env.CAPPY_MODEL
    ? createHttpModelProvider()
    : createDeterministicFormatter();
  const server = buildServer({
    sessionToken: process.env.FLICKY_SESSION_TOKEN ?? '',
    accountIds,
    mode,
    ...(live ? { snapshotTtlMs: readNessieCacheTtlMs(process.env) } : {}),
  }, provider, { auth: createDemoAuthProvider(), model, transcribe: speech.transcribe, synthesize: speech.synthesize });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(JSON.stringify({ port: Number(new URL(address).port), accountId: accountIds[0], mode,
    capabilities: { router: true, ...speech.capabilities, financialActions: false } }) + '\n');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.resume(); process.stdin.on('end', stop);
}
main().catch(error => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'Service failed\n'); process.exit(1); });
